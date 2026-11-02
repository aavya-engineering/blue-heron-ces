// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// scheduler.test.ts — G-MUSTER-PL-1 H3. Proves the wall-clock scheduler fires
// REAL nudge + reassessment ticks on the interval through withTenant: pinned
// to one tenant, or (FIN-25) serving every tenant in ces.db, each in its own
// tenant scope. Uses Vitest fake timers to drive the
// wall clock (the sub-gate requires fake-timer coverage), and the shared
// createMockDb (whose passthrough $transaction lets withTenant run the real
// service engines against it — no engine is stubbed).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler } from '../src/services/schedulerService.js';
import { createMockDb } from './helpers/mockDb.js';
import { MusterStore } from '../src/lib/musterStore.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const TENANT = 'aaaaaaaa-0000-0000-0000-000000000009';
const ENGAGEMENT_ID = 'eng-sched-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000009';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Seed a party that a reassessment tick will flip (complete, last session 400d old).
async function seedStaleParty(db: ReturnType<typeof createMockDb>): Promise<string> {
  const party = await db.party.create({
    data: {
      tenant_id: TENANT,
      engagement_id: ENGAGEMENT_ID,
      name: 'Sched Party',
      on_prem_ot: 'no',
      lifecycle: 'complete',
    },
  });
  await db.interviewSession.create({
    data: {
      party_id: party.id as string,
      status: 'complete',
      completed_at: addDays(NOW, -400),
      facts: [],
      timing_segments: [],
      selected_stacks: [],
    },
  });
  return party.id as string;
}

// The same stale party, written into a real ces.db store under `tenant`.
async function seedStoreParty(store: MusterStore, tenant: string): Promise<string> {
  const tx = store.forTenant(tenant);
  const party = await tx.party.create({
    data: { engagement_id: `eng-${tenant}`, name: 'Sched Party', on_prem_ot: 'no', lifecycle: 'complete' },
  });
  await tx.interviewSession.create({
    data: {
      party_id: party.id,
      status: 'complete',
      completed_at: addDays(NOW, -400),
      facts: [],
      timing_segments: [],
      selected_stacks: [],
    },
  });
  return party.id as string;
}

async function lifecycleOf(store: MusterStore, tenant: string, partyId: string): Promise<unknown> {
  return (await store.forTenant(tenant).party.findUnique({ where: { id: partyId } }))?.lifecycle;
}

describe('H3 — wall-clock scheduler fires real ticks for the configured tenant', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not tick before the interval, flips a stale party after one interval, and stops', async () => {
    const partyId = await seedStaleParty(db);
    const scheduler = createScheduler({
      tenantId: TENANT,
      intervalMs: 60_000,
      db,
      nowFn: () => NOW,
    });

    scheduler.start();
    expect(scheduler.running).toBe(true);

    // Before the interval elapses: no tick has run, party still 'complete'.
    await vi.advanceTimersByTimeAsync(59_000);
    expect((await db.party.findUnique({ where: { id: partyId } }))!['lifecycle']).toBe('complete');

    // Cross the interval: the scheduled reassessment tick fires on wall-clock.
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await db.party.findUnique({ where: { id: partyId } }))!['lifecycle']).toBe(
      'reassessment_due'
    );

    scheduler.stop();
    expect(scheduler.running).toBe(false);

    // After stop, further wall-clock time produces no more ticks.
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await db.party.findUnique({ where: { id: partyId } }))!['lifecycle']).toBe(
      'reassessment_due'
    );
  });

  it('a pinned scheduler ticks only the configured tenant (real ces.db store, tenant scope)', async () => {
    const store = new MusterStore(':memory:');
    try {
      const a = await seedStoreParty(store, TENANT);
      const b = await seedStoreParty(store, TENANT_B);
      const scheduler = createScheduler({ tenantId: TENANT, intervalMs: 60_000, db: store, nowFn: () => NOW });
      await scheduler.runOnce();
      expect(await lifecycleOf(store, TENANT, a)).toBe('reassessment_due');
      expect(await lifecycleOf(store, TENANT_B, b)).toBe('complete');
    } finally {
      store.close();
    }
  });

  it('FIN-25: with no tenantId the scheduler serves EVERY tenant, each in its own scope', async () => {
    const store = new MusterStore(':memory:');
    try {
      await store.tenant.create({ data: { id: TENANT, name: 'Tenant A' } });
      await store.tenant.create({ data: { id: TENANT_B, name: 'Tenant B' } });
      const a = await seedStoreParty(store, TENANT);
      const b = await seedStoreParty(store, TENANT_B);
      const scheduler = createScheduler({ intervalMs: 60_000, db: store, nowFn: () => NOW });
      await scheduler.runOnce();
      expect(await lifecycleOf(store, TENANT, a)).toBe('reassessment_due');
      expect(await lifecycleOf(store, TENANT_B, b)).toBe('reassessment_due');
      // Each reminder landed in its own tenant's outbox (FD-6), none crossed over.
      const outA = await store.forTenant(TENANT).mailOutbox.findMany();
      const outB = await store.forTenant(TENANT_B).mailOutbox.findMany();
      expect(outA.map((m) => m.party_id)).toEqual([a]);
      expect(outB.map((m) => m.party_id)).toEqual([b]);
      expect(outA[0].kind).toBe('reassessment_due');
    } finally {
      store.close();
    }
  });

  it('FIN-25: one failing tenant is reported and the others are still served', async () => {
    const onError = vi.fn();
    const store = new MusterStore(':memory:');
    try {
      const b = await seedStoreParty(store, TENANT_B);
      const scheduler = createScheduler({
        intervalMs: 60_000,
        db: store,
        nowFn: () => NOW,
        onError,
        listTenants: async () => ['', TENANT_B],
      });
      await scheduler.runOnce();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(await lifecycleOf(store, TENANT_B, b)).toBe('reassessment_due');
    } finally {
      store.close();
    }
  });

  it('a tick error does not stop the scheduler (onError is invoked, interval survives)', async () => {
    const onError = vi.fn();
    // A client whose $transaction rejects — simulates a tick failure.
    const failingDb = {
      $transaction: () => Promise.reject(new Error('boom')),
      $executeRaw: () => Promise.resolve(),
    };
    const scheduler = createScheduler({
      tenantId: TENANT,
      intervalMs: 10_000,
      db: failingDb,
      nowFn: () => NOW,
      onError,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalled();
    expect(scheduler.running).toBe(true);
    scheduler.stop();
  });
});
