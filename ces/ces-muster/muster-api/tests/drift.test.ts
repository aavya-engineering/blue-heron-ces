// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// drift.test.ts — Drift detection tests (DONE-WHEN #7 + #9).
//
// Simulated-clock idiom: nowFn injected at service creation.
// Covers: yes→no drift alert, no→yes improvement, interview-provenance exclusion,
// HIL item creation, mode-c touch instrumentation for annuity-cycle budget.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDriftService } from '../src/services/driftService.js';
import { createTouchService } from '../src/services/touchService.js';
import { createMockDb } from './helpers/mockDb.js';
import type { FactSnapshot } from '../src/services/driftService.js';

const BASE_TIME = new Date('2026-01-01T00:00:00Z');
const TENANT_ID = 'tenant-1';
const ENGAGEMENT_ID = 'eng-00000000-0000-0000-0000-000000000001';
const PARTY_ID = 'party-00000000-0000-0000-0000-000000000001';

// Seed a party in the mockDb with the given tenant/engagement.
async function seedParty(db: ReturnType<typeof createMockDb>) {
  return db.party.create({
    data: {
      id: PARTY_ID,
      tenant_id: TENANT_ID,
      engagement_id: ENGAGEMENT_ID,
      name: 'Test Party',
      on_prem_ot: 'no',
      lifecycle: 'complete',
    },
  });
}

describe('driftService — drift alerts (DONE-WHEN #7)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('re-harvested auto_detected fact yes→no fires drift alert and creates HIL item', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const previousFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected', source: 'graph:conditionalAccess' },
    ];
    const currentFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected', source: 'graph:conditionalAccess' },
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts,
      currentFacts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.improvements).toHaveLength(0);
    expect(result.alerts[0].question_id).toBe('iam-001');
    expect(result.alerts[0].previous_answer).toBe('yes');
    expect(result.alerts[0].current_answer).toBe('no');
    expect(result.alerts[0].provenance).toBe('auto_detected');

    // Verify HIL item was created in mockDb
    const hilItems = await db.hilItem.findMany({ where: { party_id: PARTY_ID } });
    expect(hilItems).toHaveLength(1);
    expect(hilItems[0]['question_id']).toBe('iam-001');
    expect(hilItems[0]['reason']).toBe('low_confidence_high_weight');

    // hil_item_id in alert must match the created item
    expect(result.alerts[0].hil_item_id).toBe(hilItems[0]['id'] as string);
  });

  it('re-ingested captured fact yes→no fires drift alert', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const previousFacts: FactSnapshot[] = [
      { question_id: 'ep-002', answer: 'yes', provenance: 'captured', source: 'recipe:defender-av-status@1.0.0' },
    ];
    const currentFacts: FactSnapshot[] = [
      { question_id: 'ep-002', answer: 'no', provenance: 'captured', source: 'recipe:defender-av-status@1.0.0' },
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts,
      currentFacts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].provenance).toBe('captured');

    // HIL item must exist
    const hilItems = await db.hilItem.findMany({ where: { party_id: PARTY_ID } });
    expect(hilItems).toHaveLength(1);
  });

  it('no→yes improvement: records improvement, NO alert, no HIL item', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const previousFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' },
    ];
    const currentFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' },
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts,
      currentFacts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(0);
    expect(result.improvements).toHaveLength(1);
    expect(result.improvements[0].question_id).toBe('iam-001');
    expect(result.improvements[0].previous_answer).toBe('no');
    expect(result.improvements[0].current_answer).toBe('yes');

    // No HIL item — improvements do not escalate
    const hilItems = await db.hilItem.findMany({ where: { party_id: PARTY_ID } });
    expect(hilItems).toHaveLength(0);
  });

  it('interview-provenance (B) change alone does NOT fire drift alert', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    // currentFact has interview provenance — drift is machine-evidence only
    const previousFacts: FactSnapshot[] = [
      { question_id: 'mon-004', answer: 'yes', provenance: 'interview' },
    ];
    const currentFacts: FactSnapshot[] = [
      { question_id: 'mon-004', answer: 'no', provenance: 'interview' },
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts,
      currentFacts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(0);
    expect(result.improvements).toHaveLength(0);

    // No HIL item — interview-provenance changes never route
    const hilItems = await db.hilItem.findMany({ where: { party_id: PARTY_ID } });
    expect(hilItems).toHaveLength(0);
  });

  it('mixed provenances: only machine-evidence facts trigger drift alerts', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const previousFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' },  // machine
      { question_id: 'mon-004', answer: 'yes', provenance: 'interview' },        // interview
    ];
    const currentFacts: FactSnapshot[] = [
      { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' },   // machine → alert
      { question_id: 'mon-004', answer: 'no', provenance: 'interview' },         // interview → skipped
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts,
      currentFacts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].question_id).toBe('iam-001');
    // mon-004 interview change must not appear
    expect(result.alerts.find((a) => a.question_id === 'mon-004')).toBeUndefined();
  });

  it('same answer in both snapshots: no alert and no improvement', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const facts: FactSnapshot[] = [
      { question_id: 'ep-001', answer: 'yes', provenance: 'auto_detected' },
    ];

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: facts,
      currentFacts: facts,
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(0);
    expect(result.improvements).toHaveLength(0);
  });

  it('no previous fact for question: no alert (no baseline to compare)', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    const result = await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: [], // empty previous snapshot
      currentFacts: [
        { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' },
      ],
      now: BASE_TIME,
    });

    expect(result.alerts).toHaveLength(0);
  });

  it('throws when party is not found', async () => {
    // Party not seeded in db
    const svc = createDriftService(db, () => BASE_TIME);

    await expect(
      svc.detectDrift({
        partyId: 'nonexistent-party',
        previousFacts: [],
        currentFacts: [],
        now: BASE_TIME,
      })
    ).rejects.toThrow('Party not found: nonexistent-party');
  });
});

