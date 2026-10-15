// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Response } from 'express';
import type { EoConfig } from '../config/EoConfig.js';
import type { EvidenceStorageConfig } from 'ces-shared/blob';
import type { CommandRegistryFile } from 'ces-shared/types/registry';
import type { Disposition } from '../assessment/DeterminationLedger.js';
import { SspGenerator } from '../ssp/SspGenerator.js';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { resolveTenantJsonPath, resolveTenantScope, type TenantScope } from './tenant-resolve.js';

// G-EO-STAB-1 M3: the registry-first resolver lives in its own light module
// (tenant-resolve.ts) so it is unit-testable in isolation; re-exported here so
// the six routers' `import { resolveTenantJsonPath } from './eo-router-utils'`
// call sites are unchanged.
export { resolveTenantJsonPath, resolveTenantScope, type TenantScope } from './tenant-resolve.js';

export interface TenantSummary {
  slug: string;
  client_name: string;
  environment: string;
  cert_expires?: string;
  configPath: string;
  source: 'registry' | 'plan-data';
}

export interface TimelineEvent {
  eventId: string;
  type: 'assessment' | 'certification' | 'poam_deadline' | 'custom';
  title: string;
  date: string;
  detail?: string;
}

export interface Timeline {
  tenantId: string;
  events: TimelineEvent[];
}

