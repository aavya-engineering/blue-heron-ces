// Synthetic-customer W4 checks V50-V53, V56, V57 (and W6's V59) for verify.mjs (kept in their own module so verify.mjs needs one line):
//   await (await import('./verify-w4.mjs')).registerW4Checks(check, { root, slug, out });
// registerW4Checks loads the run, computes the scorecard and the gap list, writes out\scorecard-<slug>.json,
// out\GAPS-<slug>.md and out\GAPS-<slug>.json, then registers six synchronous checks through verify.mjs's check(id, title, fn)
// (fn returns { pass, detail }). ctx: root = <WS>; slug = the scenario; out = <WS>\out (the run folder read and written);
// optional pkgDir (default: this package) for tests.
//  V50 the scorecard is computed (every row has a value, or is exempt for the scenario) and written.
//  V51 every SC row is within its threshold; the detail gives each failing row's delta (expected to fail until W5).
//  V52 GAPS is written with >= 1 row per not-met / not-assessed control and per presence-only met control, and one
//      documentary row per SC-3b item.
//  V53 the SC-1 / SC-2 predicates are evaluated: 7 P0 and 11 P1 rows, each with a boolean verdict (no "not computed").
//  V56 the scorecard's SC-4 = the SSP's presenceOnly count / met, recounted from out\ssp.json.
//  V57 the GAPS row count is not above the newest archived proof run's GAPS-<slug>.json for the slug (none: passes);
//      policy-reconciliation rows (findings about the organisation, not loop gaps) and W6's deficiency rows (seeded
//      deficiencies, not loop gaps) are left out on both sides. PH-11 Q2 (founder 2026-11-01): the manual-gate-read rows
//      (gate reads that came back NOT_SAT) are a deliberate, disclosed increase: they are loop rows and counted, except
//      while the archived GAPS predates them (no manualGateReadRows field, which gaps.mjs now always writes): then they are left out of the
//      current count and named in the detail. The allowance retires itself at the first re-baseline that archives them.
//  V59 (W6, S3) every seeded deficiency in customers\<slug>\deficiencies.json is surfaced: a GAPS row of another source
//      matches it, or its control is now met with a state-verified record from its named fixer; a deficiency only
//      carried by its own 'deficiency' row ("not surfaced") fails, listed by id. Report-only (pass) without the file.
// W7-PKG: ctx.honestNullsFile (verify.mjs --exclude-honest-nulls, default off) reaches loadInputs (FQ-1); V57 also leaves
// out the 'review' rows (EO review findings); registerW4Checks returns { sc, gaps } for verify.mjs's V64 / V67 / V69-V71.
// The W7 judges judgeV60 ... judgeV71 (PLAN §5) below are pure: verify.mjs gathers each check's inputs in its own block
// and calls one judge (kept here so they can be unit-tested; verify.mjs is a top-level script).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadInputs, computeScorecard, writeScorecard, PKG_DIR } from './scorecard.mjs';
import { buildGaps, writeGaps, REVIEW_MARKERS } from './gaps.mjs';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

// How far a row is from its threshold, in the row's own unit.
export function delta(r) {
  const v = r.value ?? {}, t = r.threshold ?? {};
  switch (r.id) {
    case 'SC-1': return t.rows ? `rows ${t.rows.filter((n) => !(v.rows ?? []).find((p) => p.row === n)?.pass).join(', ')} failing` : `${v.passed}/${v.of}, need ${t.minPassed} (${v.passed - t.minPassed})`;
    case 'SC-2': return `${v.passed}/${v.of}, need ${t.minPassed} (${v.passed - t.minPassed})`;
    case 'SC-3a': return `${v.pct} % < ${t.minPct} % (${(v.pct - t.minPct).toFixed(1)}; ${Math.ceil((t.minPct / 100) * v.of) - v.covered} more items)`;
    case 'SC-3b': return `${v.listed + v.credited}/${v.of}`;
    case 'SC-4': return `${v.pct} % > ${t.maxPct} % (+${(v.pct - t.maxPct).toFixed(1)}; ${v.presenceOnly - Math.floor((t.maxPct / 100) * v.met)} controls)`;
    case 'SC-5': return `JSON ${v.json} (+${v.json - t.maxJson}), DOCX ${v.docx ?? '?'} (+${(v.docx ?? 0) - t.maxDocx}) > ${t.maxJson}`;
    case 'SC-6': return `documents ${v.policies}/${v.policyDocs} (need ${t.minPolicies}), ODPs ${v.odps}/15 (need ${t.minOdps})`;
    case 'SC-7': return `recomputed ${v.recomputed} vs ${JSON.stringify(v.assessed)}`;
    case 'SC-8a': return `${v.pct} % > ${t.maxPct} % (+${(v.pct - t.maxPct).toFixed(1)})`;
    case 'SC-8b': return `TCP ${v.tcp}/${v.of} > ${t.maxTcp} (+${v.tcp - t.maxTcp})`;
    default: return JSON.stringify(v);
  }
}

// The newest archived GAPS-<slug>.json under the slug's proof runs (by generatedAt, then folder name).
export function newestProofGaps(pkgDir, slug) {
  const dirs = [path.join(pkgDir, 'expected-outputs', slug, 'proof-runs'), ...(slug === 'muster-partial' ? [path.join(pkgDir, 'expected-outputs', 'proof-runs')] : [])];
  const found = [];
  for (const d of dirs) if (fs.existsSync(d)) for (const run of fs.readdirSync(d)) {
    const f = path.join(d, run, `GAPS-${slug}.json`);
    if (fs.existsSync(f)) { try { const g = readJson(f); found.push({ file: f, run, g }); } catch { /* unreadable archive: ignored */ } }
  }
  found.sort((x, y) => String(x.g.generatedAt ?? '').localeCompare(String(y.g.generatedAt ?? '')) || x.run.localeCompare(y.run));
  return found.pop() ?? null;
}

