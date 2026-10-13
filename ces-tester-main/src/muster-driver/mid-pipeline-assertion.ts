// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PLAN.md M2 task 3: evaluate one `mid_pipeline_assertion` against the
 * exported Manual Mission Plan JSON, fail fast before Stamper runs.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): the architecture doc's
 * §6.2 worked example uses the path `$.tasks[?(@.control_id=='IA.L2-3.5.3')]`.
 * Direct read of `ces-planner/src/features/mpt/services/manualPlanGenerator.ts`
 * (lines 85-94, 318-335) shows the real Manual Mission Plan has no top-level
 * `tasks` array. Cross-checked against a real generated plan on disk
 * (`ces-planner/customers/VFS GCC High G5 M365 + Foundation + Sentinel/
 * outputs/manual-mission-plan_manual-2026-04-22T20-03-50-346Z.json`):
 * control-level directives live at
 * `outputs.human_readable_mission_plan.control_directives[]`, each
 * `{control_id, directive, step_ids?}` — and `IA.L2-3.5.3` genuinely appears
 * in that real L2/CUI-present plan (110 directives total), confirming the
 * control ID itself is valid, not just re-pathed. This module implements a
 * minimal, purpose-built evaluator (NOT a general JSONPath engine) for
 * exactly this shape: a dotted object-path prefix resolving to an array,
 * filtered by an exact `control_id` match, asserting existence.
 */

export interface MidPipelineAssertionSpec {
  /** Dotted path to the array to search, e.g. "outputs.control_directives". */
  arrayPath: string;
  /** Field name to match on each array element, e.g. "control_id". */
  matchField: string;
  /** Value the matchField must equal. */
  matchValue: string;
  assert: 'exists';
}

export interface MidPipelineAssertionResult {
  name: string;
  pass: boolean;
  detail: string;
}

function getByDottedPath(obj: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Evaluates a single mid_pipeline_assertion against a parsed Manual Mission
 * Plan JSON object. Returns pass=false (not a throw) when the array or match
 * is absent, so the caller can fail fast with a clear message rather than
 * crash on a missing path.
 */
export function evaluateMidPipelineAssertion(
  missionPlan: unknown,
  spec: MidPipelineAssertionSpec,
): MidPipelineAssertionResult {
  const name = `${spec.arrayPath}[?(@.${spec.matchField}=='${spec.matchValue}')] ${spec.assert}`;
  const arr = getByDottedPath(missionPlan, spec.arrayPath);

  if (!Array.isArray(arr)) {
    return { name, pass: false, detail: `path "${spec.arrayPath}" is not an array (or is absent)` };
  }

  const match = arr.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      (item as Record<string, unknown>)[spec.matchField] === spec.matchValue,
  );

  if (spec.assert === 'exists') {
    if (!match) {
      return {
        name,
        pass: false,
        detail: `no element in "${spec.arrayPath}" with ${spec.matchField}="${spec.matchValue}"`,
      };
    }
    return { name, pass: true, detail: `found element with ${spec.matchField}="${spec.matchValue}"` };
  }

  return { name, pass: false, detail: `unsupported assert type "${spec.assert}"` };
}

/**
 * clean-tenant-mfa-baseline's mid-pipeline assertion (architecture §6.2),
 * re-pathed to the real Manual Mission Plan shape (see module doc comment).
 * The architecture doc's control ID (IA.L2-3.5.3, MFA-related NIST 800-171
 * control) is preserved — only the array path changed.
 */
export const CLEAN_TENANT_MFA_BASELINE_MID_PIPELINE_ASSERTION: MidPipelineAssertionSpec = {
  arrayPath: 'outputs.human_readable_mission_plan.control_directives',
  matchField: 'control_id',
  matchValue: 'IA.L2-3.5.3',
  assert: 'exists',
};
