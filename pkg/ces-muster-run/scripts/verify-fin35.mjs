// FIN-35 (finishing plan PH-3 harness): V123 (watched AO UI run = twin), V124 (watched EO UI run = twin) and V125
// (watched Muster UI run = twin). FINISH-PLAN.md §1.3. The tester's runner (ces-tester src/flow/ui-console-run.ts)
// writes out/ui-e2e-<surface>.json with each variant's facts and files under out/ui/<surface>/<variant>/; these judges
// reload the twin's files and the UI's files, recompute the clauses the tester computed (ui-console-compare.ts), and
// cross-check the tester's pass flag, as V73 does for Stamper. Pure judges; runFin35Checks(vctx) never throws.
//
// Scope (FINISH-PLAN.md §1.2): V123 on S1, S2, S3 (mp has no E7A ops); V124 and V125 on all four.
// A variant not run because its console is not built is reported, and the record still needs one variant that ran.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FIN35_SCHEMA = 'ces-tester/ui-e2e-console@1';
export const FIN35_FILES = { ao: 'ui-e2e-ao.json', eo: 'ui-e2e-eo.json', muster: 'ui-e2e-muster.json' };
export const V123_SCENARIOS = ['s1-mach', 's2-eng', 's3-def'];
// mp (muster-partial) has no GD-b reviewer (document-reviews.json reviewer null) and no interview-answers.json: the EO
// review clause and FLOW-7's typed answers cannot exist there, so V124 and V125 cover S1-S3 and mp reports out of scope.
export const V124_SCENARIOS = ['s1-mach', 's2-eng', 's3-def'];
export const V125_SCENARIOS = ['s1-mach', 's2-eng', 's3-def'];

const ex = (xs, n = 5) => `${xs.slice(0, n).join('; ')}${xs.length > n ? ` (+${xs.length - n})` : ''}`;
const okC = (detail) => ({ pass: true, detail });
const badC = (detail) => ({ pass: false, detail });
const clausesPass = (c) => Object.values(c).length > 0 && Object.values(c).every((x) => x.pass);

/** Shared record gate: present, fresh, this scenario's, one variant ran; not-built variants noted. */
export function recordGate({ record, stale = null, slug, file }) {
  if (!record) return { stop: `no out/${file} (the watched UI step did not run)` };
  if (record.schema !== FIN35_SCHEMA) return { stop: `out/${file}: schema ${record.schema ?? 'none'}` };
  if (stale) return { stop: stale };
  if (record.slug !== slug) return { stop: `out/${file} is for ${record.slug}, not ${slug}` };
  const variants = record.variants ?? [];
  const notes = variants.filter((v) => !v.ran && /not built/i.test(v.reason ?? '')).map((v) => `${v.variant} not run (${v.reason})`);
  const notRun = variants.filter((v) => !v.ran && !/not built/i.test(v.reason ?? '')).map((v) => `${v.variant} not run: ${v.reason ?? 'no reason'}`);
  if (!variants.some((v) => v.ran)) return { stop: `no variant ran${notRun.length || notes.length ? `: ${[...notRun, ...notes].join('; ')}` : ''}` };
  return { variants: variants.filter((v) => v.ran), notRun, notes };
}

function finish(gate, perVariant) {
  const problems = [...gate.notRun], notes = [...gate.notes];
  for (const v of gate.variants) {
    if (v.error) { problems.push(`${v.variant}: the UI run failed: ${v.error}`); continue; }
    const c = perVariant(v);
    const recomputed = clausesPass(c);
    const fails = Object.entries(c).filter(([, x]) => !x.pass).map(([k, x]) => `(${k}) ${x.detail}`);
    if (recomputed !== !!v.pass) fails.push(`the tester's record says ${v.pass ? 'equal' : 'differs'}, verify recomputed ${recomputed ? 'equal' : 'differs'}`);
    if (fails.length) problems.push(`${v.variant}: ${fails.join('; ')}`);
    else notes.push(`${v.variant}${v.headed ? ' (headed)' : ' (headless)'} = twin: ${Object.values(c).map((x) => x.detail).join('; ')}`);
    for (const k of ['video', 'trace']) if (!v.files?.[k]) notes.push(`${v.variant}: no ${k} recorded`);
  }
  return { pass: problems.length === 0, detail: problems.length ? ex(problems, 8) : notes.join('; ') };
}