export async function registerW4Checks(check, ctx) {
  const pkgDir = ctx.pkgDir ?? PKG_DIR;
  const out = ctx.out ?? path.join(ctx.root, 'out');
  let sc = null, gaps = null, scFile = null, gFiles = null, err = null;
  try {
    const inp = loadInputs({ root: ctx.root, slug: ctx.slug, runDir: out, pkgDir, honestNullsFile: ctx.honestNullsFile ?? null });
    sc = computeScorecard(inp, pkgDir);
    scFile = writeScorecard(sc, out);
    gaps = buildGaps(inp, sc);
    gFiles = writeGaps(gaps, out);
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const fail = (what) => ({ pass: false, detail: `${what} not available: ${err ?? 'not computed'}` });
  const row = (id) => sc?.rows.find((r) => r.id === id) ?? null;

  check('V50', 'Scorecard computed and written (out/scorecard-<slug>.json; every row computed or exempt)', () => {
    if (!sc || !scFile) return fail('scorecard');
    const back = readJson(scFile);
    const missing = ['SC-1', 'SC-2', 'SC-3a', 'SC-3b', 'SC-4', 'SC-5', 'SC-6', 'SC-7', 'SC-8a', 'SC-8b'].filter((id) => !back.rows?.some((r) => r.id === id));
    const notComputed = back.rows.filter((r) => r.status === 'not computed').map((r) => r.id);
    const problems = [...(missing.length ? [`rows missing: ${missing.join(', ')}`] : []), ...(notComputed.length ? [`not computed: ${notComputed.join(', ')}`] : [])];
    return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}${path.basename(scFile)}: ${back.rows.length} rows (${back.scenarioCode}, thresholds ${back.thresholdSource}); ${back.rows.map((r) => `${r.id} ${r.status}`).join(', ')}` };
  });
  check('V51', 'Every scorecard row within its scenario threshold (PLAN §1, B21)', () => {
    if (!sc) return fail('scorecard');
    const bad = sc.rows.filter((r) => r.status !== 'pass' && r.status !== 'exempt');
    // W4: the gate is report-only until the scenario's tester file sets scorecard_gate: true (W5 flips it per
    // scenario once its thresholds hold); PLAN section 5 W4 says V50-V52 may fail until W5, and proof runs must stay
    // meaningful ("all green") in the meantime. The deltas are always printed.
    const gateOn = (() => { try { const f = path.join(ctx.root, 'ces', 'ces-tester', 'scenarios', 'muster', `${ctx.slug}-e2e.json`); return fs.existsSync(f) && readJson(f).scorecard_gate === true; } catch { return false; } })();
    if (!gateOn && bad.length) return { pass: true, detail: `report-only (scorecard_gate off until W5): ${bad.length} rows outside: ${bad.map((r) => `${r.id} ${r.status === 'not computed' ? 'not computed' : 'outside'}`).join(', ')}` };
    return { pass: bad.length === 0, detail: bad.length ? `${bad.length} rows outside: ${bad.map((r) => `${r.id} ${r.status === 'not computed' ? 'not computed' : delta(r)}`).join('; ')}` : `${sc.rows.length} rows within threshold (${sc.rows.filter((r) => r.status === 'exempt').length} exempt)` };
  });
  check('V52', 'GAPS written: >= 1 row per not-met / not-assessed control and per presence-only met control; one row per documentary item', () => {
    if (!gaps || !gFiles) return fail('GAPS');
    const back = readJson(gFiles.json);
    const ctl = loadInputs({ root: ctx.root, slug: ctx.slug, runDir: out, pkgDir }).ssp?.controlImplementations ?? [];
    const rowControls = new Set(back.rows.filter((r) => r.control).map((r) => `${r.source}|${r.control}`));
    const needStatus = ctl.filter((c) => c.status === 'not_met' || c.status === 'not_assessed').map((c) => c.control_id);
    const needPresence = ctl.filter((c) => c.status === 'met' && c.presenceOnly === true).map((c) => c.control_id);
    const lostS = needStatus.filter((id) => !rowControls.has(`control-status|${id}`));
    const lostP = needPresence.filter((id) => !rowControls.has(`presence-only|${id}`));
    const docRows = back.rows.filter((r) => r.source === 'documentary').length;
    const sc3b = row('SC-3b')?.value;
    const problems = [];
    if (!fs.existsSync(gFiles.md)) problems.push('GAPS markdown missing');
    if (lostS.length) problems.push(`${lostS.length} not-met / not-assessed controls without a row (${lostS.slice(0, 5).join(', ')})`);
    if (lostP.length) problems.push(`${lostP.length} presence-only controls without a row (${lostP.slice(0, 5).join(', ')})`);
    if (!sc3b || docRows !== sc3b.listed) problems.push(`documentary rows ${docRows} != SC-3b listed ${sc3b?.listed ?? '?'}`);
    return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}${path.basename(gFiles.md)}: ${back.rowCount} rows; ${needStatus.length} not-met / not-assessed and ${needPresence.length} presence-only controls covered; ${docRows} documentary rows; by source ${JSON.stringify(back.bySource)}` };
  });
  check('V53', 'SC-1 / SC-2 predicates evaluated: 7 P0 and 11 P1 rows, each with a verdict', () => {
    if (!sc) return fail('scorecard');
    const p0 = row('SC-1')?.value?.rows ?? [], p1 = row('SC-2')?.value?.rows ?? [];
    const undecided = [...p0, ...p1].filter((p) => typeof p.pass !== 'boolean').map((p) => p.row);
    const ok = p0.length === 7 && p1.length === 11 && !undecided.length;
    return { pass: ok, detail: `P0 ${p0.length} rows (${p0.filter((p) => p.pass).length} pass), P1 ${p1.length} rows (${p1.filter((p) => p.pass).length} pass)${undecided.length ? `; no verdict: ${undecided.join(', ')}` : ''}` };
  });
  check('V56', "Scorecard SC-4 = the SSP's presenceOnly count / met (recounted from out/ssp.json)", () => {
    if (!sc) return fail('scorecard');
    const p = path.join(out, 'ssp.json');
    if (!fs.existsSync(p)) return { pass: false, detail: 'no out/ssp.json' };
    const met = (readJson(p).controlImplementations ?? []).filter((c) => c.status === 'met');
    const po = met.filter((c) => c.presenceOnly === true).length;
    const v = row('SC-4')?.value;
    return { pass: !!v && v.presenceOnly === po && v.met === met.length, detail: `scorecard ${v?.presenceOnly}/${v?.met}; ssp.json ${po}/${met.length}` };
  });
  check('V57', 'GAPS row count monotonic non-increasing across proof runs for the slug (newest archived GAPS; first run passes)', () => {
    if (!gaps) return fail('GAPS');
    const prev = newestProofGaps(pkgDir, ctx.slug);
    // policy-reconciliation rows are findings about the organisation (its policy vs its tenant), not loop gaps: excluded on both sides.
    // W7-PKG: EO review rows (findings for the organisation's review, no status) are left out the same way.
    const loopRows = (g) => g.rowCount - (g.bySource?.['policy-reconciliation'] ?? 0) - (g.bySource?.deficiency ?? 0) - (g.bySource?.review ?? 0);
    const pr = gaps.bySource?.['policy-reconciliation'] ?? 0;
    const dr = gaps.bySource?.deficiency ?? 0;
    const rv = gaps.bySource?.review ?? 0;
    const excl = `; ${pr} policy-reconciliation rows excluded (findings about the organisation, not loop gaps)${dr ? `; ${dr} deficiency rows excluded (seeded deficiencies, not loop gaps)` : ''}${rv ? `; ${rv} review rows excluded (EO review findings, not loop gaps)` : ''}`;
    if (!prev) return { pass: true, detail: `first run for ${ctx.slug}: no archived GAPS-${ctx.slug}.json under the proof runs; ${loopRows(gaps)} rows now${excl}` };
    // PH-11 Q2: disclosed allowance for the manual-gate-read rows while the archived GAPS has no such source.
    const gr = gaps.bySource?.['manual-gate-read'] ?? 0;
    const allow = gr && !('manualGateReadRows' in prev.g) ? gr : 0;
    const now = loopRows(gaps) - allow, was = loopRows(prev.g);
    const al = allow ? `; allowance: ${allow} manual-gate-read rows left out (new source, founder Q2 2026-11-01; ${prev.run} predates it)` : '';
    return { pass: now <= was, detail: `${now} rows now vs ${was} in ${prev.run} (${now - was >= 0 ? '+' : ''}${now - was})${excl}${al}` };
  });
  check('V59', 'Every seeded deficiency (customers/<slug>/deficiencies.json) is surfaced in GAPS or fixed by its named fixer (report-only without the file)', () => {
    if (!gaps) return fail('GAPS');
    const D = gaps.deficiencies;
    if (!D) return { pass: true, detail: `report-only: no customers/${ctx.slug}/deficiencies.json for ${ctx.slug}` };
    const resolved = D.rows.filter((x) => !x.surfaced && x.resolved).map((x) => `${x.id} (${x.control} ${x.ledgerStatus}; ${x.fixerActed}${x.note ? `; ${x.note}` : ''})`);
    const lost = D.rows.filter((x) => !x.surfaced && !x.resolved);
    return {
      pass: lost.length === 0,
      detail: `${D.count} deficiencies: ${D.surfaced} surfaced by a GAPS row, ${resolved.length} fixed by their fixer${resolved.length ? ` [${resolved.join('; ')}]` : ''}, ${lost.length} not surfaced${lost.length ? `: ${lost.map((x) => `${x.id} (${x.control} ${x.ledgerStatus}; fixer ${x.fixer}: ${x.fixerActed}${x.note ? `; ${x.note}` : ''})`).join('; ')}` : ''}`,
    };
  });
  return { sc, gaps, error: err };
}

// ---------- W7 (PLAN §5): the judges of V60-V71 ----------
// Each takes plain data (verify.mjs reads the run) and returns { pass, detail }; a scenario or run without the artefact a
// check is about takes the skip path the detail names (pass), never a silent pass.
const h12 = (h) => `${String(h ?? '').slice(0, 12)}…`;
const pv = (o, k) => o?.[k] ?? o?.[k[0].toUpperCase() + k.slice(1)];
const verdict = (problems, ok) => ({ pass: problems.length === 0, detail: problems.length ? problems.join('; ') : ok });
// The six MG-12 hand-off envelopes the MP references (inputs.<kind>_ref), with their pushed-file prefixes (orchestrator
// ruling 10-29: V62 is about these six, not the nine pushed files; MP, TM and IM carry no inputs.*_ref).
export const W7_HANDOFF = [['si_baseline', 'si-baseline-'], ['tcp', 'tcp-'], ['readiness_posture', 'readiness-posture-'], ['policy_inputs_profile', 'policy-inputs-profile-'], ['policy_set_manifest', 'policy-set-manifest-'], ['cui_boundary', 'cui-boundary-']];
// FIN-35 S-1 (GD-e, LOG-FIN-28 §3): the kinds muster-api no longer writes to Stamper's plans folder (EO's intake only), as
// muster-api planHandoff.ts EO_ONLY_KINDS minus the interim policy-inputs profile (STAMPER_PLANS_KINDS keeps it).
export const EO_ONLY_HANDOFF = ['si_baseline', 'tcp', 'readiness_posture'];

// FIN-35 S-1: EO's newest intake receipt for a tenant (ces-eo intake-router.ts: <storageRoot>/intake/<slug>/intake-*/
// receipt.json, items [{ kind, stored_as, file_name, sha256, hash_sha256, artifact_id }]). Returns { receiptId, dir, receipt,
// files: kind -> absolute path of the stored part } or null when there is none. Never throws.
export function readEoIntake(storageRoot, slug) {
  try {
    const base = path.join(storageRoot, 'intake', slug);
    if (!fs.existsSync(base)) return null;
    const newest = fs.readdirSync(base).filter((d) => d.startsWith('intake-') && fs.existsSync(path.join(base, d, 'receipt.json'))).sort().pop();
    if (!newest) return null;
    const dir = path.join(base, newest);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8').replace(/^﻿/, ''));
    const files = {};
    for (const it of Array.isArray(receipt?.items) ? receipt.items : []) {
      if (it?.kind && it?.stored_as && fs.existsSync(path.join(dir, path.basename(it.stored_as)))) files[it.kind] = path.join(dir, path.basename(it.stored_as));
    }
    return { receiptId: receipt?.receipt_id ?? newest, dir, receipt, files };
  } catch {
    return null;
  }
}

