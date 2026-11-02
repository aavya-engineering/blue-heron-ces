// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-35 (finishing plan PH-3 harness): every watched AO, EO and Muster UI run compared with its headless twin, as pure
 * functions. The record lands in `<WS>/out/ui-e2e-<surface>.json`; the package's verify V123 (AO), V124 (EO) and V125
 * (Muster) reload the files it names and recompute the same clauses (scripts/verify-fin35.mjs), and cross-check the
 * tester's `pass` flag, as V73 does for Stamper.
 *
 * V123 (AO) = the twin's `out/adminops-e7a.json`: (a) the same ops in order; (b) per op the same call sequence and, per
 *   call, the same AO mode, outcome, verdict and state change, evidence persisted; (c) the confirming sim read passes on
 *   both sides with the same value; (d) each apply's evidence row names the same objectives as the twin's row.
 * V124 (EO) = the twin's E7B/E8 outputs: (a) per-control status and SPRS from the UI assess (GET /api/assessment,
 *   GET /api/sprs) equal the twin's stored snapshot and summary; (b) the UI SSP JSON statuses equal the twin's `out/ssp.json`, and the UI DOCX was downloaded (non-empty);
 *   (c) the UI upload recorded its uploader and catalog ids; (d) the UI review counts under GD-b (reviewer != uploader)
 *   and, after a re-assess, its control has the twin's status (the API path's credit); (e) the assessor view rendered.
 * V125 (Muster): see compareMusterRun (twin = the API compile with the UI run's own inputs, orchestrator ruling on
 *   LOG-FIN-32 S-B; push set = E4's; a report-only clause for the answers the UI did not send).
 */

export const UI_CONSOLE_SCHEMA_ID = 'ces-tester/ui-e2e-console@1';
export const uiConsoleFile = (surface: string): string => `ui-e2e-${surface}.json`;

export interface Clause {
  readonly pass: boolean;
  readonly detail: string;
}
export type Clauses = Record<string, Clause>;

const ok = (detail: string): Clause => ({ pass: true, detail });
const bad = (detail: string): Clause => ({ pass: false, detail });
const ex = (xs: readonly string[], n = 5): string => `${xs.slice(0, n).join('; ')}${xs.length > n ? ` (+${xs.length - n})` : ''}`;
export const clausesPass = (c: Clauses): boolean => Object.values(c).length > 0 && Object.values(c).every((x) => x.pass);

// ---------------------------------------------------------------------------------------------------------------------
// AO (V123)
// ---------------------------------------------------------------------------------------------------------------------

export interface AoCallLike {
  readonly call: string;
  readonly ok?: boolean;
  readonly mode?: string;
  readonly outcome?: string;
  readonly verdict?: string;
  readonly state_changed?: boolean;
  readonly evidence_persisted?: boolean;
  readonly evidence_row_id?: string;
  /** UI side: the objectives of the evidence row this call wrote (read from the private ces.db). */
  readonly evidence_objectives?: readonly string[];
}
export interface AoOpLike {
  readonly op: string;
  readonly ok: boolean;
  readonly calls: readonly AoCallLike[];
  readonly confirm?: { readonly pass: boolean; readonly actual?: string };
  readonly detail?: string;
}

/** The comparable facts of one AO call. Pure. */
export const aoCallKey = (c: AoCallLike): string =>
  JSON.stringify([c.call, c.mode ?? null, c.outcome ?? null, c.verdict ?? null, c.state_changed ?? null, c.evidence_persisted ?? null]);

/**
 * V123 clauses. `twinObjectives(op, callIndex)` gives the twin row's objectives (verify reads ces.db; the tester passes
 * the twin record's copy when it has one); null = unknown, reported in (d) as not compared.
 */
export function compareAoRun(
  twinOps: readonly AoOpLike[] | null,
  uiOps: readonly AoOpLike[] | null,
  twinObjectives: (op: string, i: number) => readonly string[] | null = () => null,
): Clauses {
  if (!twinOps) return { a_ops: bad('no twin out/adminops-e7a.json') };
  if (!uiOps) return { a_ops: bad('the UI run recorded no ops') };
  const tIds = twinOps.map((o) => o.op);
  const uIds = uiOps.map((o) => o.op);
  const a = tIds.join(',') === uIds.join(',') ? ok(`${tIds.length} op(s) in the twin's order: ${tIds.join(', ') || 'none'}`) : bad(`ops differ: twin [${tIds.join(', ')}], UI [${uIds.join(', ')}]`);
  const bDiff: string[] = [];
  const cDiff: string[] = [];
  const dDiff: string[] = [];
  let dCompared = 0;
  let dUnknown = 0;
  for (let i = 0; i < Math.min(twinOps.length, uiOps.length); i++) {
    const t = twinOps[i], u = uiOps[i];
    if (t.op !== u.op) continue;
    if (t.ok !== u.ok) bDiff.push(`${t.op}: ok twin ${t.ok}, UI ${u.ok}${u.detail ? ` (${u.detail})` : ''}`);
    const tk = t.calls.filter((c) => c.call !== 'approve').map(aoCallKey);
    const uk = u.calls.filter((c) => c.call !== 'approve').map(aoCallKey);
    if (tk.join('|') !== uk.join('|')) bDiff.push(`${t.op}: calls twin ${tk.join(' ')} vs UI ${uk.join(' ')}`);
    const tc = t.confirm, uc = u.confirm;
    if (!!tc !== !!uc || (tc && uc && (tc.pass !== uc.pass || (tc.actual ?? null) !== (uc.actual ?? null)))) cDiff.push(`${t.op}: confirm twin ${tc ? `${tc.pass}/${tc.actual ?? '-'}` : 'none'}, UI ${uc ? `${uc.pass}/${uc.actual ?? '-'}` : 'none'}`);
    u.calls.forEach((c, ci) => {
      if (c.call !== 'apply') return;
      const want = twinObjectives(t.op, ci);
      if (!want) { dUnknown++; return; }
      dCompared++;
      const got = [...(c.evidence_objectives ?? [])].sort();
      if (got.join(',') !== [...want].sort().join(',')) dDiff.push(`${t.op}: objectives twin [${[...want].sort().join(', ')}], UI [${got.join(', ')}]`);
    });
  }
  return {
    a_ops: a,
    b_calls: bDiff.length ? bad(ex(bDiff)) : ok('every op has the twin\'s call sequence, modes, outcomes, verdicts and state changes'),
    c_confirm: cDiff.length ? bad(ex(cDiff)) : ok('every confirming sim read equals the twin\'s'),
    d_objectives: dDiff.length ? bad(ex(dDiff)) : ok(`${dCompared} apply row(s) name the twin's objectives${dUnknown ? `; ${dUnknown} not compared (twin row objectives unknown here; verify reads ces.db)` : ''}`),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// EO (V124)
// ---------------------------------------------------------------------------------------------------------------------

/** control id -> status, from an SSP JSON (controlImplementations[].control_id / status) or a /api/controls body. Pure. */
export function statusMap(source: unknown): Record<string, string> | null {
  const s = source as { controlImplementations?: Array<Record<string, unknown>>; controls?: Array<Record<string, unknown>> } | unknown[] | null;
  const rows = Array.isArray(s) ? s : (s as { controlImplementations?: unknown[] })?.controlImplementations ?? (s as { controls?: unknown[] })?.controls ?? null;
  if (!Array.isArray(rows)) return null;
  const out: Record<string, string> = {};
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = (r.control_id ?? r.controlId ?? r.id) as string | undefined;
    const st = (r.status ?? r.implementationStatus ?? r.implementation_status) as string | undefined;
    if (typeof id === 'string' && typeof st === 'string') out[id] = st;
  }
  return Object.keys(out).length ? out : null;
}

export function statusDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return ids.filter((id) => a[id] !== b[id]).map((id) => `${id} UI ${a[id] ?? 'absent'} / twin ${b[id] ?? 'absent'}`);
}

export interface EoUiFacts {
  /** /api/controls (or the UI snapshot) after the UI assess. */
  readonly assessStatuses: Record<string, string> | null;
  readonly sprs: number | null;
  /** The SSP JSON the UI generated (statusMap source) and the DOCX it downloaded (bytes). */
  readonly sspStatuses: Record<string, string> | null;
  readonly docxBytes: number | null;
  /** The DOCX the console downloaded (its suggested file name; FIN-31's spec records the name, not the bytes). */
  readonly docxName?: string | null;
  readonly upload: { readonly status: number | null; readonly uploader?: string | null; readonly catalog_ids?: readonly string[]; readonly item_id?: string | null } | null;
  readonly review: { readonly status: number | null; readonly control_id?: string | null; readonly reviewer?: string | null; readonly uploader?: string | null; readonly counted?: boolean | null; readonly status_after?: string | null } | null;
  readonly assessor: { readonly rendered: boolean; readonly rows?: number } | null;
}
export interface EoTwinFacts {
  /** The twin's stored snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json), statusMap'd: E7B's assess. */
  readonly snapStatuses: Record<string, string> | null;
  readonly sspStatuses: Record<string, string> | null;
  readonly sprs: number | null;
  readonly docx: boolean;
}

export function compareEoRun(twin: EoTwinFacts, ui: EoUiFacts | null): Clauses {
  if (!ui) return { a_assess: bad('the UI run recorded nothing') };
  const a = !twin.snapStatuses ? bad('no twin stored snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json)')
    : !ui.assessStatuses ? bad('no UI assess statuses')
    : (() => {
      const d = statusDiff(ui.assessStatuses!, twin.snapStatuses!);
      const sprs = ui.sprs === twin.sprs ? '' : `SPRS UI ${ui.sprs ?? 'none'} / twin ${twin.sprs ?? 'none'}`;
      return d.length || sprs ? bad(ex([...(sprs ? [sprs] : []), ...d])) : ok(`${Object.keys(ui.assessStatuses!).length} control statuses and SPRS ${ui.sprs} equal the twin`);
    })();
  const b = !twin.sspStatuses ? bad('no twin out/ssp.json')
    : !ui.sspStatuses ? bad('the UI generated no SSP JSON')
    : (() => {
      const d = statusDiff(ui.sspStatuses!, twin.sspStatuses!);
      if (d.length) return bad(`SSP statuses differ: ${ex(d)}`);
      if (!(ui.docxBytes && ui.docxBytes > 0) && !ui.docxName) return bad('the UI SSP equals the twin but no DOCX was downloaded');
      return ok(`SSP statuses equal the twin (${Object.keys(ui.sspStatuses!).length}); DOCX ${ui.docxName ?? `${ui.docxBytes} bytes`}${twin.docx ? '' : ' (the twin has no DOCX)'}`);
    })();
  const u = ui.upload;
  const c = !u ? bad('no UI upload') : u.status !== 201 && u.status !== 200 ? bad(`the UI upload returned ${u.status ?? 'nothing'}`)
    : !u.uploader ? bad('the UI upload recorded no uploader')
    : ok(`item ${u.item_id ?? '?'} by ${u.uploader}${(u.catalog_ids ?? []).length ? `, catalog ${(u.catalog_ids ?? []).join(', ')}` : ' (catalog ids: not entered on screen; V112 judges them on the API path)'}`);
  const r = ui.review;
  const want = r?.control_id ? twin.sspStatuses?.[r.control_id] : undefined;
  const d = !r ? bad('no UI review') : r.status !== 201 && r.status !== 200 ? bad(`the UI review returned ${r.status ?? 'nothing'}`)
    : !r.reviewer || r.reviewer === r.uploader ? bad(`reviewer ${r.reviewer ?? 'unknown'} is the uploader (GD-b)`)
    : r.counted !== true ? bad('the UI review was not counted under GD-b')
    : want === undefined ? bad(`the twin has no status for ${r.control_id ?? 'the reviewed control'}`)
    : r.status_after !== want ? bad(`${r.control_id}: after the UI review ${r.status_after ?? 'none'}, the twin (API path) ${want}`)
    : ok(`${r.control_id} ${want} after the UI review, as the API path; reviewer != uploader`);
  const e = !ui.assessor ? bad('the assessor view was not opened') : ui.assessor.rendered ? ok(`assessor view rendered${ui.assessor.rows !== undefined ? ` (${ui.assessor.rows} rows)` : ''}`) : bad('the assessor view did not render');
  return { a_assess: a, b_ssp_docx: b, c_upload: c, d_review: d, e_assessor: e };
}

// ---------------------------------------------------------------------------------------------------------------------
// Muster (V125)
// ---------------------------------------------------------------------------------------------------------------------

/** The `-<ISO ts>` / `-<ts>` suffix of a pushed or compiled file name, normalised. Pure. */
export const normaliseFileName = (n: string): string => n.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<ts>');

export function comparePushSets(twinPushed: readonly string[] | null, uiPushed: readonly string[] | null): Clause {
  if (!twinPushed) return bad('no twin out/push-response.json pushed list');
  if (!uiPushed) return bad('the UI push recorded no pushed list');
  const t = [...twinPushed].map(normaliseFileName).sort();
  const u = [...uiPushed].map(normaliseFileName).sort();
  return t.join(',') === u.join(',') ? ok(`push file set equals E4 (${t.length}: ${t.join(', ')})`) : bad(`push file set differs: only E4 [${t.filter((x) => !u.includes(x)).join(', ')}], only UI [${u.filter((x) => !t.includes(x)).join(', ')}]`);
}

/** ces-muster e2e/flow7-muster-ui.spec.ts's run record (`<out>/flow7-run.json`, schema muster-flow7/run@1, FIN-32). */
export interface Flow7RunLike {
  readonly typed?: readonly string[];
  readonly kept_discovery?: readonly string[];
  readonly not_shown?: readonly string[];
  readonly defaulted?: readonly string[];
  readonly boundary?: ReadonlyArray<{ readonly question_id: string; readonly decision: string }>;
  readonly pushed?: string | null;
}

/** The spec records the pushed files as the screen's comma list. Pure. */
export const pushedList = (s: string | null | undefined): string[] | null => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);

