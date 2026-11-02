// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// progressService.ts — Engagement-level progress summary.
// Reads Party.lifecycle and Disposition rows to compute effective state per party.
// abandoned/opted_out override lifecycle display because they are terminal Disposition
// states (not PartyLifecycle states). [validate with BHD — display ordering]

interface ProgressDb {
  party: {
    findMany(args?: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
  };
  disposition: {
    findMany(args?: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<Record<string, unknown>[]>;
  };
}

export interface PartyProgressEntry {
  party_id: string;
  name: string;
  lifecycle: string;
  last_activity_at: Date | null;
}

export interface EngagementProgress {
  parties: PartyProgressEntry[];
  counts: Record<string, number>;
}

export function createProgressService(db: ProgressDb) {
  return {
    async getEngagementProgress(engagementId: string): Promise<EngagementProgress> {
      const parties = await db.party.findMany({
        where: { engagement_id: engagementId },
        orderBy: { created_at: 'asc' },
      });

      const dispositions = await db.disposition.findMany({
        where: { engagement_id: engagementId },
        orderBy: { set_at: 'asc' },
      });

      const perParty: PartyProgressEntry[] = parties.map((party) => {
        const partyDispositions = dispositions
          .filter((d) => d['party_id'] === party['id'])
          .sort(
            (a, b) =>
              new Date(b['set_at'] as string).getTime() -
              new Date(a['set_at'] as string).getTime()
          );

        const latest = partyDispositions[0];

        // [validate with BHD] abandoned/opted_out override lifecycle display label
        let effectiveLifecycle: string = party['lifecycle'] as string;
        if (latest?.['state'] === 'abandoned') effectiveLifecycle = 'abandoned';
        else if (latest?.['state'] === 'opted_out') effectiveLifecycle = 'opted_out';

        return {
          party_id: party['id'] as string,
          name: party['name'] as string,
          lifecycle: effectiveLifecycle,
          last_activity_at: (party['last_activity_at'] as Date | null) ?? null,
        };
      });

      const counts: Record<string, number> = {};
      for (const p of perParty) {
        counts[p.lifecycle] = (counts[p.lifecycle] ?? 0) + 1;
      }

      return { parties: perParty, counts };
    },
  };
}
