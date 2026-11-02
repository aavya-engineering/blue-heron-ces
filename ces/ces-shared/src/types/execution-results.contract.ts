// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe Stamper execution-results contract (MS-R9). Zero node:* imports.
// Stamper emits this after a run; Muster ingests it to update plan progress.

import { z } from 'zod';

export const EXECUTION_RESULTS_CONTRACT_VERSION = '1.1.0';
// 1.1.0 (FX-SH3, REQ-ces-shared-execution-results-executable-plan-id from
// ces-stamper): optional `executablePlanId`. 1.0.0 manifests still parse.
export const SUPPORTED_EXECUTION_RESULTS_VERSIONS = ['1.0.0', '1.1.0'] as const;

// Normalized verdict — maps Stamper's existing words to a clean enum.
// Stamper mapping: SAT→sat, NOT_SAT→not_sat, PROVISIONAL→provisional, N/A→not_applicable
export const ExecutionVerdict = z.enum([
  'sat',
  'not_sat',
  'provisional',
  'not_applicable',
]);
export type ExecutionVerdictType = z.infer<typeof ExecutionVerdict>;

// The directive values Stamper uses in execution results.
export const ExecutionDirective = z.enum([
  'automated',
  'validation',
  'manual_gate',
  'document-absence',
  'document-prohibition',
  'document-renderable',
  'inherit-fedramp',
  'eo-tooled',
  'nonstack',
  'skip',
]);
export type ExecutionDirectiveType = z.infer<typeof ExecutionDirective>;

// Per-control result from a Stamper run.
export const ControlExecutionResultSchema = z.object({
  controlId: z.string().min(1),
  directive: ExecutionDirective,
  verdict: ExecutionVerdict,
  outcome: z.string(),
  evidencePath: z.string().optional(),
  timestampUtc: z.string().min(1),
});
export type ControlExecutionResult = z.infer<typeof ControlExecutionResultSchema>;

// The manifest Stamper writes to state/execution-results-<planId>.json
export const ExecutionResultsManifestSchema = z.object({
  contractVersion: z.enum(SUPPORTED_EXECUTION_RESULTS_VERSIONS),
  runId: z.string().min(1),
  // The Manual Mission Plan's bare `plan_id` — the key Muster's
  // POST /api/plan/results matches. NOT the executable plan id.
  planId: z.string().min(1),
  // 1.1.0: the executable plan id Stamper actually ran (e.g. `translated-<plan_id>`).
  executablePlanId: z.string().min(1).optional(),
  cesId: z.string().optional(),
  tenantSlug: z.string().min(1),
  completedAt: z.string().min(1),
  totalControls: z.number().int().min(0),
  results: z.array(ControlExecutionResultSchema),
});
export type ExecutionResultsManifest = z.infer<typeof ExecutionResultsManifestSchema>;

// ─── Summary helpers (for Muster ingestion) ──────────────────────

export interface ExecutionSummary {
  sat: number;
  notSat: number;
  provisional: number;
  notApplicable: number;
  total: number;
}

export function summarizeResults(manifest: ExecutionResultsManifest): ExecutionSummary {
  const summary: ExecutionSummary = {
    sat: 0,
    notSat: 0,
    provisional: 0,
    notApplicable: 0,
    total: manifest.results.length,
  };
  for (const r of manifest.results) {
    switch (r.verdict) {
      case 'sat': summary.sat++; break;
      case 'not_sat': summary.notSat++; break;
      case 'provisional': summary.provisional++; break;
      case 'not_applicable': summary.notApplicable++; break;
    }
  }
  return summary;
}
