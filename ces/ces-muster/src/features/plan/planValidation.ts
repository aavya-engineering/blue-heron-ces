// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planValidation.ts — MG-15 (decision D10): Planner's cross-artifact
// validation as a release gate, plus schema checks of the compile inputs.
//
// 1. Alignment (vendored validateArtifactAlignment, proposal checks dropped
//    per D1). Planner only warns; Muster BLOCKS on
//      STRUCTURE              — a missing MP / TM body (the validator's errors);
//      MP_TM_CONTROL_MISMATCH — a control with expected artifacts but no TM
//                               evidence monitor, or a TM normative control the
//                               MP does not cover;
//    and warns on the rest (BTC, CUI-zones and TCP cross-checks). A blocked
//    push needs an operator override with a reason (muster-api audits it).
//    muster-api re-runs the same gate on push (its own vendored copy).
// 2. Input schemas: the SI Baseline, TCP and the compile's posture are checked
//    against the copied Planner schemas (public/schemas/planner/) before the
//    compile. Findings are WARNINGS: the shipped SI schema rejects Planner's
//    own reference output (G-MUSTER-PLAN-3-FINDINGS F5), so it cannot gate.
//    Known, owned schema defects are listed in SCHEMA_ALLOWLIST and accepted
//    (reported separately), so a fixture shows zero warnings beyond the list.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { validateArtifactAlignment } from '@/features/plan/engine/mpt/services/validator';
import { checkConsistency, type ConsistencyIssue } from '@/features/plan/engine/shared/services/consistencyChecker';
import type {
  BTCConfirmationOutput,
  CUIBoundaryOutput,
  ReadinessPosture,
  SIBaseline,
  TenantConfigProfileOutput,
} from '@/features/plan/engine/shared/types/artifacts';
import type { InterviewFact } from '@/shared/types/engagement';

export type BlockingCode = 'STRUCTURE' | 'MP_TM_CONTROL_MISMATCH' | 'OPERATOR_VALUE_DEFAULTED';

export interface AlignmentResult {
  /** Named, push-blocking errors: `<CODE>: <validator message>`. */
  blocking: string[];
  /** Non-blocking alignment warnings. */
  warnings: string[];
}

/** The validator's MP<->TM control checks (3 and 4) — blocking under D10. */
const CONTROL_MISMATCH = [
  /^Control ".*" has expected artifacts but no evidence monitor in tenant manifest$/,
  /^Tenant manifest normative control ".*" not present in manual plan control coverage$/,
];

/**
 * MG-09 x D10 (2C-1): the BTC gate markers. When a BTC gate fails, Planner's
 * manifestGenerator adds a `btc_gate_<domain>` normative control to the TM
 * (validator check 8 requires it), but nothing ever covers it in the MP, so
 * check 4 flags it. Planner warns on both. Blocking on it would block every
 * plan with a failed BTC gate; the gate failure is reported by check 6 (a
 * warning). Exempt from MP_TM_CONTROL_MISMATCH; muster-api's planPushAudit
 * applies the same exemption so the verdicts agree.
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

export function classifyAlignment(r: { errors: string[]; warnings: string[] }): AlignmentResult {
  const blocking = r.errors.map((e) => `STRUCTURE: ${e}`);
  const warnings: string[] = [];
  for (const w of r.warnings) {
    if (BTC_GATE_MARKER.test(w) || BTC_RISK_MARKER.test(w)) warnings.push(w);
    else if (CONTROL_MISMATCH.some((re) => re.test(w))) blocking.push(`MP_TM_CONTROL_MISMATCH: ${w}`);
    else warnings.push(w);
  }
  return { blocking, warnings };
}

export function validatePlanAlignment(
  missionPlan: unknown,
  tenantManifest: unknown,
  cuiBoundary?: CUIBoundaryOutput | null,
  tenantConfig?: TenantConfigProfileOutput | null,
  /** MG-09 hand-off (d): the compile's BTC-lite Confirmation (its gate / risk-flag checks warn). */
  btcConfirmation?: BTCConfirmationOutput | null
): AlignmentResult {
  const alignment = classifyAlignment(
    validateArtifactAlignment(missionPlan, tenantManifest, btcConfirmation ?? null, cuiBoundary ?? null, tenantConfig ?? null)
  );
  // MG-22: the SI-vs-CUI consistency rules over the SI Baseline the MP embeds (warn, never block).
  const siBaseline = (missionPlan as { inputs?: { si_baseline?: SIBaseline } } | null)?.inputs?.si_baseline ?? null;
  alignment.warnings.push(
    ...checkPlanConsistency({ siBaseline, cuiBoundary: cuiBoundary ?? null, btcConfirmation: btcConfirmation ?? null })
  );
  return alignment;
}

