// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * W8-UIT1 (UI-TRACK.md §5): the `ui-e2e` Stamper comparison, as pure functions.
 *
 * One UI variant (legacy `/` or SPA `/app/`) against its headless twin (the
 * same scenario run through `mx-e2e.ps1`, whose outputs sit in `<WS>/out`), on
 * three things, STRICT equality and no false-fail mask:
 *  (a) `projectExecutablePlan()` of the UI translate vs the twin's
 *      `out/executable-plan.json`, `variables` excluded (tasks only);
 *  (b) the Stamper failed set (`failed_tasks[].task_id`) vs `out/execution-report.json`;
 *  (c) the objects the sim ledger shows mutated inside the UI execute window vs
 *      those inside the twin's E6 window of `out/ledger.json`, compared by their
 *      END STATE in each side's sim store snapshot and keyed by a stable identity
 *      (W8-UIT3: resource type plus displayName or another natural key, the
 *      object id only when there is none; the sim mints a fresh GUID on some
 *      creates, e.g. `createInstance`, so comparing ids is a false difference).
 * The record lands in `out/ui-e2e-stamper.json`; the package's verify V73
 * recomputes (a)-(c) from the files it names.
 */

export const UI_E2E_STAMPER_SCHEMA = 'ces-tester/ui-e2e-stamper@1';
export const UI_E2E_STAMPER_FILE = 'ui-e2e-stamper.json';

/** The projection shape of Stamper's `projectExecutablePlan()` (only the parts compared here). */
export interface PlanProjectionLike {
  readonly tasks: ReadonlyArray<Record<string, unknown>>;
  readonly variables?: Record<string, unknown>;
}

export interface LedgerEntryLike {
  readonly ts: string;
  readonly type: string;
  readonly objectType?: string;
  readonly objectId?: string;
  readonly sessionType?: string;
}

export interface TimeWindow {
  readonly started: string;
  readonly ended: string;
}

export interface CheckOutcome {
  readonly pass: boolean;
  readonly detail: string;
}

export interface VariantComparison {
  readonly variant: string;
  readonly ran: true;
  readonly pass: boolean;
  readonly a_projection: CheckOutcome;
  readonly b_failed_set: CheckOutcome;
  readonly c_ledger_rows: CheckOutcome;
}

/** Key-order-insensitive JSON (objects sorted by key, arrays kept in order). Pure. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * First difference between two projections' tasks (variables excluded), or
 * null when equal: the task counts, else the first index whose task differs,
 * naming the id(s) and the first differing field.
 */
export function firstTaskDiff(ui: PlanProjectionLike, twin: PlanProjectionLike): string | null {
  const a = ui.tasks ?? [];
  const b = twin.tasks ?? [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (canonicalJson(a[i]) === canonicalJson(b[i])) continue;
    const ida = String(a[i]?.id);
    const idb = String(b[i]?.id);
    if (ida !== idb) return `task ${i}: ui id ${ida}, twin id ${idb}`;
    const keys = [...new Set([...Object.keys(a[i] ?? {}), ...Object.keys(b[i] ?? {})])].sort();
    const field = keys.find((k) => canonicalJson(a[i]?.[k]) !== canonicalJson(b[i]?.[k]));
    return `task ${i} (${ida}): field ${field ?? '?'}`;
  }
  if (a.length !== b.length) return `task counts: ui ${a.length}, twin ${b.length}`;
  return null;
}

/** (a) UI translate projection vs the twin's, variables excluded. */
export function compareProjection(ui: PlanProjectionLike | null, twin: PlanProjectionLike | null): CheckOutcome {
  if (!ui) return { pass: false, detail: '(a) no UI executable plan projection' };
  if (!twin) return { pass: false, detail: '(a) no twin out/executable-plan.json projection' };
  const diff = firstTaskDiff(ui, twin);
  return diff
    ? { pass: false, detail: `(a) UI translate projection != twin projection (variables excluded): first difference ${diff}` }
    : { pass: true, detail: `(a) UI translate projection = twin projection, ${ui.tasks.length} tasks, variables excluded` };
}

/** The failed set of a Stamper execution report: sorted, unique `failed_tasks[].task_id`. Pure. */
export function failedSet(report: unknown): string[] {
  const rows = (report as { failed_tasks?: unknown } | null)?.failed_tasks;
  const ids = (Array.isArray(rows) ? rows : [])
    .map((r) => (r as { task_id?: unknown })?.task_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].sort();
}

