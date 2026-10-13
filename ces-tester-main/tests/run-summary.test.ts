// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PLAN.md M4 task 1: per-run summary + live snapshot writers.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildRunSummary,
  summarizeScenarioResult,
  writeLiveSnapshot,
  writeRunSummary,
} from '../src/results/run-summary.js';
import type { ScenarioResult } from '../src/results/result-shape.js';

const RESULT: ScenarioResult = {
  scenario_id: 'scn-a',
  status: 'fail',
  started_at: '2026-07-26T00:00:00.000Z',
  duration_ms: 91000,
  assertions: [
    { stage: 'mid_pipeline', check: 'x exists', result: 'pass' },
    { stage: 'expected_state', check: 'y equals', result: 'fail', expected: true, actual: 'undefined' },
  ],
  diverged_commands: [{ command: 'Set-X (mutate x/x @ t)', expected: {}, actual: 'undefined' }],
  stacksim_ledger_ref: 'run-1/scn-a/ledger-snapshot.json',
  set_sub_count: 61,
};

describe('run summary', () => {
  it('summarizeScenarioResult derives counts from the full result', () => {
    const row = summarizeScenarioResult(RESULT, 'run-1/scn-a/result.json');
    expect(row).toEqual({
      scenario_id: 'scn-a',
      status: 'fail',
      duration_ms: 91000,
      assertions_pass: 1,
      assertions_fail: 1,
      diverged_count: 1,
      set_sub_count: 61,
      stacksim_ledger_ref: 'run-1/scn-a/ledger-snapshot.json',
      result_path: 'run-1/scn-a/result.json',
    });
  });

  it('buildRunSummary computes totals; writers produce summary.json and live.json', async () => {
    const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ces-runs-'));
    const started = new Date('2026-07-26T00:00:00Z');
    const rows = [
      summarizeScenarioResult(RESULT),
      { scenario_id: 'scn-b', status: 'pass' as const },
      { scenario_id: 'scn-c', status: 'crash' as const },
    ];
    const summary = buildRunSummary('run-1', started, rows, { completedAt: new Date('2026-07-26T00:20:00Z') });
    expect(summary.totals).toEqual({ total: 3, pass: 1, fail: 1, crash: 1 });
    expect(summary.completed_at).toBe('2026-07-26T00:20:00.000Z');

    await writeRunSummary(runsRoot, summary);
    await writeLiveSnapshot(runsRoot, buildRunSummary('run-1', started, rows.slice(0, 1), { inProgress: true }));

    const onDisk = JSON.parse(await fs.readFile(path.join(runsRoot, 'run-1', 'summary.json'), 'utf8'));
    expect(onDisk.totals.total).toBe(3);
    const live = JSON.parse(await fs.readFile(path.join(runsRoot, 'run-1', 'live.json'), 'utf8'));
    expect(live.in_progress).toBe(true);
    expect(live.scenarios).toHaveLength(1);
  });
});