// ── MG-22 consistency (warnings) ────────────────────────────────────────────
//
// Planner's consistencyChecker (vendored verbatim) keys its CUI rules by CUI
// bank question id (cui_boundary['CUI.DEV.001'] …), but the CUI Boundary
// artifact (Planner's and Muster's) is keyed by the bank's bindings.manifest
// field names, so on a real boundary those rules never fire. The adapter below
// adds the four question-id keys from their bound fields before the rules run.
// Of the 8 rules, the BTC four (btc-staleness, cui-identity-vs-btc-gate,
// cui-device-vs-btc-gate, btc-gate-vs-rp-status) read the compile's BTC-lite
// Confirmation (MG-09) when one was built (MG-16 hand-off (d)). Planner's cui-staleness (SI generated after the CUI
// boundary) cannot fire either: Muster compiles both in one pass. Its Muster
// analogue is checkDiscoveryStaleness (CUI answers older than the latest
// discovery run).

/** CUI bank question id -> the CUI Boundary field it binds (bank bindings.manifest). */
export const CUI_RULE_BINDINGS: Record<string, string> = {
  'CUI.DEV.001': 'device_model',
  'CUI.DEVOPS.001': 'devops_in_scope',
  'CUI.LC.EGR.001': 'external_sharing_model',
  'CUI.ID.001': 'tenant_separation',
};

/** `CONSISTENCY_<RULE>: <message> (<details>)`, e.g. CONSISTENCY_SI_CUI_BYOD. */
export function consistencyWarning(issue: ConsistencyIssue): string {
  const code = `CONSISTENCY_${issue.id.toUpperCase().replace(/-/g, '_')}`;
  return `${code}: ${issue.message}${issue.details ? ` (${issue.details})` : ''}`;
}

/** The vendored rules over the SI Baseline + the CUI boundary (question-id keys added). */
export function checkPlanConsistency(ctx: {
  siBaseline: SIBaseline | null;
  cuiBoundary: CUIBoundaryOutput | null;
  readinessPosture?: ReadinessPosture | null;
  btcConfirmation?: BTCConfirmationOutput | null;
}): string[] {
  let cuiBoundary = ctx.cuiBoundary;
  if (cuiBoundary?.cui_boundary) {
    const keyed = { ...cuiBoundary.cui_boundary };
    for (const [qid, field] of Object.entries(CUI_RULE_BINDINGS)) {
      if (keyed[qid] === undefined && keyed[field] !== undefined) keyed[qid] = keyed[field];
    }
    cuiBoundary = { ...cuiBoundary, cui_boundary: keyed };
  }
  return checkConsistency({
    siBaseline: ctx.siBaseline,
    cuiBoundary,
    btcConfirmation: ctx.btcConfirmation ?? null,
    readinessPosture: ctx.readinessPosture ?? null,
  }).map(consistencyWarning);
}

const DISCOVERY_PROVENANCES = new Set(['discovery', 'auto_detected']);
const latest = (facts: InterviewFact[]): string | null =>
  facts.reduce<string | null>((m, f) => (f.recorded_at && (!m || f.recorded_at > m) ? f.recorded_at : m), null);

/**
 * MG-22: the CUI boundary answers predate the latest discovery run (the
 * newest discovery / harvest fact), so the boundary may not reflect what
 * discovery now observes. Planner's cui-staleness, on Muster's dates.
 */
