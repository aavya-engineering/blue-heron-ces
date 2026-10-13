// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// touchService.ts — mode-a/c touch event recording and reporting.
// mode-a: BHD advisor touch log (target: 0 minutes post-onboarding).
// mode-c: per-escalation timer captured when a HilItem is resolved.

interface TouchDb {
  touchEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): Promise<Record<string, unknown>[]>;
  };
}

export interface TouchReport {
  modeA: { events: number; totalMinutes: number };
  modeC: {
    events: number;
    totalMinutes: number;
    perEscalation: Array<{ id: unknown; kind: unknown; minutes: number; created_at: unknown }>;
  };
}

export function createTouchService(db: TouchDb, now: () => Date = () => new Date()) {
  return {
    async record(
      mode: 'a' | 'c',
      kind: string,
      engagementId: string,
      tenantId: string,
      minutes: number = 0
    ): Promise<Record<string, unknown>> {
      // [validate with BHD] mode-a bar=0 post-onboarding; mode-c per-escalation
      return db.touchEvent.create({
        data: {
          tenant_id: tenantId,
          engagement_id: engagementId,
          mode,
          kind,
          minutes,
          created_at: now(),
        },
      });
    },

    async report(engagementId: string): Promise<TouchReport> {
      const events = await db.touchEvent.findMany({
        where: { engagement_id: engagementId },
        orderBy: { created_at: 'asc' },
      });

      const modeA = events.filter((e) => e['mode'] === 'a');
      const modeC = events.filter((e) => e['mode'] === 'c');

      return {
        modeA: {
          events: modeA.length,
          totalMinutes: modeA.reduce((sum, e) => sum + ((e['minutes'] as number) ?? 0), 0),
        },
        modeC: {
          events: modeC.length,
          totalMinutes: modeC.reduce((sum, e) => sum + ((e['minutes'] as number) ?? 0), 0),
          perEscalation: modeC.map((e) => ({
            id: e['id'],
            kind: e['kind'],
            minutes: (e['minutes'] as number) ?? 0,
            created_at: e['created_at'],
          })),
        },
      };
    },
  };
}
