// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2.0 (collector frame): runs the registered collectors for one tenant once, one
 * read at a time (FX-15), each over the window its store watermark gives (Collector.ts).
 *
 * Per window read, one store record (W1 store, append only, hash-chained):
 *  - success: payload = the rows that are new (de-duplicated by event id against the watermark's
 *    overlap ids and against the ids already collected inside the view period); itemCount = their
 *    number; status `empty` when none are new. The watermark moves forward in the same append
 *    (newest event time and id, overlap ids, and lastWindowEnd = the window's end).
 *  - failure: `not_assessed` for 401/403 (the record names the permission), `error` otherwise; in
 *    a multi-window backfill a window is read twice, and a second failure is a `gap` record. The
 *    collector stops at a failed window and the watermark does not move, so the next run reads the
 *    span again.
 *
 * Each collector's run also yields one "windowed view" signal for the evaluators: every row the
 * store holds for that source dated within the collector's view period, de-duplicated and sorted,
 * emitted under the registry endpoint so the mapper matches it. A run whose read failed yields the
 * failure instead (stale rows are never shown as a fresh read, B19).
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate as setImmediatePromise } from 'node:timers/promises';
import type { SignalResult } from 'ces-shared/types/signal';
import { canonicalSha256 } from 'ces-shared/crypto';
import { EvidenceStore } from '../evidence/store/EvidenceStore.js';
import { dedupeOverlap, nextWatermark } from '../evidence/store/Watermarks.js';
import { objectivesByControl } from '../evidence/store/recordFetchedSignals.js';
import type { AppendInput, CollectorInfo, EvidenceRecordStatus, Watermark } from '../evidence/store/types.js';
import { computeWindows, DAY_MS, type CollectWindow, type Collector, type CollectorReader } from './Collector.js';
import { REGISTERED_COLLECTORS } from './collectors.js';

const _require = createRequire(import.meta.url);

export interface CollectContext {
  storageRoot: string;
  tenantId: string;
  tenantSlug: string;
  reader: CollectorReader;
  /** Base identity (resolveCollectorIdentity); the record's collector name is per collector. */
  identity: CollectorInfo;
  nowMs?: number;
  collectors?: readonly Collector[];
  /** Control-signal registry file (default: ces-shared's). */
  registryPath?: string;
}

export interface CollectedRecordSummary {
  recordId: string;
  seq: number;
  status: EvidenceRecordStatus;
  itemCount: number;
  window: CollectWindow;
  query: string;
}

export interface CollectorRunResult {
  planId: string;
  sourceId: string;
  windows: CollectWindow[];
  records: CollectedRecordSummary[];
  /** Rows new in this run (sum of the records' itemCount). */
  newItems: number;
  /** Status of the run's last window read. */
  status: EvidenceRecordStatus;
  watermarkBefore: Watermark | null;
  watermarkAfter: Watermark | null;
  error?: string;
}

export interface CollectRunResult {
  tenantId: string;
  results: CollectorRunResult[];
  /** One windowed-view signal per collector, for the mapper. */
  signals: SignalResult[];
  recorded: number;
  errors: Array<{ sourceId: string; error: string }>;
}

type RegistryRows = Record<string, { signals?: Array<{ type?: string; endpoint?: string }> }>;
const registryCache = new Map<string, RegistryRows>();

function loadRegistry(registryPath?: string): RegistryRows {
  const p = registryPath ?? _require.resolve('ces-shared/data/control-signal-registry');
  let rows = registryCache.get(p);
  if (!rows) {
    rows = JSON.parse(fs.readFileSync(p, 'utf-8')) as RegistryRows;
    registryCache.set(p, rows);
  }
  return rows;
}

const norm = (e: string | undefined): string => (e ?? '').replace(/^\/+|\/+$/g, '').toLowerCase().split('?')[0];

/** Controls whose registry row lists this signal type and endpoint (the mapper's match rule). */
export function controlsForEndpoint(type: string, endpoint: string, registryPath?: string): string[] {
  const want = norm(endpoint);
  const out: string[] = [];
  for (const [controlId, row] of Object.entries(loadRegistry(registryPath))) {
    if ((row.signals ?? []).some((s) => s.type === type && norm(s.endpoint) === want)) out.push(controlId);
  }
  return out.sort();
}

/** The event id, or a content hash for a row without one. */
function idFor(c: Collector): (item: unknown) => string {
  return (item) => c.idOf(item) || `sha256:${canonicalSha256(item)}`;
}

/** Rows the store holds for a collector's source, from success records collected since `sinceMs`. */
export function storedRows(store: EvidenceStore, c: Collector, sinceMs: number): unknown[] {
  const out: unknown[] = [];
  for (const r of store.query({ sourceId: c.sourceId, from: new Date(sinceMs).toISOString() })) {
    if (r.status !== 'success' || r.itemCount === 0) continue;
    const payload = store.readPayload(r);
    if (Array.isArray(payload)) out.push(...payload);
    else if (c.recordPerItem && payload !== null && payload !== undefined) out.push(payload);
  }
  return out;
}

