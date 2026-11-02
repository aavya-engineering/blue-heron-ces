// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// artifactRefs.ts — MG-12 (persist-and-reference interim; MG-27 owns the
// Stamper intake contract, D11). The SI Baseline, the Tenant Config Profile and
// the Readiness Posture the compile read travel with every plan as hand-off
// envelopes { cesId, schema_id, artifact_id, version, hash_sha256, artifact },
// and the Mission Plan references each by id and hash:
//   inputs.si_baseline_ref        the copied Planner MP schema's artifact_ref slot
//   inputs.readiness_posture_ref  the copied Planner MP schema's artifact_ref slot
//   inputs.tcp_ref                the generator's existing block, plus the
//                                 artifact_ref fields (the schema has no TCP slot)
// ces-shared's ManualMissionPlanSchema takes `inputs` as z.any(), so the MP
// stays valid under the shared contract.
//
// hash_sha256 = SHA-256 (hex) of the canonical JSON of `artifact` (object keys
// sorted recursively, compact): the same function as ces-shared
// `ces-shared/crypto` canonicalSha256, which muster-api verifies with. It is
// independent of how a file is pretty-printed.
//
// W3.3a (B9): two more kinds travel the same way, built from the rendered
// policy set (not by the compile):
//   policy_inputs_profile  the policy-inputs profile (Planner's PolicyInputsOutput)
//   policy_set_manifest    one entry per rendered policy document: its relative
//                          file name (policies/<base>.md) and the SHA-256 (hex)
//                          of its markdown bytes
// Their MP refs (inputs.policy_inputs_profile_ref / policy_set_manifest_ref)
// also carry `file_name`, the envelope's file in plans\.
//
// W7-MX2 (ces-shared 2.10.0, note 38): a sixth kind, cui_boundary, the CUI
// Boundary the compile used (Planner's CUIBoundaryOutput, after the BTC risk
// flags are attached). Built by the compile like the first three. Its MP ref
// is the generator's existing inputs.cui_boundary_ref block (artifact,
// version, generated_on, cui_bank_version), kept, plus artifact_id,
// hash_sha256 and schema_id. No boundary (skipped): no envelope, no ref fields.
// The hash is not copied into the Tenant Manifest.

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

/** W3.3a: the kinds built from the rendered policy set; their MP refs carry `file_name`. */
export const POLICY_HANDOFF_KINDS: readonly HandoffKind[] = ['policy_inputs_profile', 'policy_set_manifest'];

/** File-name prefix: `<prefix>-<slug>-<ts>.json`, beside the MP/TM/IM. */
export const HANDOFF_FILE_PREFIX: Record<HandoffKind, string> = {
  si_baseline: 'si-baseline',
  tcp: 'tcp',
  readiness_posture: 'readiness-posture',
  policy_inputs_profile: 'policy-inputs-profile',
  policy_set_manifest: 'policy-set-manifest',
  cui_boundary: 'cui-boundary',
};

/** The artifact's own `ces.artifact` value. */
export const HANDOFF_ARTIFACT_TYPE: Record<HandoffKind, string> = {
  si_baseline: 'si_baseline_output',
  tcp: 'tenant_config_profile',
  readiness_posture: 'CES_READINESS_POSTURE',
  policy_inputs_profile: 'policy_inputs_output',
  policy_set_manifest: 'policy_set_manifest',
  cui_boundary: 'cui_boundary_output',
};

/** The Mission Plan `inputs` key holding each reference. */
export const MP_REF_KEY: Record<HandoffKind, string> = {
  si_baseline: 'si_baseline_ref',
  tcp: 'tcp_ref',
  readiness_posture: 'readiness_posture_ref',
  policy_inputs_profile: 'policy_inputs_profile_ref',
  policy_set_manifest: 'policy_set_manifest_ref',
  cui_boundary: 'cui_boundary_ref',
};

/** The copied schema each artifact was validated against ($id; the TCP schema has none, so its file name). */
export const HANDOFF_SCHEMA_ID: Record<HandoffKind, string> = {
  si_baseline: 'https://example.invalid/schemas/ces-si-baseline-output.schema.json',
  tcp: 'schemas/planner/CES TCP Tenant Config Profile.schema.json',
  readiness_posture: 'https://example.invalid/schemas/ces-readiness-posture-output.schema.json',
  // No copied schema exists for these three: Muster-local identifiers.
  policy_inputs_profile: 'muster:policy-inputs-output',
  policy_set_manifest: 'muster:policy-set-manifest',
  cui_boundary: 'muster:cui-boundary-output',
};

/** The copied Planner MP schema's artifact_ref. */
export interface ArtifactRef {
  schema_id: string;
  artifact_id: string;
  version: string;
  hash_sha256: string;
  /** W3.3a: the envelope's file name (policy kinds only). */
  file_name?: string;
}

export interface HandoffArtifact extends ArtifactRef {
  cesId: string;
  artifact: unknown;
}

export type HandoffArtifacts = Partial<Record<HandoffKind, HandoffArtifact>>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

/** ces-shared canonicalJsonStringify: keys sorted recursively, compact. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 (hex) of a text's UTF-8 bytes (the policy-set manifest's per-document hash). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** ces-shared canonicalSha256, on WebCrypto (browser and Node). */
export async function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export function handoffFileName(kind: HandoffKind, slug: string, ts: string): string {
  return `${HANDOFF_FILE_PREFIX[kind]}-${slug}-${ts}.json`;
}