export function checkDiscoveryStaleness(facts: InterviewFact[]): string[] {
  const discoveryAt = latest(facts.filter((f) => DISCOVERY_PROVENANCES.has(f.provenance)));
  const cuiAt = latest(facts.filter((f) => f.question_id.startsWith('CUI.') && !DISCOVERY_PROVENANCES.has(f.provenance)));
  if (!discoveryAt || !cuiAt || discoveryAt <= cuiAt) return [];
  return [
    `CONSISTENCY_CUI_STALE_VS_DISCOVERY: The CUI Boundary answers predate the latest discovery run. Review the CUI Boundary answers before pushing. (CUI answered: ${cuiAt}, discovery run: ${discoveryAt})`,
  ];
}

// ── Input schemas ───────────────────────────────────────────────────────────

export type SchemaArtifact = 'si-baseline' | 'tenant-config-profile' | 'readiness-posture';

export const SCHEMA_FILES: Record<SchemaArtifact, string> = {
  'si-baseline': '/schemas/planner/CES SIT Strategic Intent Baseline.schema.json',
  'tenant-config-profile': '/schemas/planner/CES TCP Tenant Config Profile.schema.json',
  'readiness-posture': '/schemas/planner/CES RRT Readiness Posture.schema.json',
};

export interface SchemaAllowEntry {
  id: string;
  artifact: SchemaArtifact;
  /** Matches `<instancePath> <keyword>[:<param>]` of one ajv error. */
  match: RegExp;
  owner: string;
  reason: string;
}

/**
 * Reviewed schema defects (accepted, reported, never counted as warnings).
 * Every entry names its owner; a new kind of finding is a warning until it is
 * reviewed and added here.
 */
export const SCHEMA_ALLOWLIST: SchemaAllowEntry[] = [
  {
    id: 'F5-si-operations-postures',
    artifact: 'si-baseline',
    match:
      /^\/si_baseline\/operations additionalProperties:(mobile_device_presence|wireless_posture|removable_media_posture|remote_access_posture|maintenance_posture|cui_endpoint_posture)$/,
    owner: 'F5 (G-MUSTER-PLAN-3-FINDINGS)',
    reason:
      "The copied SI schema predates the operations postures the vendored SIBaseline type and generator emit; Planner's own golden SI fails the same way.",
  },
  {
    id: 'F5-si-dependencies-counts',
    artifact: 'si-baseline',
    match: /^\/si_baseline\/dependencies additionalProperties:(physical_facility_count|customer_equipment_count)$/,
    owner: 'F5 (G-MUSTER-PLAN-3-FINDINGS)',
    reason:
      "The copied SI schema predates the SIT-024/025 facility and customer-equipment counts the vendored generator emits; Planner's own golden SI fails the same way.",
  },
  {
    id: 'si-cesid-pattern',
    artifact: 'si-baseline',
    match: /^\/ces\/cesId pattern$/,
    owner: 'to justify (BHD)',
    reason: "Muster stamps the engagement id as cesId; the copied SI schema expects Planner's ces-<12 hex> form.",
  },
  {
    id: 'posture-cesid-pattern',
    artifact: 'readiness-posture',
    match: /^\/ces\/cesId pattern$/,
    owner: 'to justify (BHD)',
    reason:
      "MG-12: the posture carries the engagement id as cesId, as the SI Baseline does (si-cesid-pattern); the copied posture schema expects Planner's ces-<12 hex> form.",
  },
  {
    id: 'si-no-cui-types',
    artifact: 'si-baseline',
    match: /^\/si_baseline\/target\/cui_types minItems$/,
    owner: 'Planner defect (01-GAP-BACKLOG section 5 class)',
    reason: "A no-CUI customer has no CUI types; Planner's golden SI for the same customer fails the same way.",
  },
  {
    id: 'MG-03-bridged-posture',
    artifact: 'readiness-posture',
    match:
      /^\/ces\/(generated_on format|(si_baseline_ref|rr_question_set_ref) (required|additionalProperties):.+|control_status_summary required:level|key_findings minItems)$/,
    owner: 'MG-03',
    reason:
      'A compile without a scoreFacts posture (the parity chain producer, or a caller passing requirement results only) reads a bridged posture (tenantManifestAdapter.bridgePosture), not an emitted posture artifact; MG-03 replaces it.',
  },
];

export interface SchemaCheckResult {
  /** Unreviewed findings: `<artifact> <instancePath> <message>`. */
  warnings: string[];
  /** Findings matched by SCHEMA_ALLOWLIST: `<entry id>: <artifact> <path> <message>`. */
  accepted: string[];
}