/**
 * The evaluators' view of a collected source: every stored row dated within the collector's view
 * period, once per event id, newest first (ties by id), so repeated runs give identical views.
 */
export function windowedView(store: EvidenceStore, c: Collector, nowMs: number): unknown[] {
  const since = nowMs - c.viewDays * DAY_MS;
  const id = idFor(c);
  const byId = new Map<string, unknown>();
  for (const row of storedRows(store, c, since)) {
    const t = Date.parse(c.timeOf(row));
    if (!Number.isFinite(t) || t < since) continue;
    const k = id(row);
    if (!byId.has(k)) byId.set(k, row);
  }
  return [...byId.entries()]
    .sort(([ka, a], [kb, b]) => (Date.parse(c.timeOf(b)) - Date.parse(c.timeOf(a))) || ka.localeCompare(kb))
    .map(([, row]) => row);
}

function sortRows(c: Collector, rows: unknown[]): unknown[] {
  const id = idFor(c);
  return [...rows].sort((a, b) => (Date.parse(c.timeOf(a)) - Date.parse(c.timeOf(b))) || id(a).localeCompare(id(b)));
}

/**
 * PH-12: let the event loop run pending I/O (HTTP clients, socket closes) between a collector's
 * synchronous phases. `node:timers/promises` is used rather than the global setImmediate, which
 * Jest's fake timers replace.
 */
export function yieldToEventLoop(): Promise<void> {
  return setImmediatePromise();
}

/** Run one collector for one tenant: read its window(s), append the records, return the summary. */
export async function runCollector(c: Collector, store: EvidenceStore, ctx: CollectContext, nowMs: number): Promise<CollectorRunResult> {
  const collectedAt = new Date(nowMs).toISOString();
  const watermarkBefore = store.watermarks.get(c.sourceId) ?? null;
  const windows = computeWindows(c, watermarkBefore ?? undefined, nowMs);
  const backfill = windows.length > 1;
  const id = idFor(c);
  const collector: CollectorInfo = { name: `ces-eo/collect/${c.planId}`, version: ctx.identity.version, identity: ctx.identity.identity };
  const controlIds = controlsForEndpoint(c.signalSource, c.endpoint, ctx.registryPath);
  const objectives = objectivesByControl();
  const objectiveIds = controlIds.flatMap((cid) => objectives.get(cid) ?? []);
  await yieldToEventLoop();
  const known = new Set(storedRows(store, c, nowMs - c.viewDays * DAY_MS).map(id));

  const result: CollectorRunResult = {
    planId: c.planId, sourceId: c.sourceId, windows, records: [], newItems: 0, status: 'empty',
    watermarkBefore, watermarkAfter: watermarkBefore,
  };
  const base = {
    tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, sourceId: c.sourceId, collector,
    host: c.host, endpoint: c.endpoint, collectedAt, controlIds, objectiveIds,
  };

  for (const window of windows) {
    const scope = { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug };
    let read = await c.read(ctx.reader, window, scope);
    if (read.status === 'error' && backfill) read = await c.read(ctx.reader, window, scope);
    await yieldToEventLoop();

    if (read.status !== 'success') {
      const status: EvidenceRecordStatus = read.status === 'not_assessed' ? 'not_assessed' : (backfill ? 'gap' : 'error');
      const error = status === 'not_assessed'
        ? `missing permission (${c.permission}): ${read.error ?? 'access denied'}`
        : `${status === 'gap' ? 'backfill read failed twice; window not collected' : 'read failed'}: ${read.error ?? 'unknown error'}`;
      const rec = store.append({ ...base, query: read.query, window, status, itemCount: 0, payload: null, error });
      result.records.push({ recordId: rec.recordId, seq: rec.seq, status, itemCount: 0, window, query: read.query });
      result.status = status;
      result.error = error;
      break;
    }

    const wm = store.watermarks.get(c.sourceId);
    const fresh = sortRows(c, dedupeOverlap(read.items, wm, id, c.timeOf).filter((row) => !known.has(id(row))));
    const watermark = { ...nextWatermark(read.items, wm, id, c.timeOf, c.overlapMinutes), lastWindowEnd: window.end };
    if (c.recordPerItem && fresh.length) {
      const per = c.recordPerItem;
      // PH-12 (C11 event-loop block): one record per item as before, in the same order, written in one
      // batch (EvidenceStore.appendMany: the log and manifest are read and written once, not per record).
      const inputs: AppendInput[] = fresh.map((row, i) => {
        const cids = per.controlIdsOf(row);
        return {
          ...base, endpoint: per.endpointOf?.(row) ?? c.endpoint, controlIds: cids,
          objectiveIds: cids.flatMap((cid) => objectives.get(cid) ?? []),
          query: per.queryOf?.(row) ?? read.query, window, status: 'success', itemCount: 1, payload: row,
          ...(i === fresh.length - 1 ? { watermark } : {}),
        };
      });
      await yieldToEventLoop();
      const recs = store.appendMany(inputs);
      recs.forEach((rec, i) => {
        known.add(id(fresh[i]));
        result.records.push({ recordId: rec.recordId, seq: rec.seq, status: 'success', itemCount: 1, window, query: inputs[i].query });
      });
      result.newItems += fresh.length;
      result.status = 'success';
      continue;
    }
    const status: EvidenceRecordStatus = fresh.length ? 'success' : 'empty';
    const rec = store.append({ ...base, query: read.query, window, status, itemCount: fresh.length, payload: fresh, watermark });
    for (const row of fresh) known.add(id(row));
    result.records.push({ recordId: rec.recordId, seq: rec.seq, status, itemCount: fresh.length, window, query: read.query });
    result.newItems += fresh.length;
    result.status = result.newItems > 0 ? 'success' : 'empty';
  }
  result.watermarkAfter = store.watermarks.get(c.sourceId) ?? null;
  return result;
}