// V60: the pushed CUI Boundary envelope, its hash and the MP reference (W7-CUI / W7-MX2). Skip: the runner's plan-trace.json
// boundary.no_reference_reason names why no boundary was built; then no file and no reference fields may exist.
export function judgeV60({ slug, boundary = null, pushed = [], envelope = null, mpRef = null, recompute = null, stamperRef = null }) {
  if (!boundary) return { pass: false, detail: 'no plan-trace.json boundary block' };
  if (!('cui_boundary_ref' in boundary) && !('no_reference_reason' in boundary)) return { pass: false, detail: 'plan-trace.json boundary carries neither cui_boundary_ref nor no_reference_reason (headless runner before W7-MX2)' };
  const files = pushed.filter((f) => f.startsWith(`cui-boundary-${slug}-`) && f.endsWith('.json'));
  const problems = [];
  if (boundary.no_reference_reason) {
    if (files.length) problems.push(`boundary skipped (${boundary.no_reference_reason}) but ${files.join(', ')} pushed`);
    if (mpRef?.hash_sha256 || mpRef?.artifact_id) problems.push('boundary skipped but the MP inputs.cui_boundary_ref carries artifact_id / hash_sha256');
    return verdict(problems, `skipped boundary (plan-trace.json no_reference_reason: ${boundary.no_reference_reason}): no cui-boundary file pushed, no MP reference fields`);
  }
  if (files.length !== 1) problems.push(`01-plans/pushed holds ${files.length} cui-boundary-${slug}-*.json (want exactly 1)`);
  if (!mpRef?.artifact_id || !mpRef?.hash_sha256) problems.push('MP inputs.cui_boundary_ref has no artifact_id / hash_sha256');
  if (!envelope) problems.push('no CUI Boundary envelope read');
  if (envelope && mpRef?.hash_sha256) {
    if (envelope.artifact_id !== mpRef.artifact_id) problems.push(`envelope artifact_id ${envelope.artifact_id} != MP ${mpRef.artifact_id}`);
    if (envelope.hash_sha256 !== mpRef.hash_sha256) problems.push(`envelope hash ${h12(envelope.hash_sha256)} != MP ${h12(mpRef.hash_sha256)}`);
    const tr = boundary.cui_boundary_ref;
    if (tr && (tr.artifact_id !== mpRef.artifact_id || tr.hash_sha256 !== mpRef.hash_sha256)) problems.push('plan-trace.json boundary.cui_boundary_ref differs from the MP reference');
    if (!recompute) problems.push('ces-shared canonicalSha256 not importable: the hash is not recomputed');
    else { const h = recompute(envelope.artifact); if (h !== envelope.hash_sha256) problems.push(`canonicalSha256(artifact) ${h12(h)} != envelope hash ${h12(envelope.hash_sha256)}`); }
  }
  if (!stamperRef) problems.push('Stamper recorded no variables._cui_boundary_ref (executable plan)');
  else if (stamperRef.verified !== true) problems.push(`Stamper recorded verified ${stamperRef.verified}${stamperRef.reason ? ` (${stamperRef.reason})` : ''}`);
  else if (mpRef && (stamperRef.artifact_id !== mpRef.artifact_id || stamperRef.hash_sha256 !== mpRef.hash_sha256)) problems.push("Stamper's recorded id / hash differ from the MP reference");
  return verdict(problems, `${files[0]}: ${mpRef?.artifact_id} hash ${h12(mpRef?.hash_sha256)} = canonicalSha256(artifact) = MP inputs.cui_boundary_ref (same id); Stamper recorded it verified`);
}

