// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29: harness fixes for the round R-F1 reds (LOG-FIN-29.md §8).
 * - E7 pass 1 saw `assess_ec_items count 0` (passes 2-3: 21). EO's EC reader gives up after 3 s and returns [] without
 *   an error event (ces-eo EcEvidenceReader DEFAULT_TIMEOUT_MS), so a slow first `GET /api/items` silently empties pass 1.
 *   `waitEcItemsReady` waits before the first assess until EC answers that read within the reader's budget with the
 *   count the run uploaded (or a stable count), and records what it saw.
 * - E7C (V113): E-01's tenant-sourced parameters were missing from the sim record. `seedCostProbeResources` fills
 *   them: the two names from the simulator (the ao-sweep scenario's reads) and a retention above the free 90 days, so
 *   the cost gate applies (E-01 cost_gate.recurring_when: auditLogRetentionDays gt 90).
 */
import * as path from 'node:path';
import { discoverSweepResources, loadAoSweepScenario, AO_SWEEP_SCENARIO_REL, type SimReader, type SweepResourceSpec } from './ao-sweep-run.js';
import { writeRecordResources } from './ao-step.js';
import * as fs from 'node:fs';

// ---------- E7 pass 1: EC readiness ----------

/** ces-eo EcEvidenceReader's per-request timeout: a read slower than this is an empty pass for EO. */
export const EO_EC_READ_TIMEOUT_MS = 3000;

export interface EcReadyProbe {
  attempt: number;
  ms: number;
  status: number | null;
  count: number | null;
  error?: string;
}

export interface EcReadyRecord {
  ready: boolean;
  want: number | null;
  probes: EcReadyProbe[];
  note: string;
}

export type EcItemsFetch = (url: string, init: { headers: Record<string, string>; timeoutMs: number }) => Promise<{ status: number; count: number | null }>;

export const defaultEcItemsFetch: EcItemsFetch = async (url, init) => {
  const r = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(init.timeoutMs) });
  let count: number | null = null;
  try {
    const j = (await r.json()) as unknown;
    count = Array.isArray(j) ? j.length : null;
  } catch {
    count = null;
  }
  return { status: r.status, count };
};

/**
 * Polls EC's `GET /api/items?tenant=<slug>` (the read EO's assess makes) until it answers 200 within EO's 3 s budget
 * with at least `want` items (when known) or, with no `want`, the same non-zero count twice in a row. Never throws;
 * gives up after `maxAttempts` and says why.
 */
