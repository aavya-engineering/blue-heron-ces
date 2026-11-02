// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Pure risk-register logic ported from legacy public/index.html (NIST_RISK_MATRIX, filterRiskEntries,
// sortRiskTable, renderSummaryPanel, getRiskStatusInfo, computeSnapshotDiff). No I/O.

import type { RiskEntry, RiskSnapshot } from '../../api/types';

export const LEVELS = ['very_low', 'low', 'moderate', 'high', 'very_high'] as const;
export const TREATMENT = ['recommended', 'in_progress', 'mitigated', 'accepted_residual', 'transferred'] as const;
export const RECOMMENDATION = ['mitigate', 'avoid', 'transfer', 'accept'] as const;

/** Legacy NIST_RISK_MATRIX (NIST SP 800-30 Rev. 1), likelihood -> impact -> composite, copied exactly. */
export const NIST_RISK_MATRIX: Record<string, Record<string, string>> = {
  very_low: { very_low: 'very_low', low: 'very_low', moderate: 'low', high: 'low', very_high: 'moderate' },
  low: { very_low: 'very_low', low: 'low', moderate: 'low', high: 'moderate', very_high: 'moderate' },
  moderate: { very_low: 'low', low: 'low', moderate: 'moderate', high: 'moderate', very_high: 'high' },
  high: { very_low: 'low', low: 'moderate', moderate: 'moderate', high: 'high', very_high: 'very_high' },
  very_high: { very_low: 'moderate', low: 'moderate', moderate: 'high', high: 'very_high', very_high: 'very_high' },
};

const ORDER: Record<string, number> = { very_high: 5, high: 4, moderate: 3, low: 2, very_low: 1 };

/** Legacy computeCompositeRisk. */
export function compositeRisk(likelihood?: string, impact?: string): string | undefined {
  if (!likelihood || !impact) return undefined;
  return NIST_RISK_MATRIX[likelihood]?.[impact] ?? undefined;
}

export interface RiskFilters { source: string[]; risk: string[]; treatment: string[]; needsScoring: boolean }
export const NO_FILTERS: RiskFilters = { source: [], risk: [], treatment: [], needsScoring: false };
export type SortKey = 'threatEvent' | 'vulnerability' | 'likelihood' | 'impact' | 'compositeRisk' | 'treatmentStatus' | 'lastReviewed' | 'source';

function sortValue(e: RiskEntry, key: SortKey): string | number {
  if (key === 'compositeRisk' || key === 'likelihood' || key === 'impact') return ORDER[e[key] ?? ''] ?? 0;
  if (key === 'vulnerability') return e.vulnerability?.description ?? '';
  if (key === 'source') return e.source?.type ?? '';
  return (e[key] as string | undefined) ?? '';
}

/** Legacy filterRiskEntries + sort (default: composite risk, highest first). */
export function filterAndSort(entries: RiskEntry[], f: RiskFilters, key: SortKey, asc: boolean): RiskEntry[] {
  let rows = entries.slice();
  if (f.source.length) rows = rows.filter((e) => f.source.includes(e.source?.type ?? ''));
  if (f.risk.length) rows = rows.filter((e) => f.risk.includes(e.compositeRisk ?? ''));
  if (f.treatment.length) rows = rows.filter((e) => f.treatment.includes(e.treatmentStatus ?? ''));
  if (f.needsScoring) rows = rows.filter((e) => !e.likelihood || !e.impact);
  rows.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });
  return rows;
}

/** Legacy renderSummaryPanel: counts by level (plus unscored), the top 5 scored, and counts by source. */
export function summarize(entries: RiskEntry[]) {
  const byLevel: Record<string, number> = { very_high: 0, high: 0, moderate: 0, low: 0, very_low: 0, unscored: 0 };
  const bySource: Record<string, number> = {};
  for (const e of entries) {
    if (e.compositeRisk && e.compositeRisk in byLevel) byLevel[e.compositeRisk]++;
    else byLevel.unscored++;
    const s = e.source?.type ?? 'unknown';
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  const top5 = entries.filter((e) => e.compositeRisk).sort((a, b) => (ORDER[b.compositeRisk!] ?? 0) - (ORDER[a.compositeRisk!] ?? 0)).slice(0, 5);
  return { byLevel, bySource, top5 };
}

/** Legacy getRiskStatusInfo: Overdue / Due Soon (60 days) / Current. */
export function reviewStatus(nextReviewDue: string | undefined, now = new Date()): string {
  if (!nextReviewDue) return '—';
  const days = Math.floor((new Date(nextReviewDue).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return 'Overdue';
  if (days <= 60) return 'Due Soon';
  return 'Current';
}

export const vulnText = (v: RiskEntry['vulnerability'] | string | undefined): string =>
  typeof v === 'string' ? v : v?.description ?? '—';
export const sourceText = (s: RiskEntry['source'] | string | undefined): string =>
  typeof s === 'string' ? s.replace(/_/g, ' ') : s?.type ? s.type.replace(/_/g, ' ') : '—';

/** Legacy computeSnapshotDiff: added / retired by id, re-scored (composite changed), treatment changed. */
export function snapshotDiff(older: RiskSnapshot, newer: RiskSnapshot) {
  const o = new Map((older.registerSnapshot?.entries ?? []).map((e) => [e.id, e]));
  const n = new Map((newer.registerSnapshot?.entries ?? []).map((e) => [e.id, e]));
  const added: RiskEntry[] = [];
  const retired: RiskEntry[] = [];
  const rescored: Array<{ entry: RiskEntry; from?: string; to?: string }> = [];
  const treatment: Array<{ entry: RiskEntry; from?: string; to?: string }> = [];
  for (const [id, e] of n) if (!o.has(id)) added.push(e);
  for (const [id, e] of o) if (!n.has(id)) retired.push(e);
  for (const [id, e] of n) {
    const old = o.get(id);
    if (!old) continue;
    if (old.compositeRisk !== e.compositeRisk) rescored.push({ entry: e, from: old.compositeRisk, to: e.compositeRisk });
    if (old.treatmentStatus !== e.treatmentStatus) treatment.push({ entry: e, from: old.treatmentStatus, to: e.treatmentStatus });
  }
  return { added, retired, rescored, treatment };
}

/** Composite-risk counts for one snapshot (legacy computeSnapshotEntryCounts). */
export function snapshotCounts(s: RiskSnapshot | undefined): Record<string, number> {
  const c: Record<string, number> = { very_high: 0, high: 0, moderate: 0, low: 0, very_low: 0 };
  for (const e of s?.registerSnapshot?.entries ?? []) if (e.compositeRisk && e.compositeRisk in c) c[e.compositeRisk]++;
  return c;
}
