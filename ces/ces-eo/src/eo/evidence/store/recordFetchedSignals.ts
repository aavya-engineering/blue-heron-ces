// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.4 (P1 #5, #6): every read of one fetch goes into the tenant's evidence store
 * once, whatever its status (success, empty, error, not_assessed). Called right after
 * `fetchAllSignals()` and the mapper, in one sequential loop (never per control, never in
 * parallel), from both capture paths: `/api/assess` (E7) and `captureSignalsForTenant` (the
 * on-demand capture route and the scheduled timer). The met-only blob mirror is unchanged.
 */
import { createRequire } from 'node:module';
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlAssessment } from 'ces-shared/types/controls';
import { EvidenceStore } from './EvidenceStore.js';
import type { CollectorInfo, EvidenceRecordStatus, TimeWindow, WatermarkUpdate } from './types.js';

const _require = createRequire(import.meta.url);

let _objectivesByControl: Map<string, string[]> | null = null;

/** 800-171A objective ids per control, from ces-shared's objectives reference. */
export function objectivesByControl(): Map<string, string[]> {
  if (_objectivesByControl) return _objectivesByControl;
  const map = new Map<string, string[]>();
  try {
    const ref = _require('ces-shared/data/assessment-objectives') as { objectives?: Array<{ objectiveId: string; controlId: string }> };
    for (const o of ref.objectives ?? []) {
      const list = map.get(o.controlId) ?? [];
      list.push(o.objectiveId);
      map.set(o.controlId, list);
    }
  } catch { /* no reference: objectiveIds stay empty */ }
  _objectivesByControl = map;
  return map;
}

/** Number of items a read returned: a Graph `value` array, a bare array, or one object. */
export function itemCountOf(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'object') {
    const v = (raw as { value?: unknown }).value;
    if (Array.isArray(v)) return v.length;
    return Object.keys(raw as object).length === 0 ? 0 : 1;
  }
  return 1;
}

export function storeStatusOf(signal: SignalResult, itemCount: number): EvidenceRecordStatus {
  if (signal.status === 'error') return 'error';
  if (signal.status === 'not_assessed') return 'not_assessed';
  return itemCount === 0 ? 'empty' : 'success';
}

const WINDOW_START_RE = /(?:^|%20|\s)ge(?:%20|\s)+(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/;

/** The read's window: `start` from a `$filter … ge <time>` in the request, else point in time. */
export function windowOf(query: string, collectedAt: string): TimeWindow {
  const m = WINDOW_START_RE.exec(query);
  return { start: m ? m[1] : null, end: collectedAt };
}

export interface RecordReadsContext {
  storageRoot: string;
  tenantId: string;
  tenantSlug: string;
  collector: CollectorInfo;
  /** Host and request per signal (ComplianceSignalFetcher.describeRead). */
  describe: (signal: SignalResult) => { host: string; query: string };
}

export interface RecordReadsResult {
  recorded: number;
  errors: Array<{ sourceId: string; error: string }>;
}

/** Append one store record per signal, in fetch order. Never throws. */
export function recordFetchedSignals(
  signals: SignalResult[],
  assessments: ControlAssessment[],
  ctx: RecordReadsContext,
): RecordReadsResult {
  const out: RecordReadsResult = { recorded: 0, errors: [] };
  let store: EvidenceStore;
  try {
    store = EvidenceStore.forStorageRoot(ctx.storageRoot, ctx.tenantId);
  } catch (e) {
    out.errors.push({ sourceId: '_store', error: e instanceof Error ? e.message : String(e) });
    return out;
  }

  const controlsBySignal = new Map<string, Set<string>>();
  for (const a of assessments) {
    for (const s of a.signals ?? []) {
      const set = controlsBySignal.get(s.signalId) ?? new Set<string>();
      set.add(a.control_id);
      controlsBySignal.set(s.signalId, set);
    }
  }
  const objectives = objectivesByControl();

  for (const signal of signals) {
    try {
      const { host, query } = ctx.describe(signal);
      const collectedAt = signal.timestamp;
      const itemCount = itemCountOf(signal.rawData);
      const status = storeStatusOf(signal, itemCount);
      const controlIds = [...(controlsBySignal.get(signal.signalId) ?? [])];
      const objectiveIds = controlIds.flatMap((c) => objectives.get(c) ?? []);
      let watermark: WatermarkUpdate | undefined;
      if (status === 'success' || status === 'empty') {
        const cur = store.watermarks.get(signal.signalId)?.lastWindowEnd;
        if (!cur || Date.parse(collectedAt) >= Date.parse(cur)) watermark = { lastWindowEnd: collectedAt };
      }
      const error = signal.error ?? (status === 'not_assessed' || status === 'error' ? (signal.findings ?? []).join('; ') || undefined : undefined);
      store.append({
        tenantId: ctx.tenantId,
        tenantSlug: ctx.tenantSlug,
        sourceId: signal.signalId,
        collector: ctx.collector,
        host,
        endpoint: signal.endpoint,
        query,
        window: windowOf(query, collectedAt),
        collectedAt,
        status,
        itemCount,
        payload: signal.rawData ?? null,
        controlIds,
        objectiveIds,
        ...(error !== undefined ? { error } : {}),
        ...(watermark ? { watermark } : {}),
      });
      out.recorded++;
    } catch (e) {
      out.errors.push({ sourceId: signal.signalId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