/**
 * V125 clauses (orchestrator ruling on LOG-FIN-32 S-B: proposal (a) plus a report clause (b)).
 *  (a) a_plan: the files the UI pushed equal the API compile run with the UI run's own inputs (the answers the UI sent,
 *      `downloads/interview-answers-<slug>.json`; the same org content; default stacks), modulo run-variant values (the
 *      V88 projection). `planCompare` is verify's (verify-gap.mjs v88ComparePlans shape); the tester leaves it null.
 *  b_push_set: the UI push file set equals E4's.
 *  c_typed: the spec typed answers (and pushed).
 *  d_boundary: the boundary decisions were made on screen; the UI MP's CUI Boundary hash equals the API compile's.
 *  e_not_sent (report only, never fails): the answers-file rows the UI did not send (the 15 PI.ODP.001-015 rows, the
 *      stale CUI prompts' rows when not shown) and the defaulted answers. A follow-up adds PI.ODP.001-015 as questions.
 */
export function compareMusterRun(i: {
  planCompare: { compared: number; onlyApi: string[]; onlyScript: string[]; differing: Array<{ name: string; where: string }> } | null;
  twinPushed: readonly string[] | null;
  uiPushed: readonly string[] | null;
  run: Flow7RunLike | null;
  notSent: readonly string[] | null;
  boundary: { readonly ui_hash?: string | null; readonly api_hash?: string | null } | null;
}): Clauses {
  const p = i.planCompare;
  const a = !p ? bad('no UI-pushed files and API compile files to compare')
    : p.onlyApi.length || p.onlyScript.length || p.differing.length ? bad(`UI-pushed plan differs from the API compile with the UI's inputs: ${ex([...p.onlyApi.map((x) => `only UI ${x}`), ...p.onlyScript.map((x) => `only API ${x}`), ...p.differing.map((x) => `${x.name} at ${x.where}`)])}`)
    : ok(`${p.compared} pushed file(s) equal the API compile with the UI's inputs modulo run-variant values`);
  const r = i.run;
  const c = !r ? bad('no flow7-run.json (the FLOW-7 spec did not finish)') : !(r.typed ?? []).length ? bad('the spec typed no answer')
    : ok(`${(r.typed ?? []).length} typed, ${(r.kept_discovery ?? []).length} kept from discovery, ${(r.not_shown ?? []).length} not shown, ${(r.defaulted ?? []).length} defaulted`);
  const bd = i.boundary;
  const d = !r ? bad('no flow7-run.json') : !bd ? bad('no boundary facts')
    : (bd.api_hash ?? null) !== (bd.ui_hash ?? null) ? bad(`CUI Boundary hash UI ${bd.ui_hash ?? 'none'} / API compile ${bd.api_hash ?? 'none'}`)
    : ok(`${(r.boundary ?? []).length} boundary decision(s) on screen${bd.ui_hash ? `; CUI Boundary ${bd.ui_hash.slice(0, 12)}… = API compile` : '; no CUI Boundary on either side'}`);
  const ns = i.notSent ?? [];
  const e = ok(`report only: ${ns.length} answers-file row(s) the UI did not send${ns.length ? ` (${ex([...ns], 20)})` : ''}; ${(r?.defaulted ?? []).length} defaulted${(r?.defaulted ?? []).length ? ` (${ex([...(r?.defaulted ?? [])], 10)})` : ''}`);
  return { a_plan: a, b_push_set: comparePushSets(i.twinPushed, i.uiPushed), c_typed: c, d_boundary: d, e_not_sent: e };
}

