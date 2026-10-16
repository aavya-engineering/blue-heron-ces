// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe Evidence Collector (EC) contract (M1, evidence-collector PLAN.md). Zero node:* imports.
//
// EC's job per the plan: manual evidence intake + a hash-verified integrity ledger.
// EC never assigns verdicts. `EcEvidenceItem` deliberately carries no `verdict` and no
// `dryRun` field — those stay with EO, AO and Stamper — and the schema is `.strict()`
// so an unknown key (a verdict sneaking in) is rejected outright. Index results are
// ledger-only (`EcLedgerEntry`) and never become items, so Stamper evidence that EO
// already loads is never counted twice.
//
// Field names on EcHealth/EcRun/EcFinding mirror what ces-eo's `public/index.html`
// EC status page already reads (`refreshEcStatus`, `loadEcRuns`, `loadEcFindings`,
// around lines 3573-3640): status/mode/startedAt/version; runId/startedAt/runType/
// status/artifactsWritten; findingId/checkId/detectedAt/severity/status.

import { z } from 'zod';

export const EC_CONTRACT_VERSION = '1.0.0';
export const SUPPORTED_EC_CONTRACT_VERSIONS = ['1.0.0'] as const;

// ─── EcHealth ────────────────────────────────────────────────────
// GET /api/health. Matches index.html's `refreshEcStatus()` reads: data.status,
// data.mode, data.startedAt, data.version.

export const EcHealthStatus = z.enum(['ok', 'degraded']);
export type EcHealthStatusType = z.infer<typeof EcHealthStatus>;

export const EcMode = z.enum(['sim', 'live']);
export type EcModeType = z.infer<typeof EcMode>;

export const EcHealthSchema = z.object({
  status: EcHealthStatus,
  mode: EcMode,
  startedAt: z.string().min(1),
  version: z.string().min(1),
});
export type EcHealth = z.infer<typeof EcHealthSchema>;

// ─── EcRun ───────────────────────────────────────────────────────
// GET /api/runs. Matches index.html's `loadEcRuns()` reads: r.runId, r.startedAt,
// r.runType, r.status, r.artifactsWritten.

export const EcRunType = z.enum(['ingest', 'index']);
export type EcRunTypeType = z.infer<typeof EcRunType>;

export const EcRunStatus = z.enum(['success', 'empty', 'failed']);
export type EcRunStatusType = z.infer<typeof EcRunStatus>;

export const EcRunSchema = z.object({
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  runType: EcRunType,
  status: EcRunStatus,
  artifactsWritten: z.number().int().min(0),
});
export type EcRun = z.infer<typeof EcRunSchema>;

// ─── EcFinding ───────────────────────────────────────────────────
// GET /api/findings. Matches index.html's `loadEcFindings()` reads: f.checkId,
// f.findingId, f.detectedAt, f.severity, f.status.

export const EcFindingSeverity = z.enum(['critical', 'high', 'low']);
export type EcFindingSeverityType = z.infer<typeof EcFindingSeverity>;

export const EcFindingStatus = z.enum(['open', 'resolved']);
export type EcFindingStatusType = z.infer<typeof EcFindingStatus>;

export const EcFindingSchema = z.object({
  findingId: z.string().min(1),
  checkId: z.string().min(1),
  detectedAt: z.string().min(1),
  severity: EcFindingSeverity,
  status: EcFindingStatus,
  tenantSlug: z.string().min(1),
  detail: z.string().min(1),
});
export type EcFinding = z.infer<typeof EcFindingSchema>;

// ─── EcEvidenceItem ──────────────────────────────────────────────
// A manually-collected piece of evidence (upload or attestation). NO verdict, NO
// dryRun — `.strict()` rejects either key (or any other unknown key) outright.
// Verdicts stay with EO/AO/Stamper; EC only records that evidence exists.

export const EcEvidenceSource = z.enum(['manual_upload', 'attestation']);
export type EcEvidenceSourceType = z.infer<typeof EcEvidenceSource>;

export const EcEvidenceItemSchema = z
  .object({
    contractVersion: z.enum(SUPPORTED_EC_CONTRACT_VERSIONS),
    itemId: z.string().min(1),
    tenantSlug: z.string().min(1),
    controlIds: z.array(z.string().min(1)).min(1),
    source: EcEvidenceSource,
    filename: z.string().min(1),
    mediaType: z.string().min(1),
    sha256: z.string().min(1),
    sizeBytes: z.number().int().min(0),
    collectedAt: z.string().min(1),
    submittedByRole: z.string().min(1),
    mode: EcMode,
  })
  .strict();
export type EcEvidenceItem = z.infer<typeof EcEvidenceItemSchema>;

// ─── EcLedgerEntry ───────────────────────────────────────────────
// The integrity ledger row EC's index pass writes/updates per file it has seen,
// whether the file originated in Stamper's tree (read-only pull) or in EC's own
// item store. Ledger-only — never promoted to an EcEvidenceItem.

export const EcLedgerOrigin = z.enum(['stamper', 'ec']);
export type EcLedgerOriginType = z.infer<typeof EcLedgerOrigin>;

export const EcLedgerEntrySchema = z.object({
  tenantSlug: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().min(1),
  firstSeen: z.string().min(1),
  lastSeen: z.string().min(1),
  origin: EcLedgerOrigin,
});
export type EcLedgerEntry = z.infer<typeof EcLedgerEntrySchema>;