/** The windowed-view signal of one collector after its run. */
export function viewSignal(c: Collector, store: EvidenceStore, run: CollectorRunResult, nowMs: number): SignalResult {
  const base = { signalId: c.sourceId, source: c.signalSource, endpoint: c.endpoint, timestamp: new Date(nowMs).toISOString() };
  if (run.status === 'not_assessed') {
    return { ...base, rawData: null, status: 'not_assessed', findings: [run.error ?? 'not assessed'] };
  }
  if (run.status === 'error' || run.status === 'gap') {
    return { ...base, rawData: null, status: 'error', error: run.error ?? run.status, findings: [run.error ?? run.status] };
  }
  const rows = windowedView(store, c, nowMs);
  return {
    ...base,
    rawData: { value: rows },
    status: 'success',
    findings: [`${rows.length} row(s) collected (${c.planId}) dated within the last ${c.viewDays} days`],
    metadata: { collectedView: true, planId: c.planId, viewDays: c.viewDays },
  };
}

/** FIN-24 (W2.0a): tolerance on a collector's cadence, so a tick that lands a little early still runs it. */
export const DUE_SLACK_MS = 30_000;

/** When a collector last read for this tenant: its watermark's window end (null = never read). */
export function lastCollectedMs(store: EvidenceStore, c: Collector): number | null {
  const end = store.watermarks.get(c.sourceId)?.lastWindowEnd;
  const t = end ? Date.parse(end) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** True when the collector's declared cadence has elapsed since `lastMs` (never read: due). */
export function isCollectorDue(c: Collector, lastMs: number | null, nowMs: number, slackMs: number = DUE_SLACK_MS): boolean {
  if (lastMs === null) return true;
  return nowMs - lastMs >= c.cadenceMinutes * 60_000 - slackMs;
}

export interface DueSplit {
  due: Collector[];
  notDue: Array<{ planId: string; cadenceMinutes: number; lastCollectedAt: string; nextDueAt: string }>;
}

/**
 * FIN-24 (W2.0a): split collectors by their declared cadence against the tenant's store watermarks.
 * The watermark is the store's own record of the last read, so the split survives a restart.
 */
export function dueCollectors(store: EvidenceStore, collectors: readonly Collector[], nowMs: number, slackMs: number = DUE_SLACK_MS): DueSplit {
  const out: DueSplit = { due: [], notDue: [] };
  for (const c of collectors) {
    const last = lastCollectedMs(store, c);
    if (isCollectorDue(c, last, nowMs, slackMs)) out.due.push(c);
    else out.notDue.push({
      planId: c.planId, cadenceMinutes: c.cadenceMinutes,
      lastCollectedAt: new Date(last as number).toISOString(),
      nextDueAt: new Date((last as number) + c.cadenceMinutes * 60_000).toISOString(),
    });
  }
  return out;
}

/**
 * Run every registered collector for one tenant once, sequentially, regardless of cadence (the
 * cadence is for the scheduler: dueCollectors above, used by collectionScheduler.ts). Never throws: a collector that cannot write is reported in
 * `errors` and yields an `error` view.
 */
export async function runCollectors(ctx: CollectContext): Promise<CollectRunResult> {
  const nowMs = ctx.nowMs ?? Date.now();
  const out: CollectRunResult = { tenantId: ctx.tenantId, results: [], signals: [], recorded: 0, errors: [] };
  let store: EvidenceStore;
  try {
    store = EvidenceStore.forStorageRoot(ctx.storageRoot, ctx.tenantId);
  } catch (e) {
    out.errors.push({ sourceId: '_store', error: e instanceof Error ? e.message : String(e) });
    return out;
  }
  for (const c of ctx.collectors ?? REGISTERED_COLLECTORS) {
    try {
      const run = await runCollector(c, store, ctx, nowMs);
      out.results.push(run);
      out.recorded += run.records.length;
      if (!c.noView) out.signals.push(viewSignal(c, store, run, nowMs));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      out.errors.push({ sourceId: c.sourceId, error });
      if (!c.noView) out.signals.push({
        signalId: c.sourceId, source: c.signalSource, endpoint: c.endpoint, timestamp: new Date(nowMs).toISOString(),
        rawData: null, status: 'error', error, findings: [error],
      });
    }
  }
  return out;
}
