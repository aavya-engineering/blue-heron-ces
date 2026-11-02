// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * P4.1 (muster-e2e) step EX: the tester's own comparison, as pure functions.
 *  - facts:  the scenario's expected_facts (readiness-activity ids, the ids
 *            the sim scenarios use since tenant-stacksim cadfba6) against the
 *            headless runner's readiness result (`facts[]`, question_id ->
 *            answer). An id with no fact is a miss (actual null).
 *  - ledger: the sim ledger snapshot taken after E8 against the step windows
 *            of this run (a write = a non-seed entry whose type is not read*,
 *            the same rule as the package's verify V7).
 * The resolve-based expected_state checks reuse src/verifier/expectedState.ts.
 */
import type { ExpectedLedgerSpec } from '../scenarios/musterE2eFile.js';

export interface FactRow {
  id: string;
  expected: string;
  actual: string | null;
  pass: boolean;
}

export interface FactsComparison {
  pass: boolean;
  source: string;
  matched: number;
  total: number;
  rows: FactRow[];
}

export function compareFacts(
  expected: Record<string, string>,
  readiness: { facts?: Array<{ question_id?: string; answer?: unknown }> } | null,
  source: string,
): FactsComparison {
  const byId = new Map<string, string>();
  for (const f of readiness?.facts ?? []) {
    if (typeof f.question_id === 'string') byId.set(f.question_id, String(f.answer));
  }
  const rows = Object.entries(expected).map(([id, want]) => {
    const actual = byId.has(id) ? byId.get(id)! : null;
    return { id, expected: want, actual, pass: actual === want };
  });
  const matched = rows.filter((r) => r.pass).length;
  return { pass: readiness !== null && matched === rows.length, source, matched, total: rows.length, rows };
}

export interface LedgerEntryLike {
  ts: string;
  type: string;
  objectType?: string;
  objectId?: string;
  sessionType?: string;
}

export interface StepWindow {
  started: string;
  ended: string;
}

export interface LedgerRow {
  check: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface LedgerComparison {
  pass: boolean;
  entries: number;
  writes: number;
  /** Non-seed writes inside the spec's build_window (the sim scenario build); absent without one. */
  build_writes?: number;
  rows: LedgerRow[];
}

export const isWrite = (e: LedgerEntryLike): boolean => !String(e.type).startsWith('read') && e.sessionType !== 'seed';
const inWindow = (e: LedgerEntryLike, w: StepWindow | undefined): boolean => !!w && e.ts >= w.started && e.ts <= w.ended;

/** Write steps of a stacksim scenario file (`steps[]`, every one a resolver URI call; GET is not a write). */
export function scenarioWriteSteps(scenario: { steps?: Array<{ method?: string }> } | null): number | undefined {
  if (!scenario) return undefined;
  return (scenario.steps ?? []).filter((s) => String(s.method ?? '').toUpperCase() !== 'GET').length;
}

/**
 * S1 fix (2026-10-28): the simulator tags every mutation `actor: 'ao'`, so writes are attributed by
 * step time window only. With `build_window` = { from: 'E1', before: 'E2' }, the non-seed writes in
 * [E1.started, E2.started) are the scenario build (`stacksim scenario <slug>` replaying the scenario's
 * PATCH steps): their count must equal `buildWriteSteps` (the scenario file's write steps), and every
 * other rule (no_writes_during, allowed_write_windows / writes_only_during, min_writes_during, mutated)
 * applies to the remaining (operator) writes only.
 */
export function compareLedger(
  spec: ExpectedLedgerSpec,
  entries: LedgerEntryLike[],
  windows: Record<string, StepWindow | undefined>,
  buildWriteSteps?: number,
): LedgerComparison {
  const allWrites = entries.filter(isWrite);
  const rows: LedgerRow[] = [];
  let writes = allWrites;
  let buildCount: number | undefined;
  if (spec.build_window) {
    const { from, before } = spec.build_window;
    const wFrom = windows[from];
    const wBefore = windows[before];
    const inBuild = (e: LedgerEntryLike): boolean => !!wFrom && !!wBefore && e.ts >= wFrom.started && e.ts < wBefore.started;
    buildCount = allWrites.filter(inBuild).length;
    writes = allWrites.filter((e) => !inBuild(e));
    const missing = [from, before].filter((id) => !windows[id]);
    rows.push({
      check: `scenario-build writes in [${from} start, ${before} start) = the sim scenario's write steps`,
      expected: buildWriteSteps === undefined ? 'the sim scenario file' : String(buildWriteSteps),
      actual: missing.length ? `no ${missing.join('/')} window` : String(buildCount),
      pass: missing.length === 0 && buildWriteSteps !== undefined && buildCount === buildWriteSteps,
    });
  }
  for (const id of spec.no_writes_during ?? []) {
    const w = windows[id];
    const n = writes.filter((e) => inWindow(e, w)).length;
    rows.push({ check: `no non-seed writes during ${id}`, expected: '0', actual: w ? String(n) : `no ${id} window`, pass: !!w && n === 0 });
  }
  // Synthetic-customer W2: a list of allowed windows (E6 Stamper, E6X injection, E7A AdminOps); every listed window
  // must exist. writes_only_during is the one-window form.
  const allowed = spec.allowed_write_windows ?? (spec.writes_only_during ? [spec.writes_only_during] : undefined);
  if (allowed) {
    const missing = allowed.filter((id) => !windows[id]);
    const n = writes.filter((e) => !allowed.some((id) => inWindow(e, windows[id]))).length;
    rows.push({
      check: `every non-seed write falls inside ${allowed.join(' or ')}`,
      expected: '0 outside',
      actual: missing.length ? `no ${missing.join('/')} window` : `${n} outside`,
      pass: missing.length === 0 && n === 0,
    });
  }
  for (const [id, min] of Object.entries(spec.min_writes_during ?? {})) {
    const w = windows[id];
    const n = writes.filter((e) => inWindow(e, w)).length;
    rows.push({ check: `at least ${min} non-seed writes during ${id}`, expected: `>= ${min}`, actual: w ? String(n) : `no ${id} window`, pass: !!w && n >= min });
  }
  for (const m of spec.mutated ?? []) {
    const n = writes.filter((e) => e.objectType === m.objectType && (m.objectId === undefined || e.objectId === m.objectId)).length;
    rows.push({ check: `written: ${m.objectType}${m.objectId ? `/${m.objectId}` : ''}`, expected: '>= 1', actual: String(n), pass: n >= 1 });
  }
  return { pass: rows.every((r) => r.pass), entries: entries.length, writes: allWrites.length, ...(buildCount !== undefined ? { build_writes: buildCount } : {}), rows };
}
