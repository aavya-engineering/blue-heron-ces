// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// nudgeService.ts — Nudge cadence engine (T+3/7/14, stall detection, escalation digest).
// Pure: injectable db and nowFn. All writes idempotent per (party_id, nudge_type).
// [validate with BHD] T+3/7/14 cadence thresholds and STALL_DAYS.

import { createLifecycleService } from './lifecycleService.js';
import { createTouchService } from './touchService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const NUDGE_THRESHOLDS: Array<{ days: number; type: 't3' | 't7' | 't14' }> = [
  { days: 3, type: 't3' },
  { days: 7, type: 't7' },
  { days: 14, type: 't14' },
];

const STALL_DAYS = 14; // strictly > 14 days → stall [validate with BHD]
const SYSTEM_USER_ID = 'system';

interface NudgeDb {
  party: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  nudgeEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
  disposition: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
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

export function createNudgeService(db: NudgeDb, nowFn: () => Date = () => new Date()) {
  async function hasExistingNudge(partyId: string, nudgeType: string): Promise<boolean> {
    const existing = await db.nudgeEvent.findMany({
      where: { party_id: partyId, nudge_type: nudgeType },
    });
    return existing.length > 0;
  }

  return {
    /**
     * Scans invited/in_progress parties in the given engagement (all if engagementId is null).
     * Fires t3/t7/t14 NudgeEvents when idle time since last_activity_at (fallback created_at)
     * crosses each threshold and no prior nudge of that type exists.
     * Stall detection: idle > 14 days AND lifecycle in_progress → transition to stalled +
     * fire stall NudgeEvent. All writes are idempotent.
     */
    async evaluate(
      engagementId: string | null,
      now: Date = nowFn()
    ): Promise<Record<string, unknown>[]> {
      const lifecycleSvc = createLifecycleService(db, () => now);

      const where: Record<string, unknown> = {};
      if (engagementId !== null) where.engagement_id = engagementId;

      const allParties = await db.party.findMany({ where });
      // Filter in JS because mockDb does not support `in` queries.
      const parties = allParties.filter(
        (p) => p['lifecycle'] === 'in_progress' || p['lifecycle'] === 'invited'
      );

      const fired: Record<string, unknown>[] = [];

      for (const party of parties) {
        const partyId = party['id'] as string;
        const engId = party['engagement_id'] as string;
        const lastActive =
          (party['last_activity_at'] as Date | string | null) ??
          (party['created_at'] as Date | string);
        const idleDays = (now.getTime() - new Date(lastActive).getTime()) / MS_PER_DAY;

        // T+3 / T+7 / T+14 nudges
        for (const { days, type } of NUDGE_THRESHOLDS) {
          if (idleDays >= days && !(await hasExistingNudge(partyId, type))) {
            const event = await db.nudgeEvent.create({
              data: {
                party_id: partyId,
                engagement_id: engId,
                nudge_type: type,
                channel: 'email', // [validate with BHD]
                sent_at: now,
                payload: { idle_days: Math.floor(idleDays) },
              },
            });
            fired.push(event);
          }
        }

        // Stall detection: strictly > 14 days idle AND lifecycle in_progress
        if (idleDays > STALL_DAYS && party['lifecycle'] === 'in_progress') {
          // lifecycleSvc uses () => now so last_activity_at is set to the simulated clock
          await lifecycleSvc.transition(partyId, 'stalled', SYSTEM_USER_ID);

          if (!(await hasExistingNudge(partyId, 'stall'))) {
            const event = await db.nudgeEvent.create({
              data: {
                party_id: partyId,
                engagement_id: engId,
                nudge_type: 'stall',
                channel: 'email', // [validate with BHD]
                sent_at: now,
                payload: { idle_days: Math.floor(idleDays) },
              },
            });
            fired.push(event);
          }
        }
      }

      return fired;
    },

    /**
     * Builds an escalation digest for the engagement: one NudgeEvent (escalation/digest)
     * whose payload lists all currently stalled party IDs. Also records a mode-c TouchEvent.
     * Returns null if no stalled parties exist.
     * [validate with BHD] digest counts as BHD touch mode-c; party_id set to first stalled
     * party per schema constraint (NudgeEvent.party_id is non-nullable).
     */
    async escalationDigest(
      engagementId: string,
      now: Date = nowFn()
    ): Promise<Record<string, unknown> | null> {
      const touchSvc = createTouchService(db, () => now);

      const stalledParties = await db.party.findMany({
        where: { engagement_id: engagementId, lifecycle: 'stalled' },
      });

      if (stalledParties.length === 0) return null;

      const partyIds = stalledParties.map((p) => p['id'] as string);
      const tenantId = stalledParties[0]['tenant_id'] as string;

      const payload = {
        party_ids: partyIds,
        generated_at: now.toISOString(),
      };

      const digest = await db.nudgeEvent.create({
        data: {
          party_id: partyIds[0],
          engagement_id: engagementId,
          nudge_type: 'escalation',
          channel: 'digest',
          sent_at: now,
          payload,
        },
      });

      // [validate with BHD] escalation digest counts as mode-c BHD touch
      await touchSvc.record('c', 'escalation_digest', engagementId, tenantId, 0);

      return digest;
    },
  };
}