// ---------------------------------------------------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------------------------------------------------

export interface ConsoleVariantRecord {
  readonly variant: string;
  readonly base_path: string;
  readonly ran: boolean;
  readonly reason?: string;
  readonly error?: string;
  readonly pass: boolean;
  readonly headed?: boolean;
  readonly clauses?: Clauses;
  /** Surface facts the clauses were computed from (verify recomputes from these and the files). */
  readonly facts?: Record<string, unknown>;
  /** Paths relative to <WS>/out (forward slashes). */
  readonly files?: Record<string, string | undefined>;
  readonly window?: { started: string; ended: string };
}

export interface ConsoleRecord {
  readonly schema: typeof UI_CONSOLE_SCHEMA_ID;
  readonly scenario_id: string;
  readonly slug: string;
  readonly surface: string;
  readonly step_id: string;
  readonly started: string;
  readonly ended: string;
  readonly headed: boolean;
  readonly twin: Record<string, unknown>;
  readonly variants: ConsoleVariantRecord[];
  readonly pass: boolean;
}

/**
 * The record passes when at least one variant ran and every variant that ran passed. A variant not run because its
 * console is not built (`not built`) does not fail the record; any other not-run reason does.
 */
export function consoleRecordPass(variants: readonly ConsoleVariantRecord[]): boolean {
  const ran = variants.filter((v) => v.ran);
  if (!ran.length) return false;
  return ran.every((v) => v.pass) && variants.filter((v) => !v.ran).every((v) => /not built/i.test(v.reason ?? ''));
}