export async function waitEcItemsReady(o: {
  ecUrl: string;
  slug: string;
  secret: string;
  want: number | null;
  maxAttempts?: number;
  pauseMs?: number;
  fetchItems?: EcItemsFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<EcReadyRecord> {
  const fetchItems = o.fetchItems ?? defaultEcItemsFetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const max = o.maxAttempts ?? 60;
  const probes: EcReadyProbe[] = [];
  const url = `${o.ecUrl.replace(/\/+$/, '')}/api/items?tenant=${encodeURIComponent(o.slug)}`;
  for (let i = 1; i <= max; i++) {
    const t = now();
    let p: EcReadyProbe;
    try {
      // A generous client timeout so a slow answer is measured, not cut off; "ready" needs it within EO's budget.
      const r = await fetchItems(url, { headers: { Authorization: `Bearer ${o.secret}` }, timeoutMs: 30000 });
      p = { attempt: i, ms: now() - t, status: r.status, count: r.count };
    } catch (err) {
      p = { attempt: i, ms: now() - t, status: null, count: null, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
    }
    probes.push(p);
    const fast = p.status === 200 && p.ms < EO_EC_READ_TIMEOUT_MS && typeof p.count === 'number';
    if (fast) {
      if (o.want !== null && p.count! >= o.want) return { ready: true, want: o.want, probes, note: `EC answered ${p.count} item(s) in ${p.ms} ms (want >= ${o.want})` };
      const prev = probes[probes.length - 2];
      if (o.want === null && p.count! > 0 && prev && prev.status === 200 && prev.count === p.count && prev.ms < EO_EC_READ_TIMEOUT_MS) return { ready: true, want: null, probes, note: `EC answered the same ${p.count} item(s) twice within ${EO_EC_READ_TIMEOUT_MS} ms` };
    }
    await sleep(o.pauseMs ?? 2000);
  }
  const last = probes[probes.length - 1];
  return { ready: false, want: o.want, probes, note: `EC not ready after ${max} probe(s): last HTTP ${last?.status ?? 'none'}, ${last?.count ?? 'no'} item(s), ${last?.ms ?? '?'} ms${o.want !== null ? ` (want >= ${o.want})` : ''}` };
}

/** The EC items this run uploaded before E7 (E8.5's scenario upload, its records and review uploads, E8.5b). */
export function expectedEcItems(o: { scenarioUpload: boolean; records: Array<{ http_status?: number | null }> | null; reviewUploads: Array<{ http_status?: number | null; via_catalog_upload?: boolean }> | null; eoRoute: { http_status?: number | null } | null }): number {
  let n = o.scenarioUpload ? 1 : 0;
  n += (o.records ?? []).filter((r) => r.http_status === 201).length;
  n += (o.reviewUploads ?? []).filter((r) => r.http_status === 201 && !r.via_catalog_upload).length;
  if (o.eoRoute?.http_status === 201) n += 1;
  return n;
}

// ---------- E7C: the cost probe's tenant-sourced parameters ----------

/** E-01's tenant-sourced parameters, by AO's resource keys (ces-ao SourceBindings.ts). */
export const COST_PROBE_RESOURCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'E-01': ['audit_log_retention_days', 'law_name', 'resource_group'],
};
/** Above the free 90 days, so E-01's cost gate applies (cost_gate.recurring_when auditLogRetentionDays gt 90). */
export const COST_PROBE_RETENTION_DAYS = '365';

/**
 * Fills the cost probe's tenant-sourced parameters in the run's sim record (only keys it lacks): the retention as an
 * operator setting above the free tier, the names read from the simulator with the ao-sweep scenario's reads.
 */
export async function seedCostProbeResources(o: {
  op: string;
  recordFile: string;
  testerRoot: string;
  stacksimRoot: string;
  read: SimReader;
  /** The pushed Infrastructure Manifest: the fallback for a name the simulator read did not give. */
  im?: unknown;
}): Promise<{ seeded: Record<string, string>; provenance: Record<string, string>; missing: Record<string, string> }> {
  const keys = COST_PROBE_RESOURCE_KEYS[o.op] ?? [];
  const raw = JSON.parse(fs.readFileSync(o.recordFile, 'utf8').replace(/^﻿/, '')) as { resources?: Record<string, string> };
  const existing = raw.resources ?? {};
  const sweep = loadAoSweepScenario(path.join(o.testerRoot, AO_SWEEP_SCENARIO_REL));
  const spec: Record<string, SweepResourceSpec> = {};
  for (const k of keys) {
    if (existing[k] !== undefined) continue;
    if (k === 'audit_log_retention_days') spec[k] = { literal: COST_PROBE_RETENTION_DAYS, describe: 'cost probe setting: 365 days, above the free 90, so the cost gate applies' };
    else if (sweep.resources[k]) spec[k] = sweep.resources[k];
  }
  const d = await discoverSweepResources(spec, {}, o.read, { stacksimRoot: o.stacksimRoot });
  const law = imLogAnalytics(o.im);
  for (const [k, v] of [['law_name', law?.name], ['resource_group', law?.resourceGroup]] as const) {
    if (keys.includes(k) && existing[k] === undefined && d.resources[k] === undefined && v) {
      d.resources[k] = v;
      d.provenance[k] = 'pushed Infrastructure Manifest (log_analytics_workspace)';
      delete d.missing[k];
    }
  }
  const seeded = Object.fromEntries(Object.entries(d.resources).filter(([k]) => keys.includes(k)));
  if (Object.keys(seeded).length) writeRecordResources(o.recordFile, seeded);
  return { seeded, provenance: d.provenance, missing: d.missing };
}

/** The Infrastructure Manifest's Log Analytics workspace: its name and resource group (or null). */
export function imLogAnalytics(im: unknown): { name: string; resourceGroup: string | null } | null {
  let found: { name: string; resourceGroup: string | null } | null = null;
  const walk = (o: unknown): void => {
    if (found || !o || typeof o !== 'object') return;
    const r = o as { resource_type?: unknown; name?: unknown; properties?: { resource_group?: unknown } };
    if (r.resource_type === 'log_analytics_workspace' && typeof r.name === 'string') {
      found = { name: r.name, resourceGroup: typeof r.properties?.resource_group === 'string' ? r.properties.resource_group : null };
      return;
    }
    for (const v of Object.values(o as Record<string, unknown>)) walk(v);
  };
  walk(im);
  return found;
}

// ---------- V87: the eo CLI's abort on exit ----------

/** Windows' STATUS_STACK_BUFFER_OVERRUN code a libuv assertion abort exits with (0xC0000409). */
export const WIN_ABORT_EXIT = 3221226505;

/**
 * The code a finished eo CLI call counts as: 0 when it aborted only on exit (libuv UV_HANDLE_CLOSING assertion, Windows
 * abort code) after printing a JSON result without an error and writing its output; otherwise the raw code.
 */
export function eoCliEffectiveRc(r: { rc: number; stdout: string; stderr: string }, outputWritten: boolean): number {
  if (r.rc !== WIN_ABORT_EXIT || !/UV_HANDLE_CLOSING/.test(r.stderr) || !outputWritten) return r.rc;
  let printed: unknown = null;
  try { printed = JSON.parse(r.stdout.trim().split(/\r?\n/).pop() ?? 'null'); } catch { printed = null; }
  if (!printed || typeof printed !== 'object' || 'error' in (printed as Record<string, unknown>)) return r.rc;
  return 0;
}
