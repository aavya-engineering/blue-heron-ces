// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// scheduler.test.ts — G-MUSTER-PL-1 H3. Proves the wall-clock scheduler fires
// REAL nudge + reassessment ticks on the interval, scoped to the configured
// operator tenant through withTenant. Uses Vitest fake timers to drive the
// wall clock (the sub-gate requires fake-timer coverage), and the shared
// createMockDb (whose passthrough $transaction lets withTenant run the real
// service engines against it — no engine is stubbed).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler } from '../src/services/schedulerService.js';
import { createMockDb } from './helpers/mockDb.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const TENANT = 'aaaaaaaa-0000-0000-0000-000000000009';
const ENGAGEMENT_ID = 'eng-sched-0000-0000-0000-000000000001';

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

  it('scopes every tick to the configured operator tenant through withTenant', async () => {
    await seedStaleParty(db);
    // withTenant sets the tenant GUC via tx.$executeRaw`... set_config('app.tenant_id', ${tenantId} ...)`.
    // Spy on the mock's $executeRaw to prove the scheduler scopes to TENANT.
    const rawSpy = vi.spyOn(db, '$executeRaw');

    const scheduler = createScheduler({
      tenantId: TENANT,
      intervalMs: 60_000,
      db,
      nowFn: () => NOW,
    });
    await scheduler.runOnce();

    // Two withTenant entries (nudge + reassessment); each set_config carried TENANT.
    expect(rawSpy).toHaveBeenCalledTimes(2);
    for (const call of rawSpy.mock.calls) {
      // Tagged-template args: [stringsArray, tenantId]
      expect(call[1]).toBe(TENANT);
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
