// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// reassessmentService.ts — Continuous re-assessment cadence engine (Tier-3 annuity).
//
// Scans parties in reassessable lifecycle states and flips them to 'reassessment_due'
// when their last completed interview session is older than REASSESS_DAYS.
//
// Cadence default: 365 days (env REASSESS_DAYS). [validate with BHD: annual cadence]
// Idempotent: parties already in 'reassessment_due' are not in the eligible set,
// so a re-tick naturally produces no further flips.
//
// Each flip also records a mode-c TouchEvent kind='reassessment_cycle' with minutes=0
// at cycle start. Queryable actuals accrue when the advisor resolves the downstream
// HIL item (DONE-WHEN #9).

import { createLifecycleService } from './lifecycleService.js';
import { createTouchService } from './touchService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SYSTEM_USER_ID = 'system';

// States eligible for the reassessment flip.
// 'convert_to_enclave' is terminal (LEGAL_TRANSITIONS has no outbound edges) and
// cannot be transitioned — excluded to avoid throwing on an illegal transition.
// [validate with BHD] which terminal states are truly excluded.
const REASSESSABLE_STATES = new Set<string>(['complete', 'ready', 'validate']);

interface ReassessmentDb {
  party: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  disposition: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
  interviewSession: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
  touchEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): Promise<Record<string, unknown>[]>;
  };
}

export interface FlippedParty {
  party_id: string;
  previous: string;
  due_since: Date;
}

export function createReassessmentService(
  db: ReassessmentDb,
  nowFn: () => Date = () => new Date()
) {
  const reassessDays = parseInt(process.env['REASSESS_DAYS'] ?? '365', 10);

  return {
    /**
     * Runs one reassessment cycle tick.
     *
     * For each party in a reassessable state whose last completed session
     * was completed more than REASSESS_DAYS ago:
     *   1. Transitions lifecycle → 'reassessment_due' via lifecycleService.
     *   2. Records a mode-c TouchEvent kind='reassessment_cycle' with minutes=0.
     *
     * @param engagementId - Scope to a single engagement, or null for all.
     * @param now          - Simulated clock for testing; defaults to nowFn().
     * @returns { flipped } — list of parties that were transitioned this tick.
     */
    async tick(
      engagementId: string | null,
      now: Date = nowFn()
    ): Promise<{ flipped: FlippedParty[] }> {
      const lifecycleSvc = createLifecycleService(db, () => now);
      const touchSvc = createTouchService(db, () => now);

      const where: Record<string, unknown> = {};
      if (engagementId !== null) where['engagement_id'] = engagementId;

      const allParties = await db.party.findMany({ where });
      // Filter in JS — mockDb does not support set/in queries.
      const parties = allParties.filter(
        (p) => REASSESSABLE_STATES.has(p['lifecycle'] as string)
      );

      const flipped: FlippedParty[] = [];

      for (const party of parties) {
        const partyId = party['id'] as string;
        const lifecycle = party['lifecycle'] as string;
        const engId = party['engagement_id'] as string;
        const tenantId = party['tenant_id'] as string;

        // Find the most recent completed session for this party.
        const sessions = await db.interviewSession.findMany({
          where: { party_id: partyId, status: 'complete' },
        });

        if (sessions.length === 0) continue; // no completed session — skip

        const lastSession = sessions.reduce((latest, s) => {
          const d = new Date(s['completed_at'] as string | Date);
          const ld = new Date(latest['completed_at'] as string | Date);
          return d > ld ? s : latest;
        });

        const completedAt = new Date(lastSession['completed_at'] as string | Date);
        const daysSince = (now.getTime() - completedAt.getTime()) / MS_PER_DAY;

        if (daysSince > reassessDays) {
          // Transition lifecycle via lifecycleService (writes Disposition row).
          await lifecycleSvc.transition(partyId, 'reassessment_due', SYSTEM_USER_ID);

          // Record annuity-cycle touch at cycle start; minutes=0 (actuals accrue on resolve).
          // DONE-WHEN #9: each re-assessment cycle produces a queryable touch record.
          await touchSvc.record('c', 'reassessment_cycle', engId, tenantId, 0);

          flipped.push({ party_id: partyId, previous: lifecycle, due_since: completedAt });
        }
      }

      return { flipped };
    },
  };
}