// ---------------------------------------------------------------------------------------------------------------------
// V123 (AO)
// ---------------------------------------------------------------------------------------------------------------------

export const aoCallKey = (c) => JSON.stringify([c.call, c.mode ?? null, c.outcome ?? null, c.verdict ?? null, c.state_changed ?? null, c.evidence_persisted ?? null]);

/** Mirrors ces-tester ui-console-compare.ts compareAoRun. twinObjectives(op, i) -> string[] | null. */
export function compareAo(twinOps, uiOps, twinObjectives = () => null) {
  if (!twinOps) return { a_ops: badC('no twin out/adminops-e7a.json') };
  if (!uiOps) return { a_ops: badC('the UI run recorded no ops') };
  const tIds = twinOps.map((o) => o.op), uIds = uiOps.map((o) => o.op);
  const a = tIds.join(',') === uIds.join(',') ? okC(`${tIds.length} op(s) in the twin's order: ${tIds.join(', ') || 'none'}`) : badC(`ops differ: twin [${tIds.join(', ')}], UI [${uIds.join(', ')}]`);
  const b = [], c = [], d = [];
  let dc = 0, du = 0;
  for (let i = 0; i < Math.min(twinOps.length, uiOps.length); i++) {
    const t = twinOps[i], u = uiOps[i];
    if (t.op !== u.op) continue;
    if (t.ok !== u.ok) b.push(`${t.op}: ok twin ${t.ok}, UI ${u.ok}${u.detail ? ` (${u.detail})` : ''}`);
    const tk = (t.calls ?? []).filter((x) => x.call !== 'approve').map(aoCallKey), uk = (u.calls ?? []).filter((x) => x.call !== 'approve').map(aoCallKey);
    if (tk.join('|') !== uk.join('|')) b.push(`${t.op}: calls twin ${tk.join(' ')} vs UI ${uk.join(' ')}`);
    const tc = t.confirm, uc = u.confirm;
    if (!!tc !== !!uc || (tc && uc && (tc.pass !== uc.pass || (tc.actual ?? null) !== (uc.actual ?? null)))) c.push(`${t.op}: confirm twin ${tc ? `${tc.pass}/${tc.actual ?? '-'}` : 'none'}, UI ${uc ? `${uc.pass}/${uc.actual ?? '-'}` : 'none'}`);
    (u.calls ?? []).forEach((x, ci) => {
      if (x.call !== 'apply') return;
      const want = twinObjectives(t.op, ci);
      if (!want) { du++; return; }
      dc++;
      const got = [...(x.evidence_objectives ?? [])].sort();
      if (got.join(',') !== [...want].sort().join(',')) d.push(`${t.op}: objectives twin [${[...want].sort().join(', ')}], UI [${got.join(', ')}]`);
    });
  }
  return {
    a_ops: a,
    b_calls: b.length ? badC(ex(b)) : okC("every op has the twin's call sequence, modes, outcomes, verdicts and state changes"),
    c_confirm: c.length ? badC(ex(c)) : okC("every confirming sim read equals the twin's"),
    d_objectives: d.length ? badC(ex(d)) : okC(`${dc} apply row(s) name the twin's objectives${du ? `; ${du} not compared (twin row objectives unknown here; verify reads ces.db)` : ''}`),
  };
}

