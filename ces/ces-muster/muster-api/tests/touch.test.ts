// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTouchService } from '../src/services/touchService.js';
import { createHilService } from '../src/services/hilService.js';
import { createMockDb } from './helpers/mockDb.js';

const ENG = 'eng-00000000-0000-0000-0000-000000000001';
const TENANT = 'tenant-1';

describe('touchService', () => {
  let db: ReturnType<typeof createMockDb>;
  let touchSvc: ReturnType<typeof createTouchService>;

  beforeEach(() => {
    db = createMockDb();
    touchSvc = createTouchService(db);
  });

  // ─── mode-a aggregation ────────────────────────────────────────────────────

  it('mode-a events aggregate to totalMinutes', async () => {
    await touchSvc.record('a', 'onboarding-call', ENG, TENANT, 30);
    await touchSvc.record('a', 'onboarding-call', ENG, TENANT, 15);
    await touchSvc.record('a', 'check-in', ENG, TENANT, 10);

    const report = await touchSvc.report(ENG);
    expect(report.modeA.events).toBe(3);
    expect(report.modeA.totalMinutes).toBe(55);
    expect(report.modeC.events).toBe(0);
    expect(report.modeC.totalMinutes).toBe(0);
    expect(report.modeC.perEscalation).toHaveLength(0);
  });

  // ─── mode-c per-escalation ────────────────────────────────────────────────

  it('mode-c events appear in perEscalation', async () => {
    await touchSvc.record('c', 'hil-review', ENG, TENANT, 20);
    await touchSvc.record('c', 'hil-review', ENG, TENANT, 35);

    const report = await touchSvc.report(ENG);
    expect(report.modeC.events).toBe(2);
    expect(report.modeC.totalMinutes).toBe(55);
    expect(report.modeC.perEscalation).toHaveLength(2);
    expect(report.modeC.perEscalation[0].minutes).toBe(20);
    expect(report.modeC.perEscalation[0].kind).toBe('hil-review');
  });

  // ─── mixed modes ─────────────────────────────────────────────────────────

  it('mode-a and mode-c events are segregated in the report', async () => {
    await touchSvc.record('a', 'onboarding', ENG, TENANT, 60);
    await touchSvc.record('c', 'escalation', ENG, TENANT, 25);
    await touchSvc.record('a', 'follow-up', ENG, TENANT, 20);

    const report = await touchSvc.report(ENG);
    expect(report.modeA.events).toBe(2);
    expect(report.modeA.totalMinutes).toBe(80);
    expect(report.modeC.events).toBe(1);
    expect(report.modeC.totalMinutes).toBe(25);
    expect(report.modeC.perEscalation).toHaveLength(1);
  });

  // ─── mode-c per-escalation timing from HilItem resolve context ────────────
  // This scenario simulates the workflow where a HilItem is resolved and
  // the advisor records the time as a mode-c touch event.

  it('records mode-c touch event corresponding to HilItem resolve', async () => {
    const hilSvc = createHilService(db);

    // HIL item is created (low confidence, weight >= 3)
    const item = await hilSvc.routeFact({
      tenant_id: TENANT,
      party_id: 'party-1',
      question_id: 'q-mfa-01',
      answer: 'partial',
      confidence: 'low',
      weight: 4,
    });
    const hilId = (item as Record<string, unknown>)['id'] as string;

    // Advisor resolves the HIL item with 18 minutes of work
    const advisorMinutes = 18;
    await hilSvc.resolve(hilId, 'advisor-user', advisorMinutes);

    // Advisor records a mode-c touch event for the same work
    await touchSvc.record('c', 'hil-resolve', ENG, TENANT, advisorMinutes);

    const report = await touchSvc.report(ENG);
    expect(report.modeC.events).toBe(1);
    expect(report.modeC.totalMinutes).toBe(18);
    expect(report.modeC.perEscalation[0].minutes).toBe(18);
    expect(report.modeC.perEscalation[0].kind).toBe('hil-resolve');
  });

  // ─── report for empty engagement ─────────────────────────────────────────

  it('returns zero counts for engagement with no events', async () => {
    const report = await touchSvc.report('no-events-eng');
    expect(report.modeA.events).toBe(0);
    expect(report.modeA.totalMinutes).toBe(0);
    expect(report.modeC.events).toBe(0);
    expect(report.modeC.totalMinutes).toBe(0);
    expect(report.modeC.perEscalation).toHaveLength(0);
  });
});
