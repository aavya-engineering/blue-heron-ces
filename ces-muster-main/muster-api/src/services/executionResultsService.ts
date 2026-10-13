// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R9: execution results ingest — apply Stamper results to a plan's directives.
import {
  ExecutionResultsManifestSchema,
  type ExecutionResultsManifest,
  summarizeResults,
  type ExecutionSummary,
} from 'ces-shared/types/execution-results';

export interface DirectiveStatus {
  control_id: string;
  directive: string;
  verdict: string | null;
  outcome: string | null;
}

export interface IngestResult {
  updated: DirectiveStatus[];
  unmatched: string[];
  summary: ExecutionSummary;
}

export function validateExecutionResults(
  data: unknown,
): { ok: true; manifest: ExecutionResultsManifest } | { ok: false; errors: string[] } {
  const result = ExecutionResultsManifestSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      ),
    };
  }
  return { ok: true, manifest: result.data };
}

/**
 * Apply execution results to a plan's control_directives. Matches by
 * controlId (results) → control_id (directives). Returns updated statuses
 * and any controlIds that didn't match a directive.
 */
export function applyExecutionResults(
  directives: Array<{ control_id: string; directive: string }>,
  manifest: ExecutionResultsManifest,
): IngestResult {
  const directiveMap = new Map<string, { control_id: string; directive: string }>();
  for (const d of directives) {
    directiveMap.set(d.control_id, d);
  }

  const updated: DirectiveStatus[] = [];
  const unmatched: string[] = [];

  for (const r of manifest.results) {
    const d = directiveMap.get(r.controlId);
    if (d) {
      updated.push({
        control_id: d.control_id,
        directive: d.directive,
        verdict: r.verdict,
        outcome: r.outcome,
      });
    } else {
      unmatched.push(r.controlId);
    }
  }

  return {
    updated,
    unmatched,
    summary: summarizeResults(manifest),
  };
}

/** FX-MU2: one plan directive with its latest Stamper verdict (null = pending). */
export interface DirectiveProgressRow {
  control_id: string;
  directive: string;
  verdict: string | null;
  outcome: string | null;
}

export interface DirectiveProgress {
  planId: string;
  runId: string | null;
  total: number;
  counts: Record<'sat' | 'not_sat' | 'provisional' | 'not_applicable' | 'pending', number>;
  directives: DirectiveProgressRow[];
}

/**
 * Merge a plan's control_directives with the latest ingested results: every
 * directive appears once, in plan order, with its verdict or pending.
 */
export function directiveProgress(
  planId: string,
  directives: Array<{ control_id: string; directive: string }>,
  latest: (Pick<IngestResult, 'updated'> & { runId?: string }) | null,
): DirectiveProgress {
  const byControl = new Map<string, DirectiveStatus>();
  for (const u of latest?.updated ?? []) byControl.set(u.control_id, u);
  const counts: DirectiveProgress['counts'] = {
    sat: 0, not_sat: 0, provisional: 0, not_applicable: 0, pending: 0,
  };
  const rows = directives.map((d) => {
    const u = byControl.get(d.control_id);
    const verdict = u?.verdict ?? null;
    if (verdict && verdict in counts) counts[verdict as keyof typeof counts]++;
    else counts.pending++;
    return { control_id: d.control_id, directive: d.directive, verdict, outcome: u?.outcome ?? null };
  });
  return { planId, runId: latest?.runId ?? null, total: rows.length, counts, directives: rows };
}
