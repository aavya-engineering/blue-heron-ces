// FIN-29 (Blue Heron Defense, CES team; finishing plan PH-2 harness): the hub for the PH-2 checks (FINISH-PLAN.md §1.3).
// verify.mjs builds one context object (vctx, below) and calls runFin29Checks(vctx) once; this hub calls each area
// module's checks and returns the rows verify.mjs appends. Area modules (each exports one async function taking vctx and
// returning [{ id, title, pass, detail }]):
//   verify-fin29-stamper.mjs   fin29StamperChecks   V115 (E8G), V116 (E8T), V117 (E0), V126 (E8R)
//   verify-fin29-ao.mjs        fin29AoChecks        V77 (E7S), V127 (E9A)
//   verify-fin29-eo-muster.mjs fin29EoMusterChecks  V89, V119, V120, V121, V128, V129, V130
//   this file                  fin29HubChecks       V101 (SP-11 leak scan), V122 (Planner retired, FIN-28)
// A module that is missing or throws yields one red row per check it owns, with the reason, so a broken module never
// hides a check.
//
// vctx (built by verify.mjs; every field may be null when its source is absent):
//   root, out, ces, pkg (the run package root), slug, harness ('mx' | 'tester'), steps (steps.json),
//   plansDir (pl/Stamper/plan-data/<slug>/plans), tenantPlanData (pl/Stamper/plan-data/<slug>),
//   readJson(file), exists(file), staleOf(file) -> reason | null, freshJson(file) -> json | null (null when stale or absent),
//   listFiles(dir) -> absolute file paths (recursive),
//   ssp (out/ssp.json), summary (verify's structural summary: status_by_control, sprs ...), baseline (expected summary),
//   snapshot (the EO package's latest-snapshot.json), docxText (the SSP DOCX text),
//   db() -> a read-only better-sqlite3 handle on pl/ces.db or null, dbRows(collection, tenantSlug?) -> parsed data[] | null,
//   objectivesRef (ces-shared assessment-objectives.reference.json), sprsWeights (Map control -> weight) | null.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The checks each area module owns (a missing module reports each as red). */
export const FIN29_AREAS = [
  { file: 'verify-fin29-stamper.mjs', fn: 'fin29StamperChecks', ids: ['V115', 'V116', 'V117', 'V126'] },
  { file: 'verify-fin29-ao.mjs', fn: 'fin29AoChecks', ids: ['V77', 'V127'] },
  { file: 'verify-fin29-eo-muster.mjs', fn: 'fin29EoMusterChecks', ids: ['V89', 'V119', 'V120', 'V121', 'V128', 'V129', 'V130'] },
  // PH-13 P13-LV: the AdminOps leaver flow (step EL, out/leaver-flow.json).
  { file: 'verify-fin31-leaver.mjs', fn: 'fin31LeaverChecks', ids: ['V131'] },
];

// ---------- V101 (SP-11): the run-secret leak scan ----------
// The tester scans out/, the EO evidence store, the EC store and Stamper's evidence at the end of the run, while the run's
// secrets are still in memory, and writes counts only (ces-tester src/flow/fin29-hygiene.ts, out/secret-scan.json).
export const SECRET_SCAN_SCHEMA = 'ces-tester/secret-scan@1';
// The run secrets a tester run always holds (fin29-hygiene.ts registers these names; a scan without them is incomplete).
export const V101_REQUIRED_SECRETS = ['ec_secret', 'ao_principal_secret', 'ec_principal_secret', 'eo_approver_secret', 'eo_operator_secret', 'muster_jwt_secret', 'muster_token', 'eo_auth_token'];

