// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// sessionsService.ts — Upsert-by-id sync of SPA Dexie interview sessions.

interface SessionDb {
  interviewSession: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
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
    },

    async get(id: string): Promise<Record<string, unknown> | null> {
      return db.interviewSession.findUnique({ where: { id } });
    },
  };
}
