// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planHandoff.ts — MG-12 (persist-and-reference interim; MG-27, the Stamper
// intake contract, stays contractor-owned under D11). POST /api/plan/push may
// carry the SI Baseline, TCP and Readiness Posture the plan was compiled from,
// each as { cesId, schema_id, artifact_id, version, hash_sha256, artifact }
// (SPA src/features/plan/artifactRefs.ts). The route stores each envelope
// beside the MP/TM/IM as <prefix>-<slug>-<ts>.json.
//
// Checks (each failure is a 400, before anything is written):
//   - the envelope is an object with a non-empty cesId and artifact_id, a hex
//     SHA-256 and an `artifact` whose ces.artifact is the expected type;
//   - hash_sha256 equals ces-shared canonicalSha256(artifact);
//   - the MP references the artifact (inputs.<kind>_ref) with the same hash and id.
// The fields are optional: a push without them is accepted (the run package's
// helper posts MP/TM/IM only); an MP reference with no artifact sent is a warning.
// Full schema validation of the three is MG-27's shared contract; Muster
// validates them against the copied Planner schemas at compile time (MG-15).
import { canonicalSha256 } from 'ces-shared/crypto';

//
// W3.3a (B9): two more kinds, policy_inputs_profile (the policy-inputs
// profile) and policy_set_manifest (relative policy file names + SHA-256 of
// each markdown), checked the same way. Their MP refs carry `file_name`; the
// route sets it to the name it stores the envelope under.
//
// W7-MX2 (ces-shared 2.10.0, CONTRACT CHANGE note 38): a sixth kind,
// cui_boundary (file prefix cui-boundary-), the CUI Boundary the plan was
// compiled with (artifact.ces.artifact 'cui_boundary_output'), checked the same
// way against inputs.cui_boundary_ref. That ref keeps the generator's block and
// adds artifact_id, hash_sha256 and schema_id; Stamper verifies the stored
// envelope (ces-stamper PlanTranslator checkCuiBoundaryRef). Not in
// POLICY_HANDOFF_KINDS: the route does not set its file_name, and Stamper finds
// the envelope by artifact_id.
export type HandoffKind =
  | 'si_baseline'
  | 'tcp'
  | 'readiness_posture'
  | 'policy_inputs_profile'
  | 'policy_set_manifest'
  | 'cui_boundary';

export const HANDOFF_KINDS: readonly HandoffKind[] = [
  'si_baseline',
  'tcp',
  'readiness_posture',
  'policy_inputs_profile',
  'policy_set_manifest',
  'cui_boundary',
];

/** W3.3a: the kinds whose MP refs carry `file_name`. */
export const POLICY_HANDOFF_KINDS: readonly HandoffKind[] = ['policy_inputs_profile', 'policy_set_manifest'];

/**
 * FIN-28 (GD-e, GAP-CLOSURE-PLAN.md §7; FLOW-5 (c)): which hand-off kinds Stamper
 * reads. Stamper reads the CUI Boundary (PlanTranslator checkCuiBoundaryRef) and
 * the policy-set manifest (GateEvidence) from its plans folder; it never reads the
 * SI Baseline, TCP, Readiness Posture or policy-inputs profile. GD-e: those four
 * go to EO only (EO's intake, GC-FLOW-3), not to Stamper's plans folder.
 */
export const STAMPER_READ_KINDS: readonly HandoffKind[] = ['policy_set_manifest', 'cui_boundary'];

/** FIN-28 (GD-e): the kinds Stamper never reads; EO's intake receives them. */
export const EO_ONLY_KINDS: readonly HandoffKind[] = HANDOFF_KINDS.filter((k) => !STAMPER_READ_KINDS.includes(k));

/**
 * FIN-28 (GD-e, interim): the kinds still written to Stamper's plans folder.
 * The policy-inputs profile stays until EO reads it from its intake store
 * (today ces-eo EoConfig.loadPolicyEnvelopes finds it beside the MP in plans\;
 * the SSP ODP values and the POA&M simulation marker use it). The SI Baseline,
 * TCP and Readiness Posture have no reader in plans\ (EO's intake stores all
 * six). The route applies this list once the harness checks V5 and V62 and
 * ces-tester's EO-intake re-send judge the intake instead (LOG-FIN-28.md S-1).
 * The EO bundle always carries all six.
 */
export const STAMPER_PLANS_KINDS: readonly HandoffKind[] = ['policy_inputs_profile', ...STAMPER_READ_KINDS];