// V61: the persisted BTC Confirmation parses as the vendored BTCConfirmationOutput (ces-muster
// src\vendored\ces-planner\shared\types\artifacts.ts; a runtime shape check) and its failed gates = the plan's BTC warnings
// (the MP's inputs.btc_confirmation_ref.gate_summary.fail and plan-trace.json's 'BTC gate "..." failed' validation warnings).
export function btcShapeProblems(b) {
  const p = [];
  const str = (v) => typeof v === 'string';
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (b?.ces?.artifact !== 'btc_confirmation_output') p.push(`ces.artifact ${b?.ces?.artifact} (want btc_confirmation_output)`);
  for (const k of ['version', 'generated_on', 'btc_bank_version', 'activation_package_version']) if (!str(b?.ces?.[k])) p.push(`ces.${k} missing`);
  const c = b?.btc_confirmation;
  if (!obj(c)) return [...p, 'btc_confirmation missing'];
  if (!obj(c.answers)) p.push('btc_confirmation.answers not an object');
  else for (const [k, a] of Object.entries(c.answers)) if (!str(a?.question_id) || !str(a?.mode) || !Array.isArray(a?.evidence_ids) || !str(a?.captured_at)) { p.push(`answers.${k} malformed`); break; }
  for (const k of ['evidence_refs', 'risk_flags', 'decision_log']) if (!Array.isArray(c[k])) p.push(`btc_confirmation.${k} not an array`);
  if (!obj(c.gate_status)) p.push('btc_confirmation.gate_status not an object');
  else for (const [k, g] of Object.entries(c.gate_status)) if (!str(g?.domain) || typeof g?.pass !== 'boolean' || !str(g?.reason)) { p.push(`gate_status.${k} malformed`); break; }
  return p;
}
export function judgeV61({ btc = null, btcFile = null, mpRef = null, warnings = [] }) {
  if (!btc && !mpRef) return { pass: true, detail: 'no BTC Confirmation built (no MP inputs.btc_confirmation_ref, no persisted btc-confirmation file): nothing to check' };
  if (!btc) return { pass: false, detail: `the MP references a BTC Confirmation (gate_summary ${JSON.stringify(mpRef.gate_summary ?? null)}) but 01-plans/persisted holds no btc-confirmation-*.json` };
  const problems = btcShapeProblems(btc).map((x) => `${btcFile}: ${x}`);
  const failed = Object.values(btc?.btc_confirmation?.gate_status ?? {}).filter((g) => g?.pass === false).length;
  const warned = (warnings ?? []).filter((w) => /^BTC gate "/.test(String(w))).length;
  if (!mpRef) problems.push('no MP inputs.btc_confirmation_ref');
  else if (mpRef.gate_summary?.fail !== failed) problems.push(`failed gates ${failed} != MP gate_summary.fail ${mpRef.gate_summary?.fail}`);
  if (warned !== failed) problems.push(`failed gates ${failed} != plan-trace.json BTC gate warnings ${warned}`);
  return verdict(problems, `${btcFile}: a BTCConfirmationOutput; ${failed} failed gates = MP gate_summary.fail = ${warned} plan BTC gate warnings`);
}

// V62: the six hand-off envelopes are MP-referenced (inputs.<kind>_ref: same artifact_id and hash; recomputed when
// ces-shared is importable); none unreferenced, none referenced and missing. Not built: the TCP when no TCP was built (no
// file, no hash), the CUI Boundary when plan-trace.json names a skip reason. FIN-35 S-1 (GD-e): the three Stamper-stored
// kinds are read from the plans folder (plansFiles, readEnv); the three EO-only kinds (EO_ONLY_HANDOFF) from EO's newest
// intake receipt (intake = readEoIntake(...), readIntake(absPath)), and any EO-only file left in the plans folder fails.
// Without an intake argument (older callers) every kind is read from the plans folder, as before.
export function judgeV62({ plansFiles = [], readEnv, mpInputs = {}, recompute = null, boundary = null, intake, readIntake }) {
  const json = plansFiles.filter((f) => f.endsWith('.json'));
  const problems = [], ok = [], notBuilt = [];
  const split = intake !== undefined;
  if (split) {
    const stray = json.filter((x) => EO_ONLY_HANDOFF.some((k) => x.startsWith(W7_HANDOFF.find(([kk]) => kk === k)[1])));
    if (stray.length) problems.push(`EO-only envelope(s) in Stamper's plans folder (GD-e): ${stray.join(', ')}`);
    if (!intake) problems.push('no EO intake receipt (the EO-only envelopes resolve there)');
  }
  for (const [kind, pfx] of W7_HANDOFF) {
    const fromIntake = split && EO_ONLY_HANDOFF.includes(kind);
    const f = fromIntake ? (intake?.files?.[kind] ?? null) : json.filter((x) => x.startsWith(pfx)).sort().pop();
    const ref = mpInputs?.[`${kind}_ref`];
    const where = fromIntake ? `EO intake ${intake?.receiptId ?? '(none)'}` : 'the plans folder';
    if (fromIntake && !intake) continue;
    if (!f) {
      if (ref?.hash_sha256) problems.push(fromIntake ? `inputs.${kind}_ref references ${ref.artifact_id} but ${where} has no ${kind}` : `inputs.${kind}_ref references ${ref.artifact_id} but no ${pfx}* was pushed`);
      else if (kind === 'tcp') notBuilt.push('tcp (no TCP built)');
      else if (kind === 'cui_boundary' && boundary?.no_reference_reason) notBuilt.push(`cui_boundary (skipped: ${boundary.no_reference_reason})`);
      else problems.push(`no ${pfx}* pushed and no inputs.${kind}_ref hash`);
      continue;
    }
    const env = fromIntake ? readIntake(f) : readEnv(f);
    if (!ref?.hash_sha256) { problems.push(`${f} unreferenced (inputs.${kind}_ref has no hash_sha256)`); continue; }
    if (env?.artifact_id !== ref.artifact_id || env?.hash_sha256 !== ref.hash_sha256) { problems.push(`${f}: id / hash differ from inputs.${kind}_ref`); continue; }
    if (recompute && recompute(env.artifact) !== env.hash_sha256) { problems.push(`${f}: canonicalSha256(artifact) differs from its hash_sha256`); continue; }
    ok.push(fromIntake ? `${kind} (EO intake)` : kind);
  }
  return verdict(problems, `${ok.length} hand-off envelopes MP-referenced with the same id and hash${recompute ? ' (recomputed)' : ' (recorded; ces-shared not importable)'}: ${ok.join(', ')}${notBuilt.length ? `; not built: ${notBuilt.join(', ')}` : ''}; ${json.length} pushed files`);
}

// V63: no E7A op ended "not run" (ces-tester ao-step.ts writes detail "not run: ..."), and every resources.* key has a
// provenance (registry_resources values; each op parameter's provenance, never "unknown").
export function judgeV63({ e7a }) {
  const ops = e7a?.ops ?? [];
  const notRun = ops.filter((o) => /^not run\b/i.test(String(o.detail ?? '')));
  const empty = Object.entries(e7a?.registry_resources ?? {}).filter(([, v]) => !String(v ?? '').trim()).map(([k]) => k);
  const noProv = ops.flatMap((o) => (o.params ?? []).filter((p) => /^resources\./.test(String(p.from)) && (!String(p.provenance ?? '').trim() || p.provenance === 'unknown')).map((p) => `${o.op} ${p.name} <- ${p.from}`));
  const problems = [
    ...notRun.map((o) => `${o.op}: ${o.detail}`),
    ...(empty.length ? [`resources without a provenance: ${empty.join(', ')}`] : []),
    ...(noProv.length ? [`parameters without a provenance: ${noProv.join('; ')}`] : []),
  ];
  return verdict(problems, `${ops.length} E7A ops, none "not run" (${ops.map((o) => o.op).join(', ') || 'no ops'}); ${Object.keys(e7a?.registry_resources ?? {}).length} resources keys and ${ops.reduce((n, o) => n + (o.params ?? []).length, 0)} parameters with a provenance`);
}

// W9-C1 (2P-H): the two-person mode an op ran under, from the modes its AO rows recorded
// (evidence.metadata.twoPersonApproval.mode). OFF only when every recorded mode is 'off'; a row with no recorded mode
// (an AO build before the switch) counts as 'on', the old behaviour.
export function aoTwoPersonMode(modes = []) {
  return modes.length > 0 && modes.every((x) => x === 'off') ? 'off' : 'on';
}

// W9-C1 (2P-H): the [call, AO outcome] pairs an op's tier and mode require. T2, or T3 with two-person OFF: dry_run +
// executed; T3 with two-person ON: blocked_pending_approval + executed (and an approve call, approver != requestor).
export function aoTierCalls(tier, mode = 'on') {
  return tier === 'T3' && mode !== 'off' ? [['request', 'blocked_pending_approval'], ['apply', 'executed']] : [['dry_run', 'dry_run'], ['apply', 'executed']];
}

// The recorded modes of an op's calls in the E7A record (ces-tester summarizeExec relays the AO row's mode).
const callModes = (o) => (o.calls ?? []).filter((c) => c.call !== 'approve').map((c) => c.two_person_mode);

// V64 (S3): after E7A every customer CA policy (customers\s3-def\customer.json conditional_access[]) excludes the break-glass
// id A-19 bound (resources.breakglass_user_id), read from EO's E7B conditionalAccess store payload; A-19 ran twice, T3
// (two-person ON: request, approve, apply, approver != requestor; OFF: dry_run, apply, no approver), both confirming
// reads passed; V59 counts S3-D04 fixed. `modeOf(op)` gives the op's recorded mode (verify.mjs reads the AO rows).
export function judgeV64({ slug, e7a = null, caPolicies = null, customerPolicies = [], d04 = null, breakGlassUserId = null, modeOf = (o) => aoTwoPersonMode(callModes(o)) }) {
  if (slug !== 's3-def') return { pass: true, detail: `not S3 (${slug}): not checked` };
  if (!e7a) return { pass: false, detail: 'no out/adminops-e7a.json (E7A)' };
  const problems = [];
  const a19 = (e7a.ops ?? []).filter((o) => o.op === 'A-19');
  if (a19.length !== 2) problems.push(`${a19.length} A-19 runs in E7A (want 2)`);
  const modes = a19.map((o) => modeOf(o));
  a19.forEach((o, i) => {
    if (o.tier !== 'T3') problems.push(`A-19 #${i + 1} tier ${o.tier} (want T3)`);
    const want = modes[i] === 'off' ? ['dry_run', 'apply'] : ['request', 'approve', 'apply'];
    const missing = want.filter((c) => !(o.calls ?? []).some((x) => x.call === c && x.ok === true));
    if (missing.length) problems.push(`A-19 #${i + 1} calls not ok: ${missing.join(', ')}${o.detail ? ` (${o.detail})` : ''}`);
    if (o.confirm?.pass !== true) problems.push(`A-19 #${i + 1} confirming read ${o.confirm ? `failed (${o.confirm.actual})` : 'missing'}`);
  });
  const anyOn = modes.length === 0 || modes.some((m) => m !== 'off');
  if (anyOn && (!e7a.approver_upn || e7a.approver_upn === e7a.requestor_upn)) problems.push(`approver ${e7a.approver_upn ? 'equals the requestor' : 'missing'}`);
  // W7 R1 (run 64): AdminOps binds A-19's sourced breakglassUPN itself (resources.breakglass_upn), so the E7A ops list only the
  // tester-supplied policy name; the break-glass id is the organisation's answered breakGlassUserId (org-content.json), which the
  // tester registers as resources.breakglass_user_id (provenance in registry_resources). Accept either source.
  const fromParams = a19.flatMap((o) => (o.params ?? []).filter((p) => p.from === 'resources.breakglass_user_id').map((p) => p.value));
  const bg = [...new Set(fromParams.length ? fromParams : (breakGlassUserId ? [breakGlassUserId] : []))];
  if (!(e7a.registry_resources ?? {}).breakglass_user_id) problems.push('resources.breakglass_user_id has no provenance in registry_resources');
  if (bg.length !== 1) problems.push(`break-glass id: ${bg.length} candidates (A-19 params or org-content breakGlassUserId; want 1)`);
  if (!caPolicies) problems.push('no E7B conditionalAccess read in the EO store');
  else if (bg.length === 1) {
    for (const c of customerPolicies) {
      const p = caPolicies.find((x) => x.id === c.policy_id || x.displayName === c.name);
      if (!p) { problems.push(`customer policy ${c.name} not in the E7B read`); continue; }
      const excl = p.conditions?.users?.excludeUsers ?? [];
      if (!excl.includes(bg[0])) problems.push(`${p.displayName} excludes ${JSON.stringify(excl)} (not ${bg[0]})`);
    }
    if (!customerPolicies.length) problems.push('no customer CA policies listed in customer.json conditional_access[]');
  }
  if (d04?.resolved !== true) problems.push(`V59 does not count S3-D04 fixed (${d04 ? `${d04.fixerActed}${d04.note ? `; ${d04.note}` : ''}` : 'no S3-D04 row'})`);
  const how = anyOn ? 'approver != requestor' : 'two-person approval OFF: dry run + apply, no approver';
  return verdict(problems, `A-19 x2 (T3, ${how}, confirms passed); ${customerPolicies.length} customer CA policies exclude ${bg[0]} at E7B; V59 counts S3-D04 fixed (${d04?.fixerActed})`);
}

// V65 (S1, S2): PS.L2-3.9.2 not met at E7 pass 3 and met at E7B (E7B drift); the finding names an enabled, scheduled leaver
// workflow, and EO's E7B lifecycleWorkflows payload shows it enabled, scheduled and with a disable / delete-account task
// (the rule of EO personnelActionAccessEvaluator and AdminOps A-21); A-21's confirming read passed.
export const LEAVER_TASK_IDS = ['1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', '8d18588d-9ad3-4c0f-99d0-ec215f0e3dff'];
const LEAVER_TASK_NAME = /\b(disable|delete)\s+user\s+account\b/i;
export function judgeV65({ slug, driftCtl = null, sspCtl = null, workflows = null, e7a = null }) {
  if (!['s1-mach', 's2-eng'].includes(slug)) return { pass: true, detail: `not S1 / S2 (${slug}): not checked` };
  const problems = [];
  if (!driftCtl) problems.push('PS.L2-3.9.2 is not in the E7B drift (no change from E7 pass 3)');
  else if (driftCtl.previous?.status !== 'not_met' || driftCtl.current?.status !== 'met') problems.push(`E7 pass 3 ${driftCtl.previous?.status} -> E7B ${driftCtl.current?.status} (want not_met -> met)`);
  if (sspCtl?.status !== 'met') problems.push(`SSP PS.L2-3.9.2 ${sspCtl?.status ?? 'absent'}`);
  const m = /Leaver \(([^)]*)\)[^;]*enabled and scheduled/.exec(String(sspCtl?.assessmentFinding ?? ''));
  const names = m ? m[1].split(', ').filter(Boolean) : [];
  if (!names.length) problems.push('the PS.L2-3.9.2 finding names no enabled, scheduled leaver workflow');
  if (!workflows) problems.push('no E7B lifecycleWorkflows read in the EO store');
  else for (const n of names) {
    const w = workflows.find((x) => pv(x, 'displayName') === n);
    const tasks = pv(w, 'tasks');
    const disable = Array.isArray(tasks) && tasks.some((t) => pv(t, 'isEnabled') !== false && (LEAVER_TASK_IDS.includes(String(pv(t, 'taskDefinitionId') ?? '').toLowerCase()) || LEAVER_TASK_NAME.test(String(pv(t, 'displayName') ?? ''))));
    if (!w) problems.push(`leaver workflow '${n}' not in the E7B read`);
    else if (String(pv(w, 'category')).toLowerCase() !== 'leaver' || pv(w, 'isEnabled') !== true || pv(w, 'isSchedulingEnabled') !== true || !disable) problems.push(`'${n}': category ${pv(w, 'category')}, isEnabled ${pv(w, 'isEnabled')}, isSchedulingEnabled ${pv(w, 'isSchedulingEnabled')}, disable task ${disable}`);
  }
  const a21 = (e7a?.ops ?? []).filter((o) => o.op === 'A-21');
  if (!a21.length) problems.push('no A-21 op in E7A');
  else if (!a21.every((o) => o.confirm?.pass === true)) problems.push(`A-21 confirming read ${a21.map((o) => (o.confirm ? `failed (${o.confirm.actual})` : 'missing')).join(', ')}`);
  return verdict(problems, `PS.L2-3.9.2 not_met at E7 pass 3 -> met at E7B; leaver ${names.map((n) => `'${n}'`).join(', ')} enabled, scheduled, with a disable task; A-21 confirmed`);
}

