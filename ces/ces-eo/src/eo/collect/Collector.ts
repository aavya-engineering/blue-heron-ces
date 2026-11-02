// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2.0 (collector frame): a collector reads one log source for a time window that
 * starts at the store's watermark for that source, and its new rows go into the tenant's evidence
 * store (W1) as one record per window read. The evaluators read the collected rows through a
 * "windowed view" signal the runner builds from the store (CollectorRunner.ts).
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { UnifiedAuditLogRead } from '../ingestion/ComplianceSignalFetcher.js';
import type { Watermark } from '../evidence/store/types.js';

/** Store source ids (and the windowed-view signal ids the evaluators read). */
export const COLLECTED = {
  UNIFIED_AUDIT_LOG: 'collect.unifiedAuditLog',
  DIRECTORY_AUDITS: 'collect.directoryAudits',
  SIGN_INS: 'collect.signIns',
  PIM_ACTIVATIONS: 'collect.pimActivations',
  // W2 part 2
  RISK_DETECTIONS: 'collect.riskDetections',
  RISKY_USERS: 'collect.riskyUsers',
  SECURITY_ALERTS: 'collect.securityAlerts',
  SECURITY_INCIDENTS: 'collect.securityIncidents',
  TVM_RECENCY: 'collect.tvmAssessmentRecency',
  TVM_VULNERABILITIES: 'collect.tvmVulnerabilities',
  SECURE_SCORES: 'collect.secureScores',
  // W2 part 3 (B15 extension): Secure Score control profiles (the recommendations), read explicitly
  SECURE_SCORE_PROFILES: 'collect.secureScoreControlProfiles',
  DEVICE_COMPLIANCE: 'collect.deviceCompliance',
  // Synthetic-customer W2 (AD-1): AdminOps evidence rows, pulled from the shared DB
  ADMIN_OPS: 'collect.adminOps',
} as const;

/**
 * Field EO adds to each row of a snapshot source (one whose rows carry no event time: TVM
 * vulnerabilities, Intune compliance): the end of the window in which the row was observed.
 */
export const OBSERVED_FIELD = 'eoObservedDateTime';

/** Registry endpoint of the unified audit log (type `powershell`, B15). */
export const UAL_ENDPOINT = 'Search-UnifiedAuditLog';
/** Host label of Exchange Online PowerShell reads (W1's convention for the Exchange session). */
export const EXCHANGE_HOST = 'powershell:exchange-online-gcch';

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** The reads a collector may make (ComplianceSignalFetcher implements both). */
export interface CollectorReader {
  fetchGraphCollection(signalId: string, endpoint: string, uri: string, huntingQuery?: string): Promise<SignalResult>;
  searchUnifiedAuditLog(startIso: string, endIso: string): Promise<UnifiedAuditLogRead>;
}

/** The tenant a run collects for (C10 reads a tenant-scoped store rather than the tenant's session). */
export interface CollectScope {
  tenantId: string;
  tenantSlug: string;
}

export interface CollectWindow {
  start: string;
  end: string;
}

/** What one window read returned. */
export interface CollectorRead {
  status: 'success' | 'error' | 'not_assessed';
  items: unknown[];
  /** The request actually sent. */
  query: string;
  error?: string;
}

export interface Collector {
  /** Plan id (§5 table): C1a, C2, C3, C4; C5a/C5b, C6a/C6b, C7a/C7b for the plan's two-source collectors; C8, C9. */
  planId: string;
  /** Store source id; also the signal id of the windowed view. */
  sourceId: string;
  /** The registry endpoint the view is emitted under (the mapper matches it). */
  endpoint: string;
  /** The registry signal type of that endpoint (the mapper matches signal.source to it). */
  signalSource: 'graph' | 'powershell' | 'manual';
  host: string;
  /** Permission or role the live read needs; named in a `not_assessed` record. */
  permission: string;
  /** How often the source is due (for the scheduler; a run reads every collector). */
  cadenceMinutes: number;
  /** First read, no watermark yet: read this far back. */
  initialLookbackMinutes: number;
  /** Longest window one read may span; longer spans are read in chunks (the backfill). */
  maxWindowMinutes?: number;
  /** Re-read this many minutes before the watermark; overlap rows are dropped by id. */
  overlapMinutes: number;
  /** How far back the evaluators' view of the collected rows reaches. */
  viewDays: number;
  /** The event id (Graph `id`; the UAL's `Identity`). */
  idOf(item: unknown): string;
  /** The event time (ISO). */
  timeOf(item: unknown): string;
  read(reader: CollectorReader, window: CollectWindow, scope?: CollectScope): Promise<CollectorRead>;
  /**
   * C10: one store record per new item (payload = the item) instead of one per window read, each
   * mapped to the item's own controls; the watermark moves with the last item's record.
   */
  recordPerItem?: {
    controlIdsOf(item: unknown): string[];
    /** The record's endpoint (default: the collector's). */
    endpointOf?(item: unknown): string;
    /** The record's query (default: the window read's). */
    queryOf?(item: unknown): string;
  };
  /** C10 (AD-6): no windowed view for the mapper; the store record is not a second status source. */
  noView?: true;
}