function listDiff(ui: readonly string[], twin: readonly string[]): { onlyUi: string[]; onlyTwin: string[] } {
  const count = (xs: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const cu = count(ui);
  const ct = count(twin);
  const onlyUi: string[] = [];
  const onlyTwin: string[] = [];
  for (const [k, n] of cu) for (let i = 0; i < n - (ct.get(k) ?? 0); i++) onlyUi.push(k);
  for (const [k, n] of ct) for (let i = 0; i < n - (cu.get(k) ?? 0); i++) onlyTwin.push(k);
  return { onlyUi: onlyUi.sort(), onlyTwin: onlyTwin.sort() };
}

/** (b) UI failed set vs the twin's. */
export function compareFailedSet(uiReport: unknown, twinReport: unknown): CheckOutcome {
  if (!uiReport) return { pass: false, detail: '(b) no UI execution report' };
  if (!twinReport) return { pass: false, detail: '(b) no twin out/execution-report.json' };
  const ui = failedSet(uiReport);
  const twin = failedSet(twinReport);
  const d = listDiff(ui, twin);
  if (d.onlyUi.length === 0 && d.onlyTwin.length === 0) {
    return { pass: true, detail: `(b) failed set equal: ${ui.length} task(s)` };
  }
  return {
    pass: false,
    detail: `(b) failed set differs: UI only [${d.onlyUi.slice(0, 5).join(', ')}]${d.onlyUi.length > 5 ? ` +${d.onlyUi.length - 5}` : ''}; twin only [${d.onlyTwin.slice(0, 5).join(', ')}]${d.onlyTwin.length > 5 ? ` +${d.onlyTwin.length - 5}` : ''}`,
  };
}

/** A write = a non-seed entry whose type is not read* (the package's verify V7 rule). */
export const isLedgerWrite = (e: LedgerEntryLike): boolean => !String(e.type).startsWith('read') && e.sessionType !== 'seed';

/** The mutated rows inside a window, as sorted `type objectType/objectId` keys (a multiset). Pure. */
export function mutatedLedgerRows(entries: readonly LedgerEntryLike[], window: TimeWindow): string[] {
  return entries
    .filter((e) => isLedgerWrite(e) && e.ts >= window.started && e.ts <= window.ended)
    .map((e) => `${e.type} ${e.objectType ?? '?'}/${e.objectId ?? '?'}`)
    .sort();
}

/** A sim store snapshot (`store.json` of the stacksim tenant folder): objects by type, then by id. */
export interface SimStoreLike {
  readonly collections?: Readonly<Record<string, Readonly<Record<string, Record<string, unknown>>>>>;
}

/**
 * W8-UIT3. The natural-key fields, tried in this order; the first non-empty
 * string wins. The package judge (verify-w4.mjs `V73_NATURAL_KEYS`) uses the same list.
 */
export const NATURAL_KEY_FIELDS = ['displayName', 'DisplayName', 'Name', 'name', 'Identity'] as const;

/**
 * W8-UIT3. Fields dropped from an end state, at any depth: the run timestamps the
 * sim stamps on a write (`createdDateTime`, `lastModifiedDateTime`, `WhenChanged`).
 * The object's own `id` is dropped at the top level only. Nothing else is
 * dropped, so any other field that differs is a genuine difference. Same rule
 * as verify-w4.mjs `V73_VOLATILE`.
 */
export const VOLATILE_FIELD = /DateTime$|^When(Changed|Created)(UTC)?$/i;

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!VOLATILE_FIELD.test(k)) out[k] = stripVolatile(v);
    return out;
  }
  return value;
}

/** An object's end state for comparison: canonical JSON without its `id` and the volatile fields; null when the store has no such object. Pure. */
export function endStateOf(obj: Record<string, unknown> | undefined | null): string | null {
  if (!obj) return null;
  const rest: Record<string, unknown> = { ...obj };
  delete rest.id;
  return canonicalJson(stripVolatile(rest));
}

export interface MutatedObject {
  /** `objectType/<natural key>`, or `objectType/<objectId>` when there is no (unique) natural key. */
  readonly identity: string;
  /** The ledger row types of the writes on this object inside the window, sorted. */
  readonly writes: readonly string[];
  /** `endStateOf` the object in the store snapshot. */
  readonly state: string | null;
}

