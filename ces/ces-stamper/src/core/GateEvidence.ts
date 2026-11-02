// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * synthetic-customer W3 (Stamper slice): records for the tasks that used to pass with no action.
 *
 * - A manual gate records `metadata.gate: 'manual'`, the owner role, and the operator action.
 *   It is SAT only when an operator approved it in this run; with no action it is PROVISIONAL
 *   ("pending the owner's review"), never SAT.
 * - A document renderable records the rendered policy document it rests on — the document's
 *   sha256 as listed in the tenant's policy-set manifest (`metadata.policyRef`). SAT only when the
 *   manifest lists that document with a hash; otherwise NOT_SAT.
 *
 * Both records go to the task's evidence-by-task folder only, not to the evidence directory EO
 * reads: crediting hashed policies against controls is EO's W5 work (PLAN §5 W5).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import type { ExeTask, StructuredEvidence } from '../types/schema.types.js';
import { taskEvidencePath } from './EvidenceReadinessAnalyzer.js';
import { getExecutorIdentity } from '../utils/executorIdentity.js';
import { recordWrittenEvidence, type EvidenceFileLedger } from '../evidence/EvidenceStore.js';

/** Controls whose rendered document is not their family policy. */
export const POLICY_DOCUMENT_BY_CONTROL: Readonly<Record<string, string>> = {
  'CA.L2-3.12.2': 'policies/poam.md',
  'CA.L2-3.12.4': 'policies/system-security-plan.md',
};

/** Control family -> the family policy document's name in the policy-set manifest. */
export const POLICY_DOCUMENT_BY_FAMILY: Readonly<Record<string, string>> = {
  AC: 'policies/access-control-policy.md',
  AT: 'policies/awareness-training-policy.md',
  AU: 'policies/audit-accountability-policy.md',
  CA: 'policies/security-assessment-policy.md',
  CM: 'policies/configuration-management-policy.md',
  IA: 'policies/identification-authentication-policy.md',
  IR: 'policies/incident-response-policy.md',
  MA: 'policies/maintenance-policy.md',
  MP: 'policies/media-protection-policy.md',
  PE: 'policies/physical-protection-policy.md',
  PS: 'policies/personnel-security-policy.md',
  RA: 'policies/risk-assessment-policy.md',
  SC: 'policies/system-communications-policy.md',
  SI: 'policies/system-integrity-policy.md',
};

export interface PolicyRef {
  document: string;
  sha256: string;
  manifestArtifactId?: string;
  manifestSha256?: string;
  manifestFile: string;
}

export const MANUAL_GATE_FILE = 'manual-gate.json';
export const POLICY_REFERENCE_FILE = 'policy-reference.json';
export const UNASSIGNED_OWNER = 'unassigned';

/** The newest policy-set manifest in a tenant plans folder (Muster pushes it with the plan). */
export function latestPolicySetManifest(plansDir: string): string | null {
  if (!fs.existsSync(plansDir)) return null;
  const files = fs.readdirSync(plansDir).filter((f) => /^policy-set-manifest[-_].*\.json$/.test(f)).sort();
  return files.length > 0 ? path.join(plansDir, files[files.length - 1]) : null;
}

