// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// ph5-session-lifecycle.test.ts — PH-5 (R-F2 V121 red): a session sync advances the party's lifecycle, so a
// completed interview makes the party reassessable and the reassessment tick writes its reassessment_due reminder.

import { describe, it, expect } from 'vitest';
import { createSessionsService } from '../src/services/sessionsService.js';
import { createReassessmentService } from '../src/services/reassessmentService.js';
import { createMockDb } from './helpers/mockDb.js';

const T0 = new Date('2026-01-01T00:00:00Z');
const day = 86400000;

async function seed(db: ReturnType<typeof createMockDb>, lifecycle = 'invited') {
  const party = await db.party.create({ data: { tenant_id: 't-1', engagement_id: 'eng-1', name: 'Fictional Sub (FICTIONAL)', on_prem_ot: 'no', lifecycle } });
  await db.user.create({ data: { tenant_id: 't-1', party_id: party['id'], email: 'sub@example.invalid', role: 'sub' } });
  return party['id'] as string;
}
const sync = (id: string, partyId: string, status: 'in_progress' | 'complete', completed_at: Date | null = null) =>
  ({ id, party_id: partyId, facts: {}, timing_segments: [], selected_stacks: ['m365'], status, completed_at });
const lifecycleOf = async (db: ReturnType<typeof createMockDb>, id: string) => (await db.party.findUnique({ where: { id } }))?.['lifecycle'];

describe('PH-5: session sync advances the party lifecycle', () => {
  it('invited -> in_progress on an in-progress sync, then -> complete on a complete sync', async () => {
    const db = createMockDb();
    const p = await seed(db);
    const svc = createSessionsService(db as never, () => T0);
    await svc.sync(sync('s-1', p, 'in_progress'));
    expect(await lifecycleOf(db, p)).toBe('in_progress');
    await svc.sync(sync('s-1', p, 'complete', T0));
    expect(await lifecycleOf(db, p)).toBe('complete');
  });

  it('a stalled party resumes and completes in one complete sync; a party past complete is left alone', async () => {
    const db = createMockDb();
    const stalled = await seed(db, 'stalled');
    const ready = await seed(db, 'ready');
    const svc = createSessionsService(db as never, () => T0);
    await svc.sync(sync('s-2', stalled, 'complete', T0));
    expect(await lifecycleOf(db, stalled)).toBe('complete');
    await svc.sync(sync('s-3', ready, 'in_progress'));
    expect(await lifecycleOf(db, ready)).toBe('ready');
  });

  it('a sync for an unknown party still stores the session and changes nothing else', async () => {
    const db = createMockDb();
    const svc = createSessionsService(db as never, () => T0);
    const s = await svc.sync(sync('s-4', 'no-such-party', 'complete', T0));
    expect(s['id']).toBe('s-4');
  });

  it('after a completed interview, the reassessment tick 400 days on flips the party and records a reassessment_due reminder', async () => {
    const db = createMockDb();
    const p = await seed(db);
    const svc = createSessionsService(db as never, () => T0);
    await svc.sync(sync('s-5', p, 'in_progress'));
    await svc.sync(sync('s-5', p, 'complete', T0));
    const r = await createReassessmentService(db as never).tick('eng-1', new Date(T0.getTime() + 400 * day));
    expect(r.flipped.map((f) => f.party_id)).toEqual([p]);
    expect(await lifecycleOf(db, p)).toBe('reassessment_due');
    const outbox = await db.mailOutbox.findMany({ where: { tenant_id: 't-1' } });
    expect(outbox.some((m) => m['kind'] === 'reassessment_due')).toBe(true);
  });
});