// FIN-01 (a): V65 re-aimed to the PS.L2-3.9.2 honest drop (founder A-1031-44, W9-R4a). A-21 still runs (dry run + apply),
// writes and passes its confirming read, and EO's E7B lifecycleWorkflows read shows the workflow A-21 was bound to
// (resources.leaver_workflow_id) as a leaver, enabled, scheduled, with a disable / delete-account task. EO's personnel
// records store outranks that stack credit (NS-3b ledger precedence), so PS.L2-3.9.2 has no status move from E7 pass 3 to
// E7B and the SSP says not_met. snapCtl = the stored snapshot's control (its statusRationale names the personnel store);
// the SSP objectives sourced 'personnel' stand in when it is absent. judgeV65 above is the pre-drop rule, kept for its tests.
export const V65_STORE_RE = /store precedence \(personnel store\b/i;
export function judgeV65Drop({ slug, driftCtl = null, sspCtl = null, snapCtl = null, workflows = null, e7a = null }) {
  if (!['s1-mach', 's2-eng'].includes(slug)) return { pass: true, detail: `not S1 / S2 (${slug}): not checked` };
  const problems = [];
  if (driftCtl && driftCtl.previous?.status !== driftCtl.current?.status) problems.push(`E7 pass 3 ${driftCtl.previous?.status} -> E7B ${driftCtl.current?.status} (want no status move: the records store decides)`);
  if (sspCtl?.status !== 'not_met') problems.push(`SSP PS.L2-3.9.2 ${sspCtl?.status ?? 'absent'} (want not_met: the personnel records store outranks A-21)`);
  const bySnap = V65_STORE_RE.test(String(snapCtl?.statusRationale ?? ''));
  const byObj = (sspCtl?.assessmentObjectives ?? []).some((o) => o.source === 'personnel');
  if (!bySnap && !byObj) problems.push('PS.L2-3.9.2 is not decided by the personnel records store (no "Store precedence (personnel store" rationale, no personnel-sourced objective)');
  const a21 = (e7a?.ops ?? []).filter((o) => o.op === 'A-21');
  if (!a21.length) problems.push('no A-21 op in E7A');
  for (const o of a21) {
    const missing = ['dry_run', 'apply'].filter((c) => !(o.calls ?? []).some((x) => x.call === c && x.ok === true));
    if (missing.length) problems.push(`A-21 calls not ok: ${missing.join(', ')}${o.detail ? ` (${o.detail})` : ''}`);
    if (o.confirm?.pass !== true) problems.push(`A-21 confirming read ${o.confirm ? `failed (${o.confirm.actual})` : 'missing'}`);
  }
  const ids = [...new Set(a21.flatMap((o) => (o.params ?? []).filter((p) => p.from === 'resources.leaver_workflow_id').map((p) => String(p.value))))];
  if (a21.length && ids.length !== 1) problems.push(`A-21 bound ${ids.length} leaver workflow id(s) from resources.leaver_workflow_id (want 1)`);
  if (!workflows) problems.push('no E7B lifecycleWorkflows read in the EO store');
  else for (const id of ids) {
    const w = workflows.find((x) => String(pv(x, 'id') ?? '') === id);
    const tasks = pv(w, 'tasks');
    const disable = Array.isArray(tasks) && tasks.some((t) => pv(t, 'isEnabled') !== false && (LEAVER_TASK_IDS.includes(String(pv(t, 'taskDefinitionId') ?? '').toLowerCase()) || LEAVER_TASK_NAME.test(String(pv(t, 'displayName') ?? ''))));
    if (!w) problems.push(`leaver workflow ${id} not in the E7B read`);
    else if (String(pv(w, 'category')).toLowerCase() !== 'leaver' || pv(w, 'isEnabled') !== true || pv(w, 'isSchedulingEnabled') !== true || !disable) problems.push(`${id}: category ${pv(w, 'category')}, isEnabled ${pv(w, 'isEnabled')}, isSchedulingEnabled ${pv(w, 'isSchedulingEnabled')}, disable task ${disable}`);
  }
  return verdict(problems, `PS.L2-3.9.2 not_met at E7 pass 3 and E7B, decided by the personnel records store (${bySnap ? 'snapshot rationale' : 'SSP objectives'}); A-21 ran and confirmed; leaver workflow ${ids.join(', ')} enabled, scheduled, with a disable task at E7B (stack credit outranked)`);
}

// V66 (founder ruling 1): no positive source for SC.L2-3.13.15 / SI.L1-3.14.2 names a built-in Exchange policy (EO snapshot
// sources and a met SSP finding), and no discovery "yes" rests on built-ins alone (each met observation's capture lists
// only IsDefault / "Built-In Protection Policy" objects). A capture that cannot be read is noted, not judged.
export const V66_CONTROLS = ['SC.L2-3.13.15', 'SI.L1-3.14.2'];
export const BUILTIN_RE = /\bIsDefault\b"?\s*[:=]\s*\$?true\b|Built-In Protection Policy/i;
const NEGATIVE_RESULT = /^(missing|no_query|not_met|failed|error|empty|absent|not_assessed)$/i;
export function builtinsOnly(text) {
  let j;
  try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return null; }
  const items = (Array.isArray(j) ? j : Array.isArray(j?.value) ? j.value : [j]).filter((x) => x && typeof x === 'object');
  return items.length > 0 && items.every((x) => pv(x, 'isDefault') === true || /Built-In Protection Policy/i.test(`${pv(x, 'name') ?? ''} ${pv(x, 'identity') ?? ''}`));
}
export function judgeV66({ snapshotControls = [], sspControls = [], facts = [], observations = [], captureText = () => null }) {
  const problems = [], notes = [];
  for (const cid of V66_CONTROLS) {
    for (const s of (snapshotControls.find((c) => c.control_id === cid)?.sources ?? [])) if (!NEGATIVE_RESULT.test(String(s.result ?? '')) && BUILTIN_RE.test(String(s.detail ?? ''))) problems.push(`${cid}: EO source ${s.type}/${s.result} names a built-in policy: ${String(s.detail).slice(0, 120)}`);
    const sc = sspControls.find((c) => c.control_id === cid);
    if (sc?.status === 'met' && BUILTIN_RE.test(String(sc.assessmentFinding ?? ''))) problems.push(`${cid}: met, and the SSP finding names a built-in policy`);
    const q = `RR-ACT-${cid.replace(/[.-]/g, '_')}`;
    const ans = facts.find((f) => f.question_id === q)?.answer;
    if (ans !== 'yes') { notes.push(`${cid} discovery ${ans ?? 'none'}`); continue; }
    const met = observations.filter((o) => o.control_id === cid && o.derived_posture === 'met' && o.raw_capture_ref);
    const judged = met.map((o) => ({ o, only: builtinsOnly(captureText(o.raw_capture_ref) ?? '') }));
    const real = judged.filter((x) => x.only === false);
    if (!real.length && judged.some((x) => x.only === true)) problems.push(`${cid}: discovery yes from built-ins alone (${judged.filter((x) => x.only).map((x) => x.o.ran_entry_ids?.[0]).join(', ')})`);
    else notes.push(`${cid} discovery yes (${real.length ? `${real.length} capture(s) with a configured policy` : 'no capture readable: not judged'})`);
  }
  return verdict(problems, `no positive source names a built-in Exchange policy; ${notes.join('; ')}`);
}