/** The policy document a renderable control rests on, with its hash from the policy-set manifest. */
export function resolvePolicyRef(controlId: string, plansDir: string): { ref?: PolicyRef; reason?: string } {
  const wanted = POLICY_DOCUMENT_BY_CONTROL[controlId] ?? POLICY_DOCUMENT_BY_FAMILY[controlId.split('.')[0]];
  if (!wanted) return { reason: `no policy document is mapped for ${controlId}` };
  const manifestPath = latestPolicySetManifest(plansDir);
  if (!manifestPath) return { reason: `no policy-set manifest in the tenant plans folder (${path.basename(plansDir)})` };
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8').replace(/^﻿/, ''));
  } catch (err) {
    return { reason: `policy-set manifest ${path.basename(manifestPath)} is not readable JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const documents: Array<{ name?: unknown; sha256?: unknown }> = manifest?.artifact?.documents ?? manifest?.documents ?? [];
  const doc = Array.isArray(documents) ? documents.find((d) => d?.name === wanted) : undefined;
  if (!doc) return { reason: `policy-set manifest ${path.basename(manifestPath)} lists no ${wanted}` };
  if (typeof doc.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(doc.sha256)) {
    return { reason: `policy-set manifest ${path.basename(manifestPath)} lists ${wanted} without a sha256` };
  }
  return {
    ref: {
      document: wanted,
      sha256: doc.sha256.toLowerCase(),
      ...(typeof manifest?.artifact_id === 'string' ? { manifestArtifactId: manifest.artifact_id } : {}),
      ...(typeof manifest?.hash_sha256 === 'string' ? { manifestSha256: manifest.hash_sha256 } : {}),
      manifestFile: path.basename(manifestPath),
    },
  };
}

/** A manual gate's owner role (the Mission Plan step's owner_role, carried by the translator). */
export function ownerRoleOf(task: ExeTask): string {
  const role = task.action?.args?._owner_role;
  return typeof role === 'string' && role.trim() !== '' ? role.trim() : UNASSIGNED_OWNER;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A document renderable's record: SAT on a policy reference, NOT_SAT without one. */
export function buildPolicyReferenceEvidence(task: ExeTask, resolved: { ref?: PolicyRef; reason?: string }): StructuredEvidence {
  const raw = JSON.stringify(resolved.ref ?? { reason: resolved.reason ?? 'no policy reference' });
  const ref = resolved.ref;
  return {
    rawResponse: raw,
    outcome: ref ? 'policy_compliance' : 'failed_no_remediation',
    outcomeRationale: ref
      ? `Document renderable rests on the rendered ${ref.document} (sha256 ${ref.sha256}, ${ref.manifestFile})`
      : `Document renderable has no rendered policy document: ${resolved.reason}`,
    complianceVerdict: ref ? 'SAT' : 'NOT_SAT',
    verdictRationale: ref
      ? 'Policy reference recorded from the policy-set manifest'
      : `No policy reference: ${resolved.reason}`,
    metadata: {
      controlIds: task.controls,
      timestamp: new Date().toISOString(),
      executorIdentity: getExecutorIdentity(),
      commandExecuted: ref ? `[policy-reference] ${ref.document}` : '[policy-reference] none',
      sha256Hash: sha256(raw),
      ...(ref ? { policyRef: ref } : {}),
    },
  };
}

/** A manual gate's record: SAT only after an operator approved it; no action = PROVISIONAL. */
export function buildManualGateEvidence(
  task: ExeTask,
  gate: { ownerRole: string; gateAction: 'approved' | 'rejected' | 'none'; operator?: string; notes?: string },
): StructuredEvidence {
  const raw = JSON.stringify({ task_id: task.id, controls: task.controls, owner_role: gate.ownerRole, action: gate.gateAction, operator: gate.operator ?? null, notes: gate.notes ?? null });
  const approved = gate.gateAction === 'approved';
  const rejected = gate.gateAction === 'rejected';
  return {
    rawResponse: raw,
    outcome: approved ? 'manual_action' : rejected ? 'failed_no_remediation' : 'verification_pending',
    outcomeRationale: approved
      ? `Manual gate approved by an operator in this run (owner role ${gate.ownerRole})`
      : rejected
      ? `Manual gate rejected by an operator in this run (owner role ${gate.ownerRole})`
      : `Manual gate: no operator action in this run; pending review by the owner role ${gate.ownerRole}`,
    complianceVerdict: approved ? 'SAT' : rejected ? 'NOT_SAT' : 'PROVISIONAL',
    verdictRationale: approved
      ? 'Operator approval recorded'
      : rejected
      ? 'Operator rejected the gate'
      : 'Not satisfied without an action: the gate stays provisional until its owner acts',
    metadata: {
      controlIds: task.controls,
      timestamp: new Date().toISOString(),
      executorIdentity: getExecutorIdentity(),
      commandExecuted: `[manual-gate] ${task.id}`,
      sha256Hash: sha256(raw),
      gate: 'manual',
      ownerRole: gate.ownerRole,
      gateAction: gate.gateAction,
    },
  };
}

/**
 * Write a gate or renderable record to the task's evidence-by-task folder (never EO's evidence dir).
 * FLOW-2b: with a ledger, the written file also gets one WORM stamper_evidence_metadata row.
 */
export function writeTaskRecord(evidenceDir: string, taskId: string, fileName: string, evidence: StructuredEvidence, ledger?: EvidenceFileLedger): string {
  const target = taskEvidencePath(evidenceDir, taskId, fileName);
  writeJsonArtifact(target, evidence);
  recordWrittenEvidence(ledger, evidenceDir, target, evidence.metadata.controlIds, 'stamper:task-record');
  return target;
}
