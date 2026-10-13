// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ScenarioResult } from './result-shape.js';

/**
 * PLAN.md M4 task 1: the per-run summary shape written to
 * `runs/<run-id>/summary.json` (run complete) and `runs/<run-id>/live.json`
 * (updated after each scenario while the run is still in flight). One row per
 * scenario, derived from the scenario's own §7.1 result.json — the dashboard
 * generator reads ONLY these files plus (for the latest run) the full
 * result.json drill-down data.
 */

export interface RunScenarioSummary {
  scenario_id: string;
  /** `crash` = the scenario threw before writing result.json (run-all catch). */
  status: 'pass' | 'fail' | 'crash';
  duration_ms?: number;
  assertions_pass?: number;
  assertions_fail?: number;
  diverged_count?: number;
  set_sub_count?: number;
  stacksim_ledger_ref?: string;
  /** Path of the scenario's result.json relative to the runs root (forward slashes). */
  result_path?: string;
}

export interface RunSummary {
  run_id: string;
  started_at: string;
  /** Absent while the run is in flight (live.json). */
  completed_at?: string;
  in_progress?: boolean;
  scenarios: RunScenarioSummary[];
  totals: { total: number; pass: number; fail: number; crash: number };
}

/** Derives a summary row from a scenario's full result. */
export function summarizeScenarioResult(result: ScenarioResult, resultPathRel?: string): RunScenarioSummary {
  return {
    scenario_id: result.scenario_id,
    status: result.status,
    duration_ms: result.duration_ms,
    assertions_pass: result.assertions.filter((a) => a.result === 'pass').length,
    assertions_fail: result.assertions.filter((a) => a.result === 'fail').length,
    diverged_count: result.diverged_commands.length,
    ...(result.set_sub_count !== undefined ? { set_sub_count: result.set_sub_count } : {}),
    stacksim_ledger_ref: result.stacksim_ledger_ref,
    ...(resultPathRel ? { result_path: resultPathRel } : {}),
  };
}

export function buildRunSummary(
  runId: string,
  startedAt: Date,
  scenarios: RunScenarioSummary[],
  opts: { completedAt?: Date; inProgress?: boolean } = {},
): RunSummary {
  return {
    run_id: runId,
    started_at: startedAt.toISOString(),
    ...(opts.completedAt ? { completed_at: opts.completedAt.toISOString() } : {}),
    ...(opts.inProgress ? { in_progress: true } : {}),
    scenarios,
    totals: {
      total: scenarios.length,
      pass: scenarios.filter((s) => s.status === 'pass').length,
      fail: scenarios.filter((s) => s.status === 'fail').length,
      crash: scenarios.filter((s) => s.status === 'crash').length,
    },
  };
}

async function writeJson(runsRoot: string, runId: string, name: string, value: unknown): Promise<string> {
  const dir = path.join(runsRoot, runId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

export function writeRunSummary(runsRoot: string, summary: RunSummary): Promise<string> {
  return writeJson(runsRoot, summary.run_id, 'summary.json', summary);
}

/** PLAN.md M4 task 1: in-flight progress snapshot, rewritten after each scenario. */
export function writeLiveSnapshot(runsRoot: string, summary: RunSummary): Promise<string> {
  return writeJson(runsRoot, summary.run_id, 'live.json', { ...summary, in_progress: true });
}
