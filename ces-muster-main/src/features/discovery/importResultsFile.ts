// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// importResultsFile.ts — GO-2 M3: auth-ladder tier 2 (script-upload) IS GO-1's
// import-file mode — ONE mechanism (open-decision-0/1). An admin-run script's
// results file parses into the SAME DiscoveryResult[] shape the canned fixture
// uses and flows through the SAME synthesize + boundary-draft path — the M3
// gate asserts the equivalence, this module just refuses to invent a second
// format. Zero network: the file arrives via a local <input type="file">.
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';

const CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown']);

function isDiscoveryResult(v: unknown): v is DiscoveryResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.control_id === 'string' &&
    Array.isArray(r.objective_ids) &&
    r.objective_ids.every((o) => typeof o === 'string') &&
    typeof r.confidence === 'string' &&
    CONFIDENCES.has(r.confidence)
  );
}

/**
 * Parse a script-upload results file. Accepts either a bare DiscoveryResult[]
 * or an object wrapping it as { results: [...] } (the shape the admin-run
 * script emits alongside its metadata). Throws with a descriptive message on
 * anything else — a malformed upload must fail loudly, never ingest partially.
 */
export function parseDiscoveryResultsFile(text: string): DiscoveryResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Import failed: the file is not valid JSON.');
  }

  const candidate = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : null;

  if (!candidate) {
    throw new Error(
      'Import failed: expected a JSON array of discovery results (or { "results": [...] }).'
    );
  }
  if (candidate.length === 0) {
    throw new Error('Import failed: the results file contains no discovery results.');
  }
  const bad = candidate.findIndex((r) => !isDiscoveryResult(r));
  if (bad !== -1) {
    throw new Error(
      `Import failed: row ${bad} is not a valid discovery result ` +
        '(need control_id, objective_ids[], confidence high|medium|low|unknown).'
    );
  }
  return candidate as DiscoveryResult[];
}