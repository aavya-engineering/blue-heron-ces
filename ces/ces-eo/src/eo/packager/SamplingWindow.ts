// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W4.2: the sampling window per control family, from the evidence-store records.
//
// A record counts for every family among its controlIds. Only reads that returned (status
// `success` or `empty`) count as samples; failed reads are counted apart.
// - window.start = the earliest record window start (point-in-time reads have none);
// - window.end   = the latest record window end;
// - sampleCount  = the number of returned reads (records) in the family;
// - itemCount    = the rows those reads returned (a collector stores only new rows; a point-in-time
//                  read stores its whole result on every pass, so its rows recur).

import type { EvidenceRecord } from '../evidence/store/types.js';

export type WindowRecord = Pick<EvidenceRecord, 'sourceId' | 'status' | 'itemCount' | 'controlIds' | 'window' | 'collectedAt'>;

export interface FamilySamplingWindow {
  family: string;
  window: { start: string | null; end: string | null };
  sampleCount: number;
  itemCount: number;
  /** Returned reads with no window start (current-state reads). */
  pointInTimeCount: number;
  /** Reads that failed (`error`, `not_assessed`, `gap`): not samples. */
  failedCount: number;
  sources: string[];
}

/** "AC.L1-3.1.1" → "AC". */
export const familyOf = (controlId: string): string => controlId.split('.')[0];

export function samplingWindowsByFamily(records: readonly WindowRecord[]): FamilySamplingWindow[] {
  const byFamily = new Map<string, FamilySamplingWindow & { _sources: Set<string> }>();
  for (const r of records) {
    const families = [...new Set((r.controlIds ?? []).map(familyOf))];
    const returned = r.status === 'success' || r.status === 'empty';
    for (const f of families) {
      let w = byFamily.get(f);
      if (!w) {
        w = { family: f, window: { start: null, end: null }, sampleCount: 0, itemCount: 0, pointInTimeCount: 0, failedCount: 0, sources: [], _sources: new Set() };
        byFamily.set(f, w);
      }
      if (!returned) { w.failedCount++; continue; }
      w.sampleCount++;
      w.itemCount += r.itemCount ?? 0;
      w._sources.add(r.sourceId);
      const start = r.window?.start ?? null;
      const end = r.window?.end ?? r.collectedAt;
      if (start === null) w.pointInTimeCount++;
      else if (w.window.start === null || Date.parse(start) < Date.parse(w.window.start)) w.window.start = start;
      if (end && (w.window.end === null || Date.parse(end) > Date.parse(w.window.end))) w.window.end = end;
    }
  }
  return [...byFamily.values()]
    .map(({ _sources, ...w }) => ({ ...w, sources: [..._sources].sort() }))
    .sort((a, b) => a.family.localeCompare(b.family));
}
