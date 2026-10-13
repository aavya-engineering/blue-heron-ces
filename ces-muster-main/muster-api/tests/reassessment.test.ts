// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// reassessment.test.ts — Continuous re-assessment scheduler tests (DONE-WHEN #7 + #9).
//
// Simulated-clock idiom: all dates are deterministic offsets from BASE_TIME.
// Covers: 364-day no-flip, 366-day flip, idempotency, mode-c touch instrumentation.

import { describe, it, expect, beforeEach } from 'vitest';
import { createReassessmentService } from '../src/services/reassessmentService.js';
import { createTouchService } from '../src/services/touchService.js';
import { createMockDb } from './helpers/mockDb.js';

const BASE_TIME = new Date('2026-01-01T00:00:00Z');

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

const ENGAGEMENT_ID = 'eng-00000000-0000-0000-0000-000000000001';
const TENANT_ID = 'tenant-1';

// Seed a party in a reassessable lifecycle state.
async function seedParty(
  db: ReturnType<typeof createMockDb>,
  lifecycle: string = 'complete'
) {
  return db.party.create({
    data: {
      tenant_id: TENANT_ID,
      engagement_id: ENGAGEMENT_ID,
      name: 'Test Party',
      on_prem_ot: 'no',
      lifecycle,
    },
  });
}

// Seed a completed interview session for the given party with a specific completed_at.
async function seedCompletedSession(
  db: ReturnType<typeof createMockDb>,
  partyId: string,
  completedAt: Date
) {
  return db.interviewSession.create({
    data: {
      party_id: partyId,
      status: 'complete',
      completed_at: completedAt,
      facts: [],
      timing_segments: [],
      selected_stacks: [],
    },
  });
}

describe('reassessmentService — cadence flip (DONE-WHEN #7)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('party complete 364 days → does NOT flip (below cadence threshold)', async () => {
    const party = await seedParty(db, 'complete');
    // Session completed exactly 364 days ago — still within the window
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -364));

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(0);

    // Lifecycle must remain 'complete'
    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('complete');
  });

  it('party complete 366 days → flips to reassessment_due (over cadence threshold)', async () => {
    const party = await seedParty(db, 'complete');
    // Session completed 366 days ago — exceeds REASSESS_DAYS=365
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(1);
    expect(result.flipped[0].party_id).toBe(party.id as string);
    expect(result.flipped[0].previous).toBe('complete');

    // Lifecycle must now be 'reassessment_due'
    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('reassessment_due');
  });

  it('366-day flip is idempotent: re-tick returns empty flipped', async () => {
    const party = await seedParty(db, 'complete');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);

    // First tick flips the party
    const first = await svc.tick(ENGAGEMENT_ID, BASE_TIME);
    expect(first.flipped).toHaveLength(1);

    // Second tick: party is now in 'reassessment_due' — not in REASSESSABLE_STATES
    const second = await svc.tick(ENGAGEMENT_ID, BASE_TIME);
    expect(second.flipped).toHaveLength(0);
  });

  it('party with no completed session is skipped', async () => {
    const party = await seedParty(db, 'complete');
    // No sessions seeded

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(0);
    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('complete');
  });

  it('party in ready state 366 days → also flips', async () => {
    const party = await seedParty(db, 'ready');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(1);
    expect(result.flipped[0].previous).toBe('ready');
    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('reassessment_due');
  });

  it('party in validate state 366 days → also flips', async () => {
    const party = await seedParty(db, 'validate');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(1);
    expect(result.flipped[0].previous).toBe('validate');
  });

  it('party in in_progress state is NOT eligible for reassessment flip', async () => {
    const party = await seedParty(db, 'in_progress');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -400));

    const svc = createReassessmentService(db);
    const result = await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    expect(result.flipped).toHaveLength(0);
    const updated = await db.party.findUnique({ where: { id: party.id as string } });
    expect(updated!['lifecycle']).toBe('in_progress');
  });

  it('null engagementId scans all parties across engagements', async () => {
    const p1 = await seedParty(db, 'complete');
    await seedCompletedSession(db, p1.id as string, addDays(BASE_TIME, -366));

    // Party in a different engagement
    const p2 = await db.party.create({
      data: {
        tenant_id: TENANT_ID,
        engagement_id: 'eng-other',
        name: 'Other Party',
        on_prem_ot: 'no',
        lifecycle: 'complete',
      },
    });
    await seedCompletedSession(db, p2.id as string, addDays(BASE_TIME, -400));

    const svc = createReassessmentService(db);
    const result = await svc.tick(null, BASE_TIME);

    expect(result.flipped).toHaveLength(2);
  });
});

describe('reassessmentService — annuity-cycle touch instrumentation (DONE-WHEN #9)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('flip records mode-c reassessment_cycle touch event with minutes=0', async () => {
    const party = await seedParty(db, 'complete');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);
    await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    const touches = await db.touchEvent.findMany({ where: { engagement_id: ENGAGEMENT_ID } });
    const cycleTouch = touches.find((t) => t['kind'] === 'reassessment_cycle');
    expect(cycleTouch).toBeDefined();
    expect(cycleTouch!['mode']).toBe('c');
    expect(cycleTouch!['minutes']).toBe(0);
  });

  it('touch report shows annuity-cycle events queryable against ≤30-min budget', async () => {
    const party = await seedParty(db, 'complete');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -366));

    const svc = createReassessmentService(db);
    await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    // Report is queryable via touchService
    const touchSvc = createTouchService(db);
    const report = await touchSvc.report(ENGAGEMENT_ID);

    expect(report.modeC.events).toBeGreaterThanOrEqual(1);
    // Cycle starts at 0 minutes; budget is ≤30 min/escalation [validate with BHD]
    const cycleEvent = report.modeC.perEscalation.find((e) => e.kind === 'reassessment_cycle');
    expect(cycleEvent).toBeDefined();
    expect(cycleEvent!.minutes).toBeLessThanOrEqual(30);
  });

  it('no flip → no touch event recorded', async () => {
    const party = await seedParty(db, 'complete');
    await seedCompletedSession(db, party.id as string, addDays(BASE_TIME, -364));

    const svc = createReassessmentService(db);
    await svc.tick(ENGAGEMENT_ID, BASE_TIME);

    const touches = await db.touchEvent.findMany({ where: { engagement_id: ENGAGEMENT_ID } });
    expect(touches).toHaveLength(0);
  });
});
