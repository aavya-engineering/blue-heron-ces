// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// importReadinessResult.ts — G-MUSTER-PLAN-2 M1: plan mode accepts a
// readiness-result.v1 payload as input. This is GO-2 M3 plus a manifest/facts
// superset, deliberately built as that and NOT as a parallel path:
//   - observations[] reduce to the ONE DiscoveryResult shape and ride the SAME
//     synthesizeFactsFromDiscovery + boundary-draft + pruneByCoverage seam the
//     canned fixture and the bare results file use;
//   - facts[] (rows that may carry attestations) go straight into the ONE fact
//     store with their provenance strings and attestation records preserved —
//     staged LAST so a payload fact wins the prefill over a synthesized row
//     for the same question (the payload row is the richer record; routing
//     class still decides scoring precedence downstream);
//   - FCA at the seam is inherited, not re-implemented: unknown never prunes
//     or passes (discoveryFactJoin/factCoveragePruner), unconfirmed drafts in
//     facts[] stay drafts (draftSemantics) and never count as met.
// Zero network: the payload arrives via the same local file input (M3).
import Ajv from 'ajv';
import schema from '../../../public/schemas/readiness-result.schema.json';
import {
  READINESS_SCHEMA_VERSIONS,
  type ReadinessConsent,
  type ReadinessResult,
} from '@/shared/types/readinessResult';
import type { DiscoveryResult } from '@/shared/types/discovery';
import type { InterviewFact } from '@/shared/types/engagement';

const ajvValidate = new Ajv({ strict: true }).compile(schema);

/** Cheap shape sniff: is this JSON text a readiness-result payload (vs a bare
 * DiscoveryResult[] results file)? Never throws. */
export function looksLikeReadinessResult(parsed: unknown): boolean {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (READINESS_SCHEMA_VERSIONS as readonly unknown[]).includes((parsed as Record<string, unknown>).schema_version)
  );
}

/**
 * Parse + schema-validate a readiness-result.v1 file. Loud failure on
 * anything invalid — a payload must never partially ingest.
 */
export function parseReadinessResultFile(text: string): ReadinessResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Import failed: the file is not valid JSON.');
  }
  if (!looksLikeReadinessResult(parsed)) {
    throw new Error(
      `Import failed: not a readiness-result payload (schema_version missing or not one of ${READINESS_SCHEMA_VERSIONS.join(', ')}).`
    );
  }
  if (!ajvValidate(parsed)) {
    throw new Error(
      `Import failed: the payload does not validate against ${String((parsed as Record<string, unknown>).schema_version)}: ${JSON.stringify(ajvValidate.errors?.[0] ?? ajvValidate.errors)}`
    );
  }
  return parsed as unknown as ReadinessResult;
}

/**
 * Reduce observations[] to THE DiscoveryResult shape (the extra execution-
 * provenance fields stay in the payload; the seam consumes exactly what the
 * fixture flavor carries — one shape, one seam).
 */
export function discoveryResultsFromPayload(payload: ReadinessResult): DiscoveryResult[] {
  return payload.observations.map((o) => ({
    control_id: o.control_id,
    objective_ids: o.objective_ids,
    confidence: o.confidence,
  }));
}

/** The payload's already-recorded session facts, provenance + attestation intact. */
export function factsFromPayload(payload: ReadinessResult): InterviewFact[] {
  return payload.facts ?? [];
}
/**
 * FC-MU-3: every live consent the payload records — manifest.consent (FC-MU-2,
 * the Graph one) and manifest.consents[] (1.1.0, one per area) — each once.
 * Empty for a sim / fixture / script-upload payload.
 */
export function consentsFromPayload(payload: ReadinessResult): ReadinessConsent[] {
  const all = [...(payload.manifest.consent ? [payload.manifest.consent] : []), ...(payload.manifest.consents ?? [])];
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = JSON.stringify([c.area ?? 'graph', c.tenant_id, c.consented_by, c.consented_at, c.scopes]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