// scan: out/secret-scan.json (or null); stale: staleOf(file) or null; steps: steps.json; harness: 'mx' | 'tester'.
export function judgeV101({ scan = null, stale = null, steps = {}, harness = 'tester' }) {
  if (harness !== 'tester') return { pass: true, detail: 'not run here: the leak scan is the tester\'s (mx-e2e.ps1 -Harness tester); this run used the mx harness' };
  if (!scan) return { pass: false, detail: 'no out/secret-scan.json (the tester\'s end-of-run leak scan did not run)' };
  if (stale) return { pass: false, detail: stale };
  const problems = [];
  if (scan.schema !== SECRET_SCAN_SCHEMA) problems.push(`schema ${scan.schema}`);
  const e1 = steps?.E1?.started;
  if (e1 && !(Date.parse(scan.taken) >= Date.parse(e1))) problems.push(`scan taken ${scan.taken} before this run's E1 start ${e1}`);
  const secrets = Array.isArray(scan.secrets) ? scan.secrets : [];
  // The record never carries a value: only a name, a length and counts.
  const leakedShape = secrets.filter((s) => Object.keys(s).some((k) => !['name', 'length', 'hits', 'files_with_hits', 'encodings'].includes(k)));
  if (leakedShape.length) problems.push(`secret rows carry unexpected fields (${leakedShape.map((s) => s.name).join(', ')}); the record may hold counts only`);
  const names = new Set(secrets.map((s) => s.name));
  const missing = V101_REQUIRED_SECRETS.filter((n) => !names.has(n));
  if (missing.length) problems.push(`secrets not scanned: ${missing.join(', ')}`);
  const short = secrets.filter((s) => !(Number(s.length) >= 16));
  if (short.length) problems.push(`secrets too short to scan reliably (< 16 chars): ${short.map((s) => s.name).join(', ')}`);
  const hits = secrets.filter((s) => Number(s.hits) > 0);
  if (hits.length) problems.push(`LEAK: ${hits.map((s) => `${s.name} ${s.hits} hit(s) in ${s.files_with_hits} file(s)`).join('; ')} (files: ${(scan.hit_files ?? []).slice(0, 5).join(', ')})`);
  const roots = Array.isArray(scan.roots) ? scan.roots : [];
  const want = ['out', 'eo-evidence-store', 'ec-store', 'stamper-evidence'];
  const rootNames = new Set(roots.map((r) => r.name));
  const missRoots = want.filter((r) => !rootNames.has(r));
  if (missRoots.length) problems.push(`roots not scanned: ${missRoots.join(', ')}`);
  const files = roots.reduce((n, r) => n + (Number(r.files) || 0), 0);
  if (files === 0) problems.push('0 files scanned');
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `${secrets.length} run secret(s) (each as raw, base64 and URL-encoded text) over ${files} file(s) in ${roots.map((r) => `${r.name} ${r.files}`).join(', ')}: 0 hits` };
}

// ---------- V122 (FIN-28, Planner retired): clauses (a), (b) and (c) (GD-e, FIN-28 S-1, landed with FIN-35) ----------
// plannerDirExists: <ces>/ces-planner exists; rootPkg: <ces>/package.json; unitGate: out/unit-gate.json.
// (c) plansFiles: Stamper's plans folder listing (null = no folder); intake: verify-w4.mjs readEoIntake() for the tenant
// (null = none). Wants no si-baseline-, tcp- or readiness-posture- file in the plans folder, and EO's newest intake receipt
// naming all six hand-off kinds (the TCP only when the MP references one: tcpExpected). When gdE is false (not passed)
// clause (c) is reported "not judged" as before.
export const V122_EO_ONLY_PREFIXES = ['si-baseline-', 'tcp-', 'readiness-posture-'];
export const V122_HANDOFF_KINDS = ['si_baseline', 'tcp', 'readiness_posture', 'policy_inputs_profile', 'policy_set_manifest', 'cui_boundary'];
export function judgeV122({ plannerDirExists = null, rootPkg = null, unitGate = null, gdE = false, plansFiles = null, intake = null, tcpExpected = true, boundarySkipped = false }) {
  const problems = [];
  let cNote = '(c) GD-e not judged here';
  if (gdE) {
    if (plansFiles === null) problems.push("(c) no Stamper plans folder");
    else {
      const stray = plansFiles.filter((f) => V122_EO_ONLY_PREFIXES.some((p) => f.startsWith(p)));
      if (stray.length) problems.push(`(c) Stamper's plans folder still holds EO-only envelope(s): ${stray.join(', ')}`);
    }
    if (!intake) problems.push('(c) no EO intake receipt for the tenant');
    else {
      const kinds = new Set((intake.receipt?.items ?? []).map((i) => i.kind));
      const want = V122_HANDOFF_KINDS.filter((k) => (k !== 'tcp' || tcpExpected) && (k !== 'cui_boundary' || !boundarySkipped));
      const missing = want.filter((k) => !kinds.has(k));
      if (missing.length) problems.push(`(c) EO intake ${intake.receiptId} lacks ${missing.join(', ')}`);
      else cNote = `(c) GD-e: no EO-only envelope in Stamper's plans folder; EO intake ${intake.receiptId} names ${want.length} hand-off kinds`;
    }
  }
  if (plannerDirExists === null) problems.push('(a) could not look for <ces>/ces-planner');
  else if (plannerDirExists) problems.push('(a) <ces>/ces-planner still exists');
  if (!rootPkg) problems.push('(a) no root package.json');
  else {
    const ws = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces?.packages ?? [];
    const badWs = ws.filter((w) => /ces-planner/i.test(String(w)));
    if (badWs.length) problems.push(`(a) root workspaces still name ${badWs.join(', ')}`);
    const badScripts = Object.entries(rootPkg.scripts ?? {}).filter(([k, v]) => k === 'planner' || /ces-planner/i.test(String(v))).map(([k]) => k);
    if (badScripts.length) problems.push(`(a) root scripts still name ces-planner: ${badScripts.join(', ')}`);
  }
  if (!unitGate) problems.push('(b) no out/unit-gate.json');
  else if ((unitGate.suites ?? []).some((s) => /ces-planner/i.test(String(s.suite)))) problems.push('(b) the unit gate still runs a ces-planner suite');
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `(a) no <ces>/ces-planner; root workspaces and scripts name no ces-planner; (b) the unit gate's ${(unitGate.suites ?? []).length} suites include no ces-planner; ${cNote}` };
}

