// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// GC-FLOW-3: POST /api/intake/muster, Muster's push bundle delivered to EO.
//
// Body (the same names as muster-api's POST /api/plan/push, plus two):
//   tenant_slug, missionPlan, tenantManifest, infraManifest?,
//   si_baseline?, tcp?, readiness_posture?, policy_inputs_profile?, policy_set_manifest?, cui_boundary?
//     (each envelope { cesId, artifact_id, hash_sha256, artifact }),
//   policies?: [{ name: 'policies/<stem>.md', markdown }]  (the documents the policy-set manifest hashes),
//   file_names?: { <kind>: '<pushed file name>' }          (echoed in the receipt).
// Checks, before anything is written (each failure a 400 naming it): the envelope rules of muster-api's push
// (planHandoff.checkHandoff: shape, artifact.ces.artifact type, hash_sha256 = canonicalSha256(artifact), and the
// Mission Plan's inputs.<kind>_ref carries the same hash and artifact_id); each policy is named in the accepted
// policy-set manifest and sha256(markdown, utf8) equals the manifest's sha256.
// Stored under <storageRoot>/intake/<slug>/<receiptId>/: <kind>.json (JSON.stringify(doc, null, 2), the bytes
// muster-api writes to Stamper's plans folder), policies/<stem>.md, receipt.json. The policies go into the policy
// store through the import path (importPolicyDocuments). The response is the receipt (201).
// Auth: the global EO bearer middleware (CES_EO_AUTH_TOKEN) guards /api/*.
import express, { type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from 'ces-shared/crypto';
import type { EoConfig } from '../../config/EoConfig.js';
import type { PolicyStore } from '../../policies/PolicyStore.js';
import { FAMILY_POLICY_BASES } from '../../ssp/OdpValueProvider.js';
import { sendError, requireTenantScope } from '../eo-router-utils.js';
import { importPolicyDocuments } from './policies-router.js';

export const INTAKE_RECEIPT_SCHEMA = 'ces-eo/muster-intake-receipt@1';

export type IntakeEnvelopeKind =
  | 'si_baseline'
  | 'tcp'
  | 'readiness_posture'
  | 'policy_inputs_profile'
  | 'policy_set_manifest'
  | 'cui_boundary';

/** Same kinds, artifact types and MP ref keys as muster-api's planHandoff.ts. */
export const INTAKE_ENVELOPE_KINDS: readonly IntakeEnvelopeKind[] = [
  'si_baseline', 'tcp', 'readiness_posture', 'policy_inputs_profile', 'policy_set_manifest', 'cui_boundary',
];
const ARTIFACT_TYPE: Record<IntakeEnvelopeKind, string> = {
  si_baseline: 'si_baseline_output',
  tcp: 'tenant_config_profile',
  readiness_posture: 'CES_READINESS_POSTURE',
  policy_inputs_profile: 'policy_inputs_output',
  policy_set_manifest: 'policy_set_manifest',
  cui_boundary: 'cui_boundary_output',
};
const MP_REF_KEY: Record<IntakeEnvelopeKind, string> = {
  si_baseline: 'si_baseline_ref',
  tcp: 'tcp_ref',
  readiness_posture: 'readiness_posture_ref',
  policy_inputs_profile: 'policy_inputs_profile_ref',
  policy_set_manifest: 'policy_set_manifest_ref',
  cui_boundary: 'cui_boundary_ref',
};
const DOCUMENT_KINDS = [
  { kind: 'mission_plan', key: 'missionPlan', required: true },
  { kind: 'tenant_manifest', key: 'tenantManifest', required: true },
  { kind: 'infra_manifest', key: 'infraManifest', required: false },
] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const POLICY_NAME_RE = /^policies\/([a-z0-9][a-z0-9-]*)\.md$/;

interface Envelope { cesId: string; artifact_id: string; hash_sha256: string; artifact: Record<string, unknown> }

export interface IntakeReceiptItem {
  kind: string;
  /** The name the caller pushed it under (Stamper plans folder), when given. */
  file_name: string | null;
  stored_as: string;
  /** SHA-256 of the stored bytes: JSON.stringify(doc, null, 2) as UTF-8 (= the pushed file's bytes). */
  sha256: string;
  bytes: number;
  artifact_id?: string;
  /** The envelope's own canonical hash, checked against the artifact and the MP reference. */
  hash_sha256?: string;
}

export interface IntakeReceipt {
  schema: typeof INTAKE_RECEIPT_SCHEMA;
  receipt_id: string;
  tenant_slug: string;
  received_at: string;
  items: IntakeReceiptItem[];
  policies: {
    documents: Array<{ name: string; sha256: string; domain: string; stored_as: string }>;
    manifest_documents: number;
    imported: number;
    /** The tenant's policy store after the import (PolicyStore.load). */
    store_count: number;
    /** Manifest documents the push did not carry (no text, so not imported). */
    missing: string[];
  };
  warnings: string[];
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The family a Muster policy document belongs to (FAMILY_POLICY_BASES), else ORG (organisation-wide). */
export function policyDomainFor(stem: string): string {
  return Object.entries(FAMILY_POLICY_BASES).find(([, bases]) => bases.includes(stem))?.[0] ?? 'ORG';
}

/**
 * A Muster policy document as an EO PolicyDocument. The title round-trips to the file name
 * (title.toLowerCase().replace(/\s+/g, '-') = stem), which the package and the evidence index match on.
 * completeness 0: Muster does not measure it (0 = not measured). nist_controls: the 3.x.y requirements the text names.
 */
export function policyDocumentFromMuster(name: string, markdown: string): Record<string, unknown> {
  const stem = POLICY_NAME_RE.exec(name)![1]!;
  const refs = [...new Set(markdown.match(/(?<![\d.])3\.\d{1,2}\.\d{1,2}(?![\d])/g) ?? [])];
  return {
    template_id: stem,
    title: stem.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    markdown,
    completeness: 0,
    domain: policyDomainFor(stem),
    nist_controls: refs,
  };
}

/** The envelope rules of muster-api's push (planHandoff.checkHandoff), on the intake body. */
export function checkIntakeEnvelopes(missionPlan: unknown, body: Record<string, unknown>): {
  errors: string[]; warnings: string[]; accepted: Partial<Record<IntakeEnvelopeKind, Envelope>>;
} {
  const inputs = ((missionPlan as { inputs?: unknown })?.inputs ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const accepted: Partial<Record<IntakeEnvelopeKind, Envelope>> = {};
  for (const kind of INTAKE_ENVELOPE_KINDS) {
    const ref = inputs[MP_REF_KEY[kind]] as { hash_sha256?: unknown; artifact_id?: unknown } | undefined;
    const refHash = ref && typeof ref.hash_sha256 === 'string' ? ref.hash_sha256 : null;
    const sent = body[kind];
    if (sent === undefined || sent === null) {
      if (refHash) warnings.push(`the Mission Plan references ${kind} (${String(ref!.artifact_id)}) but the bundle did not carry it`);
      continue;
    }
    const e = sent as Partial<Envelope>;
    const art = e.artifact as { ces?: { artifact?: unknown } } | undefined;
    if (
      typeof sent !== 'object' || typeof e.cesId !== 'string' || !e.cesId ||
      typeof e.artifact_id !== 'string' || !e.artifact_id ||
      typeof e.hash_sha256 !== 'string' || !HEX64.test(e.hash_sha256) ||
      !art || typeof art !== 'object' || art.ces?.artifact !== ARTIFACT_TYPE[kind]
    ) {
      errors.push(`${kind}: must be { cesId, artifact_id, hash_sha256 (hex SHA-256), artifact } with artifact.ces.artifact '${ARTIFACT_TYPE[kind]}'`);
      continue;
    }
    if (canonicalSha256(e.artifact) !== e.hash_sha256) { errors.push(`${kind}: hash_sha256 does not match the artifact`); continue; }
    if (!refHash) { errors.push(`${kind}: the Mission Plan does not reference it (inputs.${MP_REF_KEY[kind]})`); continue; }
    if (refHash !== e.hash_sha256 || ref!.artifact_id !== e.artifact_id) {
      errors.push(`${kind}: does not match the Mission Plan's inputs.${MP_REF_KEY[kind]}`);
      continue;
    }
    accepted[kind] = e as Envelope;
  }
  return { errors, warnings, accepted };
}

/** Each policy named in the accepted policy-set manifest, with the manifest's sha256 of its text. */
export function checkIntakePolicies(policies: unknown, manifest: Envelope | undefined): {
  errors: string[]; docs: Array<{ name: string; markdown: string; sha256: string }>; missing: string[]; manifestCount: number;
} {
  const listed = (((manifest?.artifact as { documents?: unknown })?.documents ?? []) as Array<{ name?: unknown; sha256?: unknown }>)
    .filter(d => typeof d?.name === 'string' && typeof d?.sha256 === 'string') as Array<{ name: string; sha256: string }>;
  const byName = new Map(listed.map(d => [d.name, d.sha256]));
  const errors: string[] = [];
  const docs: Array<{ name: string; markdown: string; sha256: string }> = [];
  if (policies === undefined || policies === null) {
    return { errors, docs, missing: listed.map(d => d.name), manifestCount: listed.length };
  }
  if (!Array.isArray(policies)) return { errors: ['policies: must be an array of { name, markdown }'], docs, missing: [], manifestCount: listed.length };
  if (policies.length > 0 && !manifest) errors.push('policies: no policy_set_manifest in the bundle to verify them against');
  const seen = new Set<string>();
  for (const p of policies as Array<{ name?: unknown; markdown?: unknown }>) {
    const name = typeof p?.name === 'string' ? p.name : '';
    if (!POLICY_NAME_RE.test(name) || typeof p.markdown !== 'string' || p.markdown.length === 0) {
      errors.push(`policies: ${name || '(unnamed)'} must be { name: 'policies/<name>.md', markdown (non-empty) }`);
      continue;
    }
    if (seen.has(name)) { errors.push(`policies: ${name} sent twice`); continue; }
    seen.add(name);
    if (!manifest) continue;
    const want = byName.get(name);
    if (!want) { errors.push(`policies: ${name} is not in the policy-set manifest`); continue; }
    const got = sha256(p.markdown);
    if (got !== want) { errors.push(`policies: ${name} sha256 does not match the policy-set manifest`); continue; }
    docs.push({ name, markdown: p.markdown, sha256: got });
  }
  return { errors, docs, missing: listed.map(d => d.name).filter(n => !seen.has(n)), manifestCount: listed.length };
}

function receiptStamp(): string {
  return `intake-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export interface IntakeRouterDeps {
  config: EoConfig;
  stamperRoot: string;
  policyStore: PolicyStore;
}

export function createIntakeRouter(deps: IntakeRouterDeps): express.Router {
  const { config, stamperRoot, policyStore } = deps;
  const router = express.Router();

  router.post('/api/intake/muster', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scope = requireTenantScope(req, res, stamperRoot, body.tenant_slug);
    if (!scope) return;
    const slug = scope.slug;

    const errors: string[] = [];
    for (const d of DOCUMENT_KINDS) {
      const v = body[d.key];
      if (v === undefined || v === null) { if (d.required) errors.push(`${d.key} is required`); continue; }
      if (typeof v !== 'object' || Array.isArray(v)) errors.push(`${d.key} must be an object`);
    }
    if (errors.length > 0) { res.status(400).json({ error: 'Intake bundle violation', details: errors }); return; }
    const env = checkIntakeEnvelopes(body.missionPlan, body);
    const pol = checkIntakePolicies(body.policies, env.accepted.policy_set_manifest);
    errors.push(...env.errors, ...pol.errors);
    if (errors.length > 0) { res.status(400).json({ error: 'Intake bundle violation', details: errors }); return; }

    const policyDocs = pol.docs.map(d => policyDocumentFromMuster(d.name, d.markdown));
    const fileNames = (body.file_names && typeof body.file_names === 'object' ? body.file_names : {}) as Record<string, unknown>;
    const receiptId = receiptStamp();
    const dir = path.join(config.storageRoot, 'intake', slug, receiptId);
    try {
      fs.mkdirSync(path.join(dir, 'policies'), { recursive: true });
      const items: IntakeReceiptItem[] = [];
      const store = (kind: string, doc: unknown, envelope?: Envelope) => {
        const text = JSON.stringify(doc, null, 2);
        const storedAs = `${kind}.json`;
        fs.writeFileSync(path.join(dir, storedAs), text, 'utf-8');
        const name = fileNames[kind];
        items.push({
          kind,
          file_name: typeof name === 'string' && name ? path.basename(name) : null,
          stored_as: storedAs,
          sha256: sha256(text),
          bytes: Buffer.byteLength(text, 'utf8'),
          ...(envelope ? { artifact_id: envelope.artifact_id, hash_sha256: envelope.hash_sha256 } : {}),
        });
      };
      for (const d of DOCUMENT_KINDS) if (body[d.key]) store(d.kind, body[d.key]);
      for (const kind of INTAKE_ENVELOPE_KINDS) {
        const e = env.accepted[kind];
        if (e) store(kind, e, e);
      }
      for (const d of pol.docs) fs.writeFileSync(path.join(dir, d.name), d.markdown, 'utf-8');

      let imported = 0;
      if (policyDocs.length > 0) {
        const r = importPolicyDocuments({ config, policyStore }, slug, policyDocs, `Muster intake ${receiptId} (FLOW-3)`);
        if (!r.ok) throw new Error(`policy import failed: ${r.error}`);
        imported = r.imported;
      }
      const receipt: IntakeReceipt = {
        schema: INTAKE_RECEIPT_SCHEMA,
        receipt_id: receiptId,
        tenant_slug: slug,
        received_at: new Date().toISOString(),
        items,
        policies: {
          documents: pol.docs.map((d, i) => ({ name: d.name, sha256: d.sha256, domain: String(policyDocs[i]!.domain), stored_as: d.name })),
          manifest_documents: pol.manifestCount,
          imported,
          store_count: policyStore.load(slug).length,
          missing: pol.missing,
        },
        warnings: [...env.warnings, ...(pol.missing.length > 0 ? [`${pol.missing.length} policy-set manifest document(s) carried no text: ${pol.missing.slice(0, 5).join(', ')}`] : [])],
      };
      fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2), 'utf-8');
      res.status(201).json(receipt);
    } catch (err) {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  return router;
}

/** The CUI Boundary envelope of the tenant's newest intake, verified, for the SSP boundary section. */
export interface IntakeCuiBoundary {
  receiptId: string;
  receivedAt: string;
  artifactId: string;
  hashSha256: string;
  cuiBoundary: Record<string, unknown>;
}

/**
 * GC-FLOW-3: the newest intake's CUI Boundary envelope (<storageRoot>/intake/<slug>/<newest receipt>/cui_boundary.json),
 * when canonicalSha256(artifact) equals its hash_sha256 and the receipt's, and, when a Mission Plan is given and it
 * references the boundary, the MP's inputs.cui_boundary_ref hash and artifact_id. Otherwise undefined (the SSP keeps
 * the Tenant Manifest's boundary facts). Never throws.
 */
export function readIntakeCuiBoundary(storageRoot: string | undefined, slug: string | undefined, missionPlan?: Record<string, unknown>): IntakeCuiBoundary | undefined {
  try {
    if (!storageRoot || !slug || !SLUG_RE.test(slug)) return undefined;
    const root = path.join(storageRoot, 'intake', slug);
    if (!fs.existsSync(root)) return undefined;
    const newest = fs.readdirSync(root).filter(d => d.startsWith('intake-') && fs.existsSync(path.join(root, d, 'receipt.json'))).sort().pop();
    if (!newest) return undefined;
    const receipt = JSON.parse(fs.readFileSync(path.join(root, newest, 'receipt.json'), 'utf-8')) as IntakeReceipt;
    const item = receipt.items?.find(i => i.kind === 'cui_boundary');
    if (!item) return undefined;
    const envelope = JSON.parse(fs.readFileSync(path.join(root, newest, item.stored_as), 'utf-8')) as Envelope;
    const recomputed = canonicalSha256(envelope.artifact);
    if (recomputed !== envelope.hash_sha256 || recomputed !== item.hash_sha256) return undefined;
    const ref = (missionPlan?.inputs as Record<string, { hash_sha256?: unknown; artifact_id?: unknown } | undefined> | undefined)?.cui_boundary_ref;
    if (ref?.hash_sha256 !== undefined && (ref.hash_sha256 !== recomputed || ref.artifact_id !== envelope.artifact_id)) return undefined;
    const cuiBoundary = (envelope.artifact as { cui_boundary?: unknown }).cui_boundary;
    if (!cuiBoundary || typeof cuiBoundary !== 'object') return undefined;
    return { receiptId: receipt.receipt_id, receivedAt: receipt.received_at, artifactId: envelope.artifact_id, hashSha256: recomputed, cuiBoundary: cuiBoundary as Record<string, unknown> };
  } catch {
    return undefined;
  }
}