/**
 * W8-UIT3. The objects written inside a window, each keyed by a stable identity
 * and carrying its end state from `store`. A natural key that two of the
 * window's objects of one type share is not an identity: both fall back to their ids. Pure.
 */
export function mutatedObjects(entries: readonly LedgerEntryLike[], window: TimeWindow, store: SimStoreLike | null): MutatedObject[] {
  const byObject = new Map<string, { type: string; id: string; writes: string[] }>();
  for (const e of entries) {
    if (!isLedgerWrite(e) || e.ts < window.started || e.ts > window.ended) continue;
    const type = e.objectType ?? '?';
    const id = e.objectId ?? '?';
    const k = JSON.stringify([type, id]);
    const o = byObject.get(k) ?? { type, id, writes: [] };
    o.writes.push(String(e.type));
    byObject.set(k, o);
  }
  const objs = [...byObject.values()].map((o) => {
    const obj = store?.collections?.[o.type]?.[o.id];
    const nk = NATURAL_KEY_FIELDS.map((f) => obj?.[f]).find((v): v is string => typeof v === 'string' && v.length > 0);
    return { ...o, nk, state: endStateOf(obj) };
  });
  const nkCount = new Map<string, number>();
  for (const o of objs) if (o.nk !== undefined) nkCount.set(`${o.type}/${o.nk}`, (nkCount.get(`${o.type}/${o.nk}`) ?? 0) + 1);
  return objs
    .map((o) => ({
      identity: o.nk !== undefined && nkCount.get(`${o.type}/${o.nk}`) === 1 ? `${o.type}/${o.nk}` : `${o.type}/${o.id}`,
      writes: [...o.writes].sort(),
      state: o.state,
    }))
    .sort((x, y) => (x.identity < y.identity ? -1 : x.identity > y.identity ? 1 : 0));
}

const listOf = (xs: readonly string[], n = 5): string => `[${xs.slice(0, n).join('; ')}]${xs.length > n ? ` +${xs.length - n}` : ''}`;

/** The first top-level field whose end state differs (for the detail). */
function firstStateField(a: string | null, b: string | null): string {
  if (a === null || b === null) return a === null ? 'absent in the UI store' : 'absent in the twin store';
  const x = JSON.parse(a) as Record<string, unknown>;
  const y = JSON.parse(b) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  return `field ${keys.find((k) => canonicalJson(x[k]) !== canonicalJson(y[k])) ?? '?'}`;
}

/**
 * (c) the mutated objects of the UI execute window vs the twin's E6 window (W8-UIT3):
 * the same identities, the same writes on each, the same end state. Strict.
 */
export function compareLedgerRows(
  uiEntries: readonly LedgerEntryLike[] | null,
  uiWindow: TimeWindow | null,
  twinEntries: readonly LedgerEntryLike[] | null,
  twinWindow: TimeWindow | null,
  uiStore: SimStoreLike | null = null,
  twinStore: SimStoreLike | null = null,
): CheckOutcome {
  if (!uiEntries) return { pass: false, detail: '(c) no UI sim ledger snapshot' };
  if (!uiWindow) return { pass: false, detail: '(c) no UI execute window' };
  if (!twinEntries) return { pass: false, detail: '(c) no twin out/ledger.json' };
  if (!twinWindow) return { pass: false, detail: '(c) no twin E6 window in out/steps.json' };
  if (!uiStore) return { pass: false, detail: '(c) no UI sim store snapshot' };
  if (!twinStore) return { pass: false, detail: '(c) no twin sim store snapshot' };
  const ui = mutatedObjects(uiEntries, uiWindow, uiStore);
  const twin = mutatedObjects(twinEntries, twinWindow, twinStore);
  const uiRows = ui.reduce((n, o) => n + o.writes.length, 0);
  const twinRows = twin.reduce((n, o) => n + o.writes.length, 0);
  const d = listDiff(
    ui.map((o) => o.identity),
    twin.map((o) => o.identity),
  );
  const twinBy = new Map(twin.map((o) => [o.identity, o]));
  const writesDiffer: string[] = [];
  const stateDiffers: string[] = [];
  for (const o of ui) {
    const t = twinBy.get(o.identity);
    if (!t) continue;
    if (o.writes.join(',') !== t.writes.join(',')) writesDiffer.push(`${o.identity} (UI ${o.writes.length}, twin ${t.writes.length})`);
    if (o.state !== t.state) stateDiffers.push(`${o.identity} (${firstStateField(o.state, t.state)})`);
  }
  if (!d.onlyUi.length && !d.onlyTwin.length && !writesDiffer.length && !stateDiffers.length) {
    return { pass: true, detail: `(c) mutated objects equal: ${ui.length} object(s), ${uiRows} row(s), same end state (keyed by natural identity)` };
  }
  const parts = [
    ...(d.onlyUi.length || d.onlyTwin.length ? [`UI only ${listOf(d.onlyUi)}; twin only ${listOf(d.onlyTwin)}`] : []),
    ...(writesDiffer.length ? [`writes differ ${listOf(writesDiffer)}`] : []),
    ...(stateDiffers.length ? [`end state differs ${listOf(stateDiffers)}`] : []),
  ];
  return {
    pass: false,
    detail: `(c) mutated objects differ (UI ${ui.length} objects / ${uiRows} rows, twin ${twin.length} objects / ${twinRows} rows): ${parts.join('; ')}`,
  };
}

