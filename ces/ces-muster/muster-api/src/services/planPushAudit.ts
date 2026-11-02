// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planPushAudit.ts — MG-15 (decision D10): the push gate's verdict and the
// audit record of an operator override.
//
// The gate runs the vendored validateArtifactAlignment (proposal checks
// dropped, D1) and classifies it exactly as the SPA does
// (src/features/plan/planValidation.ts classifyAlignment):
//   STRUCTURE              — a missing MP / TM body (the validator's errors);
//   MP_TM_CONTROL_MISMATCH — a control with expected artifacts but no TM
//                            evidence monitor, or a TM normative control the
//                            MP does not cover;
// both BLOCK; every other finding is a warning.
// FX-11: OPERATOR_VALUE_DEFAULTED — an operator value (operatorUPN …
// securityEmail) whose TM provenance (tenant_identity.operator_value_provenance)
// is 'defaulted' also BLOCKS, unless that record says the plan is sim-only.
// Same rule as the SPA's planValidation.checkOperatorValues (tsc rootDir keeps
// muster-api from importing it; tests/plan.push.validation.test.ts compares them).
//
// Audit log: overrides are appended as JSON lines to
// <CES_PIPELINE_ROOT>/<slug>/state/plan-push-audit.jsonl — append-only, never
// rewritten or purged here. FLOW-1: every accepted push (override or not) is
// also recorded write-once in ces.db's WORM collection muster_plan_push
// (recordPlanPush, musterWorm.ts); the jsonl stays as the override mirror.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStamperTenantSubdir } from 'ces-shared/storage/node';
import { MUSTER_PLAN_PUSH, sha256Hex, writeMusterWorm } from './musterWorm.js';
import { validateArtifactAlignment } from './artifactAlignmentValidator.js';

export interface PushGateResult {
  blocking: string[];
  warnings: string[];
}

const CONTROL_MISMATCH = [
  /^Control ".*" has expected artifacts but no evidence monitor in tenant manifest$/,
  /^Tenant manifest normative control ".*" not present in manual plan control coverage$/,
];

/**
 * MG-09 x D10 (2C-1): a failed BTC gate's `btc_gate_<domain>` TM normative
 * control is never covered by the MP (Planner's own check 8 requires it in the
 * TM, check 4 then flags it); it stays a warning, as in the SPA's
 * planValidation.classifyAlignment.
 */
const BTC_GATE_MARKER = /^Tenant manifest normative control "btc_gate_[^"]*" not present in manual plan control coverage$/;

/**
 * W6 (run 56, S2): a BTC risk flag (critical / high) becomes a remediation task
 * in the MP with requirement_id `BTC_RISK_<flag>` and no control coverage, and
 * the TM carries it as a normative control, so validator check 4 flags it. It is
 * a boundary risk finding, not a plan control: exempt it from
 * MP_TM_CONTROL_MISMATCH like the btc_gate marker and keep it as a warning. The
 * flag itself rides the CUI boundary (`boundary_risk_flags`, tenantManifestAdapter)
 * into the TM boundary_zones definitions, which EvidenceOps prints as boundary facts.
 * The SPA's planValidation and muster-api's planPushAudit apply the same rule.
 */
const BTC_RISK_MARKER = /^(Tenant manifest normative control|Control) "BTC_RISK_[^"]*" (not present in manual plan control coverage|has expected artifacts but no evidence monitor in tenant manifest)$/;

export function runPushGate(missionPlan: unknown, tenantManifest: unknown, cuiBoundary?: unknown): PushGateResult {
  const r = validateArtifactAlignment(
    missionPlan,
    tenantManifest,
    null,
    (cuiBoundary ?? null) as Parameters<typeof validateArtifactAlignment>[3],
    null,
  );
  const blocking = r.errors.map((e) => `STRUCTURE: ${e}`);
  const warnings: string[] = [];
  for (const w of r.warnings) {
    if (BTC_GATE_MARKER.test(w) || BTC_RISK_MARKER.test(w)) warnings.push(w);
    else if (CONTROL_MISMATCH.some((re) => re.test(w))) blocking.push(`MP_TM_CONTROL_MISMATCH: ${w}`);
    else warnings.push(w);
  }
  blocking.push(...operatorValueBlocking(tenantManifest));
  return { blocking, warnings };
}

/** FX-11: the OPERATOR_VALUE_DEFAULTED errors for a TM (none when sim-only or no record). */
export function operatorValueBlocking(tenantManifest: unknown): string[] {
  const ti = (tenantManifest as { tenant_manifest?: { tenant_identity?: Record<string, unknown> } } | null)
    ?.tenant_manifest?.tenant_identity;
  const block = ti?.operator_value_provenance as { sim_only?: unknown; values?: Record<string, unknown> } | undefined;
  if (!block || typeof block !== 'object' || !block.values || block.sim_only === true) return [];
  return Object.entries(block.values)
    .filter(([, p]) => p === 'defaulted')
    .map(
      ([name]) =>
        `OPERATOR_VALUE_DEFAULTED: ${name}: ${typeof ti?.[name] === 'string' ? `placeholder ${String(ti[name])}` : 'unresolved'} (not discovered or answered)`
    );
}

export interface PlanPushOverrideRecord {
  event: 'plan_push_validation_override';
  at: string;
  user: { sub: string; tenant_id: string; role: string };
  tenant_slug: string;
  reason: string;
  overridden_errors: string[];
  warnings: string[];
  pushed: string[];
}

export function planPushAuditPath(tenantSlug: string): string {
  return path.join(getStamperTenantSubdir(tenantSlug, 'state'), 'plan-push-audit.jsonl');
}

export function appendPlanPushAudit(record: PlanPushOverrideRecord): void {
  const file = planPushAuditPath(record.tenant_slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
}

export interface PlanPushWormRecord {
  event: 'plan_push';
  at: string;
  user: { sub: string; tenant_id: string; role: string };
  tenant_slug: string;
  /** Every pushed file, in push order, hashed as it lies in Stamper's plans folder. */
  files: { name: string; sha256: string; bytes: number }[];
  override: { reason: string; overridden_errors: string[] } | null;
  warnings: string[];
}

/**
 * FLOW-1: record one accepted push in ces.db's WORM collection muster_plan_push
 * (id = `<slug>:<MP file name>`). The hashes are read back from `plansDir`.
 */
export function recordPlanPush(input: {
  at: string;
  user: { sub: string; tenant_id: string; role: string };
  tenant_slug: string;
  plansDir: string;
  pushed: string[];
  override: { reason: string; overridden_errors: string[] } | null;
  warnings: string[];
}): PlanPushWormRecord {
  const record: PlanPushWormRecord = {
    event: 'plan_push',
    at: input.at,
    user: input.user,
    tenant_slug: input.tenant_slug,
    files: input.pushed.map((name) => {
      const bytes = fs.readFileSync(path.join(input.plansDir, name));
      return { name, sha256: sha256Hex(bytes), bytes: bytes.length };
    }),
    override: input.override,
    warnings: input.warnings,
  };
  writeMusterWorm(MUSTER_PLAN_PUSH, `${input.tenant_slug}:${input.pushed[0]}`, input.tenant_slug, record);
  return record;
}
