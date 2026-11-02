// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// musterE2eFile.ts - P4.1: loader for the `muster-e2e` scenario type
// (schemas/muster-e2e.schema.json). Kept apart from scenarioFile.ts: that
// loader validates against the FROZEN scenario schema with ajv strict mode,
// so a new type gets its own schema and run-scenario dispatches on `type`.
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ValidateFunction } from 'ajv';
import type { TenantStance } from '../stacksim-client/types.js';
import type { ExpectedStateCheck } from '../verifier/expectedState.js';
import type { AdminOpsOpSpec, AllowedRevert, DriftInjection, ExpectedImprovement } from '../flow/ao-step.js';

export type { AdminOpsOpSpec, AllowedRevert, DriftInjection, ExpectedImprovement };

const _require = createRequire(import.meta.url);

export const MUSTER_E2E_TYPE = 'muster-e2e';

export interface ExpectedLedgerSpec {
  /** Step ids during which the sim must record zero non-seed writes. */
  no_writes_during?: string[];
  /** Every non-seed write in the snapshot must fall inside this step's window (one-window form of allowed_write_windows). */
  writes_only_during?: string;
  /**
   * Synthetic-customer W2: every non-seed write outside the build window must fall inside one of these steps' windows
   * (E6 Stamper, E6X injection, E7A AdminOps). Takes precedence over writes_only_during.
   */
  allowed_write_windows?: string[];
  /** Step id -> minimum non-seed writes inside its window. */
  min_writes_during?: Record<string, number>;
  /** Objects some non-seed write must have touched. */
  mutated?: Array<{ objectType: string; objectId?: string }>;
  /**
   * S1 fix: the scenario-build window, [from.started, before.started) (E1 to E2). Its writes must equal
   * the sim scenario's write steps and are excluded from the rules above.
   */
  build_window?: { from: string; before: string };
}

export interface MusterE2eScenario {
  type: typeof MUSTER_E2E_TYPE;
  scenario_id: string;
  description?: string;
  sim_scenario: string;
  stance: TenantStance;
  force_fail_entry?: string;
  eo_assess_runs?: number;
  ec_upload?: Record<string, unknown> & { controlIds: string[] };
  expected_facts: Record<string, string>;
  expected_state: { checks: ExpectedStateCheck[] };
  expected_ledger: ExpectedLedgerSpec;
  ao_coverage?: { enabled: boolean; expected_total: number };
  /** W2 (PLAN §3 E7A): the AdminOps ops, run in order; empty = E7A passes trivially. */
  adminops_ops?: AdminOpsOpSpec[];
  /** W2 (V47): E7B's drift improvements, exactly. */
  expected_improvements?: ExpectedImprovement[];
  /** W2 (V48, V43a): AO-touched objects the forced run (E8F) may revert, and the controls it may then regress. */
  allowed_reverts?: AllowedRevert[];
  /** W2 (PLAN §3 E6X, S3 only): sim writes re-injected after Stamper; empty = E6X passes trivially. */
  drift_injection?: DriftInjection[];
}

let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean }) => {
      compile: (schema: unknown) => ValidateFunction;
    };
    // Same depth trick as scenarioFile.ts: vitest loads src/, the CLI loads dist/src/.
    let schema: unknown;
    try {
      schema = _require('../../schemas/muster-e2e.schema.json');
    } catch {
      schema = _require('../../../schemas/muster-e2e.schema.json');
    }
    compiled = new AjvCtor({ strict: true }).compile(schema);
  }
  return compiled;
}

/** True when the file parses and declares `"type": "muster-e2e"`. A file that
 * does not parse returns false so the normal loader reports its own error. */
export async function isMusterE2eFile(filePath: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as { type?: unknown };
    return raw?.type === MUSTER_E2E_TYPE;
  } catch {
    return false;
  }
}

export function validateMusterE2e(parsed: unknown, label = 'muster-e2e scenario'): MusterE2eScenario {
  const validate = validator();
  if (!validate(parsed)) {
    throw new Error(`${label}: fails muster-e2e schema: ${JSON.stringify(validate.errors?.[0] ?? validate.errors)}`);
  }
  return parsed as MusterE2eScenario;
}

/** Synthetic-customer W0: a scenario slug (stacksim scenario name = tenant slug): lower case, digits and '-'. */
export const SCENARIO_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The tester's muster scenarios folder: `<tester>/scenarios/muster` (src/ in vitest, dist/src/ from the CLI). */
export function defaultMusterScenariosDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fromSrc = path.resolve(here, '..', '..', 'scenarios', 'muster');
  return existsSync(fromSrc) ? fromSrc : path.resolve(here, '..', '..', '..', 'scenarios', 'muster');
}

/** Synthetic-customer W0: the scenario file for a slug is `<scenariosDir>/<slug>-e2e.json`. Throws on a bad slug. */
export function musterE2eFileForSlug(slug: string, scenariosDir: string = defaultMusterScenariosDir()): string {
  if (!SCENARIO_SLUG_RE.test(slug)) throw new Error(`"${slug}" is not a scenario slug (lower case, digits, '-')`);
  return path.join(scenariosDir, `${slug}-e2e.json`);
}

/** Loads the slug's scenario file and checks it drives that slug (`sim_scenario` = slug), so every per-tenant path follows it. */
export async function loadMusterE2eForSlug(slug: string, scenariosDir?: string): Promise<{ file: string; scenario: MusterE2eScenario }> {
  const file = musterE2eFileForSlug(slug, scenariosDir);
  if (!existsSync(file)) throw new Error(`no muster-e2e scenario for "${slug}" (${file})`);
  const scenario = await loadMusterE2eFile(file);
  if (scenario.sim_scenario !== slug) throw new Error(`${file}: sim_scenario "${scenario.sim_scenario}" is not the slug "${slug}"`);
  return { file, scenario };
}

export async function loadMusterE2eFile(filePath: string): Promise<MusterE2eScenario> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`${filePath}: not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  return validateMusterE2e(parsed, filePath);
}