/**
 * An event time as ISO-8601 UTC. Accepts ISO strings, Windows PowerShell 5.1's `/Date(<ms>)/`
 * JSON form, and a zone-less date-time (the UAL's CreationDate is UTC). '' when unparseable.
 */
export function isoTime(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  const legacy = /^\/?Date\((-?\d+)(?:[+-]\d{4})?\)\/?$/.exec(s);
  if (legacy) return new Date(Number(legacy[1])).toISOString();
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s) || !/T\d{2}:\d{2}/.test(s) ? s : `${s}Z`;
  const t = Date.parse(zoned);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

function ms(t: string | null | undefined): number | null {
  if (!t) return null;
  const v = Date.parse(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * The window to read: from the later of the watermark's last event time and last window end,
 * minus the overlap, to now; with no watermark, the collector's initial lookback. A span longer
 * than `maxWindowMinutes` is split into consecutive chunks, oldest first.
 */
export function computeWindows(
  c: Pick<Collector, 'initialLookbackMinutes' | 'maxWindowMinutes' | 'overlapMinutes'>,
  wm: Pick<Watermark, 'lastEventTime' | 'lastWindowEnd'> | undefined,
  nowMs: number,
): CollectWindow[] {
  const last = [ms(wm?.lastEventTime), ms(wm?.lastWindowEnd)].filter((v): v is number => v !== null);
  let startMs = last.length ? Math.max(...last) - c.overlapMinutes * MINUTE_MS : nowMs - c.initialLookbackMinutes * MINUTE_MS;
  if (startMs > nowMs) startMs = nowMs;
  if (!c.maxWindowMinutes) return [{ start: new Date(startMs).toISOString(), end: new Date(nowMs).toISOString() }];
  const step = c.maxWindowMinutes * MINUTE_MS;
  const out: CollectWindow[] = [];
  for (let s = startMs; s < nowMs; s += step) {
    out.push({ start: new Date(s).toISOString(), end: new Date(Math.min(s + step, nowMs)).toISOString() });
  }
  if (out.length === 0) out.push({ start: new Date(startMs).toISOString(), end: new Date(nowMs).toISOString() });
  return out;
}

/** Items of a Graph collection read (`{value: [...]}`, a bare array, or advanced hunting's `{results: [...]}`). */
export function graphItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = raw as { value?: unknown; results?: unknown; Results?: unknown } | null;
  for (const v of [r?.value, r?.results, r?.Results]) if (Array.isArray(v)) return v;
  return [];
}

/** One Graph read (GET collection, all pages; or the advanced-hunting POST) as a collector read. */
export async function readGraph(
  reader: CollectorReader, sourceId: string, endpoint: string, uri: string, huntingQuery?: string,
): Promise<CollectorRead> {
  const sig = huntingQuery === undefined
    ? await reader.fetchGraphCollection(sourceId, endpoint, uri)
    : await reader.fetchGraphCollection(sourceId, endpoint, uri, huntingQuery);
  const query = huntingQuery === undefined ? `GET ${uri}` : `POST ${uri} ${huntingQuery}`;
  if (sig.status === 'success') return { status: 'success', items: graphItems(sig.rawData), query };
  const error = sig.error ?? ((sig.findings ?? []).join('; ') || undefined);
  return { status: sig.status === 'not_assessed' ? 'not_assessed' : 'error', items: [], query, ...(error ? { error } : {}) };
}

/**
 * A collector over a Graph log collection, windowed by `$filter=<timeField> ge <start>`.
 * `expand` (e.g. `$expand=alerts`) is sent before the filter. With `versionField`, a row's id is
 * `<id>@<versionField>`, so a later state of the same object (an alert or incident updated, a risk
 * detection dismissed) is collected as a new version; evaluators keep the newest version per id.
 */
export function graphLogCollector(spec: {
  planId: string;
  sourceId: string;
  endpoint: string;
  uriPath: string;
  timeField: string;
  permission: string;
  cadenceMinutes: number;
  initialLookbackDays: number;
  viewDays: number;
  expand?: string;
  versionField?: string;
}): Collector {
  return {
    planId: spec.planId,
    sourceId: spec.sourceId,
    endpoint: spec.endpoint,
    signalSource: 'graph',
    host: 'graph.microsoft.us',
    permission: spec.permission,
    cadenceMinutes: spec.cadenceMinutes,
    initialLookbackMinutes: spec.initialLookbackDays * 24 * 60,
    overlapMinutes: 15,
    viewDays: spec.viewDays,
    idOf: (it) => {
      const id = String((it as { id?: unknown })?.id ?? '');
      if (!id || !spec.versionField) return id;
      const v = (it as Record<string, unknown>)?.[spec.versionField];
      return `${id}@${isoTime(v) || String(v ?? '')}`;
    },
    timeOf: (it) => isoTime((it as Record<string, unknown>)?.[spec.timeField]),
    read(reader, window) {
      const uri = `${spec.uriPath}?${spec.expand ? `${spec.expand}&` : ''}$filter=${spec.timeField}%20ge%20${window.start}`;
      return readGraph(reader, spec.sourceId, spec.endpoint, uri);
    },
  };
}