// V67 (founder ruling 2): a sign-in frequency weaker than 8 h (an enabled tenant CA policy, or an answered
// odps.sign_in_frequency_hours) -> CMMC-SessionTimeout enabled at <= 8 h, the weaker policy not named in AC.L2-3.1.11's
// finding (no credit), and a GAPS policy-reconciliation row CES.BASELINE naming both values. Skip: nothing weaker than 8 h.
export const sifHours = (p) => { const s = p?.sessionControls?.signInFrequency; if (!s || s.isEnabled === false || !Number.isFinite(Number(s.value))) return null; return Number(s.value) * (String(s.type).toLowerCase() === 'days' ? 24 : 1); };
export function judgeV67({ caPolicies = null, profileOdps = null, sspCtl = null, gapsRows = [] }) {
  if (!caPolicies) return { pass: false, detail: 'no E7B conditionalAccess read in the EO store' };
  const weaker = caPolicies.filter((p) => p.state === 'enabled' && p.displayName !== 'CMMC-SessionTimeout' && sifHours(p) > 8);
  const answered = Number(profileOdps?.sign_in_frequency_hours);
  if (!weaker.length && !(answered > 8)) return { pass: true, detail: `no sign-in frequency weaker than 8 h (answered ${profileOdps?.sign_in_frequency_hours ?? 'none'}; no enabled CA policy above 8 h): nothing to check` };
  const problems = [];
  const ses = caPolicies.find((p) => p.displayName === 'CMMC-SessionTimeout');
  if (!ses) problems.push('no CMMC-SessionTimeout policy');
  else if (ses.state !== 'enabled' || !(sifHours(ses) <= 8)) problems.push(`CMMC-SessionTimeout ${ses.state} at ${sifHours(ses)} h (want enabled, <= 8 h)`);
  for (const p of weaker) if (String(sspCtl?.assessmentFinding ?? '').includes(p.displayName)) problems.push(`AC.L2-3.1.11 finding credits the weaker policy '${p.displayName}'`);
  const rows = gapsRows.filter((r) => r.source === 'policy-reconciliation' && r.control === 'AC.L2-3.1.11' && /^CES\.BASELINE\b/.test(String(r.item)));
  for (const p of weaker) {
    const h = sifHours(p);
    if (!rows.some((r) => /\b8 hours\b/.test(r.have) && new RegExp(`\\b${h} hours\\b`).test(r.have))) problems.push(`no GAPS CES.BASELINE reconciliation row naming 8 hours and ${h} hours ('${p.displayName}')`);
  }
  if (answered > 8 && !rows.some((r) => new RegExp(`\\b${answered} hours\\b`).test(r.have))) problems.push(`no GAPS CES.BASELINE reconciliation row naming the answered ${answered} hours`);
  return verdict(problems, `weaker: ${[...weaker.map((p) => `'${p.displayName}' ${sifHours(p)} h`), ...(answered > 8 ? [`answered ${answered} h`] : [])].join(', ')}; CMMC-SessionTimeout ${sifHours(ses)} h; no credit on the weaker policy; GAPS ${rows.map((r) => r.id).join(', ')}`);
}

// V68: the E7 passes and E7B end with a terminal event (assess_done / assess_error); in the EO log (out\logs\E7-eo.out,
// .err) every respawn line (EO SessionManager "session respawn; command in flight:", or the factory's "Process died during
// execute for <type>, respawning") is followed by a "fetch after a session respawn" outcome line (W7-EO).
export const TERMINAL_EVENTS = ['assess_done', 'assess_error'];
export const RESPAWN_RE = /\[EO SessionManager\] session respawn; command in flight:|Process died during execute for .*respawning/;
export const RESPAWN_OUTCOME_RE = /\[EO SessionManager\] fetch after a session respawn/;
export function judgeV68({ passes = [], logs = [] }) {
  const problems = [];
  for (const p of passes) {
    const last = Array.isArray(p.events) && p.events.length ? p.events[p.events.length - 1].type : null;
    if (!last) problems.push(`${p.name}: no events${p.stale ? ` (${p.stale})` : ''}`);
    else if (!TERMINAL_EVENTS.includes(last)) problems.push(`${p.name} ends with ${last}, not a terminal event`);
  }
  if (!logs.length) problems.push('no EO log (out/logs/E7-eo.out, E7-eo.err)');
  const per = logs.map(({ file, text }) => {
    let pending = false, respawns = 0, outcomes = 0;
    for (const l of String(text ?? '').split(/\r?\n/)) {
      if (RESPAWN_RE.test(l)) { respawns++; pending = true; } else if (RESPAWN_OUTCOME_RE.test(l)) { outcomes++; pending = false; }
    }
    return { file, pending, respawns, outcomes };
  });
  // A respawn line and its outcome may sit in the two streams (stdout / stderr): a file left pending is resolved by an
  // outcome line in another EO log file.
  for (const f of per.filter((x) => x.pending)) if (!per.some((o) => o !== f && o.outcomes > 0)) problems.push(`${f.file}: a respawn with no retried-fetch outcome after it`);
  const r = per.reduce((n, x) => n + x.respawns, 0), o = per.reduce((n, x) => n + x.outcomes, 0);
  return verdict(problems, `${passes.map((p) => `${p.name} ${p.events?.[p.events.length - 1]?.type}`).join(', ')}; EO log: ${r} respawn lines, ${o} retried-fetch outcomes${r ? '' : ' (no respawn)'}`);
}

// V69 (S1, S2): SC-8a within threshold, or FQ-1's disposition applied (--exclude-honest-nulls): then SC-8a passes and every
// excluded control carries its reason, and an excluded "unsure" stays a GAPS unsure row with that reason.
export function judgeV69({ slug, sc8a = null, gapsRows = [] }) {
  if (!['s1-mach', 's2-eng'].includes(slug)) return { pass: true, detail: `not S1 / S2 (${slug}): not checked` };
  if (!sc8a) return { pass: false, detail: 'no SC-8a row' };
  const hn = sc8a.value?.honestNulls;
  if (!hn) return { pass: sc8a.status === 'pass', detail: `SC-8a ${sc8a.status}: ${sc8a.detail}${sc8a.status === 'pass' ? '' : `; ${delta(sc8a)}; FQ-1 disposition not applied (--exclude-honest-nulls off)`}` };
  const problems = [];
  if (sc8a.status !== 'pass') problems.push(`SC-8a ${sc8a.status} with FQ-1 applied: ${delta(sc8a)}`);
  for (const h of hn.applied) {
    if (!String(h.reason ?? '').trim()) problems.push(`${h.control}: excluded without a reason`);
    if (h.answer === 'unsure' && !gapsRows.some((r) => r.source === 'unsure' && r.control === h.control && String(r.reason ?? '').includes(h.reason))) problems.push(`${h.control}: no GAPS unsure row with its reason`);
  }
  return verdict(problems, `SC-8a ${sc8a.status} with FQ-1 applied (${hn.file}): ${sc8a.value.unsure}/${sc8a.value.of} = ${sc8a.value.pct} %; ${hn.count} excluded: ${hn.applied.map((h) => `${h.control} (${h.reason})`).join('; ')}`);
}

