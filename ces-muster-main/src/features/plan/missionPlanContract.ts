// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// missionPlanContract.ts — SPA-side contract validation for plan artifacts.
//
// Flow-through MS-R1: validate every Manual Mission Plan and Tenant Manifest
// BEFORE it leaves Muster (download or push). This is the SPA half — no Zod
// (the SPA does not carry it). This is a FAST STRUCTURAL PRE-CHECK only; the
// authoritative gate is the canonical ces-shared Zod contract
// (ces-shared/types/mission-plan), which muster-api enforces on push via
// muster-api/src/contracts/missionPlan.contract.ts (a re-export).
//
// The contract is the CORE the generator unconditionally emits, and the gate
// asserts it against Planner's VFS reference FIRST, then against Muster's
// output — the reference defines the shape, and the check is self-verifying.

const KNOWN_VERSIONS = ['1.0.0'];

const VALID_DIRECTIVES = [
  'implement', 'validate', 'manual',
  'document-absence', 'document-prohibition', 'document-renderable',
  'inherit-fedramp', 'eo-tooled', 'skip',
];

export interface MissionPlanCoreResult {
  ok: boolean;
  missing: string[];
}

/**
 * Check a Manual Mission Plan against the core contract the generator always
 * emits for a gapful posture. Returns every missing/ill-typed path (not just
 * the first) so failures are legible.
 */
export function checkMissionPlanCore(plan: unknown): MissionPlanCoreResult {
  const missing: string[] = [];
  const p = plan as Record<string, unknown> | null | undefined;

  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const nonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

  // ces block spine
  const ces = p?.ces;
  if (!isObj(ces)) missing.push('ces');
  else {
    for (const k of ['artifact', 'version', 'generated_on']) {
      if (!(k in ces)) missing.push(`ces.${k}`);
    }
    if (typeof ces.version === 'string' && !KNOWN_VERSIONS.includes(ces.version)) {
      missing.push(`ces.version "${ces.version}" is not a known contract version (known: ${KNOWN_VERSIONS.join(', ')})`);
    }
    if (typeof ces.generated_on === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(ces.generated_on)) {
      missing.push('ces.generated_on must be YYYY-MM-DD');
    }
  }

  if (!isObj(p?.inputs)) missing.push('inputs');

  const outputs = p?.outputs as Record<string, unknown> | undefined;
  if (!isObj(outputs)) {
    missing.push('outputs');
    return { ok: missing.length === 0, missing };
  }
  if (!('cost_proposal_sow' in outputs)) missing.push('outputs.cost_proposal_sow');

  const hrmp = outputs.human_readable_mission_plan as Record<string, unknown> | undefined;
  if (!isObj(hrmp)) {
    missing.push('outputs.human_readable_mission_plan');
    return { ok: missing.length === 0, missing };
  }
  for (const k of ['plan_id', 'plan_mode', 'target_level', 'assessor_alignment_notes']) {
    if (!(k in hrmp)) missing.push(`human_readable_mission_plan.${k}`);
  }
  if (!nonEmptyArray(hrmp.milestones)) missing.push('human_readable_mission_plan.milestones[]');
  if (!nonEmptyArray(hrmp.steps)) missing.push('human_readable_mission_plan.steps[]');
  if (!nonEmptyArray(hrmp.control_directives)) {
    missing.push('human_readable_mission_plan.control_directives[]');
  } else {
    const rows = hrmp.control_directives as Array<Record<string, unknown>>;
    const bad = rows.some((r) => typeof r.control_id !== 'string' || typeof r.directive !== 'string');
    if (bad) missing.push('control_directives[].{control_id,directive}');
    const unknownDirective = rows.find(
      (r) => typeof r.directive === 'string' && !VALID_DIRECTIVES.includes(r.directive),
    );
    if (unknownDirective) {
      missing.push(`control_directives[].directive: unknown value "${unknownDirective.directive}"`);
    }
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Check a Tenant Manifest against the core contract: ces meta block with
 * ISO datetime generated_on, and a tenant_manifest body with required arrays.
 */
export function checkTenantManifestCore(manifest: unknown): MissionPlanCoreResult {
  const missing: string[] = [];
  const m = manifest as Record<string, unknown> | null | undefined;

  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const nonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

  const ces = m?.ces;
  if (!isObj(ces)) missing.push('ces');
  else {
    for (const k of ['artifact', 'version', 'generated_on', 'intent']) {
      if (!(k in ces)) missing.push(`ces.${k}`);
    }
    if (typeof ces.version === 'string' && !KNOWN_VERSIONS.includes(ces.version)) {
      missing.push(`ces.version "${ces.version}" is not a known contract version (known: ${KNOWN_VERSIONS.join(', ')})`);
    }
  }

  const tm = m?.tenant_manifest;
  if (!isObj(tm)) {
    missing.push('tenant_manifest');
    return { ok: missing.length === 0, missing };
  }

  if (typeof tm.manifest_id !== 'string' || !tm.manifest_id) missing.push('tenant_manifest.manifest_id');
  if (typeof tm.tech_stack_id !== 'number') missing.push('tenant_manifest.tech_stack_id');
  if (!nonEmptyArray(tm.normative_controls)) missing.push('tenant_manifest.normative_controls[]');
  if (!nonEmptyArray(tm.config_intents)) missing.push('tenant_manifest.config_intents[]');
  if (!nonEmptyArray(tm.evidence_monitors)) missing.push('tenant_manifest.evidence_monitors[]');
  if (!nonEmptyArray(tm.drift_policies)) missing.push('tenant_manifest.drift_policies[]');

  return { ok: missing.length === 0, missing };
}
