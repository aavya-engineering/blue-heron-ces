// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-24: EC's HASH_DRIFT findings become EO findings.
 *
 * EC's index pass (ces-ec/src/indexPass.ts) raises HASH_DRIFT when a file's bytes changed since the
 * last index, or an EC item no longer matches the sha256 recorded at ingest. Until FIN-24 nothing in
 * EO read those findings except a UI proxy. The collection scheduler now reads EC's open findings on
 * every tick and records each HASH_DRIFT once (write-once ces.db collection `eo_integrity_findings`).
 *
 * Effect: reported only. An integrity finding changes no control status, SPRS score or POA&M item
 * (FIN-24 AR5 = low). A human reviews the file; EO never repairs or re-hashes it.
 */
import { getCesRepository } from 'ces-shared/persistence/node';

export const EO_INTEGRITY_COLLECTION = 'eo_integrity_findings';
export const HASH_DRIFT = 'HASH_DRIFT';

/** The fields EO reads from an EC finding (ces-shared EcFinding). */
export interface EcFindingLike {
  findingId: string;
  checkId: string;
  detectedAt: string;
  severity: string;
  status: string;
  tenantSlug: string;
  detail?: string;
}

export interface EoIntegrityFinding {
  schema: 'ces-eo/integrity-finding@1';
  findingId: string;
  code: typeof HASH_DRIFT;
  source: 'ces-ec';
  ecFindingId: string;
  tenantSlug: string;
  tenantId: string | null;
  severity: string;
  detail: string;
  ecDetectedAt: string;
  recordedAt: string;
  effect: string;
  action: string;
}

export const INTEGRITY_EFFECT = 'reported only: no control status, SPRS score or POA&M item changes';
export const INTEGRITY_ACTION = 'operator review: confirm whether the file was tampered with or legitimately replaced; EO repairs nothing';

/**
 * EC's open findings for one tenant (`GET /api/findings?tenant=&status=open`). Null when EC is unreachable.
 * PH7-EO: EC asks a network (non-loopback) caller for the bearer (P7-SEC); `secret` (EVIDENCE_OPS_SECRET) is sent when given.
 */
export async function fetchEcOpenFindings(ecUrl: string | undefined, tenantSlug: string, timeoutMs = 10_000, secret?: string): Promise<EcFindingLike[] | null> {
  if (!ecUrl) return null;
  try {
    const url = `${ecUrl.replace(/\/+$/, '')}/api/findings?tenant=${encodeURIComponent(tenantSlug)}&status=open`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...(secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}) });
    if (!res.ok) return null;
    const body = await res.json() as unknown;
    return Array.isArray(body) ? body as EcFindingLike[] : null;
  } catch {
    return null;
  }
}

function rowId(tenantSlug: string, ecFindingId: string): string {
  return `${tenantSlug}|${ecFindingId}`;
}

/**
 * Record each open HASH_DRIFT finding of this tenant once. Returns only the findings recorded now
 * (an EC finding already recorded is left as it is: write-once).
 */
export function recordHashDriftFindings(
  findings: readonly EcFindingLike[],
  scope: { tenantSlug: string; tenantId: string | null },
  nowIso: string,
  dbPath?: string,
): EoIntegrityFinding[] {
  const repo = getCesRepository(dbPath);
  const fresh: EoIntegrityFinding[] = [];
  for (const f of findings) {
    if (f.checkId !== HASH_DRIFT || f.status !== 'open' || f.tenantSlug !== scope.tenantSlug) continue;
    const id = rowId(scope.tenantSlug, f.findingId);
    if (repo.get(EO_INTEGRITY_COLLECTION, id, { tenantSlug: scope.tenantSlug })) continue;
    const row: EoIntegrityFinding = {
      schema: 'ces-eo/integrity-finding@1',
      findingId: `eoif-${f.findingId}`,
      code: HASH_DRIFT,
      source: 'ces-ec',
      ecFindingId: f.findingId,
      tenantSlug: scope.tenantSlug,
      tenantId: scope.tenantId,
      severity: f.severity,
      detail: f.detail ?? '',
      ecDetectedAt: f.detectedAt,
      recordedAt: nowIso,
      effect: INTEGRITY_EFFECT,
      action: INTEGRITY_ACTION,
    };
    repo.put(EO_INTEGRITY_COLLECTION, { id, ces: { tenantSlug: scope.tenantSlug, ...(scope.tenantId ? { tenantId: scope.tenantId } : {}) }, data: row });
    fresh.push(row);
  }
  return fresh;
}

/** The tenant's EO integrity findings, oldest first. */
export function listIntegrityFindings(tenantSlug: string, dbPath?: string): EoIntegrityFinding[] {
  return getCesRepository(dbPath).list<EoIntegrityFinding>(EO_INTEGRITY_COLLECTION, { tenantSlug }).map((r) => r.data);
}
