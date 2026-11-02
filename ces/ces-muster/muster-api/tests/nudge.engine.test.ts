// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createNudgeService } from '../src/services/nudgeService.js';
import { createMockDb } from './helpers/mockDb.js';

// Fixed epoch for all simulated-clock tests.
const BASE_TIME = new Date('2026-01-01T00:00:00Z');

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Seed a party with last_activity_at = created_at = BASE_TIME unless overridden.
async function seedParty(
  db: ReturnType<typeof createMockDb>,
  overrides: Record<string, unknown> = {}
) {
  return db.party.create({
    data: {
      tenant_id: 'tenant-1',
      engagement_id: 'eng-1',
      name: 'Test Party',
      on_prem_ot: 'no',
      lifecycle: 'in_progress',
      created_at: BASE_TIME,
      last_activity_at: BASE_TIME,
      ...overrides,
    },
  });
}

// ─── T+3 / T+7 / T+14 cadence ───────────────────────────────────────────────

describe('nudgeService — T+3/7/14 cadence (DONE-WHEN #9)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('T+3: fires t3 nudge and nothing else', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);

    const fired = await svc.evaluate('eng-1', addDays(BASE_TIME, 3));
    const types = fired.map((e) => e['nudge_type']);
    expect(types).toContain('t3');
    expect(types).not.toContain('t7');
    expect(types).not.toContain('t14');
    expect(types).not.toContain('stall');
  });

  it('T+3 idempotent: re-tick at same time fires nothing', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);
    const now = addDays(BASE_TIME, 3);

    await svc.evaluate('eng-1', now);
    const second = await svc.evaluate('eng-1', now);
    expect(second).toHaveLength(0);
  });

  it('T+7: fires t7 only (t3 already sent)', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);

    await svc.evaluate('eng-1', addDays(BASE_TIME, 3)); // fires t3
    const fired = await svc.evaluate('eng-1', addDays(BASE_TIME, 7));
    const types = fired.map((e) => e['nudge_type']);
    expect(types).toContain('t7');
    expect(types).not.toContain('t3');
    expect(types).not.toContain('t14');
  });

  it('T+7 idempotent: re-tick fires nothing', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);
    const t7 = addDays(BASE_TIME, 7);

    await svc.evaluate('eng-1', addDays(BASE_TIME, 3));
    await svc.evaluate('eng-1', t7);
    const third = await svc.evaluate('eng-1', t7);
    expect(third).toHaveLength(0);
  });

  it('T+14: fires t14 only (t3+t7 already sent, exactly 14d is NOT stall)', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);

    await svc.evaluate('eng-1', addDays(BASE_TIME, 3));
    await svc.evaluate('eng-1', addDays(BASE_TIME, 7));
    const fired = await svc.evaluate('eng-1', addDays(BASE_TIME, 14));
    const types = fired.map((e) => e['nudge_type']);
    expect(types).toContain('t14');
    expect(types).not.toContain('t3');
    expect(types).not.toContain('t7');
    expect(types).not.toContain('stall');
  });

  it('T+14 idempotent: re-tick fires nothing', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);
    const t14 = addDays(BASE_TIME, 14);

    await svc.evaluate('eng-1', addDays(BASE_TIME, 3));
    await svc.evaluate('eng-1', addDays(BASE_TIME, 7));
    await svc.evaluate('eng-1', t14);
    const fourth = await svc.evaluate('eng-1', t14);
    expect(fourth).toHaveLength(0);
  });
});

// ─── Stall detection ─────────────────────────────────────────────────────────