export type SchemaValidators = Record<SchemaArtifact, ValidateFunction>;

export function compileSchemaValidators(schemas: Record<SchemaArtifact, object>): SchemaValidators {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return {
    'si-baseline': ajv.compile(schemas['si-baseline']),
    'tenant-config-profile': ajv.compile(schemas['tenant-config-profile']),
    'readiness-posture': ajv.compile(schemas['readiness-posture']),
  };
}

const validatorsCache = new WeakMap<object, SchemaValidators>();

/** Compile once per loaded schema set (the banks loader supplies and caches the set). */
export function schemaValidatorsFor(schemas: Record<SchemaArtifact, object>): SchemaValidators {
  let v = validatorsCache.get(schemas);
  if (!v) {
    v = compileSchemaValidators(schemas);
    validatorsCache.set(schemas, v);
  }
  return v;
}

function errorKey(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  const param = p.additionalProperty ?? p.missingProperty;
  return `${e.instancePath} ${e.keyword}${param !== undefined ? `:${String(param)}` : ''}`;
}

export function checkInputSchemas(
  validators: SchemaValidators,
  inputs: Partial<Record<SchemaArtifact, unknown>>
): SchemaCheckResult {
  const warnings: string[] = [];
  const accepted: string[] = [];
  for (const artifact of Object.keys(SCHEMA_FILES) as SchemaArtifact[]) {
    const value = inputs[artifact];
    if (value === undefined || value === null) continue;
    const v = validators[artifact];
    if (v(value)) continue;
    for (const e of v.errors ?? []) {
      const key = errorKey(e);
      const text = `${artifact} ${e.instancePath || '/'} ${e.message ?? e.keyword}`;
      const hit = SCHEMA_ALLOWLIST.find((a) => a.artifact === artifact && a.match.test(key));
      if (hit) accepted.push(`${hit.id}: ${text}`);
      else warnings.push(text);
    }
  }
  return { warnings, accepted };
}

// ── FX-11 operator values ───────────────────────────────────────────────────

export interface OperatorValueCheck {
  /** The TM carries operator values and says the plan is for a sim tenant. */
  simOnly: boolean;
  /** Every defaulted operator value, always reported: `<stamperVar>: <value | unresolved>`. */
  defaulted: string[];
  /** `OPERATOR_VALUE_DEFAULTED: …` per defaulted value, unless sim-only. */
  blocking: string[];
}

/**
 * MG-15 / FX-11: an operator value Stamper would use (operatorUPN …
 * securityEmail) that nobody discovered or answered is a placeholder or a
 * gap, not a tenant fact. It blocks the push unless the plan is sim-only
 * (readiness_manifest.tenant_kind 'sim', e.g. the headless runner); either way
 * it is listed. Reads the TM's tenant_identity.operator_value_provenance
 * (tenantManifestAdapter), so the muster-api gate can apply the same rule.
 */
export function checkOperatorValues(tenantManifest: unknown): OperatorValueCheck {
  const ti = (tenantManifest as { tenant_manifest?: { tenant_identity?: Record<string, unknown> } } | null)
    ?.tenant_manifest?.tenant_identity;
  const block = ti?.operator_value_provenance as { sim_only?: unknown; values?: Record<string, unknown> } | undefined;
  if (!block || typeof block !== 'object' || !block.values) return { simOnly: false, defaulted: [], blocking: [] };
  const simOnly = block.sim_only === true;
  const defaulted = Object.entries(block.values)
    .filter(([, p]) => p === 'defaulted')
    .map(([name]) => `${name}: ${typeof ti?.[name] === 'string' ? `placeholder ${String(ti[name])}` : 'unresolved'}`);
  return {
    simOnly,
    defaulted,
    blocking: simOnly ? [] : defaulted.map((d) => `OPERATOR_VALUE_DEFAULTED: ${d} (not discovered or answered)`),
  };
}

/** What the compile reports and the push gate enforces. */
export interface PlanValidation extends AlignmentResult {
  schema: SchemaCheckResult;
  /** FX-11: defaulted operator values (always listed; blocking unless sim-only). */
  operatorValues: OperatorValueCheck;
}