type CesBlock = { ces?: { cesId?: unknown; version?: unknown; snapshot_id?: unknown } };

async function envelopeOf(kind: HandoffKind, artifact: unknown, cesId: string): Promise<HandoffArtifact> {
  const ces = (artifact as CesBlock).ces ?? {};
  const id = typeof ces.cesId === 'string' && ces.cesId ? ces.cesId : cesId;
  return {
    cesId: id,
    schema_id: HANDOFF_SCHEMA_ID[kind],
    artifact_id:
      kind === 'readiness_posture' && typeof ces.snapshot_id === 'string'
        ? ces.snapshot_id
        : `${HANDOFF_FILE_PREFIX[kind]}-${id}`,
    version: typeof ces.version === 'string' ? ces.version : '1.0.0',
    hash_sha256: await canonicalSha256(artifact),
    artifact,
  };
}

/**
 * The envelopes for the artifacts the compile read (the TCP only when one was
 * built; W7-MX2: the CUI Boundary only when one was built).
 */
export async function buildHandoffArtifacts(
  inputs: { siBaseline: unknown; tenantConfig: unknown | null; posture: unknown; cuiBoundary?: unknown | null },
  cesId: string
): Promise<HandoffArtifacts> {
  const out: HandoffArtifacts = {};
  const sources: Partial<Record<HandoffKind, unknown>> = {
    si_baseline: inputs.siBaseline,
    tcp: inputs.tenantConfig,
    readiness_posture: inputs.posture,
    cui_boundary: inputs.cuiBoundary,
  };
  for (const kind of HANDOFF_KINDS) {
    const artifact = sources[kind];
    if (!artifact) continue;
    out[kind] = await envelopeOf(kind, artifact, cesId);
  }
  return out;
}

/** W3.3a: one manifest entry per rendered policy document. */
export interface PolicySetManifestEntry {
  /** Relative file name, `policies/<base>.md`. */
  name: string;
  /** SHA-256 (hex) of the markdown's UTF-8 bytes. */
  sha256: string;
}

export interface PolicySetManifest {
  ces: { artifact: 'policy_set_manifest'; version: string; generated_on: string };
  documents: PolicySetManifestEntry[];
}

/**
 * W3.3a: the policy-inputs profile and the hashed policy-set manifest as
 * envelopes. `documents` maps each base name (policyFileBase) to its rendered
 * markdown; the manifest's generated_on is the profile's own ces.generated_on.
 */
export async function buildPolicyHandoffArtifacts(
  inputs: { profileOutput: unknown; documents: Record<string, string> },
  cesId: string
): Promise<HandoffArtifacts> {
  const generatedOn = (inputs.profileOutput as { ces?: { generated_on?: unknown } }).ces?.generated_on;
  const manifest: PolicySetManifest = {
    ces: {
      artifact: 'policy_set_manifest',
      version: '1.0.0',
      generated_on: typeof generatedOn === 'string' ? generatedOn : '',
    },
    documents: await Promise.all(
      Object.keys(inputs.documents)
        .sort()
        .map(async (base) => ({ name: `policies/${base}.md`, sha256: await sha256Hex(inputs.documents[base]) }))
    ),
  };
  return {
    policy_inputs_profile: await envelopeOf('policy_inputs_profile', inputs.profileOutput, cesId),
    policy_set_manifest: await envelopeOf('policy_set_manifest', manifest, cesId),
  };
}

export function refOf(h: HandoffArtifact): ArtifactRef {
  return { schema_id: h.schema_id, artifact_id: h.artifact_id, version: h.version, hash_sha256: h.hash_sha256 };
}

/**
 * Write the references into the MP's `inputs` (in place; tcp_ref and, W7-MX2,
 * cui_boundary_ref keep the generator's fields). `fileNames` (W3.3a) adds
 * `file_name` to those refs.
 */
export function referenceHandoffArtifacts(
  missionPlan: unknown,
  handoff: HandoffArtifacts,
  fileNames: Partial<Record<HandoffKind, string>> = {}
): void {
  const mp = missionPlan as { inputs?: Record<string, unknown> };
  if (!mp.inputs) mp.inputs = {};
  for (const kind of HANDOFF_KINDS) {
    const h = handoff[kind];
    if (!h) continue;
    const key = MP_REF_KEY[kind];
    const existing = mp.inputs[key];
    mp.inputs[key] = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...refOf(h),
      ...(fileNames[kind] ? { file_name: fileNames[kind] } : {}),
    };
  }
}

/** The references an MP carries (only those with a hash). */
export function missionPlanRefs(missionPlan: unknown): Partial<Record<HandoffKind, ArtifactRef>> {
  const inputs = (missionPlan as { inputs?: Record<string, unknown> } | null)?.inputs ?? {};
  const out: Partial<Record<HandoffKind, ArtifactRef>> = {};
  for (const kind of HANDOFF_KINDS) {
    const r = inputs[MP_REF_KEY[kind]] as Partial<ArtifactRef> | undefined;
    if (r && typeof r.hash_sha256 === 'string') out[kind] = r as ArtifactRef;
  }
  return out;
}