describe('driftService — annuity-cycle touch instrumentation (DONE-WHEN #9)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('drift alert records mode-c drift_alert touch event with minutes=0', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: [{ question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' }],
      currentFacts: [{ question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' }],
      now: BASE_TIME,
    });

    const touches = await db.touchEvent.findMany({ where: { engagement_id: ENGAGEMENT_ID } });
    const alertTouch = touches.find((t) => t['kind'] === 'drift_alert');
    expect(alertTouch).toBeDefined();
    expect(alertTouch!['mode']).toBe('c');
    expect(alertTouch!['minutes']).toBe(0);
  });

  it('improvement does NOT record a touch event', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: [{ question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' }],
      currentFacts: [{ question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' }],
      now: BASE_TIME,
    });

    const touches = await db.touchEvent.findMany({ where: { engagement_id: ENGAGEMENT_ID } });
    expect(touches).toHaveLength(0);
  });

  it('touch report shows drift-alert events queryable against ≤30-min budget', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: [{ question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' }],
      currentFacts: [{ question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' }],
      now: BASE_TIME,
    });

    // Verify annuity-cycle events are queryable via touchService.report
    const touchSvc = createTouchService(db);
    const report = await touchSvc.report(ENGAGEMENT_ID);

    expect(report.modeC.events).toBeGreaterThanOrEqual(1);
    const driftTouch = report.modeC.perEscalation.find((e) => e.kind === 'drift_alert');
    expect(driftTouch).toBeDefined();
    // minutes=0 at alert creation; budget is ≤30 min/escalation [validate with BHD]
    expect(driftTouch!.minutes).toBeLessThanOrEqual(30);
  });

  it('multiple drift alerts each produce a touch event', async () => {
    await seedParty(db);
    const svc = createDriftService(db, () => BASE_TIME);

    await svc.detectDrift({
      partyId: PARTY_ID,
      previousFacts: [
        { question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected' },
        { question_id: 'ep-001', answer: 'yes', provenance: 'auto_detected' },
      ],
      currentFacts: [
        { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected' },
        { question_id: 'ep-001', answer: 'no', provenance: 'auto_detected' },
      ],
      now: BASE_TIME,
    });

    const touches = await db.touchEvent.findMany({
      where: { engagement_id: ENGAGEMENT_ID, kind: 'drift_alert' } as Record<string, unknown>,
    });
    expect(touches).toHaveLength(2);
  });
});
