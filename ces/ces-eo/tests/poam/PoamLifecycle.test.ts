// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PoamLifecycle — objective-level POA&M with auto-close on remediation.
 * Exercises the full open -> carry-forward -> auto-close -> reopen cycle with stable keys.
 */
import { describe, test, expect } from '@jest/globals';
import { reconcilePoamLifecycle, type PoamLedger } from '../../src/eo/poam/PoamLifecycle.js';
import type { Deficiency } from '../../src/eo/assessment/DeterminationLedger.js';

const def = (objectiveId: string, weight = 1, status: 'other_than_satisfied' | 'not_assessed' = 'other_than_satisfied'): Deficiency => ({
  key: objectiveId, objectiveId, controlId: objectiveId.replace(/\[[a-z]\]$/, ''), statement: `stmt ${objectiveId}`,
  status, source: 'digital-signal', weight, noPoam: weight >= 5,
});

describe('PoamLifecycle reconciliation', () => {
  test('first run: every deficiency opens a new tracked item', () => {
    const led = reconcilePoamLifecycle(null, [def('AC.L2-3.1.5[a]'), def('AC.L2-3.1.5[b]')], 'T1', 'p1', 't');
    expect(led.summary.newThisRun).toBe(2);
    expect(led.summary.open).toBe(2);
    expect(led.items.every(i => i.status === 'open' && i.openedAt === 'T1')).toBe(true);
    expect(led.items.every(i => i.history[0].event === 'opened')).toBe(true);
  });

  test('still deficient: item carries forward, preserving openedAt + history (stable id)', () => {
    const run1 = reconcilePoamLifecycle(null, [def('AC.L2-3.1.5[a]')], 'T1', 'p1', 't');
    const run2 = reconcilePoamLifecycle(run1, [def('AC.L2-3.1.5[a]')], 'T2', 'p2', 't');
    const item = run2.items.find(i => i.key === 'AC.L2-3.1.5[a]')!;
    expect(run2.summary.carriedForward).toBe(1);
    expect(run2.summary.newThisRun).toBe(0);
    expect(item.openedAt).toBe('T1');       // preserved
    expect(item.lastSeenAt).toBe('T2');     // advanced
    expect(item.status).toBe('open');
  });

  test('remediated: item AUTO-CLOSES and drops from the active open count', () => {
    const run1 = reconcilePoamLifecycle(null, [def('AC.L2-3.1.5[a]'), def('AC.L2-3.1.5[b]')], 'T1', 'p1', 't');
    // run2: [a] is fixed (gone from deficiencies), [b] still deficient
    const run2 = reconcilePoamLifecycle(run1, [def('AC.L2-3.1.5[b]')], 'T2', 'p2', 't');
    const a = run2.items.find(i => i.key === 'AC.L2-3.1.5[a]')!;
    expect(run2.summary.closedThisRun).toBe(1);
    expect(run2.summary.open).toBe(1);              // only [b] remains open
    expect(a.status).toBe('closed');
    expect(a.closedAt).toBe('T2');
    expect(a.history.some(h => h.event === 'auto-closed')).toBe(true);
  });

  test('closed items persist for the audit trail across later runs', () => {
    const r1 = reconcilePoamLifecycle(null, [def('X[a]')], 'T1', 'p1', 't');
    const r2 = reconcilePoamLifecycle(r1, [], 'T2', 'p2', 't');           // X[a] remediated -> closed
    const r3 = reconcilePoamLifecycle(r2, [], 'T3', 'p3', 't');           // nothing deficient
    const x = r3.items.find(i => i.key === 'X[a]')!;
    expect(x.status).toBe('closed');
    expect(x.closedAt).toBe('T2');                 // not re-stamped
    expect(r3.summary.closed).toBe(1);
    expect(r3.summary.closedThisRun).toBe(0);
  });

  test('regression: a closed deficiency that recurs REOPENS with an audit event', () => {
    const r1 = reconcilePoamLifecycle(null, [def('Y[a]')], 'T1', 'p1', 't');
    const r2 = reconcilePoamLifecycle(r1, [], 'T2', 'p2', 't');           // remediated -> closed
    const r3 = reconcilePoamLifecycle(r2, [def('Y[a]')], 'T3', 'p3', 't'); // recurs
    const y = r3.items.find(i => i.key === 'Y[a]')!;
    expect(r3.summary.reopenedThisRun).toBe(1);
    expect(y.status).toBe('open');
    expect(y.openedAt).toBe('T3');
    expect(y.history.some(h => h.event === 'reopened')).toBe(true);
  });

  test('5-point deficiencies route to certificationBlockers, not the POA&M open count', () => {
    const led = reconcilePoamLifecycle(null, [def('SC.L2-3.13.11[a]', 5), def('AU.L2-3.3.1[a]', 1)], 'T1', 'p1', 't');
    expect(led.summary.certificationBlockers).toBe(1);   // the weight-5 one
    expect(led.summary.open).toBe(1);                    // the weight-1 one
  });
});