// V70: every IA.L1-3.5.1 not met on a shared-login finding cites the corroborating signal (W7-EO: primary user of more than
// one managed device); a name-only hit (REVIEW_MARKERS[0], in the SSP or the EO snapshot) is a GAPS review row only.
export const CORROBORATED_RE = /primary user of more than one managed device|on \d+ devices \(/;
export function judgeV70({ sspCtl = null, snapCtl = null, gapsRows = [] }) {
  const cid = 'IA.L1-3.5.1', mk = REVIEW_MARKERS[0];
  const status = sspCtl?.status ?? snapCtl?.status ?? null;
  const finding = String(sspCtl?.assessmentFinding ?? snapCtl?.assessmentFinding ?? '');
  const texts = [sspCtl?.assessmentFinding, sspCtl?.implementationNarrative, snapCtl?.statusRationale, snapCtl?.assessmentFinding, ...(snapCtl?.sources ?? []).map((s) => s.detail)].map((t) => String(t ?? ''));
  const named = texts.some((t) => t.includes(mk));
  const problems = [];
  if (status === 'not_met' && /shared or generic login/i.test(finding) && !CORROBORATED_RE.test(finding)) problems.push(`not met on a shared-login name without a corroborating signal: ${finding.slice(0, 160)}`);
  const review = gapsRows.filter((r) => r.source === 'review' && r.control === cid);
  if (named && !review.length) problems.push('a name-only shared-login hit with no GAPS review row');
  if (!named && review.length) problems.push(`GAPS review row ${review[0].id} without a name-only hit in the SSP or snapshot`);
  return verdict(problems, `${cid} ${status ?? 'absent'}${status === 'not_met' ? (CORROBORATED_RE.test(finding) ? ' (corroborated: managed devices)' : ' (not a shared-login finding)') : ''}; name-only hits ${named ? `in GAPS review row ${review[0]?.id}` : 'none'}`);
}

// V71: after E6, Muster's basis for AC.L1-3.1.1 (Stamper's E6 record of AC.L1-3.1.1.ca-mfa-compliant-device, whose lookup
// is Muster's ca-mfa-compliant-device predicate; Muster's E2 discovery answer when there is no record) agrees with EO's
// status at E7, or GAPS holds a reconciliation (or review) row on AC.L1-3.1.1 naming both bases.
export function judgeV71({ stamperRec = null, discoveryAnswer = null, eoStatus = null, gapsRows = [] }) {
  if (!eoStatus) return { pass: false, detail: 'no EO status for AC.L1-3.1.1' };
  const muster = stamperRec
    ? { status: stamperRec.complianceVerdict === 'SAT' && stamperRec.metadata?.postcheckMode === 'state' ? 'met' : 'not_met', basis: `Stamper E6 AC.L1-3.1.1.ca-mfa-compliant-device ${stamperRec.complianceVerdict} (postcheckMode ${stamperRec.metadata?.postcheckMode ?? 'none'})` }
    : { status: discoveryAnswer === 'yes' ? 'met' : discoveryAnswer === 'no' ? 'not_met' : null, basis: `Muster E2 discovery ${discoveryAnswer ?? 'none'} (no Stamper E6 record)` };
  if (muster.status && (muster.status === 'met') === (eoStatus === 'met')) return { pass: true, detail: `agree: ${muster.basis} -> ${muster.status}; EO at E7 ${eoStatus}` };
  const row = gapsRows.find((r) => r.control === 'AC.L1-3.1.1' && ['policy-reconciliation', 'review'].includes(r.source) && /Muster|Stamper|discovery/i.test(`${r.item} ${r.needs} ${r.have}`) && /EvidenceOps|\bEO\b|assess/i.test(`${r.item} ${r.needs} ${r.have}`));
  return row ? { pass: true, detail: `disagree (${muster.basis} -> ${muster.status ?? 'unknown'}; EO ${eoStatus}); GAPS ${row.source} row ${row.id} names both bases` }
    : { pass: false, detail: `disagree: ${muster.basis} -> ${muster.status ?? 'unknown'}; EO at E7 ${eoStatus}; no GAPS reconciliation row on AC.L1-3.1.1 naming both bases` };
}

// V72 (W8-PKG, PLAN.md W8 §7; S1 only): Stamper's translateForTenant() in modes cli and gui, run in process on the run's pushed
// MP, TM, IM and tenant, gives equal projectExecutablePlan() projections (a); the cli projection equals the projection of the
// executable plan E6 ran, variables excluded (b). The detail names the first differing task (index, id, field).
const canonJson = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
export function firstProjectionDiff(x, y, { variables = true } = {}) {
  const xt = x?.tasks ?? [], yt = y?.tasks ?? [];
  for (let i = 0; i < Math.max(xt.length, yt.length); i++) {
    if (canonJson(xt[i]) === canonJson(yt[i])) continue;
    if (!xt[i] || !yt[i]) return `task count ${xt.length} != ${yt.length} (first unmatched: task ${i} ${(xt[i] ?? yt[i]).id})`;
    const field = [...new Set([...Object.keys(xt[i]), ...Object.keys(yt[i])])].find((k) => canonJson(xt[i][k]) !== canonJson(yt[i][k]));
    return `task ${i} ${xt[i].id}${xt[i].id === yt[i].id ? '' : ` vs ${yt[i].id}`}, field ${field}`;
  }
  if (!variables) return null;
  const xv = x?.variables ?? {}, yv = y?.variables ?? {};
  const key = [...new Set([...Object.keys(xv), ...Object.keys(yv)])].sort().find((k) => canonJson(xv[k]) !== canonJson(yv[k]));
  return key === undefined ? null : `variables.${key}`;
}
export function judgeV72({ slug, error = null, cli = null, gui = null, e6 = null, tenant = null }) {
  if (slug !== 's1-mach') return { pass: true, detail: `not S1 (${slug}): not checked` };
  if (error) return { pass: false, detail: `in-process translate failed: ${error}` };
  if (!cli || !gui) return { pass: false, detail: 'no in-process projection' };
  if (!e6) return { pass: false, detail: 'no out/executable-plan.json (E6)' };
  const problems = [];
  const a = firstProjectionDiff(cli, gui);
  if (a) problems.push(`(a) cli projection != gui projection: first difference ${a}`);
  const b = firstProjectionDiff(cli, e6, { variables: false });
  if (b) problems.push(`(b) cli projection != E6 out/executable-plan.json projection (variables excluded): first difference ${b}`);
  return verdict(problems, `(a) cli = gui projection (${cli.tasks.length} tasks, ${Object.keys(cli.variables ?? {}).length} variables); (b) cli = E6 out/executable-plan.json projection, variables excluded; tenant record ${tenant ? `${tenant} loaded` : 'absent at verify time (translated without it)'}`);
}
// V73 (W8-UIT1, PLAN.md §8b, UI-TRACK.md §5): the UI run equals its headless twin. Step EU (mx-e2e.ps1, after E8F) runs the
// tester's ui-e2e use case for Stamper and writes out/ui-e2e-stamper.json; verify.mjs reloads each variant's files and the
// twin's and recomputes, strictly, with no false-fail mask: (a) projectExecutablePlan() of the UI translate = the twin's
// out/executable-plan.json projection, variables excluded; (b) the Stamper failed set (failed_tasks[].task_id) = the twin's
// out/execution-report.json; (c) the objects the sim ledger shows mutated (non-seed, non-read entries) inside the UI execute
// window = those inside the twin's E6 window of out/ledger.json, by end state and stable identity (W8-UIT3, below). The tester's own verdict
// must agree with the recomputation. S1 gates: the legacy variant must have run and match; the SPA variant passes as "not
// run" while /app/ is not built and gates once it runs. Other scenarios: report-only (pass, with what the record says).
export function v73FailedSet(report) {
  return [...new Set((Array.isArray(report?.failed_tasks) ? report.failed_tasks : []).map((t) => t?.task_id).filter((id) => typeof id === 'string' && id))].sort();
}
export function v73MutatedRows(entries, w) {
  if (!Array.isArray(entries) || !w?.started || !w?.ended) return null;
  return entries.filter((e) => !String(e.type).startsWith('read') && e.sessionType !== 'seed' && e.ts >= w.started && e.ts <= w.ended).map((e) => `${e.type} ${e.objectType ?? '?'}/${e.objectId ?? '?'}`).sort();
}
// W8-UIT3 (c): the mutated OBJECTS, by end state, keyed by a stable identity. The sim mints a fresh GUID on some creates
// (tenant-stacksim ResolverTable resolveCreateInstance: id randomUUID()), so the same intent has another id in each run and
// "type objectType/objectId" is a false difference. Per distinct objectType/objectId written in the window: identity =
// objectType/<first non-empty V73_NATURAL_KEYS field of the object in that side's sim store snapshot>, or objectType/<id>
// when there is none or two of the window's objects of the type share it; end state = the stored object without its id and
// the V73_VOLATILE fields at any depth (null when the store has no such object). The same identities, the same write row
// types per object and the same end state, or (c) fails. Same rules as ces-tester src/flow/ui-e2e-compare.ts
// (NATURAL_KEY_FIELDS, VOLATILE_FIELD, mutatedObjects): change both together.
export const V73_NATURAL_KEYS = ['displayName', 'DisplayName', 'Name', 'name', 'Identity'];
export const V73_VOLATILE = /DateTime$|^When(Changed|Created)(UTC)?$/i;
const v73Strip = (x) => (Array.isArray(x) ? x.map(v73Strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !V73_VOLATILE.test(k)).map(([k, v]) => [k, v73Strip(v)])) : x);
export function v73EndState(obj) {
  if (!obj) return null;
  const { id: _id, ...rest } = obj;
  return canonJson(v73Strip(rest));
}
export function v73MutatedObjects(entries, w, store) {
  if (!Array.isArray(entries) || !w?.started || !w?.ended || !store) return null;
  const by = new Map();
  for (const e of entries) {
    if (String(e.type).startsWith('read') || e.sessionType === 'seed' || e.ts < w.started || e.ts > w.ended) continue;
    const type = e.objectType ?? '?', id = e.objectId ?? '?', k = JSON.stringify([type, id]);
    if (!by.has(k)) by.set(k, { type, id, writes: [] });
    by.get(k).writes.push(String(e.type));
  }
  const objs = [...by.values()].map((o) => {
    const obj = store.collections?.[o.type]?.[o.id];
    const nk = V73_NATURAL_KEYS.map((f) => obj?.[f]).find((v) => typeof v === 'string' && v.length > 0);
    return { ...o, nk, state: v73EndState(obj) };
  });
  const count = new Map();
  for (const o of objs) if (o.nk !== undefined) count.set(`${o.type}/${o.nk}`, (count.get(`${o.type}/${o.nk}`) ?? 0) + 1);
  return objs.map((o) => ({ identity: o.nk !== undefined && count.get(`${o.type}/${o.nk}`) === 1 ? `${o.type}/${o.nk}` : `${o.type}/${o.id}`, writes: [...o.writes].sort(), state: o.state }))
    .sort((x, y) => (x.identity < y.identity ? -1 : x.identity > y.identity ? 1 : 0));
}
const v73List = (xs) => `[${xs.slice(0, 4).join('; ')}${xs.length > 4 ? ` +${xs.length - 4}` : ''}]`;
function v73ObjectsDiff(ui, twin) {
  const parts = [];
  const d = v73Diff(ui.map((o) => o.identity), twin.map((o) => o.identity));
  if (d) parts.push(d);
  const tby = new Map(twin.map((o) => [o.identity, o]));
  const writes = [], states = [];
  for (const o of ui) {
    const t = tby.get(o.identity);
    if (!t) continue;
    if (o.writes.join(',') !== t.writes.join(',')) writes.push(`${o.identity} (UI ${o.writes.length}, twin ${t.writes.length})`);
    if (o.state !== t.state) {
      const x = o.state === null ? null : JSON.parse(o.state), y = t.state === null ? null : JSON.parse(t.state);
      const field = !x || !y ? (x ? 'absent in the twin store' : 'absent in the UI store') : `field ${[...new Set([...Object.keys(x), ...Object.keys(y)])].sort().find((k) => canonJson(x[k]) !== canonJson(y[k])) ?? '?'}`;
      states.push(`${o.identity} (${field})`);
    }
  }
  if (writes.length) parts.push(`writes differ ${v73List(writes)}`);
  if (states.length) parts.push(`end state differs ${v73List(states)}`);
  return parts.length ? parts.join('; ') : null;
}
const v73Diff = (ui, twin) => {
  const left = [...twin], onlyUi = [];
  for (const x of ui) { const i = left.indexOf(x); if (i === -1) onlyUi.push(x); else left.splice(i, 1); }
  return onlyUi.length || left.length ? `UI only [${onlyUi.slice(0, 4).join('; ')}${onlyUi.length > 4 ? ` +${onlyUi.length - 4}` : ''}], twin only [${left.slice(0, 4).join('; ')}${left.length > 4 ? ` +${left.length - 4}` : ''}]` : null;
};
// variants: [{ id, ran, reason, error, testerPass, projection, report, ledger, window, store }] (the UI side, reloaded by verify.mjs);
// twin: { projection, report, ledger, window, store } (window = steps.json E6; store = the sim store snapshots, W8-UIT3).
export function judgeV73({ slug, error = null, record = null, stale = null, twin = {}, variants = [] }) {
  const summary = (vs) => vs.map((v) => `${v.id} ${v.ran ? (v.testerPass ? 'ran, tester: equal' : `ran, tester: differs${v.error ? ` (${v.error})` : ''}`) : `not run (${v.reason ?? 'no reason'})`}`).join('; ');
  // FIN-35 (V73 x4, FINISH-PLAN.md FIN-33 / FIN-35): every scenario gates; before, only S1 did and the rest reported.
  void summary;
  if (error) return { pass: false, detail: `V73 inputs failed to load: ${error}` };
  if (!record) return { pass: false, detail: 'no out/ui-e2e-stamper.json (step EU did not run)' };
  if (stale) return { pass: false, detail: stale };
  if (record.slug !== slug) return { pass: false, detail: `out/ui-e2e-stamper.json is for ${record.slug}, not ${slug}` };
  const problems = [], notes = [];
  if (!variants.some((v) => v.id === 'legacy' && v.ran)) problems.push(`legacy console not run${variants.find((v) => v.id === 'legacy')?.reason ? `: ${variants.find((v) => v.id === 'legacy').reason}` : ''}`);
  for (const v of variants) {
    if (!v.ran) {
      if (v.id === 'spa' && /not built/i.test(v.reason ?? '')) notes.push('spa not run (/app/ not built)');
      else if (v.id !== 'legacy') problems.push(`${v.id} not run: ${v.reason ?? 'no reason'}`);
      continue;
    }
    if (v.error) { problems.push(`${v.id}: the UI run failed: ${v.error}`); continue; }
    const vp = [];
    if (!v.projection || !twin.projection) vp.push(`(a) no ${v.projection ? 'twin out/executable-plan.json' : 'UI executable plan'} projection`);
    else { const d = firstProjectionDiff(v.projection, twin.projection, { variables: false }); if (d) vp.push(`(a) UI translate projection != twin (variables excluded): first difference ${d}`); }
    if (!v.report || !twin.report) vp.push(`(b) no ${v.report ? 'twin out/execution-report.json' : 'UI execution report'}`);
    else { const d = v73Diff(v73FailedSet(v.report), v73FailedSet(twin.report)); if (d) vp.push(`(b) failed set differs: ${d}`); }
    const ur = v73MutatedObjects(v.ledger, v.window, v.store), tr = v73MutatedObjects(twin.ledger, twin.window, twin.store);
    const rows = (os) => os.reduce((n, o) => n + o.writes.length, 0);
    if (!ur || !tr) vp.push(`(c) no ${ur ? 'twin out/ledger.json, E6 window or twin sim store snapshot' : 'UI ledger snapshot, execute window or UI sim store snapshot'}`);
    else { const d = v73ObjectsDiff(ur, tr); if (d) vp.push(`(c) mutated objects differ (UI ${ur.length} objects / ${rows(ur)} rows, twin ${tr.length} objects / ${rows(tr)} rows): ${d}`); }
    if (v.testerPass !== (vp.length === 0)) vp.push(`the tester's record says ${v.testerPass ? 'equal' : 'differs'}, verify recomputed ${vp.length ? 'differs' : 'equal'}`);
    if (vp.length) problems.push(`${v.id}: ${vp.join('; ')}`);
    else notes.push(`${v.id} = twin: ${v.projection.tasks.length} tasks (variables excluded), ${v73FailedSet(v.report).length} failed, ${ur.length} mutated objects (${rows(ur)} ledger rows) with the same end state`);
  }
  return verdict(problems, notes.join('; '));
}

