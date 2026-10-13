// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import type { RunSummary } from './run-summary.js';

/**
 * PLAN.md M4 task 3: flaky-scenario detection via repeated-failure count
 * across `runs/*"/summary.json`. A scenario is FLAKY when completed runs show
 * BOTH pass and non-pass outcomes (mixed verdicts on identical inputs — the
 * signature of the rotating external instability this repo carries as a named
 * known-red). A scenario that fails every time (e.g. the deliberate-fail one)
 * is consistent, not flaky.
 */
export interface ScenarioHistory {
  scenario_id: string;
  runs_seen: number;
  pass_count: number;
  fail_count: number;
  crash_count: number;
  flaky: boolean;
  /** Verdict sequence oldest→newest, e.g. ["pass","fail","pass"]. */
  sequence: Array<'pass' | 'fail' | 'crash'>;
}

export function scenarioHistories(summariesOldestFirst: RunSummary[]): ScenarioHistory[] {
  const byId = new Map<string, ScenarioHistory>();
  for (const run of summariesOldestFirst) {
    if (run.in_progress) continue; // live snapshots don't count toward history
    for (const s of run.scenarios) {
      let h = byId.get(s.scenario_id);
      if (!h) {
        h = { scenario_id: s.scenario_id, runs_seen: 0, pass_count: 0, fail_count: 0, crash_count: 0, flaky: false, sequence: [] };
        byId.set(s.scenario_id, h);
      }
      h.runs_seen++;
      if (s.status === 'pass') h.pass_count++;
      else if (s.status === 'fail') h.fail_count++;
      else h.crash_count++;
      h.sequence.push(s.status);
    }
  }
  for (const h of byId.values()) {
    h.flaky = h.pass_count > 0 && h.pass_count < h.runs_seen;
  }
  return [...byId.values()].sort((a, b) => a.scenario_id.localeCompare(b.scenario_id));
}