/** FIN-28 (GD-e): is this accepted envelope written to Stamper's plans folder? */
export function storedForStamper(kind: HandoffKind): boolean {
  return STAMPER_PLANS_KINDS.includes(kind);
}

/** Same values as the SPA's artifactRefs.ts (a test compares them). */
export const HANDOFF_FILE_PREFIX: Record<HandoffKind, string> = {
  si_baseline: 'si-baseline',
  tcp: 'tcp',
  readiness_posture: 'readiness-posture',
  policy_inputs_profile: 'policy-inputs-profile',
  policy_set_manifest: 'policy-set-manifest',
  cui_boundary: 'cui-boundary',
};

export const HANDOFF_ARTIFACT_TYPE: Record<HandoffKind, string> = {
  si_baseline: 'si_baseline_output',
  tcp: 'tenant_config_profile',
  readiness_posture: 'CES_READINESS_POSTURE',
  policy_inputs_profile: 'policy_inputs_output',
  policy_set_manifest: 'policy_set_manifest',
  cui_boundary: 'cui_boundary_output',
};

export const MP_REF_KEY: Record<HandoffKind, string> = {
  si_baseline: 'si_baseline_ref',
  tcp: 'tcp_ref',
  readiness_posture: 'readiness_posture_ref',
  policy_inputs_profile: 'policy_inputs_profile_ref',
  policy_set_manifest: 'policy_set_manifest_ref',
  cui_boundary: 'cui_boundary_ref',
};

export interface HandoffEnvelope {
  cesId: string;
  schema_id?: string;
  artifact_id: string;
  version?: string;
  hash_sha256: string;
  artifact: Record<string, unknown>;
}

export interface HandoffCheck {
  errors: string[];
  warnings: string[];
  /** The envelopes to persist, by kind. */
  accepted: Partial<Record<HandoffKind, HandoffEnvelope>>;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function checkHandoff(missionPlan: unknown, body: Record<string, unknown>): HandoffCheck {
  const inputs = ((missionPlan as { inputs?: unknown })?.inputs ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const accepted: HandoffCheck['accepted'] = {};
  for (const kind of HANDOFF_KINDS) {
    const ref = inputs[MP_REF_KEY[kind]] as { hash_sha256?: unknown; artifact_id?: unknown } | undefined;
    const refHash = ref && typeof ref.hash_sha256 === 'string' ? ref.hash_sha256 : null;
    const sent = body[kind];
    if (sent === undefined || sent === null) {
      if (refHash) warnings.push(`MG-12: the Mission Plan references ${kind} (${String(ref!.artifact_id)}) but the push did not send it`);
      continue;
    }
    const e = sent as Partial<HandoffEnvelope>;
    const art = e.artifact as { ces?: { artifact?: unknown } } | undefined;
    if (
      typeof sent !== 'object' ||
      typeof e.cesId !== 'string' ||
      !e.cesId ||
      typeof e.artifact_id !== 'string' ||
      !e.artifact_id ||
      typeof e.hash_sha256 !== 'string' ||
      !HEX64.test(e.hash_sha256) ||
      !art ||
      typeof art !== 'object' ||
      art.ces?.artifact !== HANDOFF_ARTIFACT_TYPE[kind]
    ) {
      errors.push(
        `${kind}: must be { cesId, artifact_id, hash_sha256 (hex SHA-256), artifact } with artifact.ces.artifact '${HANDOFF_ARTIFACT_TYPE[kind]}'`
      );
      continue;
    }
    if (canonicalSha256(e.artifact) !== e.hash_sha256) {
      errors.push(`${kind}: hash_sha256 does not match the artifact`);
      continue;
    }
    if (!refHash) {
      errors.push(`${kind}: the Mission Plan does not reference it (inputs.${MP_REF_KEY[kind]})`);
      continue;
    }
    if (refHash !== e.hash_sha256 || ref!.artifact_id !== e.artifact_id) {
      errors.push(`${kind}: does not match the Mission Plan's inputs.${MP_REF_KEY[kind]}`);
      continue;
    }
    accepted[kind] = e as HandoffEnvelope;
  }
  return { errors, warnings, accepted };
}

export function handoffFileName(kind: HandoffKind, slug: string, ts: string): string {
  return `${HANDOFF_FILE_PREFIX[kind]}-${slug}-${ts}.json`;
}