export function judgeV123({ slug, record = null, stale = null, e7a = null, twinRowObjectives = () => null, error = null }) {
  if (!V123_SCENARIOS.includes(slug)) return { pass: true, detail: `not in V123's scope (${slug}: no E7A ops; V123 covers ${V123_SCENARIOS.join(', ')})` };
  if (error) return { pass: false, detail: `V123 inputs failed to load: ${error}` };
  const g = recordGate({ record, stale, slug, file: FIN35_FILES.ao });
  if (g.stop) return { pass: false, detail: g.stop };
  // The twin row's objectives, by the twin call at the same position (ops and calls compared in order).
  const tObj = (op, ci) => {
    const t = (e7a?.ops ?? []).find((o) => o.op === op);
    const row = t?.calls?.[ci]?.evidence_row_id;
    const objs = row ? twinRowObjectives(row) : null;
    return Array.isArray(objs) ? objs : null;
  };
  return finish(g, (v) => compareAo(e7a?.ops ?? null, v.facts?.ops ?? null, tObj));
}

// ---------------------------------------------------------------------------------------------------------------------
// V124 (EO)
// ---------------------------------------------------------------------------------------------------------------------

export function statusMap(source) {
  const rows = Array.isArray(source) ? source : source?.controlImplementations ?? source?.controls ?? null;
  if (!Array.isArray(rows)) return null;
  const out = {};
  for (const r of rows) {
    const id = r?.control_id ?? r?.controlId ?? r?.id;
    const st = r?.status ?? r?.implementationStatus ?? r?.implementation_status;
    if (typeof id === 'string' && typeof st === 'string') out[id] = st;
  }
  return Object.keys(out).length ? out : null;
}
const statusDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((id) => a[id] !== b[id]).map((id) => `${id} UI ${a[id] ?? 'absent'} / twin ${b[id] ?? 'absent'}`);

/** Mirrors ces-tester compareEoRun. ui: the variant's facts with sspStatuses recomputed from its SSP file. */
export function compareEo(twin, ui) {
  if (!ui) return { a_assess: badC('the UI run recorded nothing') };
  const a = !twin.snapStatuses ? badC('no twin stored snapshot (out/eo-package/<latest>/assessments/latest-snapshot.json)') : !ui.assessStatuses ? badC('no UI assess statuses') : (() => {
    const d = statusDiff(ui.assessStatuses, twin.snapStatuses);
    const s = ui.sprs === twin.sprs ? '' : `SPRS UI ${ui.sprs ?? 'none'} / twin ${twin.sprs ?? 'none'}`;
    return d.length || s ? badC(ex([...(s ? [s] : []), ...d])) : okC(`${Object.keys(ui.assessStatuses).length} control statuses and SPRS ${ui.sprs} equal the twin`);
  })();
  const b = !twin.sspStatuses ? badC('no twin out/ssp.json') : !ui.sspStatuses ? badC('the UI generated no SSP JSON') : (() => {
    const d = statusDiff(ui.sspStatuses, twin.sspStatuses);
    if (d.length) return badC(`SSP statuses differ: ${ex(d)}`);
    if (!(ui.docxBytes > 0) && !ui.docxName) return badC('the UI SSP equals the twin but no DOCX was downloaded');
    return okC(`SSP statuses equal the twin (${Object.keys(ui.sspStatuses).length}); DOCX ${ui.docxName ?? `${ui.docxBytes} bytes`}${twin.docx ? '' : ' (the twin has no DOCX)'}`);
  })();
  const u = ui.upload;
  const c = !u ? badC('no UI upload') : u.status !== 201 && u.status !== 200 ? badC(`the UI upload returned ${u.status ?? 'nothing'}`)
    : !u.uploader ? badC('the UI upload recorded no uploader')
    : okC(`item ${u.item_id ?? '?'} by ${u.uploader}${(u.catalog_ids ?? []).length ? `, catalog ${(u.catalog_ids ?? []).join(', ')}` : ' (catalog ids: not entered on screen; V112 judges them on the API path)'}`);
  const r = ui.review;
  const want = r?.control_id ? twin.sspStatuses?.[r.control_id] : undefined;
  const d = !r ? badC('no UI review') : r.status !== 201 && r.status !== 200 ? badC(`the UI review returned ${r.status ?? 'nothing'}`)
    : !r.reviewer || r.reviewer === r.uploader ? badC(`reviewer ${r.reviewer ?? 'unknown'} is the uploader (GD-b)`)
    : r.counted !== true ? badC('the UI review was not counted under GD-b')
    : want === undefined ? badC(`the twin has no status for ${r.control_id ?? 'the reviewed control'}`)
    : r.status_after !== want ? badC(`${r.control_id}: after the UI review ${r.status_after ?? 'none'}, the twin (API path) ${want}`)
    : okC(`${r.control_id} ${want} after the UI review, as the API path; reviewer != uploader`);
  const e = !ui.assessor ? badC('the assessor view was not opened') : ui.assessor.rendered ? okC(`assessor view rendered${ui.assessor.rows !== undefined ? ` (${ui.assessor.rows} rows)` : ''}`) : badC('the assessor view did not render');
  return { a_assess: a, b_ssp_docx: b, c_upload: c, d_review: d, e_assessor: e };
}