export function fin29HubChecks(vctx) {
  const f = path.join(vctx.out, 'secret-scan.json');
  const scan = vctx.exists(f) ? vctx.readJson(f) : null;
  const r = judgeV101({ scan, stale: vctx.staleOf(f), steps: vctx.steps ?? {}, harness: vctx.harness });
  const pkgFile = path.join(vctx.ces, 'package.json');
  const gateFile = path.join(vctx.out, 'unit-gate.json');
  // FIN-35 S-1: clause (c) reads the plans folder and EO's intake (<out>/eo/intake/<slug>/); vctx.readEoIntake is verify-w4.mjs's.
  const mpFile = vctx.plansDir && fs.existsSync(vctx.plansDir) ? fs.readdirSync(vctx.plansDir).filter((f) => f.startsWith('manual-mission-plan-')).sort().pop() : null;
  const mpInputs = mpFile ? vctx.readJson(path.join(vctx.plansDir, mpFile))?.inputs ?? {} : {};
  const r122 = judgeV122({
    plannerDirExists: fs.existsSync(path.join(vctx.ces, 'ces-planner')), rootPkg: vctx.exists(pkgFile) ? vctx.readJson(pkgFile) : null, unitGate: vctx.exists(gateFile) ? vctx.readJson(gateFile) : null,
    gdE: true,
    plansFiles: vctx.plansDir && fs.existsSync(vctx.plansDir) ? fs.readdirSync(vctx.plansDir) : null,
    intake: typeof vctx.readEoIntake === 'function' ? vctx.readEoIntake(path.join(vctx.out, 'eo'), vctx.slug) : null,
    tcpExpected: !!mpInputs.tcp_ref?.hash_sha256,
    boundarySkipped: !mpInputs.cui_boundary_ref?.hash_sha256,
  });
  return [
    { id: 'V101', title: 'Run-secret leak scan (SP-11): no run secret appears in out/, the EO and EC stores or Stamper evidence; the record holds counts only', ...r },
    { id: 'V122', title: 'Planner is gone: no <ces>/ces-planner, no ces-planner workspace or script, no ces-planner suite in the unit gate; (c) GD-e: no EO-only envelope in the Stamper plans folder and the EO intake names all six kinds (FIN-28 S-1, FIN-35)', ...r122 },
  ];
}

/** Calls every area module; a missing or throwing module yields red rows for its checks. */
export async function runFin29Checks(vctx, { dir = HERE } = {}) {
  const rows = [];
  for (const area of FIN29_AREAS) {
    const file = path.join(dir, area.file);
    let got = null;
    let why = null;
    if (!fs.existsSync(file)) why = `${area.file} is missing`;
    else {
      try {
        const mod = await import(pathToFileURL(file).href);
        if (typeof mod[area.fn] !== 'function') why = `${area.file} exports no ${area.fn}`;
        else got = await mod[area.fn](vctx);
      } catch (e) {
        why = `${area.file}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (got) {
      for (const id of area.ids) if (!got.some((r) => r.id === id)) rows.push({ id, title: `${id} (FIN-29)`, pass: false, detail: `${area.fn} returned no ${id} row` });
      rows.push(...got.map((r) => ({ id: r.id, title: r.title, pass: !!r.pass, detail: r.detail })));
    } else rows.push(...area.ids.map((id) => ({ id, title: `${id} (FIN-29)`, pass: false, detail: `error: ${why}` })));
  }
  try {
    rows.push(...fin29HubChecks(vctx));
  } catch (e) {
    for (const id of ['V101', 'V122']) rows.push({ id, title: `${id} (FIN-29)`, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
  return rows;
}

// ---------- V88 (g) (FIN-19 open item 1): muster-api's E3/E4 call lines survive E6's state wipe ----------
// calls: the parsed lines of pl/Stamper/plan-data/<slug>/state/muster-eo-calls.jsonl (or null); answersPresent: the
// customer has interview-answers.json (then E3 sends interview records and writes an eo_interviews line).
export function judgeMusterCallLines({ calls = null, answersPresent = false }) {
  if (calls === null) return { pass: false, detail: '(g) no muster-eo-calls.jsonl' };
  const ev = (e) => calls.filter((c) => c?.event === e).length;
  const problems = [];
  if (ev('eo_intake') < 1) problems.push('(g) no eo_intake line (E4): E6 wiped it, or muster-api made no intake call');
  if (answersPresent && ev('eo_interviews') < 1) problems.push('(g) no eo_interviews line (E3)');
  if (problems.length) return { pass: false, detail: problems.join('; ') };
  return { pass: true, detail: `(g) the E3/E4 lines survived E6: eo_intake ${ev('eo_intake')}${answersPresent ? `, eo_interviews ${ev('eo_interviews')}` : ''}` };
}