export interface CompareVariantInput {
  readonly variant: string;
  readonly uiProjection: PlanProjectionLike | null;
  readonly twinProjection: PlanProjectionLike | null;
  readonly uiReport: unknown;
  readonly twinReport: unknown;
  readonly uiLedger: readonly LedgerEntryLike[] | null;
  readonly uiWindow: TimeWindow | null;
  readonly twinLedger: readonly LedgerEntryLike[] | null;
  readonly twinWindow: TimeWindow | null;
  /** W8-UIT3: the sim store snapshots the (c) end state is read from. */
  readonly uiStore?: SimStoreLike | null;
  readonly twinStore?: SimStoreLike | null;
}

/** One variant against the twin on (a), (b) and (c). Pure. */
export function compareVariant(input: CompareVariantInput): VariantComparison {
  const a = compareProjection(input.uiProjection, input.twinProjection);
  const b = compareFailedSet(input.uiReport, input.twinReport);
  const c = compareLedgerRows(input.uiLedger, input.uiWindow, input.twinLedger, input.twinWindow, input.uiStore ?? null, input.twinStore ?? null);
  return { variant: input.variant, ran: true, pass: a.pass && b.pass && c.pass, a_projection: a, b_failed_set: b, c_ledger_rows: c };
}

/** One variant's entry in `out/ui-e2e-stamper.json`. */
export interface VariantRecord {
  readonly variant: string;
  readonly base_path: string;
  readonly ran: boolean;
  /** Why the variant did not run (e.g. `/app/` not built), or the error that stopped it. */
  readonly reason?: string;
  readonly error?: string;
  readonly pass: boolean;
  readonly comparison?: VariantComparison;
  /** Files under `<WS>/out`, relative, forward slashes. */
  readonly files?: {
    readonly executable_plan?: string;
    readonly execution_report?: string;
    readonly ledger?: string;
    /** W8-UIT3: the variant's sim store snapshot, taken after the drive. */
    readonly sim_store?: string;
    readonly video?: string;
    readonly trace?: string;
  };
  readonly execute_window?: TimeWindow;
  readonly approvals?: number;
  readonly evidence?: unknown;
  readonly resource_ledger?: unknown;
  readonly headed?: boolean;
}

export interface UiE2eStamperRecord {
  readonly schema: typeof UI_E2E_STAMPER_SCHEMA;
  readonly scenario_id: string;
  readonly slug: string;
  readonly surface: 'stamper';
  readonly started: string;
  readonly ended: string;
  readonly twin: {
    readonly executable_plan: string;
    readonly execution_report: string;
    readonly ledger: string;
    /** W8-UIT3: the twin's sim store snapshot (copied before the first UI reset), when there was one. */
    readonly sim_store?: string;
    readonly e6_window: TimeWindow | null;
  };
  readonly variants: readonly VariantRecord[];
  /** Every variant that ran passed, and the legacy variant ran. */
  readonly pass: boolean;
}

/** The record's verdict: legacy must have run and passed; every other variant passes or did not run. Pure. */
export function recordPass(variants: readonly VariantRecord[]): boolean {
  const legacy = variants.find((v) => v.variant === 'legacy');
  if (!legacy || !legacy.ran || !legacy.pass) return false;
  return variants.every((v) => !v.ran || v.pass);
}