export function judgeV124({ slug, record = null, stale = null, twin = {}, readUiFile = () => null, fileSize = () => null, error = null }) {
  if (!V124_SCENARIOS.includes(slug)) return { pass: true, detail: `not in V124's scope (${slug}: no GD-b reviewer in the customer file; V124 covers ${V124_SCENARIOS.join(', ')})` };
  if (error) return { pass: false, detail: `V124 inputs failed to load: ${error}` };
  const g = recordGate({ record, stale, slug, file: FIN35_FILES.eo });
  if (g.stop) return { pass: false, detail: g.stop };
  return finish(g, (v) => {
    const f = v.facts ?? null;
    if (!f) return compareEo(twin, null);
    // Recompute from the files where the record names them (the SSP JSON and the DOCX), else the recorded facts.
    const sspFile = v.files?.ssp_json ? readUiFile(v.files.ssp_json) : null;
    const docx = v.files?.ssp_docx ? fileSize(v.files.ssp_docx) : null;
    return compareEo(twin, { ...f, sspStatuses: sspFile ? statusMap(sspFile) : f.sspStatuses ?? null, docxBytes: docx ?? f.docxBytes ?? null });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// V125 (Muster)
// ---------------------------------------------------------------------------------------------------------------------

export const normaliseFileName = (n) => String(n).replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<ts>');

export function comparePushSets(twinPushed, uiPushed) {
  if (!twinPushed) return badC('no twin out/push-response.json pushed list');
  if (!uiPushed) return badC('the UI push recorded no pushed list');
  const t = [...twinPushed].map(normaliseFileName).sort(), u = [...uiPushed].map(normaliseFileName).sort();
  return t.join(',') === u.join(',') ? okC(`push file set equals E4 (${t.length}: ${t.join(', ')})`) : badC(`push file set differs: only E4 [${t.filter((x) => !u.includes(x)).join(', ')}], only UI [${u.filter((x) => !t.includes(x)).join(', ')}]`);
}

/** The spec records the pushed files as the screen's comma list. */
export const pushedList = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : null);

/**
 * Mirrors ces-tester ui-console-compare.ts compareMusterRun (orchestrator ruling on LOG-FIN-32 S-B: proposal (a) plus
 * the report-only clause (b)). planCompare: the UI-pushed files against the API compile run with the UI run's own inputs.
 */
export function compareMuster({ planCompare = null, twinPushed = null, uiPushed = null, run = null, notSent = null, boundary = null }) {
  const p = planCompare;
  const a = !p ? badC('no UI-pushed files and API compile files to compare')
    : p.onlyApi.length || p.onlyScript.length || p.differing.length ? badC(`UI-pushed plan differs from the API compile with the UI's inputs: ${ex([...p.onlyApi.map((x) => `only UI ${x}`), ...p.onlyScript.map((x) => `only API ${x}`), ...p.differing.map((x) => `${x.name} at ${x.where}`)])}`)
    : okC(`${p.compared} pushed file(s) equal the API compile with the UI's inputs modulo run-variant values`);
  const r = run;
  const c = !r ? badC('no flow7-run.json (the FLOW-7 spec did not finish)') : !(r.typed ?? []).length ? badC('the spec typed no answer')
    : okC(`${(r.typed ?? []).length} typed, ${(r.kept_discovery ?? []).length} kept from discovery, ${(r.not_shown ?? []).length} not shown, ${(r.defaulted ?? []).length} defaulted`);
  const bd = boundary;
  const d = !r ? badC('no flow7-run.json') : !bd ? badC('no boundary facts')
    : (bd.api_hash ?? null) !== (bd.ui_hash ?? null) ? badC(`CUI Boundary hash UI ${bd.ui_hash ?? 'none'} / API compile ${bd.api_hash ?? 'none'}`)
    : okC(`${(r.boundary ?? []).length} boundary decision(s) on screen${bd.ui_hash ? `; CUI Boundary ${String(bd.ui_hash).slice(0, 12)}… = API compile` : '; no CUI Boundary on either side'}`);
  const ns = notSent ?? [];
  const e = okC(`report only: ${ns.length} answers-file row(s) the UI did not send${ns.length ? ` (${ex([...ns], 20)})` : ''}; ${(r?.defaulted ?? []).length} defaulted${(r?.defaulted ?? []).length ? ` (${ex([...(r?.defaulted ?? [])], 10)})` : ''}`);
  return { a_plan: a, b_push_set: comparePushSets(twinPushed, uiPushed), c_typed: c, d_boundary: d, e_not_sent: e };
}

/** The answers-file rows absent from what the UI sent (by question id). Pure. */
export function answersNotSent(fileRows, sentRows) {
  const sent = new Set((Array.isArray(sentRows) ? sentRows : sentRows?.answers ?? []).map((r) => r.question_id));
  return (Array.isArray(fileRows) ? fileRows : fileRows?.answers ?? []).map((r) => r.question_id).filter((id) => !sent.has(id));
}

/**
 * V125. Per variant the record names files.ui_plans (the private plans folder the UI push wrote), files.api_plan (the
 * API compile with the UI's inputs), files.flow7 (the spec's run record), files.answers_sent (the answers the UI sent);
 * readers are injected: readUi(rel) -> JSON | null, planCompareOf(variant) -> v88 comparison | null,
 * hashOf(variant, side) -> MP inputs.cui_boundary_ref.hash_sha256 | null. answersFile: the customer's answers file.
 */
export function judgeV125({ slug, record = null, stale = null, twinPushed = null, answersFile = null, readUi = () => null, planCompareOf = () => null, hashOf = () => null, error = null }) {
  if (!V125_SCENARIOS.includes(slug)) return { pass: true, detail: `not in V125's scope (${slug}: no interview-answers.json to type; V125 covers ${V125_SCENARIOS.join(', ')})` };
  if (error) return { pass: false, detail: `V125 inputs failed to load: ${error}` };
  const g = recordGate({ record, stale, slug, file: FIN35_FILES.muster });
  if (g.stop) return { pass: false, detail: g.stop };
  return finish(g, (v) => {
    const run = v.files?.flow7 ? readUi(v.files.flow7) : null;
    const sent = v.files?.answers_sent ? readUi(v.files.answers_sent) : null;
    return compareMuster({
      planCompare: planCompareOf(v),
      twinPushed,
      uiPushed: pushedList(run?.pushed) ?? v.facts?.pushed ?? null,
      run,
      notSent: answersFile && sent ? answersNotSent(answersFile, sent) : v.facts?.not_sent ?? null,
      boundary: { ui_hash: hashOf(v, 'ui'), api_hash: hashOf(v, 'api') },
    });
  });
}


// ---------------------------------------------------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------------------------------------------------

/**
 * vctx (verify.mjs): out, slug, readJson, exists, staleOf, ssp, summary, plansDir, aoRow(id) (the ces.db adminops
 * row), exePlan. Never throws: a failing loader gives a red row with the error.
 */
export async function runFin35Checks(vctx) {
  const { out, slug } = vctx;
  const rd = (f) => (vctx.exists(f) ? vctx.readJson(f) : null);
  const uiAbs = (rel) => path.join(out, ...String(rel).split('/'));
  const rows = [];
  const safe = (id, title, fn) => {
    try { rows.push({ id, title, ...fn() }); } catch (e) { rows.push({ id, title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` }); }
  };
  safe('V123', 'Watched AO UI run (S1, S2, S3) equals the twin\'s out/adminops-e7a.json: the same ops, calls, outcomes and state changes, the same confirming reads, apply rows naming the same objectives', () => {
    const f = path.join(out, FIN35_FILES.ao);
    return judgeV123({ slug, record: rd(f), stale: vctx.staleOf(f), e7a: rd(path.join(out, 'adminops-e7a.json')), twinRowObjectives: (id) => vctx.aoRow?.(id)?.evidenceObjectives ?? null });
  });
  safe('V124', 'Watched EO UI run equals the twin: assess statuses and SPRS, SSP JSON and DOCX, an upload through the UI with its uploader and catalog ids, a UI review (reviewer != uploader) that leaves its control at the API path\'s status, the assessor view', () => {
    const f = path.join(out, FIN35_FILES.eo);
    const twin = {
      snapStatuses: statusMap(vctx.snapshot),
      sspStatuses: statusMap(vctx.ssp),
      sprs: vctx.summary?.eo_assess?.sprs_score ?? vctx.summary?.sprs ?? null,
      docx: vctx.exists(path.join(out, 'ssp.docx')),
    };
    return judgeV124({
      slug, record: rd(f), stale: vctx.staleOf(f), twin,
      readUiFile: (rel) => rd(uiAbs(rel)),
      fileSize: (rel) => { try { return fs.statSync(uiAbs(rel)).size; } catch { return null; } },
    });
  });
  const gapmod = await import('./verify-gap.mjs');
  const { docxText } = await import('./scorecard.mjs');
  const recM = rd(path.join(out, FIN35_FILES.muster));
  const compares = new Map();
  const v125Key = (f) => gapmod.v88Normalize(f.name);
  for (const v of recM?.variants ?? []) {
    if (!v.ran || !v.files?.ui_plans || !v.files?.api_plan) continue;
    const ui = await gapmod.v88ReadPlanDir(uiAbs(v.files.ui_plans), docxText);
    const api = await gapmod.v88ReadPlanDir(uiAbs(v.files.api_plan), docxText);
    // Only the files the UI pushed are compared: the API compile folder also holds reports, policies and the trace.
    const want = new Set((ui ?? []).map(v125Key));
    compares.set(v.variant, ui && api ? gapmod.v88ComparePlans(ui, api.filter((f) => want.has(v125Key(f)))) : null);
  }
  const mpHash = (dir) => {
    if (!dir || !fs.existsSync(dir)) return null;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const f = walk(dir).filter((x) => path.basename(x).startsWith('manual-mission-plan-') && x.endsWith('.json')).sort().pop();
    return f ? rd(f)?.inputs?.cui_boundary_ref?.hash_sha256 ?? null : null;
  };
  safe('V125', 'Watched Muster UI run (FLOW-7): answers typed, discovery, boundary, compile and push through the UI; the pushed plan equals the API compile run with the UI\'s own inputs (V88 projection), the push file set equals E4, and the answers the UI did not send are reported', () => {
    const f = path.join(out, FIN35_FILES.muster);
    const push = rd(path.join(out, 'push-response.json'));
    const answersFile = vctx.pkg ? rd(path.join(vctx.pkg, 'customers', slug, 'interview-answers.json')) : null;
    return judgeV125({
      slug, record: recM, stale: vctx.staleOf(f), twinPushed: push?.pushed ?? null, answersFile,
      readUi: (rel) => rd(uiAbs(rel)),
      planCompareOf: (v) => compares.get(v.variant) ?? null,
      hashOf: (v, side) => mpHash(side === 'ui' ? (v.files?.ui_plans ? uiAbs(v.files.ui_plans) : null) : (v.files?.api_plan ? uiAbs(v.files.api_plan) : null)),
    });
  });
  return rows;
}
