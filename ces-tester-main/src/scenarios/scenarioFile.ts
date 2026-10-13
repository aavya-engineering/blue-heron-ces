// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// scenarioFile.ts — G-TESTER-2 M3 task 1: scenario JSON loader/validator.
// Validates against the FROZEN schema (schemas/scenario.schema.json — the
// Step-0 schema-insurance baseline; lanes + muster.readiness_payload are part
// of the frozen interface) plus the cross-field rules the schema prose
// mandates: lanes/seed disagreement is REJECTED, never papered over.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { StacksimSeedBlock } from '../stacksim-client/types.js';
import type { MusterAnswerMapEntry, MusterAnswerType } from '../muster-driver/answer-map.js';
import type { MidPipelineAssertionSpec } from '../muster-driver/mid-pipeline-assertion.js';
import type { ExpectedStateCheck } from '../verifier/expectedState.js';
import type { MusterPlanCase, MusterStatus } from '../flow/muster-plan-generator.js';

const _require = createRequire(import.meta.url);

export interface ScenarioFile {
  scenario_id: string;
  description?: string;
  target_level?: 'L1' | 'L2' | 'L3';
  lanes: Array<'sim' | 'live'>;
  stacksim_seed?: StacksimSeedBlock;
  muster?: {
    answer_map?: Record<
      string,
      { wizard: MusterAnswerMapEntry['wizard']; answer_type: MusterAnswerType; value: MusterAnswerMapEntry['value'] }
    >;
    mid_pipeline_assertions?: Array<{
      path: string;
      assert: string;
      array_path?: string;
      match_field?: string;
      match_value?: string;
    }>;
    readiness_payload?: { fixture_ref: string; schema_version?: string };
    /** Flow-through MS-R10: source the plan from ces-muster's real generator. */
    plan_source?: MusterPlanSourceBlock;
  };
  stamper?: { execution_mode?: 'auto' | 'manual' | 'dry-run' };
  fault_injection?: unknown[];
  expected_state?: { checks?: ExpectedStateCheck[] };
  expected_evidence?: unknown[];
}

export interface MusterPlanSourceBlock {
  kind: 'muster-generator';
  ces_id?: string;
  requirement_results: Array<{ requirement_id: string; status: MusterStatus }>;
}

let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    // ajv is CJS; under NodeNext ESM the default-import interop is unreliable,
    // so require() it (same channel the schema itself loads through).
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean }) => {
      compile: (schema: unknown) => ValidateFunction;
    };
    // Depth differs between contexts: vitest imports this TS source
    // (src/scenarios -> repo root is ../../), the CLI runs the compiled file
    // (dist/src/scenarios -> repo root is ../../../).
    let schema: unknown;
    try {
      schema = _require('../../schemas/scenario.schema.json');
    } catch {
      schema = _require('../../../schemas/scenario.schema.json');
    }
    compiled = new AjvCtor({ strict: true }).compile(schema);
  }
  return compiled;
}

/** Parse + schema-validate + cross-field-validate one scenario file. Loud
 * failure with the file path in every message — a bad scenario must never
 * run partially. */
export async function loadScenarioFile(filePath: string): Promise<ScenarioFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${filePath}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  const validate = validator();
  if (!validate(parsed)) {
    throw new Error(
      `${filePath}: fails scenario schema: ${JSON.stringify(validate.errors?.[0] ?? validate.errors)}`
    );
  }
  const scenario = parsed as unknown as ScenarioFile;
  // Default per the frozen schema; then enforce the lanes/seed agreement rule.
  scenario.lanes = scenario.lanes ?? ['sim'];
  const simLane = scenario.lanes.includes('sim');
  if (simLane && !scenario.stacksim_seed) {
    throw new Error(`${filePath}: lanes includes "sim" but no stacksim_seed block — rejected (lanes/seed disagreement)`);
  }
  if (!simLane && scenario.stacksim_seed) {
    throw new Error(`${filePath}: stacksim_seed present but lanes has no "sim" — rejected (lanes/seed disagreement)`);
  }
  if (scenario.lanes.includes('live')) {
    throw new Error(`${filePath}: the "live" lane is BLOCKED-ON-FD-LIVE-SMOKE-HOLD — only ["sim"] scenarios run today`);
  }
  return scenario;
}

/** scenarios/*.json discovery — glob-sorted so run-all order is stable and a
 * 5th file appears with zero code changes (M3 acceptance gate). */
export async function discoverScenarioFiles(scenariosDir: string): Promise<string[]> {
  const entries = await fs.readdir(scenariosDir);
  return entries
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(scenariosDir, f));
}

/** Bridge the scenario file's answer_map object to the driver's entry list. */
export function answerMapEntries(scenario: ScenarioFile): MusterAnswerMapEntry[] {
  const map = scenario.muster?.answer_map ?? {};
  return Object.entries(map).map(([questionId, v]) => ({
    questionId,
    wizard: v.wizard,
    answerType: v.answer_type,
    value: v.value,
  }));
}

/** Bridge mid_pipeline_assertions rows to the evaluator's spec shape. */
export function midPipelineSpecs(scenario: ScenarioFile): MidPipelineAssertionSpec[] {
  return (scenario.muster?.mid_pipeline_assertions ?? []).flatMap((a) => {
    if (!a.array_path || !a.match_field || a.match_value === undefined) return [];
    return [{ arrayPath: a.array_path, matchField: a.match_field, matchValue: a.match_value, assert: 'exists' as const }];
  });
}
/**
 * Flow-through MS-R10: the Muster generator input for a scenario whose plan is
 * sourced from ces-muster (`muster.plan_source.kind === 'muster-generator'`).
 * SIT answers = the answer_map rows driven through the SIT wizard (their keys
 * are real SI-bank question ids); rows for other wizards (e.g. the legacy
 * planner's TCP licence question) have no Muster-generator input and are
 * reported back as `unmapped` so the caller can log them honestly.
 * Returns null for scenarios still on the legacy planner path.
 */
export function musterPlanCase(scenario: ScenarioFile): { planCase: MusterPlanCase; unmapped: string[] } | null {
  const src = scenario.muster?.plan_source;
  if (!src || src.kind !== 'muster-generator') return null;
  const sitAnswers: MusterPlanCase['sitAnswers'] = {};
  const unmapped: string[] = [];
  for (const [qid, v] of Object.entries(scenario.muster?.answer_map ?? {})) {
    if (v.wizard === 'sit') sitAnswers[qid] = v.value;
    else unmapped.push(`${qid} (${v.wizard})`);
  }
  return {
    planCase: {
      id: scenario.scenario_id,
      cesId: src.ces_id ?? `ces-tester-${scenario.scenario_id}`,
      sitAnswers,
      requirementResults: src.requirement_results,
    },
    unmapped,
  };
}
