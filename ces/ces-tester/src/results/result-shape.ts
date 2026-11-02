// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PLAN.md M2 task 4 / architecture §7.1: the per-scenario result JSON shape.
 * Pure serialization logic — no filesystem access here (the CLI writes the
 * file; this module only builds the JS object matching §7.1's schema).
 */

export type AssertionStage = 'mid_pipeline' | 'expected_state' | 'expected_evidence';
export type AssertionOutcome = 'pass' | 'fail';

export interface ResultAssertion {
  stage: AssertionStage;
  check: string;
  result: AssertionOutcome;
  expected?: unknown;
  actual?: unknown;
}

export interface DivergedCommand {
  command: string;
  expected: unknown;
  actual: unknown;
}

export interface ScenarioResult {
  scenario_id: string;
  status: 'pass' | 'fail';
  started_at: string;
  duration_ms: number;
  assertions: ResultAssertion[];
  diverged_commands: DivergedCommand[];
  stacksim_ledger_ref: string;
  /**
   * M3 (loop-board plan-composition finding): how many SET-bearing
   * sub-commands the translated plan carried. A zero-SET plan makes an
   * execution sweep vacuously green — every verdict records what it actually
   * exercised. Absent when the run failed before translation.
   */
  set_sub_count?: number;
  /**
   * Flow-through MS-R10: where the Mission Plan came from (e.g. ces-muster's
   * real generator + its commit). Absent for legacy-planner runs.
   */
  plan_source?: Record<string, unknown>;
}

export interface BuildScenarioResultInput {
  scenarioId: string;
  startedAt: Date;
  durationMs: number;
  assertions: ResultAssertion[];
  divergedCommands?: DivergedCommand[];
  stacksimLedgerRef: string;
  setSubCount?: number;
  planSource?: Record<string, unknown>;
}

/** Builds a §7.1-shaped result object. `status` is derived from whether all
 * assertions passed (fail if any assertion result is "fail" or the list is
 * empty — an empty assertion list is not a vacuous pass). */
export function buildScenarioResult(input: BuildScenarioResultInput): ScenarioResult {
  const status: 'pass' | 'fail' =
    input.assertions.length > 0 && input.assertions.every((a) => a.result === 'pass') ? 'pass' : 'fail';

  return {
    scenario_id: input.scenarioId,
    status,
    started_at: input.startedAt.toISOString(),
    duration_ms: input.durationMs,
    assertions: input.assertions,
    diverged_commands: input.divergedCommands ?? [],
    stacksim_ledger_ref: input.stacksimLedgerRef,
    ...(input.setSubCount !== undefined ? { set_sub_count: input.setSubCount } : {}),
    ...(input.planSource ? { plan_source: input.planSource } : {}),
  };
}
