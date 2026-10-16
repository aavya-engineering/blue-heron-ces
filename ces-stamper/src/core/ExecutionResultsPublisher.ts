// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-ST6 — one publisher for the per-control execution-results manifest, shared
 * by the GUI server's execute route and the CLI `execute` / `translate --execute`
 * paths (REQ-STAMPER-CLI-NO-RESULTS-MANIFEST), plus delivery of that manifest to
 * Muster's `POST /api/plan/results` (MS-R9 loop).
 *
 * Manifest building stays in ExecutionResultsCollector.buildManifestForPlan —
 * this module only (a) turns a finished run's task states into collector
 * records (CLI path), (b) writes the manifest to the canonical location
 * `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json`,
 * and (c) delivers it. Delivery NEVER throws and never fails the run: its outcome
 * is returned, logged, and written to a sidecar next to the manifest, and the
 * manifest stays on disk for a retry.
 *
 * Muster endpoint config (env, no secrets in code):
 *   CES_MUSTER_API_URL        Muster API origin, e.g. http://localhost:3001 (a
 *                             trailing `/` or `/api` is tolerated). Unset → skip.
 *   CES_MUSTER_API_TOKEN      Bearer token Muster issued (sent as
 *                             `Authorization: Bearer <token>`).
 *   CES_MUSTER_ALLOW_REMOTE   `1`/`true` to allow a non-localhost Muster URL.
 *                             Without it only localhost / 127.0.0.1 / ::1 are
 *                             allowed (sim-only safety).
 *   CES_MUSTER_TIMEOUT_MS     delivery timeout (default 10000).
 */
import * as path from 'path';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { tenantStateDir } from './EvidenceReadinessAnalyzer.js';
import {
  ExecutionResultsCollector,
  ResultVerdict,
  type ExecutionResultsManifest,
  type ManifestPlanRef,
} from './ExecutionResultsCollector.js';
import type { TaskStatus } from '../types/schema.types.js';

/** Muster's tenant_slug rule (muster-api/src/routes/plan.ts SLUG_RE). */
export const MUSTER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// ---- (a) task states → collector records (CLI path) ----

export interface ResultsPlanTask {
  id: string;
  controls?: string[];
}

/**
 * Record per-control results from a finished run's task states, with the same
 * words the server route records: completed → SAT/'completed', accomplished →
 * SAT/'accomplished', failed → NOT_SAT/'failed'; skipped/pending are not
 * recorded. Directive = `_control_directives[cid] || 'automated'`.
 * A control covered by several tasks is NOT_SAT if any of them failed (a later
 * SAT never overwrites a NOT_SAT).
 */
export function recordTaskStatuses(
  collector: ExecutionResultsCollector,
  tasks: ResultsPlanTask[],
  statusOf: (taskId: string) => TaskStatus | undefined,
  controlDirectives: Record<string, string> = {},
): void {
  const failed = new Set<string>();
  const passed = new Map<string, 'completed' | 'accomplished'>();
  for (const task of tasks) {
    const status = statusOf(task.id);
    for (const cid of task.controls ?? []) {
      if (status === 'failed') failed.add(cid);
      else if (status === 'completed' || status === 'accomplished') {
        if (!passed.has(cid)) passed.set(cid, status);
      }
    }
  }
  for (const [cid, outcome] of passed) {
    if (failed.has(cid)) continue;
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.SAT, outcome);
  }
  for (const cid of failed) {
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.NOT_SAT, 'failed');
  }
}

/**
 * Tenant slug for a CLI run: --tenant > plan.ces.tenantSlug >
 * variables.tenant_slug > TENANT_SLUG env > 'dev' (the server's fallback).
 */
export function resolveResultsTenantSlug(
  plan: ManifestPlanRef & { ces?: { tenantSlug?: string } },
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [explicit, plan.ces?.tenantSlug, plan.variables?.tenant_slug, env.TENANT_SLUG];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '' && c !== 'unknown') return c.trim();
  }
  return 'dev';
}

// ---- (b) canonical write ----

export function executionResultsManifestPath(tenantSlug: string, executablePlanId: string): string {
  return path.join(tenantStateDir(tenantSlug), `execution-results-${executablePlanId}.json`);
}

/** Write the manifest to the canonical state dir; returns its path. */
export function writeExecutionResultsManifest(
  manifest: ExecutionResultsManifest,
  tenantSlug: string,
  executablePlanId: string,
): string {
  const manifestPath = executionResultsManifestPath(tenantSlug, executablePlanId);
  writeJsonArtifact(manifestPath, manifest);
  return manifestPath;
}

// ---- (c) delivery to Muster ----

export type DeliveryStatus = 'delivered' | 'skipped' | 'refused' | 'failed';

export interface DeliveryOutcome {
  status: DeliveryStatus;
  reason?: string;
  endpoint?: string;
  httpStatus?: number;
  error?: string;
  response?: unknown;
  attemptedAt: string;
}