describe('nudgeService — stall detection (DONE-WHEN #9)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('>14 days idle in_progress: transitions lifecycle to stalled and fires stall nudge', async () => {
    const party = await seedParty(db);
    const svc = createNudgeService(db);

    const fired = await svc.evaluate('eng-1', addDays(BASE_TIME, 15));
    const types = fired.map((e) => e['nudge_type']);
    expect(types).toContain('stall');

    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('stalled');
  });

  it('stall nudge fires exactly once: re-tick excludes now-stalled party', async () => {
    await seedParty(db);
    const svc = createNudgeService(db);
    const t15 = addDays(BASE_TIME, 15);

    await svc.evaluate('eng-1', t15); // party transitions to stalled
    const second = await svc.evaluate('eng-1', t15); // stalled party not in scope
    expect(second.filter((e) => e['nudge_type'] === 'stall')).toHaveLength(0);
    expect(second).toHaveLength(0);
  });

  it('invited party idle >14 days fires t14 but NOT stall transition', async () => {
    const party = await seedParty(db, { lifecycle: 'invited' });
    const svc = createNudgeService(db);

    const fired = await svc.evaluate('eng-1', addDays(BASE_TIME, 15));
    const types = fired.map((e) => e['nudge_type']);
    expect(types).toContain('t14');
    expect(types).not.toContain('stall');

    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('invited'); // lifecycle unchanged
  });
});

// ─── Escalation digest ───────────────────────────────────────────────────────

describe('nudgeService — escalation digest (DONE-WHEN #9)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('aggregates stalled parties into one NudgeEvent and records mode-c TouchEvent', async () => {
    const p1 = await seedParty(db, { lifecycle: 'stalled' });
    const p2 = await seedParty(db, { lifecycle: 'stalled' });
    const svc = createNudgeService(db);

    const digest = await svc.escalationDigest('eng-1', BASE_TIME);

    expect(digest).not.toBeNull();
    expect(digest!['nudge_type']).toBe('escalation');
    expect(digest!['channel']).toBe('digest');
    expect(digest!['engagement_id']).toBe('eng-1');

    const payload = digest!['payload'] as { party_ids: string[]; generated_at: string };
    expect(payload.party_ids).toHaveLength(2);
    expect(payload.party_ids).toContain(p1.id as string);
    expect(payload.party_ids).toContain(p2.id as string);
    expect(payload.generated_at).toBe(BASE_TIME.toISOString());

    // mode-c TouchEvent must be present
    const touches = await db.touchEvent.findMany({ where: { engagement_id: 'eng-1' } });
    const digestTouch = touches.find((t) => t['kind'] === 'escalation_digest');
    expect(digestTouch).toBeDefined();
    expect(digestTouch!['mode']).toBe('c');
  });

  it('returns null when no stalled parties exist', async () => {
    const svc = createNudgeService(db);
    const result = await svc.escalationDigest('eng-1', BASE_TIME);
    expect(result).toBeNull();
  });

  it('digest payload excludes non-stalled parties', async () => {
    const stalled = await seedParty(db, { lifecycle: 'stalled' });
    await seedParty(db, { lifecycle: 'in_progress' }); // not stalled
    const svc = createNudgeService(db);

    const digest = await svc.escalationDigest('eng-1', BASE_TIME);
    const payload = digest!['payload'] as { party_ids: string[] };
    expect(payload.party_ids).toHaveLength(1);
    expect(payload.party_ids[0]).toBe(stalled.id as string);
  });
});

// ─── Fresh party fires nothing ────────────────────────────────────────────────

describe('nudgeService — fresh party fires nothing (DONE-WHEN #9)', () => {
  it('party with last_activity_at equal to evaluation time fires no nudges', async () => {
    const db = createMockDb();
    const now = new Date('2026-06-15T09:00:00Z');
    await db.party.create({
      data: {
        tenant_id: 'tenant-1',
        engagement_id: 'eng-fresh',
        name: 'Fresh Party',
        on_prem_ot: 'no',
        lifecycle: 'in_progress',
        created_at: now,
        last_activity_at: now,
      },
    });

    const svc = createNudgeService(db);
    const fired = await svc.evaluate('eng-fresh', now);
    expect(fired).toHaveLength(0);
  });

  it('party created moments ago with no last_activity_at fires no nudges', async () => {
    const db = createMockDb();
    const now = new Date('2026-06-15T09:00:00Z');
    await db.party.create({
      data: {
        tenant_id: 'tenant-1',
        engagement_id: 'eng-fresh2',
        name: 'New Party',
        on_prem_ot: 'no',
        lifecycle: 'in_progress',
        created_at: now,
        last_activity_at: null, // fallback to created_at
      },
    });

    const svc = createNudgeService(db);
    const fired = await svc.evaluate('eng-fresh2', now);
    expect(fired).toHaveLength(0);
  });
});