// V43b (W3.2; W8-ENC excuse): no false drift across the E7 passes. passes = [pass 1, pass 2, pass 3], each
// { name, events, stale } as verify.mjs builds them; driftOf(p) = p's drift event. Passes 2 and 3 must be empty with no
// regression. Pass 1 compares with the previous run's last non-forced snapshot (E7B on a scenario with an E7A), and the run
// resets the simulator first, so a control the scenario's E7A fixes (expectedIds = adminops-e7a.json expected_improvements,
// the list V47 reads) is always met there and not met now: such pass-1 regressions are excused and named in the detail.
// Any other pass-1 regression, and any regression on passes 2 or 3 (excused ids included), still fails.
export function judgeV43b({ passes = [], driftOf, expectedIds = [], notW3 = 'run predates EO-collection W3' }) {
  const problems = [];
  const excusedAll = [];
  const expected = new Set(expectedIds);
  for (const [i, wantEmpty] of [[0, false], [1, true], [2, true]]) {
    const p = passes[i] ?? { name: `E7 pass ${i + 1}`, events: null };
    if (!p.events) { problems.push(`${p.name}: ${p.stale ?? 'no assess stream'}`); continue; }
    const d = driftOf(p);
    if (!d) { problems.push(`${p.name}: no drift event (${notW3})`); continue; }
    const regs = (d.regressions ?? []).map((r) => r.controlId);
    const excused = i === 0 ? regs.filter((id) => expected.has(id)) : [];
    const other = regs.filter((id) => !excused.includes(id));
    excusedAll.push(...excused);
    if (other.length) problems.push(`${p.name}: regressions ${other.join(', ')}`);
    if (wantEmpty && d.empty !== true) problems.push(`${p.name}: drift not empty (${JSON.stringify(d.summary)})`);
    if ((p.events ?? []).some((e) => e.type === 'drift_error' || e.type === 'poam_reconcile_failed')) problems.push(`${p.name}: drift_error or poam_reconcile_failed`);
  }
  const note = excusedAll.length ? `; excused on pass 1 (the scenario's expected_improvements, re-broken by the sim reset): ${excusedAll.join(', ')}` : '';
  const r = verdict(problems, `E7 passes 2 and 3: drift empty; pass 1: no regression${note}`);
  if (!r.pass) r.detail += note;
  return r;
}
