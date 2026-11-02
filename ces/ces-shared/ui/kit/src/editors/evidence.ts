// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence record shape and the legacy parse rules (evidence-popout.html renderEvidence,
// index.html renderEvidenceOverlay L11192 and openEvidenceModal L11562).

export interface EvidenceRegistryEntry {
  entry_id?: string;
  label?: string;
  engine?: string;
  layer_hint?: number | null;
  sequence_hint?: number | null;
  idempotency?: string;
  on_failure?: string;
  control_ids?: string[];
  get_command?: string;
  set_command?: string;
  evidence_commands?: string[];
}

export interface EvidenceMetadata {
  commandExecuted?: string;
  preStateOutput?: unknown;
  postStateOutput?: unknown;
  stateChanged?: boolean | null;
  controlIds?: string[];
  timestamp?: string;
  executorIdentity?: string;
  environment?: string;
  sha256Hash?: string;
  moduleVersions?: Record<string, string>;
}

export interface FailureDiagnostics {
  rootCause?: string;
  failureCategory?: string;
  remediationSteps?: string[];
}

export interface StateVerificationDetails {
  method?: string;
  confidence?: string;
  confidenceScore?: number;
  expectedValue?: string;
  matchedValue?: string;
  rawExtract?: string;
}

export interface VerificationResult {
  passed?: boolean;
  reason?: string;
  stateVerificationDetails?: StateVerificationDetails;
}

export interface EvidenceRecord {
  complianceVerdict?: string;
  verdictRationale?: string;
  outcome?: string;
  outcomeRationale?: string;
  failureDiagnostics?: FailureDiagnostics;
  rawResponse?: unknown;
  registryEntry?: EvidenceRegistryEntry;
  metadata?: EvidenceMetadata;
  cmmc_controls?: string[];
  evidenceContent?: string;
  verificationResult?: VerificationResult;
  /** Modal "no evidence" case: no file exists for the entry. */
  noEvidence?: boolean;
  expectedPath?: string;
  [key: string]: unknown;
}

/** What the screens hand over: the structured record, or raw file content. */
export type EvidenceInput = EvidenceRecord | string;

/** Legacy parse: merge a JSON `evidenceContent` string into the record; a bare string is JSON or a raw response. */
export function normalizeEvidence(evidence: EvidenceInput): EvidenceRecord {
  if (typeof evidence === 'string') {
    try {
      return JSON.parse(evidence) as EvidenceRecord;
    } catch {
      return { rawResponse: evidence };
    }
  }
  if (evidence.evidenceContent && typeof evidence.evidenceContent === 'string') {
    try {
      return { ...evidence, ...(JSON.parse(evidence.evidenceContent) as EvidenceRecord) };
    } catch {
      return evidence;
    }
  }
  return evidence;
}

export const DEFAULT_EVIDENCE_TITLE = 'Evidence Review';

/** Legacy title: "entry_id — label", else label, else the executed command, else "Evidence Review". */
export function evidenceTitle(record: EvidenceRecord): string {
  const label = record.registryEntry?.label ?? '';
  const entryId = record.registryEntry?.entry_id ?? '';
  if (entryId && label) return `${entryId} — ${label}`;
  return label || record.metadata?.commandExecuted || DEFAULT_EVIDENCE_TITLE;
}

/** Legacy control list: metadata.controlIds, else registryEntry.control_ids, else cmmc_controls. */
export function evidenceControls(record: EvidenceRecord): string[] {
  return record.metadata?.controlIds || record.registryEntry?.control_ids || record.cmmc_controls || [];
}

/** Legacy modal colour rule for the state verification block. */
export function verificationTone(record: EvidenceRecord): 'high' | 'medium' | 'pending' | 'failed' | 'none' {
  const svr = record.verificationResult;
  const confidence = svr?.stateVerificationDetails?.confidence;
  if (svr?.passed && confidence === 'HIGH') return 'high';
  if (confidence === 'MEDIUM') return 'medium';
  if (record.outcome === 'verification_pending') return 'pending';
  if (svr && !svr.passed) return 'failed';
  return 'none';
}