export interface MusterEndpoint {
  endpoint: string;
  token?: string;
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/**
 * Resolve the Muster results endpoint from env. Returns `skipped` when no URL is
 * configured and `refused` when the URL is invalid or non-local without opt-in.
 */
export function resolveMusterEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): MusterEndpoint | { status: 'skipped' | 'refused'; reason: string } {
  const raw = env.CES_MUSTER_API_URL?.trim();
  if (!raw) return { status: 'skipped', reason: 'no Muster endpoint configured (CES_MUSTER_API_URL unset)' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: 'refused', reason: `CES_MUSTER_API_URL is not a valid URL: ${raw}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { status: 'refused', reason: `CES_MUSTER_API_URL must be http(s): ${raw}` };
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase()) && !truthy(env.CES_MUSTER_ALLOW_REMOTE)) {
    return {
      status: 'refused',
      reason: `non-localhost Muster URL (${url.hostname}) refused — sim-only; set CES_MUSTER_ALLOW_REMOTE=1 to opt in`,
    };
  }
  let base = url.pathname.replace(/\/+$/, '');
  if (!base.endsWith('/api')) base += '/api';
  url.pathname = `${base}/plan/results`;
  url.search = '';
  url.hash = '';
  const token = env.CES_MUSTER_API_TOKEN?.trim();
  return { endpoint: url.toString(), ...(token ? { token } : {}) };
}

export interface DeliverOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Dry-run results carry verdicts the run didn't earn — never delivered. */
  dryRun?: boolean;
  log?: (msg: string) => void;
}

/** POST `{ tenant_slug, manifest }` to Muster. Never throws. */
export async function deliverExecutionResults(
  manifest: ExecutionResultsManifest,
  tenantSlug: string,
  opts: DeliverOptions = {},
): Promise<DeliveryOutcome> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const attemptedAt = new Date().toISOString();
  const done = (o: Omit<DeliveryOutcome, 'attemptedAt'>): DeliveryOutcome => {
    const outcome = { ...o, attemptedAt };
    const detail = o.reason ?? o.error ?? (o.httpStatus ? `HTTP ${o.httpStatus}` : '');
    const line = `[results-delivery] ${o.status}${o.endpoint ? ` → ${o.endpoint}` : ''}${detail ? ` (${detail})` : ''}`;
    log(line);
    return outcome;
  };
  try {
    const env = opts.env ?? process.env;
    const resolved = resolveMusterEndpoint(env);
    if ('status' in resolved) return done({ status: resolved.status, reason: resolved.reason });
    if (opts.dryRun) {
      return done({ status: 'skipped', reason: 'dry_run — dry-run verdicts are not delivered to Muster', endpoint: resolved.endpoint });
    }
    if (!MUSTER_SLUG_RE.test(tenantSlug)) {
      return done({ status: 'refused', reason: `tenant slug "${tenantSlug}" does not match Muster's slug rule`, endpoint: resolved.endpoint });
    }
    const envTimeout = Number(env.CES_MUSTER_TIMEOUT_MS);
    const timeoutMs = opts.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 10_000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (resolved.token) headers['Authorization'] = `Bearer ${resolved.token}`;
    const fetchFn = opts.fetchImpl ?? fetch;
    const res = await fetchFn(resolved.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tenant_slug: tenantSlug, manifest }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text().catch(() => '');
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : undefined; } catch { /* keep text */ }
    if (res.ok) return done({ status: 'delivered', endpoint: resolved.endpoint, httpStatus: res.status, response: body });
    return done({
      status: 'failed',
      endpoint: resolved.endpoint,
      httpStatus: res.status,
      error: `Muster responded ${res.status}${typeof body === 'object' && body && 'error' in body ? `: ${String((body as any).error)}` : ''}`,
      response: body,
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const msg = e?.name === 'TimeoutError' ? 'timed out' : `${e?.message ?? String(err)}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
    return done({ status: 'failed', error: msg });
  }
}

// ---- build + write + deliver (both paths) ----

export interface PublishResult {
  manifest: ExecutionResultsManifest;
  manifestPath: string;
  delivery: DeliveryOutcome;
  deliveryRecordPath?: string;
}

/**
 * Build the manifest with the production builder, write it to the canonical
 * location, deliver it to Muster (if configured), and record the delivery
 * outcome in `execution-results-<planId>.delivery.json` next to the manifest.
 * Throws only if the manifest itself cannot be built/written.
 */
export async function publishExecutionResults(
  collector: ExecutionResultsCollector,
  plan: ManifestPlanRef,
  tenantSlug: string,
  opts: DeliverOptions & { runId?: string } = {},
): Promise<PublishResult> {
  const manifest = collector.buildManifestForPlan(opts.runId ?? plan.plan_id, tenantSlug, plan);
  const manifestPath = writeExecutionResultsManifest(manifest, tenantSlug, plan.plan_id);
  const delivery = await deliverExecutionResults(manifest, tenantSlug, opts);
  let deliveryRecordPath: string | undefined;
  try {
    deliveryRecordPath = manifestPath.replace(/\.json$/, '.delivery.json');
    writeJsonArtifact(deliveryRecordPath, { manifestPath, tenantSlug, planId: manifest.planId, runId: manifest.runId, ...delivery });
  } catch (err) {
    deliveryRecordPath = undefined;
    (opts.log ?? console.warn)(`[results-delivery] could not write delivery record: ${(err as Error).message}`);
  }
  return { manifest, manifestPath, delivery, deliveryRecordPath };
}