export function loadTimeline(storageRoot: string, tenantId: string): Timeline {
  const timelineDir = path.join(storageRoot, 'timeline');
  const filePath = path.join(timelineDir, `${tenantId}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return { tenantId, events: [] };
}

export function saveTimeline(storageRoot: string, timeline: Timeline): void {
  const timelineDir = path.join(storageRoot, 'timeline');
  fs.mkdirSync(timelineDir, { recursive: true });
  const filePath = path.join(timelineDir, `${timeline.tenantId}.json`);
  writeJsonArtifact(filePath, timeline, { pretty: true });
}

export function validateUuid(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

export function validateControlId(controlId: string): boolean {
  return /^[A-Z]{2,4}\.L[1-3]-\d+\.\d+\.\d+$/.test(controlId);
}

export function sendError(res: Response, status: number, error: string, detail?: string) {
  res.status(status).json({ error, ...(detail && { detail }) });
}

/**
 * FX-EO7: resolve the REQUESTED tenant (default: `?tenant=`) or answer the request with
 * 400 (missing/invalid) / 404 (unknown) and return null. Never falls back to
 * `config.tenantSlug` — the same rule as FX-EO1's resolveTenantScope, packaged for routes.
 */
export function requireTenantScope(
  req: { query: Record<string, unknown> },
  res: Response,
  stamperPath: string,
  rawSlug: unknown = req.query.tenant,
): Extract<TenantScope, { ok: true }> | null {
  const scope = resolveTenantScope(rawSlug, stamperPath);
  if (!scope.ok) { sendError(res, scope.status, scope.message); return null; }
  return scope;
}

const _resolveRequire = createRequire(import.meta.url);
const _dataPathMap: Record<string, string> = {
  'cmmc-l2-controls.reference.json': 'ces-shared/data/cmmc-l2-controls',
  'sprs-weights.json': 'ces-shared/data/sprs-weights',
  'assessment-objectives.reference.json': 'ces-shared/data/assessment-objectives',
  'control-signal-registry.json': 'ces-shared/data/control-signal-registry',
};

export function resolveDataPath(filename: string): string {
  const mapped = _dataPathMap[filename];
  if (mapped) return _resolveRequire.resolve(mapped);
  throw new Error(`Unknown shared data file: ${filename}`);
}

export function loadOptionalJson(filePath?: string): Record<string, unknown> | undefined {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * G-EUT-5 Phase 3 — auto-feed the tenant test suite's per-objective results into the SSP.
 * Walks up from this module to the repo root, loads tenant-tests/profiles/probe-objective-map.json
 * and the newest docs/tenant-tests/results/run-*.json, and derives { objectiveId -> status } via
 * SspGenerator.buildObjectiveEvidence. Returns undefined (feature off) when the artifacts are
 * absent, so the SSP falls back to control-status inheritance exactly as before (golden guard).
 */
export function loadObjectiveEvidenceFromSuite(): Record<string, 'satisfied' | 'other_than_satisfied' | 'not_assessed'> | undefined {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    let mapPath: string | undefined;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'tenant-tests', 'profiles', 'probe-objective-map.json');
      if (fs.existsSync(candidate)) { mapPath = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!mapPath) return undefined;
    const repoRoot = path.resolve(path.dirname(mapPath), '..', '..');
    const resultsDir = path.join(repoRoot, 'docs', 'tenant-tests', 'results');
    if (!fs.existsSync(resultsDir)) return undefined;
    const runs = fs.readdirSync(resultsDir).filter(f => /^run-.*\.json$/.test(f)).sort();
    if (!runs.length) return undefined;
    const probeMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8').replace(/^﻿/, '')).map ?? [];
    const run = JSON.parse(fs.readFileSync(path.join(resultsDir, runs[runs.length - 1]), 'utf-8').replace(/^﻿/, ''));
    const evidence = SspGenerator.buildObjectiveEvidence(probeMap, run.results ?? []);
    const count = Object.keys(evidence).length;
    if (count === 0) return undefined;
    console.log(`[SSP] objective evidence from tenant suite: ${count} objectives (source ${runs[runs.length - 1]})`);
    return evidence;
  } catch (err) {
    console.warn('[SSP] objective evidence load skipped:', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/**
 * Load the mission-plan applicability dispositions for a tenant (out-of-scope / attested /
 * inherited / deferred controls), keyed by numeric ref ("3.1.17"). Walks up to the repo root
 * to find tenant-tests/profiles/<slug>.applicability.json. Returns {} if absent.
 */
export function loadDispositionsFromProfile(tenantSlug: string): Record<string, Disposition> {
  const out: Record<string, Disposition> = {};
  if (!tenantSlug) return out;
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    let profilePath: string | undefined;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'tenant-tests', 'profiles', `${tenantSlug}.applicability.json`);
      if (fs.existsSync(candidate)) { profilePath = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!profilePath) return out;
    const DISPO: Record<string, Disposition> = { NOT_APPLICABLE: 'NA', ATTEST: 'ATTEST', INHERITED: 'INHERITED', IN_SCOPE_DEFERRED: 'DEFERRED', CES_PRODUCED: 'PRODUCED' };
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8').replace(/^﻿/, ''));
    for (const d of (profile.dispositions ?? [])) {
      const mapped = DISPO[d.disposition];
      if (mapped) out[String(d.control).replace(/^[A-Z]+-/, '')] = mapped;   // "AC-3.1.17" -> "3.1.17"
    }
  } catch { /* optional */ }
  return out;
}

export function loadRegistry(registryPath: string): CommandRegistryFile {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  return JSON.parse(raw) as CommandRegistryFile;
}

export function getEvidenceStorageConfig(
  config: EoConfig,
  /** FX-EO1: the REQUESTED tenant's config (resolveTenantScope().tenantJsonPath). When given,
   *  the server's default tenant config is never consulted — no cross-tenant blob reads. */
  requestTenantJsonPath?: string,
): EvidenceStorageConfig | null {
  if (requestTenantJsonPath !== undefined) return readEvidenceStorage(requestTenantJsonPath);
  const tenantSlug = config.tenantSlug;
  const tenantConfigPath = config.tenantConfigPath;

  // Try explicit tenant config path first, then resolve by slug through the
  // SAME registry-first resolver (G-EO-STAB-1 M3) — retires the last deprecated
  // ~/.stamper/tenants reader here too. stamperRoot is derived from the registry
  // path exactly as EoServer/the routers derive it, so plan-data stays reachable.
  const stamperRoot = path.resolve(path.dirname(config.registryPath), '..', '..');
  const jsonPath = tenantConfigPath
    ?? (tenantSlug ? resolveTenantJsonPath(tenantSlug, stamperRoot, os.homedir()) : null);

  if (!jsonPath) return null;
  return readEvidenceStorage(jsonPath);
}

function readEvidenceStorage(jsonPath: string): EvidenceStorageConfig | null {
  if (!fs.existsSync(jsonPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const es = raw.evidence_storage;
    if (es?.account_name && es?.account_key && es?.container && es?.blob_endpoint) {
      return {
        account_name: es.account_name,
        account_key: es.account_key,
        container: es.container,
        base_path: es.base_path ?? '',
        blob_endpoint: es.blob_endpoint,
      };
    }
  } catch (err) {
    // Log warning with context for debugging
    console.warn(`Failed to parse tenant config ${jsonPath}:`,
      err instanceof Error ? err.message : String(err));
  }

  return null;
}
