// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe AdminOps evidence contract (AE-R2). Zero node:* imports.
// Both ces-ao (writer) and ces-eo (reader) compile and validate against this.

import { z } from 'zod';

export const ADMINOPS_EVIDENCE_CONTRACT_VERSION = '1.3.0';
export const SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS = ['1.0.0', '1.1.0', '1.2.0', '1.3.0'] as const;

// 1.3.0 (FX-SH3, REQ-ces-shared-adminops-target-identity from ces-eo): optional
// `targetUPN` / `targetObjectId` — the user the command ACTED ON (distinct from
// the operator identities requestorUPN/approverUPN). Optional on every version,
// so 1.0.0–1.2.0 rows parse unchanged.

// 1.2.0 (FX-SH1): adds outcome 'denied_sim_only' — the sim-only safety rail
// (e.g. CES_AO_SIM_ONLY=1) refused the command because the target is not a sim
// tenant or has a non-loopback endpoint. Distinct from 'denied_cmmc'. Only rows
// that declare contractVersion >= 1.2.0 (1.2.0 or 1.3.0) may carry it; 1.0.0/1.1.0 rows parse
// exactly as before.
const OUTCOMES_REQUIRING_1_2_0 = new Set(['denied_sim_only']);

// Normalized 8-value outcome enum. AO's richer EvidenceOutcome (15 values) maps
// into these; the mapping is documented in the AE-R3 instructions for ces-ao.
//
// Legacy→normalized mapping (for ces-ao AE-R3):
//   automated_success, policy_compliance → executed (if mode=live) or dry_run (if mode=dry_run)
//   manual_action, exception_granted, outside_action, partial_success → executed
//   failed_remediation_available, failed_no_remediation → failed (unless cmmcGate.allow===false → denied_cmmc)
//   not_applicable, inherited, verification_pending, unknown_legacy → failed
//   dry_run → dry_run
//   denied_cmmc → denied_cmmc
//   denied_cui → denied_cui
//   sim-only rail refusal → denied_sim_only (1.2.0+; previously denied_cmmc)
export const AdminOpsEvidenceOutcome = z.enum([
  'executed',
  'dry_run',
  'denied_cmmc',
  'denied_cui',
  'denied_sim_only',
  'blocked_pending_approval',
  'approval_rejected',
  'failed',
]);

export type AdminOpsEvidenceOutcomeType = z.infer<typeof AdminOpsEvidenceOutcome>;

export const AdminOpsEvidenceMode = z.enum(['dry_run', 'live']);
export type AdminOpsEvidenceModeType = z.infer<typeof AdminOpsEvidenceMode>;

export const AdminOpsEvidenceSchema = z.object({
  contractVersion: z.enum(SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS),
  commandId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantSlug: z.string().optional(),
  tenantKind: z.string().optional(),
  mode: AdminOpsEvidenceMode,
  dryRun: z.boolean(),
  outcome: AdminOpsEvidenceOutcome,
  controlIds: z.array(z.string().min(1)).min(1),
  correlationId: z.string().optional(),
  requestorUPN: z.string().optional(),
  approverUPN: z.string().optional(),
  // 1.3.0: target user of a user-targeted command (e.g. A-02/A-03/B-05).
  targetUPN: z.string().min(1).optional(),
  targetObjectId: z.string().min(1).optional(),
  approvalId: z.string().optional(),
  timestamp: z.string().min(1),
  executionTimestamp: z.string().optional(),
  preStateOutput: z.string().optional(),
  postStateOutput: z.string().optional(),
  verdict: z.string().min(1),
  verdictRationale: z.string().optional(),
  sha256: z.string().min(1),
}).superRefine((row, ctx) => {
  const isDry = row.dryRun || row.mode === 'dry_run';
  const ALLOWED_DRY_OUTCOMES = new Set([
    'dry_run', 'denied_cmmc', 'denied_cui', 'denied_sim_only', 'blocked_pending_approval',
  ]);

  // FX-SH1: outcomes introduced in 1.2.0 must not appear on older-version rows
  // (a 1.1.0 reader would not know them).
  if (OUTCOMES_REQUIRING_1_2_0.has(row.outcome)
      && (row.contractVersion === '1.0.0' || row.contractVersion === '1.1.0')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `outcome '${row.outcome}' requires contractVersion 1.2.0 or later (row declares ${row.contractVersion})`,
      path: ['outcome'],
    });
  }

  // F-4: a dry run may only carry the allowed outcomes — never 'executed'.
  if (isDry && !ALLOWED_DRY_OUTCOMES.has(row.outcome)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `dry-run row has outcome '${row.outcome}'; allowed: ${[...ALLOWED_DRY_OUTCOMES].join(', ')}`,
      path: ['outcome'],
    });
  }

  // SPRS integrity: non-executed outcomes must never carry SAT.
  const NEVER_SAT_OUTCOMES = new Set([
    'dry_run', 'denied_cmmc', 'denied_cui', 'denied_sim_only',
    'blocked_pending_approval', 'approval_rejected', 'failed',
  ]);
  if (NEVER_SAT_OUTCOMES.has(row.outcome) && row.verdict === 'SAT') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `A '${row.outcome}' row must never carry verdict SAT — this would inflate SPRS`,
      path: ['verdict'],
    });
  }
});

export type AdminOpsEvidence = z.infer<typeof AdminOpsEvidenceSchema>;

// ─── Predicate helpers (consumed by EO reader) ──────────────────

export function isLiveExecution(ev: AdminOpsEvidence): boolean {
  return ev.mode === 'live' && ev.outcome === 'executed';
}

export function isDryRun(ev: AdminOpsEvidence): boolean {
  return ev.dryRun || ev.mode === 'dry_run' || ev.outcome === 'dry_run';
}

export function isDenial(ev: AdminOpsEvidence): boolean {
  return ev.outcome === 'denied_cmmc' || ev.outcome === 'denied_cui' || ev.outcome === 'denied_sim_only';
}

export function isBlocked(ev: AdminOpsEvidence): boolean {
  return ev.outcome === 'blocked_pending_approval' || ev.outcome === 'approval_rejected';
}
