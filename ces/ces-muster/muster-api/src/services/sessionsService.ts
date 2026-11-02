// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// sessionsService.ts — Upsert-by-id sync of SPA Dexie interview sessions.
//
// PH-5 (R-F2 V121 red): a sync also moves the party along its interview lifecycle (lifecycleService), which nothing
// did before, so a party never reached 'complete' and the reassessment tick (reassessable: complete / ready / validate)
// could never fire: invited / stalled / reassessment_due -> in_progress on any sync, then in_progress -> complete when
// the synced session is complete. A party past 'complete' (ready, validate, convert_to_enclave) is left alone.

import { createLifecycleService } from './lifecycleService.js';

interface SessionDb {
  interviewSession: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  /** PH-5: the party store (absent on older test doubles: the lifecycle is not advanced). */
  party?: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  disposition?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  };
}

const RESUMES_INTERVIEW = new Set(['invited', 'stalled', 'reassessment_due']);

/** PH-5: advance the party's lifecycle for a synced session (see the header). */
async function advanceParty(db: SessionDb, partyId: string, status: SessionSyncInput['status'], now: () => Date): Promise<void> {
  if (!db.party || !db.disposition) return;
  const party = await db.party.findUnique({ where: { id: partyId } });
  if (!party) return;
  const lifecycle = createLifecycleService({ party: db.party, disposition: db.disposition }, now);
  let state = party['lifecycle'] as string;
  if (RESUMES_INTERVIEW.has(state)) {
    await lifecycle.transition(partyId, 'in_progress', 'system');
    state = 'in_progress';
  }
  if (status === 'complete' && state === 'in_progress') await lifecycle.transition(partyId, 'complete', 'system');
}

export interface SessionSyncInput {
  id: string;
  party_id: string;
  facts: unknown;
  timing_segments: unknown;
  selected_stacks: string[];
  status: 'in_progress' | 'complete';
  completed_at?: Date | null;
}

export function createSessionsService(db: SessionDb, now: () => Date = () => new Date()) {
  return {
    async sync(data: SessionSyncInput): Promise<Record<string, unknown>> {
      const session = await upsert(data);
      await advanceParty(db, data.party_id, data.status, now);
      return session;
    },

    async get(id: string): Promise<Record<string, unknown> | null> {
      return db.interviewSession.findUnique({ where: { id } });
    },
  };

  async function upsert(data: SessionSyncInput): Promise<Record<string, unknown>> {
    const existing = await db.interviewSession.findUnique({ where: { id: data.id } });
    if (existing) {
      return db.interviewSession.update({
        where: { id: data.id },
        data: {
          facts: data.facts,
          timing_segments: data.timing_segments,
          selected_stacks: data.selected_stacks,
          status: data.status,
          completed_at: data.completed_at ?? null,
        },
      });
    }
    return db.interviewSession.create({
      data: {
        id: data.id,
        party_id: data.party_id,
        facts: data.facts,
        timing_segments: data.timing_segments,
        selected_stacks: data.selected_stacks,
        status: data.status,
        completed_at: data.completed_at ?? null,
        created_at: now(),
      },
    });
  }
}
