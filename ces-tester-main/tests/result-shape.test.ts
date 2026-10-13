// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { buildScenarioResult, type ResultAssertion } from '../src/results/result-shape.js';

describe('buildScenarioResult', () => {
  const baseInput = {
    scenarioId: 'clean-tenant-mfa-baseline',
    startedAt: new Date('2026-07-10T14:02:00.000Z'),
    durationMs: 41200,
    stacksimLedgerRef: 'runs/clean-tenant-mfa-baseline/2026-07-10T140200/ledger-snapshot.json',
  };

  it('status is "pass" when all assertions pass', () => {
    const assertions: ResultAssertion[] = [
      { stage: 'mid_pipeline', check: 'a', result: 'pass' },
      { stage: 'expected_state', check: 'b', result: 'pass' },
    ];
    const result = buildScenarioResult({ ...baseInput, assertions });
    expect(result.status).toBe('pass');
  });

  it('status is "fail" when any assertion fails', () => {
    const assertions: ResultAssertion[] = [
      { stage: 'mid_pipeline', check: 'a', result: 'pass' },
      { stage: 'expected_state', check: 'b', result: 'fail' },
    ];
    const result = buildScenarioResult({ ...baseInput, assertions });
    expect(result.status).toBe('fail');
  });

  it('status is "fail" when the assertion list is empty (not a vacuous pass)', () => {
    const result = buildScenarioResult({ ...baseInput, assertions: [] });
    expect(result.status).toBe('fail');
  });

  it('matches the architecture §7.1 shape exactly', () => {
    const assertions: ResultAssertion[] = [
      { stage: 'mid_pipeline', check: 'IA.L2-3.5.3 task exists', result: 'pass' },
    ];
    const result = buildScenarioResult({ ...baseInput, assertions });
    expect(result).toEqual({
      scenario_id: 'clean-tenant-mfa-baseline',
      status: 'pass',
      started_at: '2026-07-10T14:02:00.000Z',
      duration_ms: 41200,
      assertions,
      diverged_commands: [],
      stacksim_ledger_ref: baseInput.stacksimLedgerRef,
    });
  });

  it('defaults diverged_commands to [] when omitted', () => {
    const result = buildScenarioResult({
      ...baseInput,
      assertions: [{ stage: 'mid_pipeline', check: 'a', result: 'pass' }],
    });
    expect(result.diverged_commands).toEqual([]);
  });
});
