#!/usr/bin/env node
// MX verify (Blue Heron Defense, CES team): checks V1-V11, the v2 checks (V12-V29), the SSP-uplift checks (V30-V36) and the
// EO-collection checks (V37-V44: freshness, provenance, empty payloads, tenant scope, watermarks, hash chain, regression and
// drift, date filter) over one e2e run; synthetic-customer W0 adds V49 (identity scan) and V58 (fictional banner) and
// extends V10 to %LOCALAPPDATA%\CES; synthetic-customer W1 adds V54 (overrides retired); synthetic-customer W2 adds V45-V48
// (AdminOps in the loop: evidence rows, write windows, E7B drift, no forced-run revert) and the E6X / E7A windows in V7;
// synthetic-customer W3 adds V55 (postchecks assert state; gates and renderables never SAT without an action);
// wave W7 (W7-PKG) adds V60-V71 (PLAN.md §5: CUI Boundary, BTC, hand-off refs, E7A, break-glass, leaver workflow, rulings 1-2,
// terminal events, SC-8a / FQ-1, shared login, AC.L1-3.1.1), their judges in verify-w4.mjs.
//   node verify.mjs --root <WS> --scenario <slug> [--baseline <summary.json>] [--harness mx|tester] [--exclude-honest-nulls <file>|off]
//   (the default baseline is expected-outputs/<slug>/summary.json; muster-partial: expected-outputs/summary.json)
//   (the harness defaults to env MX_HARNESS, which mx-e2e.ps1 sets, then mx; it decides V23/V26 "not run")
// Writes <WS>/out/verify.json and <WS>/out/summary.json (the structural summary).
// Exit 0 only when every check passes. Called by verify.ps1.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { expectedOutputsFile } from './expected-outputs.mjs';
import { sprsAuthority, summaryOf } from './scorecard.mjs';
import { v49Scope, isSyntheticCustomer } from './v49-scope.mjs';
import { judgeV43b, aoTierCalls, aoTwoPersonMode } from './verify-w4.mjs';
import { projectionSentences, judgeV109, runWindowStart, judgeV6Accounting } from './verify-gap.mjs';
import { TENANT_IDENTITY_KEYS, HARNESS_GENERATED_KEYS, ALLOWED_PROVENANCE, OVERRIDES_NOT_NEEDED_LINE, isPresent, tmBody, provenanceFor } from './overrides-gate.mjs';
import { elLeaverOf, isElLeaverWrite, elAoRows, c10HoldsOnlyElRows } from './verify-fin31-leaver.mjs';

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = path.resolve(a.root);
const slug = a.scenario ?? 'muster-partial';
const ces = path.join(root, 'ces');
const out = path.join(root, 'out');
const plansDir = path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'plans');
// Synthetic-customer W0: the default baseline follows the slug (expected-outputs/<slug>/summary.json; muster-partial: the root).
const baselinePath = a.baseline ? path.resolve(a.baseline) : expectedOutputsFile(slug, 'summary.json');
const TOL = 2;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const exists = (p) => !!p && fs.existsSync(p);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const latest = (dir, prefix) => {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
};
const countBy = (xs, key) => xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
const within = (actual, base) => Math.abs(actual - base) <= TOL;

const checks = [];
function check(id, title, fn) {
  try {
    const r = fn();
    checks.push({ id, title, pass: !!r.pass, detail: r.detail });
  } catch (e) {
    checks.push({ id, title, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
}

const steps = exists(path.join(out, 'steps.json')) ? readJson(path.join(out, 'steps.json')) : {};
// Per-run cleanup follow-up (run 61): an assessment file written before this run's E1 start (steps.json) is a stale
// artefact from an earlier run; it is reported as such and never read as this run's (V14 compared run 61's pass 1 with
// run 60's passes 2 and 3). No E1 start in steps.json: mtimes are not judged.
const runStartMsOf = (st) => {
  const v = st?.E1?.started; if (!v) return NaN;
  const m = /\/Date\((-?\d+)/.exec(String(v)); if (m) return Number(m[1]);
  const t = String(v); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
};
const runStartMs = runStartMsOf(steps);
// PH-5 (R-F2 V117 red): freshness is judged against this run's first step start (E0 when it ran, else E1), since E0's
// own artefact is legitimately older than the E1 stamp (verify-gap.mjs runWindowStart). runStartMs (E1) is unchanged
// for the checks that use it as the run window.
const freshRef = runWindowStart(steps);
const staleOf = (f) => (exists(f) && Number.isFinite(freshRef.ms) && fs.statSync(f).mtimeMs < freshRef.ms
  ? `stale artefact from an earlier run: ${path.basename(f)} (written ${new Date(fs.statSync(f).mtimeMs).toISOString()}, before this run's ${freshRef.step} start ${freshRef.started})` : null);
const freshJson = (f) => (exists(f) && !staleOf(f) ? readJson(f) : null);
const pMP = latest(plansDir, 'manual-mission-plan-');
const pTM = latest(plansDir, 'tenant-manifest-');
const pIM = latest(plansDir, 'infrastructure-manifest-');
const planDir = path.join(out, 'plan');
const mp = exists(pMP) ? readJson(pMP) : null;
const tm = exists(pTM) ? readJson(pTM) : null;
const trace = exists(path.join(planDir, 'plan-trace.json')) ? readJson(path.join(planDir, 'plan-trace.json')) : null;
const discovery = exists(path.join(out, 'discovery-result.json')) ? readJson(path.join(out, 'discovery-result.json')) : null;
const readiness = exists(path.join(planDir, `readiness-result-${slug}.json`)) ? readJson(path.join(planDir, `readiness-result-${slug}.json`)) : null;
const report = exists(path.join(out, 'execution-report.json')) ? readJson(path.join(out, 'execution-report.json')) : null;
const ssp = exists(path.join(out, 'ssp.json')) ? readJson(path.join(out, 'ssp.json')) : null;
const assess = freshJson(path.join(out, 'eo-assess.json')) ?? [];
const assessSummary = assess.find((e) => e.type === 'assess_summary') ?? null;
const baseline = exists(baselinePath) ? readJson(baselinePath) : null;
const directives = mp?.outputs?.human_readable_mission_plan?.control_directives ?? [];
const posture = mp?.inputs?.readiness_posture ?? null;
const failedTaskNames = (report?.failed_tasks ?? []).map((t) => String(t.error ?? t.task_id).split(':')[0]).sort();
const sspStatus = countBy(ssp?.controlImplementations ?? [], (c) => c.status);

// The structural summary (also what expected-outputs/summary.json holds).
const summary = {
  scenario: slug,
  directives_total: directives.length,
  directives_by_type: countBy(directives, (d) => d.directive),
  steps_total: mp?.outputs?.human_readable_mission_plan?.steps?.length ?? null,
  mp_posture_summary: posture?.control_status_summary ?? null,
  requirement_results: trace?.requirement_results ?? null,
  discovery_postures: countBy(discovery?.observations ?? [], (o) => o.derived_posture),
  discovered_facts: trace?.discovered_facts ?? null,
  infrastructure_manifest: !!pIM,
  stamper: report ? { status: report.status, ...report.summary, failed_tasks: failedTaskNames } : null,
  eo_assess: assessSummary
    ? { controls_met: assessSummary.controls_met, controls_not_met: assessSummary.controls_not_met, controls_partial: assessSummary.controls_partial, controls_not_assessed: assessSummary.controls_not_assessed, sprs_score: assessSummary.sprs_score }
    : null,
  ssp: ssp
    ? { sections: Object.keys(ssp).sort(), control_implementations: (ssp.controlImplementations ?? []).length, status_counts: sspStatus, source_artifacts: ssp.sourceArtifacts, system_name_source: ssp.systemName === `${ssp.tenantId} System` ? 'fallback' : 'manifest-or-variables' }
    : null,
  // W1.5: per-control SSP status (control id -> status).
  status_by_control: ssp ? Object.fromEntries((ssp.controlImplementations ?? []).map((c) => [c.control_id, c.status])) : null,
};

// V1
// Synthetic-customer W2: E7B (one more EO assess after AdminOps) runs under both harnesses; E6X (S3 re-injection) and
// E7A (AdminOps) run under the tester harness only.
const harnessEarly = String(a.harness ?? process.env.MX_HARNESS ?? 'mx').toLowerCase();
check('V1', 'All E-step exit codes are 0', () => {
  const want = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', ...(harnessEarly === 'tester' ? ['E6X'] : []), 'E8.5', 'E8.6', 'E7', ...(harnessEarly === 'tester' ? ['E7A'] : []), 'E7B', 'E8', 'E8B'];
  const bad = want.filter((s) => !steps[s] || steps[s].rc !== 0);
  return { pass: bad.length === 0, detail: bad.length ? `failed or missing: ${bad.join(', ')}` : `${want.join(', ')} rc=0${steps.E2?.raw_rc ? ` (E2 raw exit ${steps.E2.raw_rc}: libuv exit abort after ok:true, see log)` : ''}; E4 mode=${steps.E4?.mode}` };
});

// V2
const shared = await import(pathToFileURL(path.join(ces, 'ces-shared', 'dist', 'types', 'mission-plan.contract.js')).href);
check('V2', 'MP and TM parse with the ces-shared schemas', () => {
  const m = shared.ManualMissionPlanSchema.safeParse(mp);
  const t = shared.TenantManifestSchema.safeParse(tm);
  return { pass: m.success && t.success, detail: `MP ${m.success ? 'ok' : JSON.stringify(m.error.issues.slice(0, 2))}; TM ${t.success ? 'ok' : JSON.stringify(t.error.issues.slice(0, 2))}` };
});

// V3
check('V3', 'The MP has 110 control directives', () => ({
  pass: directives.length === 110,
  detail: `${directives.length} directives ${JSON.stringify(summary.directives_by_type)}`,
}));

// V4
check('V4', 'Provenance: the plan came from discovery', () => {
  const problems = [];
  const dObs = discovery?.observations ?? [];
  const rObs = readiness?.observations ?? [];
  const dC = countBy(dObs, (o) => o.derived_posture);
  const rC = countBy(rObs, (o) => o.derived_posture);
  if (dObs.length === 0) problems.push('discovery file has no observations');
  if (rObs.length !== dObs.length) problems.push(`readiness observations ${rObs.length} != discovery ${dObs.length}`);
  for (const k of ['met', 'unknown', 'not_met', 'partial']) if ((dC[k] ?? 0) !== (rC[k] ?? 0)) problems.push(`posture ${k}: readiness ${rC[k] ?? 0} != discovery ${dC[k] ?? 0}`);
  const withRan = rObs.filter((o) => (o.ran_entry_ids ?? []).length > 0).length;
  if (withRan === 0 || withRan !== rObs.length) problems.push(`ran_entry_ids non-empty on ${withRan}/${rObs.length} observations`);
  const auto = (readiness?.facts ?? []).filter((f) => f.provenance === 'auto_detected').length;
  if (!(auto > 0)) problems.push('no discovered (auto_detected) facts');
  const s = posture?.control_status_summary ?? {};
  const rr = trace?.requirement_results ?? {};
  for (const k of ['met', 'partial', 'not_met', 'unknown']) if ((s[k] ?? -1) !== (rr[k] ?? -2)) problems.push(`MP posture ${k}=${s[k]} != compiled requirement results ${rr[k]}`);
  if ((rr.total ?? 0) === 0) problems.push('no requirement results compiled');
  const text = exists(pMP) ? fs.readFileSync(pMP, 'utf8') : '';
  if (text.includes('1970-01-01')) problems.push('MP contains a 1970-01-01 date');
  const planMP = latest(planDir, 'manual-mission-plan-');
  // W3.3c (B9): muster-api rewrites the two policy refs' file_name to its own <ts>; that field alone may differ.
  const mpSansPolicyFileNames = (p) => {
    const m = readJson(p);
    for (const k of ['policy_inputs_profile_ref', 'policy_set_manifest_ref']) if (m?.inputs?.[k]) delete m.inputs[k].file_name;
    return JSON.stringify(m);
  };
  if (!planMP || !pMP || (sha(planMP) !== sha(pMP) && mpSansPolicyFileNames(planMP) !== mpSansPolicyFileNames(pMP))) problems.push('pushed MP differs from the plan-from-discovery MP');
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `observations ${rObs.length} (met ${rC.met ?? 0}, unknown ${rC.unknown ?? 0}) match discovery; auto_detected facts ${auto}; MP posture ${JSON.stringify({ met: s.met, partial: s.partial, not_met: s.not_met, unknown: s.unknown })} = compiled results; no 1970 dates`,
  };
});

// V5 (+ MG-12): the picker regex also covers the hand-off envelopes, and the MP's inputs.*_ref resolve to the pushed
// envelopes with matching hashes (recomputed with ces-shared canonicalSha256 when its dist is importable).
const canon = await import(pathToFileURL(path.join(ces, 'ces-shared', 'dist', 'crypto', 'canonicalHash.js')).href).catch(() => null);
const v5w4 = await import('./verify-w4.mjs');
check('V5', "Stamper's picker regex matches all pushed files; MP hand-off refs resolve with matching hashes (the three EO-only envelopes against EO's intake, FIN-35 S-1)", () => {
  // W3.3c (B9): the two policy envelopes (policy-inputs-profile-, policy-set-manifest-) are pushed files too.
  // W7-PKG: so is the CUI Boundary envelope (cui-boundary-, W7-MX2; its reference is checked by V60 / V62).
  const re = [/^manual-mission-plan[-_]/, /^tenant-manifest[-_]/, /^infra(structure)?-manifest[-_]/, /^si-baseline[-_]/, /^tcp[-_]/, /^readiness-posture[-_]/, /^policy-inputs-profile[-_]/, /^policy-set-manifest[-_]/, /^cui-boundary[-_]/];
  const files = fs.existsSync(plansDir) ? fs.readdirSync(plansDir) : [];
  const unmatched = files.filter((f) => !re.some((r) => r.test(f)));
  const needIM = !!latest(planDir, 'infrastructure-manifest-');
  const problems = [];
  if (!(files.length > 0 && unmatched.length === 0 && !!pMP && !!pTM && (!needIM || !!pIM))) problems.push(`picker: unmatched ${unmatched.join(', ') || 'none'}; MP ${!!pMP}, TM ${!!pTM}, IM ${pIM ? 'present' : 'absent'}${needIM ? ' (expected)' : ''}`);
  // si_baseline and readiness_posture are always built; the TCP only when one was built (then tcp_ref carries a hash).
  // FIN-35 S-1 (GD-e): these three are EO-only; muster-api delivers them to EO's intake and no longer writes them to
  // Stamper's plans folder, so the refs resolve against EO's newest intake receipt (<WS>/out/eo/intake/<slug>/).
  const kinds = [['si_baseline_ref', 'si_baseline', true], ['tcp_ref', 'tcp', false], ['readiness_posture_ref', 'readiness_posture', true]];
  const intake = v5w4.readEoIntake(path.join(out, 'eo'), slug);
  if (!intake) problems.push(`no EO intake receipt under out/eo/intake/${slug}/ (the three EO-only envelopes resolve there since FIN-35 S-1)`);
  const resolved = [];
  for (const [key, kind, required] of kinds) {
    const ref = mp?.inputs?.[key];
    const f = intake?.files?.[kind] ?? null;
    if (!ref?.hash_sha256) { if (required || f) problems.push(`MP inputs.${key} has no hash_sha256${f ? ` but EO's intake holds ${kind}` : ''}`); continue; }
    if (!intake) continue;
    if (!f) { problems.push(`inputs.${key} does not resolve: EO intake ${intake.receiptId} has no ${kind}`); continue; }
    const env = readJson(f);
    const recomputed = canon ? canon.canonicalSha256(env.artifact) : null;
    if (env.hash_sha256 !== ref.hash_sha256 || env.artifact_id !== ref.artifact_id) problems.push(`${path.basename(f)}: envelope hash/id differ from inputs.${key}`);
    else if (recomputed && recomputed !== env.hash_sha256) problems.push(`${path.basename(f)}: canonicalSha256(artifact) ${recomputed.slice(0, 12)}… != recorded ${env.hash_sha256.slice(0, 12)}…`);
    else resolved.push(`${key}=${env.hash_sha256.slice(0, 12)}…${recomputed ? ' (recomputed)' : ' (recorded)'}`);
  }
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${files.length} files; unmatched: none; IM ${pIM ? 'present' : 'absent'}${needIM ? ' (expected)' : ''}; refs ${resolved.join(', ')}` };
});

// V6 (PH-9 P9-PK): since DEPTH-3 folds directives by objective credit, every directive is accounted for (planned or
// folded; judgeV6Accounting in verify-gap.mjs) instead of directive count = task count.
check('V6', 'Translate exit 0; execute report exists; every MP directive planned or folded by objective credit; counts within baseline +/-2', () => {
  if (steps.E5?.rc !== 0) return { pass: false, detail: 'translate did not exit 0' };
  if (!report) return { pass: false, detail: 'no execution report' };
  const s = report.summary;
  const v6Plan = exists(path.join(out, 'executable-plan.json')) ? readJson(path.join(out, 'executable-plan.json')) : null;
  const acct = judgeV6Accounting({ directives, plan: v6Plan, report });
  if (!acct.pass) return acct;
  if (!baseline?.stamper) return { pass: true, detail: `${acct.detail}; no baseline yet: this run sets it (completed ${s.completed}, failed ${s.failed} of ${s.total_tasks})` };
  const b = baseline.stamper;
  const ok = s.completed >= b.completed - TOL && s.failed <= b.failed + TOL;
  return { pass: ok, detail: `${acct.detail}; completed ${s.completed} (baseline ${b.completed}), failed ${s.failed} (baseline ${b.failed}), tolerance ${TOL}` };
});

// V7
check('V7', 'Only the scenario build (E1), Stamper (E6), the S3 injection (E6X), the leaver flow (EL: A-22 on the confirmed leaver only) and AdminOps (E7A) wrote to the sim ledger, each in its own window; discovery added zero writes', () => {
  const ledgerPath = path.join(out, 'ledger.json');
  if (!exists(ledgerPath)) return { pass: false, detail: 'no ledger snapshot' };
  const entries = readJson(ledgerPath).data ?? [];
  const allWrites = entries.filter((e) => !String(e.type).startsWith('read') && e.sessionType !== 'seed');
  const inWin = (e, s) => s && e.ts >= s.started && e.ts <= s.ended;
  // S1 fix (2026-10-28): the sim tags every mutation actor 'ao', so writes are attributed by step window only.
  // [E1.started, E2.started) is the scenario build (`stacksim scenario <slug>` replaying the scenario's PATCH
  // steps); its count must equal the scenario file's write steps, and it is not an operator write.
  const simScenario = path.join(ces, 'tenant-stacksim', 'scenarios', `${slug}.json`);
  const buildSteps = exists(simScenario) ? (readJson(simScenario).steps ?? []).filter((s) => String(s.method ?? '').toUpperCase() !== 'GET').length : null;
  const inBuild = (e) => !!steps.E1?.started && !!steps.E2?.started && e.ts >= steps.E1.started && e.ts < steps.E2.started;
  const byBuild = allWrites.filter(inBuild);
  const writes = allWrites.filter((e) => !inBuild(e));
  const byE2 = writes.filter((e) => inWin(e, steps.E2));
  // Synthetic-customer W2: the E6X window (S3 re-injection) is allowed only when the run injected something
  // (out/e6x.json), the E7A window (AdminOps) only when the run's E7A record has write ops; nowhere else.
  const e6xRec = exists(path.join(out, 'e6x.json')) ? readJson(path.join(out, 'e6x.json')) : null;
  const e7aRec = exists(path.join(out, 'adminops-e7a.json')) ? readJson(path.join(out, 'adminops-e7a.json')) : null;
  const allowX = (e6xRec?.injections ?? []).length > 0 && !!steps.E6X;
  const allowA = (e7aRec?.write_ops ?? 0) > 0 && !!steps.E7A;
  // FIX-EL (R-F11): step EL (after E5, before E6) runs A-22 on the leaver a tenant administrator confirmed. Its window is
  // allowed only on a confirm-mode record of this run (out/leaver-flow.json), and only for A-22's writes on that leaver
  // (the user, its group memberships, its MFA methods: verify-fin31-leaver.mjs isElLeaverWrite); any other write stays outside.
  const elRec = exists(path.join(out, 'leaver-flow.json')) ? readJson(path.join(out, 'leaver-flow.json')) : null;
  const leaver = elLeaverOf(elRec, steps);
  const allowed = (e) => inWin(e, steps.E6) || (allowX && inWin(e, steps.E6X)) || (allowA && inWin(e, steps.E7A)) || isElLeaverWrite(e, leaver);
  const outside = writes.filter((e) => !allowed(e));
  const byE6 = writes.filter((e) => inWin(e, steps.E6));
  const byE6X = writes.filter((e) => inWin(e, steps.E6X));
  const byE7A = writes.filter((e) => inWin(e, steps.E7A));
  const byEL = writes.filter((e) => isElLeaverWrite(e, leaver));
  const inELWin = writes.filter((e) => inWin(e, steps.EL));
  const buildOk = !!steps.E1?.started && !!steps.E2?.started && buildSteps !== null && byBuild.length === buildSteps;
  return {
    pass: buildOk && byE2.length === 0 && outside.length === 0 && byE6.length > 0 && (!allowA || byE7A.length > 0) && (!leaver || byEL.length > 0),
    detail: `${entries.length} entries; non-seed writes ${allWrites.length}: scenario build [E1 start, E2 start) ${byBuild.length} (scenario write steps ${buildSteps ?? 'unknown: no sim scenario file'}), during EL (leaver flow; ${leaver ? `allowed for A-22 on ${leaver.userId} only` : 'not allowed'}) ${byEL.length} of ${inELWin.length}, during E6 (Stamper) ${byE6.length}, during E6X (injection; ${allowX ? 'allowed' : 'not allowed'}) ${byE6X.length}, during E7A (AdminOps; ${allowA ? `allowed, ${e7aRec.write_ops} write op(s)` : 'not allowed'}) ${byE7A.length}, during E2 (discovery) ${byE2.length}, outside the allowed windows ${outside.length}`,
  };
});

// V8
check('V8', 'SSP sections, implementation count, TM and MP loaded', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  const problems = [];
  const required = ['sspId', 'systemName', 'systemDescription', 'authorizationBoundary', 'systemComponents', 'networkTopology', 'hostingModel', 'controlImplementations', 'responsibleParties', 'continuousMonitoringActivities', 'appendices', 'sourceArtifacts', 'riskAssessment', 'incidentResponse'];
  const missing = required.filter((k) => !(k in ssp));
  if (missing.length) problems.push(`missing sections: ${missing.join(', ')}`);
  const n = (ssp.controlImplementations ?? []).length;
  const want = baseline?.ssp?.control_implementations ?? 110;
  if (n !== want) problems.push(`${n} control implementations (baseline ${want})`);
  for (const art of ['Mission Plan', 'Tenant Manifest']) if (!(ssp.sourceArtifacts ?? []).includes(art)) problems.push(`sourceArtifacts lacks ${art}`);
  // W1.5: status counts are asserted strictly against the baseline, with the per-key diff printed.
  const baseCounts = baseline?.ssp?.status_counts;
  if (!baseCounts) problems.push('no baseline ssp.status_counts');
  else {
    const keys = [...new Set([...Object.keys(baseCounts), ...Object.keys(sspStatus)])].sort();
    const diff = keys.filter((k) => (sspStatus[k] ?? 0) !== (baseCounts[k] ?? 0)).map((k) => `${k} ${sspStatus[k] ?? 0} vs baseline ${baseCounts[k] ?? 0}`);
    if (diff.length) {
      const baseBy = baseline?.status_by_control;
      const moved = baseBy ? Object.keys(summary.status_by_control ?? {}).filter((id) => baseBy[id] !== summary.status_by_control[id]).map((id) => `${id} ${baseBy[id]}->${summary.status_by_control[id]}`) : [];
      problems.push(`status counts differ: ${diff.join(', ')}${moved.length ? `; controls moved: ${moved.join(', ')}` : ''}`);
    }
  }
  const docx = path.join(out, 'ssp.docx');
  const head = exists(docx) ? fs.readFileSync(docx).subarray(0, 2).toString('latin1') : '';
  if (head !== 'PK' || fs.statSync(docx).size < 10000) problems.push('SSP DOCX missing or not a DOCX');
  const poam = exists(path.join(out, 'poam.json')) ? readJson(path.join(out, 'poam.json')) : null;
  if (!poam?.poamId) problems.push('no POA&M JSON');
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `all ${required.length} sections; ${n} implementations (baseline ${want}), status ${JSON.stringify(sspStatus)} = baseline; sources ${JSON.stringify(ssp.sourceArtifacts)}; DOCX ${fs.statSync(docx).size} bytes; POA&M ok; system name source: ${summary.ssp.system_name_source} (K4)`,
  };
});

// V9
check('V9', "The SSP's MP is the pushed MP", () => {
  const eoLog = path.join(out, 'logs', 'E7-eo.out');
  const text = exists(eoLog) ? fs.readFileSync(eoLog, 'utf8') : '';
  const m = text.match(/Auto-discovered mission plan: (.+)/);
  const used = m ? m[1].trim() : null;
  const same = !!used && !!pMP && path.resolve(used).toLowerCase() === path.resolve(pMP).toLowerCase();
  return { pass: same, detail: `EO loaded ${used ? path.basename(used) : '(none)'}; pushed ${pMP ? path.basename(pMP) : '(none)'}` };
});

// V10
// Synthetic-customer W0: %LOCALAPPDATA%\CES is watched too. V24's snapshot-outside (nb-tools) watches C:\CES_Pipeline,
// ~/.ces, ~/.stamper, <usertemp>/ces* and the current-build repos, not %LOCALAPPDATA%\CES, so V10 carries it. A watched
// folder missing from either snapshot fails (a key only in "after" would otherwise go unseen).
const V10_WATCHED = ['C:\\CES_Pipeline', '~\\.ces', '~\\.stamper', '%LOCALAPPDATA%\\CES'];
check('V10', 'Nothing written outside the workspace (C:\\CES_Pipeline, ~/.ces, ~/.stamper, %LOCALAPPDATA%\\CES)', () => {
  const b = path.join(out, 'outside-before.json');
  const f = path.join(out, 'outside-after.json');
  if (!exists(b) || !exists(f)) return { pass: false, detail: 'missing outside-before/after snapshot' };
  const B = readJson(b), A = readJson(f);
  const unwatched = V10_WATCHED.filter((k) => !(k in B) || !(k in A));
  const keys = [...new Set([...Object.keys(B), ...Object.keys(A)])].filter((k) => k !== 'taken');
  const diffs = keys.filter((k) => (k in B) && (k in A) && JSON.stringify(B[k]) !== JSON.stringify(A[k]));
  const problems = [];
  if (unwatched.length) problems.push(`not in both snapshots: ${unwatched.join(', ')} (snapshot taken before W0?)`);
  if (diffs.length) problems.push(`changed: ${diffs.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : keys.map((k) => `${k}: ${B[k].count} files, unchanged`).join('; ') };
});

// V109 (FIN-01 e): out/unit-gate.json is newer than the newest commit in every workspace repo (<WS>\ces and its child
// repos, <WS>\pkg\*); V11, V21 and V22 read the gate and fail when it is stale. Judge in verify-gap.mjs (judgeV109).
const unitGateFile = path.join(out, 'unit-gate.json');
const gitRepoDirs = [ces, ...(exists(ces) ? fs.readdirSync(ces).map((d) => path.join(ces, d)) : []), ...(exists(path.join(root, 'pkg')) ? fs.readdirSync(path.join(root, 'pkg')).map((d) => path.join(root, 'pkg', d)) : [])].filter((d) => exists(path.join(d, '.git')));
const unitGateFresh = judgeV109({
  gateMs: exists(unitGateFile) ? fs.statSync(unitGateFile).mtimeMs : null,
  repos: gitRepoDirs.map((d) => {
    const r = spawnSync('git', ['-C', d, 'log', '-1', '--format=%ct'], { encoding: 'utf8' });
    const s = Number(String(r.stdout ?? '').trim());
    return { repo: path.relative(root, d).split(path.sep).join('/'), commitMs: r.status === 0 && s > 0 ? s * 1000 : null };
  }),
});
check('V109', 'Unit gate fresh: out/unit-gate.json is newer than the newest commit in every workspace repo', () => unitGateFresh);

// V11
check('V11', 'Unit-suite failures are a subset of known-failures.json', () => {
  const g = path.join(out, 'unit-gate.json');
  if (!exists(g)) return { pass: false, detail: 'no unit-gate.json (run scripts/run-tests.ps1)' };
  const gate = readJson(g);
  return { pass: gate.pass === true && unitGateFresh.pass, detail: `${gate.totals.passed} passed, ${gate.totals.failed} failed (${gate.failures.length - gate.unexpected.length} known), ${gate.unexpected.length} unexpected${unitGateFresh.pass ? '' : `; stale unit gate (V109): ${unitGateFresh.detail}`}` };
});

// V14 (v2, FX-15 / K5): three back-to-back assessments of the same sim state give identical counts.
check('V14', 'Three back-to-back EO assessments give identical counts', () => {
  const files = ['eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json'].map((f) => path.join(out, f));
  if (!files.every(exists)) return { pass: false, detail: `missing: ${files.filter((f) => !exists(f)).map((f) => path.basename(f)).join(', ')} (E7 runs assess three times in v2)${files.some(staleOf) ? `; ${files.map(staleOf).filter(Boolean).join('; ')}` : ''}` };
  if (files.some(staleOf)) return { pass: false, detail: files.map(staleOf).filter(Boolean).join('; ') };
  const keys = ['controls_met', 'controls_not_met', 'controls_partial', 'controls_not_assessed', 'sprs_score', 'liveAssessmentCount'];
  const sums = files.map((f) => readJson(f).find((e) => e.type === 'assess_summary') ?? null);
  if (sums.some((s) => !s)) return { pass: false, detail: 'an assessment produced no assess_summary event' };
  const pick = (s) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, s[k]])));
  const same = sums.every((s) => pick(s) === pick(sums[0]));
  return { pass: same, detail: same ? `3 runs identical: ${pick(sums[0])}` : `runs differ: ${sums.map(pick).join(' | ')}` };
});

// V15 (v2, FX-02 / FX-05): Stamper evidence lands in the tenant folder, per task, and EO finds it; failure records are truthful.
check('V15', 'Stamper evidence in the tenant folder, one record per task, found by EO, failures recorded', () => {
  const tenantDir = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
  const evDir = path.join(tenantDir, 'evidence');
  const byTask = path.join(tenantDir, 'evidence-by-task');
  const problems = [];
  const evFiles = exists(evDir) ? fs.readdirSync(evDir, { recursive: true }).filter((f) => fs.statSync(path.join(evDir, f)).isFile()) : [];
  if (!evFiles.length) problems.push(`no files under ${path.relative(root, evDir)}`);
  const taskDirs = exists(byTask) ? fs.readdirSync(byTask).filter((d) => fs.statSync(path.join(byTask, d)).isDirectory()) : [];
  const emptyTaskDirs = taskDirs.filter((d) => fs.readdirSync(path.join(byTask, d)).length === 0);
  if (!taskDirs.length) problems.push('no evidence-by-task folders');
  if (emptyTaskDirs.length) problems.push(`${emptyTaskDirs.length} empty task folders`);
  if (!(report?.evidence_collected > 0)) problems.push(`execution-report evidence_collected = ${report?.evidence_collected ?? 'n/a'}`);
  const imp = assess.find((e) => e.type === 'assess_import');
  if (!(imp?.filesFound > 0)) problems.push(`EO assess_import filesFound = ${imp?.filesFound ?? 'n/a'}`);
  // failure records: every failed task's folder holds a record that names a reason and what verification saw
  const failed = report?.failed_tasks ?? [];
  const noRecord = failed.filter((t) => {
    const dir = path.join(byTask, t.task_id);
    if (!exists(dir)) return true;
    const text = fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isFile()).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    return !/reason|outcomeRationale/i.test(text) || !/verification|blocked/i.test(text);
  });
  if (noRecord.length) problems.push(`${noRecord.length} of ${failed.length} failed tasks lack a truthful failure record (e.g. ${noRecord[0]?.task_id})`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${evFiles.length} evidence files; ${taskDirs.length} task folders; evidence_collected ${report.evidence_collected}; EO filesFound ${imp.filesFound}; ${failed.length} failure records checked` };
});

// V16 (v2, FX-01 / FX-08 / FX-10 / P1.5): no unresolved placeholder reached the sim; the inactive-account task disabled only stale, non-excluded users.
check('V16', 'No leftover {name} placeholders reached the sim; inactive-account task disabled only stale users', () => {
  const problems = [];
  const token = /"\{[A-Za-z][A-Za-z0-9_]*\}"/g;
  const store = path.join(ces, 'tenant-stacksim', '.stacksim', 'tenants', slug, 'store.json');
  if (!exists(store)) return { pass: false, detail: `no sim store at ${path.relative(root, store)}` };
  const storeText = fs.readFileSync(store, 'utf8');
  const stored = [...new Set(storeText.match(token) ?? [])];
  if (stored.length) problems.push(`placeholders stored on the sim: ${stored.join(', ')}`);
  const e6 = path.join(out, 'logs', 'E6-execute.out');
  // Only command lines count ("cmd:" in the adapter's phase lines). Descriptions and postcheck titles carry
  // naming-convention text such as {Classification}-{Handling} and are not placeholders.
  const sent = exists(e6)
    ? [...new Set(fs.readFileSync(e6, 'utf8').split(/\r?\n/).filter((l) => /\bcmd:/.test(l) && !/blocked: unresolved variable|Unresolved manifest variables|UNRESOLVED_/i.test(l)).join('\n').match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) ?? [])]
    : [];
  if (sent.length) problems.push(`placeholders in executed command lines: ${sent.slice(0, 6).join(', ')}`);
  const users = Object.values(JSON.parse(storeText).collections?.users ?? {});
  // S1 fix (2026-10-28): only users Stamper's inactive-account task disabled count: disabled in the store AND
  // written (a users mutate) inside the E6 window of the sim ledger. A user the scenario build seeds disabled
  // (S1's leaver user-40, PATCHed at E1) is not Stamper's. "Stale" = the seeded lastSignInDateTime older than
  // the task's threshold (the AddDays(-N) of IA.L2-3.5.5.disable-inactive in the executable plan; 90 if absent)
  // at E6's start, the instant the task ran, not the time verify runs.
  const ledgerPath16 = path.join(out, 'ledger.json');
  const ledger16 = exists(ledgerPath16) ? readJson(ledgerPath16).data ?? [] : null;
  if (!ledger16) problems.push('no ledger snapshot (needed to attribute disables to E6)');
  if (!steps.E6?.started) problems.push('no E6 window in steps.json');
  const e6Users = new Set((ledger16 ?? []).filter((e) => e.objectType === 'users' && e.sessionType !== 'seed' && !String(e.type).startsWith('read') && steps.E6 && e.ts >= steps.E6.started && e.ts <= steps.E6.ended).map((e) => e.objectId));
  const exePlan = path.join(out, 'executable-plan.json');
  const days = exists(exePlan) ? Number((fs.readFileSync(exePlan, 'utf8').match(/\$inactiveDate = \(Get-Date\)\.AddDays\(-(\d+)\)/) ?? [])[1] ?? 90) : 90;
  const taskNow = steps.E6?.started ? Date.parse(steps.E6.started) : NaN;
  const disabledAll = users.filter((u) => u.accountEnabled === false).map((u) => u.id).sort();
  const disabled = disabledAll.filter((id) => e6Users.has(id));
  const stale = users.filter((u) => { const d = u.signInActivity?.lastSignInDateTime; return d && (taskNow - Date.parse(d)) > days * 86400000; }).map((u) => u.id).sort();
  const overDisabled = disabled.filter((id) => !stale.includes(id));
  if (users.length && disabledAll.length === users.length) problems.push('every sim user is disabled');
  if (overDisabled.length) problems.push(`disabled by Stamper (E6) but not stale (${days} d at E6 start): ${overDisabled.join(', ')}`);
  const notStamper = disabledAll.filter((id) => !e6Users.has(id));
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `no placeholders stored or sent; disabled by Stamper in E6 ${JSON.stringify(disabled)} ⊆ stale (${days} d at E6 start) ${JSON.stringify(stale)} of ${users.length} users; disabled, not written in E6 (seed or build): ${JSON.stringify(notStamper)}` };
});

// V21 (v2, MG-28): the question register exists, every row names an output field, and the ces-muster suite
// (which enforces "every asked node has a row") passed in the unit gate.
check('V21', 'Question register present, every row names an output field, register test green', () => {
  const reg = path.join(ces, 'ces-muster', 'src', 'features', 'interview', 'questionRegister.json');
  if (!exists(reg)) return { pass: false, detail: 'no questionRegister.json' };
  const rows = readJson(reg); const list = Array.isArray(rows) ? rows : rows.rows ?? rows.questions ?? [];
  const noOut = list.filter((r) => !(Array.isArray(r.outputs ?? r.output_fields ?? r.feeds) ? (r.outputs ?? r.output_fields ?? r.feeds).length : (r.outputs ?? r.output_fields ?? r.feeds)));
  const gate = exists(path.join(out, 'unit-gate.json')) ? readJson(path.join(out, 'unit-gate.json')) : null;
  const mu = gate?.suites?.find?.((s) => s.id === 'ces-muster' || s.suite === 'ces-muster') ?? gate?.suites?.['ces-muster'] ?? null;
  const muOk = mu ? (mu.failed === 0 || mu.totals?.failed === 0) : false;
  const problems = [];
  if (list.length < 64) problems.push(`${list.length} rows (expected at least the 64 graph nodes)`);
  if (noOut.length) problems.push(`${noOut.length} rows without an output field`);
  if (!muOk) problems.push('ces-muster unit suite not green in unit-gate.json (register test runs there)');
  if (!unitGateFresh.pass) problems.push('unit-gate.json is stale (V109)');
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${list.length} rows, all with output fields; ces-muster suite green` };
});

// V22 (v2, MG-04): the parity suite ran green against the reviewed allow-list (every entry carries owner, reason, counts).
check('V22', 'MG-04 parity suite green against the reviewed allow-list', () => {
  const al = path.join(ces, 'ces-muster', 'src', 'features', 'plan', '__fixtures__', 'customers', 'parity-allowlist.json');
  if (!exists(al)) return { pass: false, detail: 'no parity-allowlist.json' };
  const a = readJson(al); const entries = Array.isArray(a) ? a : a.entries ?? a.allowlist ?? [];
  const bad = entries.filter((e) => !((e.owner || e.mg || e.producer) && e.reason && e.count !== undefined));
  const gate = exists(path.join(out, 'unit-gate.json')) ? readJson(path.join(out, 'unit-gate.json')) : null;
  const mu = gate?.suites?.find?.((s) => s.id === 'ces-muster' || s.suite === 'ces-muster') ?? gate?.suites?.['ces-muster'] ?? null;
  const muOk = mu ? (mu.failed === 0 || mu.totals?.failed === 0) : false;
  const problems = [];
  if (!entries.length) problems.push('empty allow-list');
  if (bad.length) problems.push(`${bad.length} entries without owner/reason`);
  if (!muOk) problems.push('ces-muster unit suite not green in unit-gate.json (planParity runs there)');
  if (!unitGateFresh.pass) problems.push('unit-gate.json is stale (V109)');
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${entries.length} allow-list entries, all with owner and reason; ces-muster suite green` };
});

// ---------- GC-PKG-2 judges (begin): pure; scripts/gap-pkg.test.mjs loads this block from the source ----------
// V12 system name: the SSP's systemName (the V58 "SIMULATED CUSTOMER (FICTIONAL): " marker set aside) is the TM tenant
// identity's display_name, or its primary_domain when the display name is a placeholder; never empty, never a
// placeholder ("Sim Tenant", "Tenant"), never doubled ("X - X"). Same placeholder set as EO's SspGenerator.
const PKG2_PLACEHOLDER_NAMES = new Set(['sim tenant', 'simulated tenant', 'tenant', 'test tenant', 'default directory']);
const PKG2_SIM_MARKER = 'SIMULATED CUSTOMER (FICTIONAL): ';
function pkg2IsPlaceholderName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return n === '' || PKG2_PLACEHOLDER_NAMES.has(n);
}
function judgeSystemName(systemName, tenantIdentity) {
  const problems = [];
  const full = String(systemName ?? '').trim();
  const name = full.startsWith(PKG2_SIM_MARKER) ? full.slice(PKG2_SIM_MARKER.length).trim() : full;
  if (pkg2IsPlaceholderName(name)) problems.push(`systemName is empty or a placeholder: "${full}"`);
  if (/^(.+?) - \1$/.test(name)) problems.push(`systemName is doubled: "${full}"`);
  const dn = String(tenantIdentity?.display_name ?? '').trim();
  const expected = dn && !pkg2IsPlaceholderName(dn) ? dn.replace(/^(.+?) - \1$/, '$1') : String(tenantIdentity?.primary_domain ?? '').trim();
  if (!expected) problems.push('the TM tenant_identity has neither a real display_name nor a primary_domain');
  else if (!problems.length && name !== expected) problems.push(`systemName "${full}" is not the TM tenant identity "${expected}"`);
  return problems;
}
// V30 non-met clause: a control that is not met never claims to be implemented or continuously verified. The same
// three patterns as EO's SspGenerator IMPLEMENTATION_CLAIM_PATTERNS (non-global copies here).
const PKG2_CLAIM_PATTERNS = [
  /\s*—\s*implemented and continuously verified\.?/i,
  /\bcontinuously verified\b/i,
  /(?<!\b(?:not|never)\s+(?:(?:yet|been|be|fully)\s+)*)(\b(?:is|are|been|was|were)|—)\s*(?:fully\s+)?implemented\b/i,
];
function nonMetClaimHits(controls) {
  const hits = [];
  for (const c of controls ?? []) {
    if (c.status === 'met') continue;
    const n = String(c.implementationNarrative ?? '');
    for (const re of PKG2_CLAIM_PATTERNS) {
      const m = re.exec(n);
      if (m) { hits.push(`${c.control_id} (${c.status}) "${m[0].trim()}"`); break; }
    }
  }
  return hits;
}
// ---------- GC-PKG-2 judges (end) ----------

// V12 (v2, EVC.4 / K4, MG-08; W2.5): the SSP's system name comes from the Tenant Manifest; every TM boundary
// definition (a CUI-boundary questionnaire answer) is an SSP boundary fact; zones are real boundary parts, never questionnaire keys.
check('V12', 'SSP system name from the TM; every TM boundary definition a boundary fact; no zone named like a questionnaire key', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  if (!tm) return { pass: false, detail: 'no pushed TM' };
  const inner = tm.tenant_manifest ?? tm;
  const bz = inner.boundary_zones ?? {};
  // MG-08 shape: { cui_boundary_version, definitions: [{ key, value, type }, …] }; older shapes: an array of zones, or a keyed object.
  const defs = Array.isArray(bz) ? bz : bz.definitions ?? {};
  const keys = Array.isArray(defs) ? defs.map((z) => z.key ?? z.name ?? z.id).filter(Boolean).map(String) : Object.keys(defs);
  const facts = (ssp.authorizationBoundary?.boundaryFacts ?? []).map((f) => String(f.key));
  const sspZones = (ssp.authorizationBoundary?.zones ?? []).map(String);
  const problems = [];
  if (ssp.systemNameSource !== 'tenant_manifest') problems.push(`systemNameSource = ${ssp.systemNameSource ?? 'absent'} (expected tenant_manifest)`);
  // GC-PKG-2: the generated name itself, not only its source.
  problems.push(...judgeSystemName(ssp.systemName, inner.tenant_identity));
  if (keys.length < 1) problems.push('the pushed TM carries no boundary definitions (MG-08 / the runner\'s sim-only boundary default)');
  const missing = keys.filter((k) => !facts.includes(k));
  if (missing.length) problems.push(`TM boundary definitions not in authorizationBoundary.boundaryFacts: ${missing.join(', ')}`);
  if (sspZones.length < 1) problems.push('the SSP lists no boundary zones');
  const keyLike = sspZones.filter((z) => keys.includes(z) || /^[a-z0-9]+(_[a-z0-9]+)+$/.test(z));
  if (keyLike.length) problems.push(`zones named like questionnaire keys: ${keyLike.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `systemName "${ssp.systemName}" from the TM; ${keys.length} TM definition(s) all boundary facts (${facts.length} facts); ${sspZones.length} zone(s), none named like a questionnaire key` };
});

// V18 (v2, MG-16 / P2C.1; W5 cycle 2: 22 with the Continuous Monitoring Plan and the Acceptable Use Policy): the runner wrote all 22 policy documents as markdown + DOCX with no unresolved template tokens.
check('V18', '22 policy documents (markdown + DOCX) with zero unresolved tokens', () => {
  const dir = path.join(planDir, 'policies');
  if (!exists(dir)) return { pass: false, detail: `no ${path.relative(root, dir)} (P2C.1 runner output)` };
  const files = fs.readdirSync(dir);
  const md = files.filter((f) => f.endsWith('.md')); const docx = files.filter((f) => f.endsWith('.docx'));
  const problems = [];
  if (md.length !== 22) problems.push(`${md.length} markdown documents (expected 22)`);
  if (docx.length !== 22) problems.push(`${docx.length} DOCX documents (expected 22)`);
  const badDocx = docx.filter((f) => { const b = fs.readFileSync(path.join(dir, f)); return b.subarray(0, 2).toString('latin1') !== 'PK' || b.length < 2000; });
  if (badDocx.length) problems.push(`${badDocx.length} DOCX files are not valid archives: ${badDocx.slice(0, 3).join(', ')}`);
  // Template tokens are {{name}} (handlebars). Tenant naming conventions such as CA-{Number}-{Purpose} use single braces and are
  // quoted as written; signature blocks carry [Name] / [Title] until personnel are confirmed; neither counts as unresolved.
  const tokenRe = /\{\{[^}]+\}\}/g;
  const unresolved = md.flatMap((f) => (fs.readFileSync(path.join(dir, f), 'utf8').match(tokenRe) ?? []).map((t) => `${f}: ${t}`));
  if (unresolved.length) problems.push(`${unresolved.length} unresolved tokens, e.g. ${unresolved.slice(0, 3).join('; ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `22 markdown + 22 DOCX documents; no unresolved {{tokens}}` };
});

// V19 (v2, MG-11 / MG-18): the three assessor reports and the tech-ref guide are present and non-empty.
check('V19', 'Three assessor reports and the tech-ref guide present and non-empty', () => {
  const dir = path.join(planDir, 'reports');
  if (!exists(dir)) return { pass: false, detail: `no ${path.relative(root, dir)} (P2C.1 runner output)` };
  const files = fs.readdirSync(dir);
  const want = ['exclusions', 'traceability', 'control-assessment', 'tech-ref'];
  const missing = want.filter((w) => !files.some((f) => f.toLowerCase().includes(w.replace('-', '')) || f.toLowerCase().includes(w)));
  const empty = files.filter((f) => fs.statSync(path.join(dir, f)).size < 200);
  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')} (files present: ${files.join(', ')})`);
  if (empty.length) problems.push(`near-empty: ${empty.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${files.length} report files: ${files.join(', ')}` };
});

// V28 (v2, EVC.2 / EVC.3, R-1 / R-2): MP requirement text equals the ces-shared reference; collect rows are catalog-sourced or marked placeholder.
check('V28', 'MP requirement text = ces-shared reference; collect rows catalog-sourced or marked placeholder', () => {
  const refPath = path.join(ces, 'ces-shared', 'src', 'data', 'cmmc-l2-controls.reference.json');
  if (!exists(refPath)) return { pass: false, detail: 'no ces-shared controls reference' };
  const nist = (id) => String(id ?? '').replace(/^[A-Z]{2}\.L[123]-/, '').replace(/[#\[].*$/, '').trim();
  const ref = new Map((readJson(refPath).controls ?? []).map((c) => [nist(c.nist_ref ?? c.control_id), String(c.practice ?? '').trim()]));
  const steps = mp?.outputs?.human_readable_mission_plan?.steps ?? [];
  const withCtx = steps.filter((s) => s.requirement_context?.requirement_text);
  const wrong = withCtx.filter((s) => { const want = ref.get(nist(s.requirement_context.nist_reference)); return want && want !== String(s.requirement_context.requirement_text).trim(); });
  const problems = [];
  if (!withCtx.length) problems.push('no MP step carries a requirement_context');
  if (wrong.length) problems.push(`${wrong.length} of ${withCtx.length} steps carry text that differs from the reference (e.g. ${wrong[0].requirement_context.nist_reference})`);
  const gaps = readiness?.derived?.gaps ?? [];
  const unmarked = gaps.filter((g) => !['catalog', 'placeholder'].includes(g.evidence_source));
  const cat = gaps.filter((g) => g.evidence_source === 'catalog');
  const r311 = gaps.filter((g) => nist(g.requirement_id) === '3.1.1');
  if (!gaps.length) problems.push('readiness record has no derived.gaps');
  if (unmarked.length) problems.push(`${unmarked.length} collect rows without an evidence_source marker`);
  if (r311.length && !r311.every((g) => g.evidence_source === 'catalog' && (g.catalog_definitions ?? []).length)) problems.push('3.1.1 collect rows are not catalog-sourced with definition provenance');
  // Titles are not compared: the reference carries no title field (EVC.2b).
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${withCtx.length} steps with reference text; ${gaps.length} collect rows: ${cat.length} catalog, ${gaps.length - cat.length} placeholder; titles not checked (EVC.2b)` };
});

// V29 (v2, EVC.1): the catalog release validates (loader tests run in the unit gate), the examine-lists file hashes to the
// value recorded in the release log, and release 0 has 14 definitions each with at least one objective id (EMX ids optional).
check('V29', 'Evidence catalog: release log hash matches, release 0 complete, loader tests green', () => {
  // FIN-29 (FIN-28 B-1): ces-planner is retired; the byte-identical catalog copy lives in ces-muster's plan engine.
  const dir = path.join(ces, 'ces-muster', 'src', 'features', 'plan', 'engine', 'data', 'evidence-catalog');
  const rel = path.join(dir, 'catalog-releases.json'); const ex = path.join(dir, 'nist-800-171a-examine-lists.json'); const r0 = path.join(dir, 'evidence-catalog-release-0.json');
  if (![rel, ex, r0].every(exists)) return { pass: false, detail: `missing: ${[rel, ex, r0].filter((f) => !exists(f)).map((f) => path.basename(f)).join(', ')}` };
  const log = readJson(rel); const text = JSON.stringify(log);
  const recorded = (text.match(/[0-9a-f]{64}/g) ?? [])[0];
  const actual = sha(ex);
  const problems = [];
  if (!recorded) problems.push('release log records no SHA-256');
  else if (recorded !== actual) problems.push(`examine-lists hash ${actual.slice(0, 12)}… differs from the recorded ${recorded.slice(0, 12)}…`);
  const cat = readJson(r0); const defs = cat.definitions ?? cat.items ?? (Array.isArray(cat) ? cat : []);
  if (defs.length !== 14) problems.push(`release 0 has ${defs.length} definitions (expected 14)`);
  const noObj = defs.filter((d) => !((d.objective_ids ?? d.objectives ?? []).length));
  if (noObj.length) problems.push(`${noObj.length} definitions without an objective id`);
  const gate = exists(path.join(out, 'unit-gate.json')) ? readJson(path.join(out, 'unit-gate.json')) : null;
  const pl = gate?.suites?.find?.((s) => s.suite === 'ces-muster'); const sh = gate?.suites?.find?.((s) => s.suite === 'ces-shared');
  if (!(pl?.failed === 0 && sh?.failed === 0)) problems.push('ces-muster / ces-shared suites not green in unit-gate.json (catalog loader and schema tests run there)');
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `hash ${actual.slice(0, 12)}… matches the release log; 14 definitions, all with objective ids; loader and schema tests green` };
});

// ---------- Phase 3 (P3.4): V13, V17, V20, V25, V27 ----------
const runsDir = path.join(out, 'runs');
const latestRun = exists(path.join(runsDir, 'latest.json')) ? readJson(path.join(runsDir, 'latest.json')) : null;
const forcedDir = path.join(runsDir, 'forced');
const controlOfTask = (id) => (String(id).match(/^step_task_([A-Z]{2}\.L[123]-[0-9.]+?)_/) ?? [])[1] ?? null;
const sspById = (s) => new Map((s?.controlImplementations ?? []).map((c) => [c.control_id, c]));
// Controls whose tasks ALL failed or were blocked (one execute report).
function allFailedControls(rep, plan) {
  const bad = new Set([...(rep?.failed_tasks ?? []), ...(rep?.blocked_tasks ?? [])].map((t) => t.task_id));
  const byControl = new Map();
  for (const t of plan?.execution_graph ?? []) {
    const c = controlOfTask(t.id); if (!c) continue;
    (byControl.get(c) ?? byControl.set(c, []).get(c)).push(t.id);
  }
  const failedControls = [...bad].map(controlOfTask).filter(Boolean);
  return [...new Set(failedControls)].filter((c) => (byControl.get(c) ?? []).every((id) => bad.has(id)));
}
const exePlan = exists(path.join(out, 'executable-plan.json')) ? readJson(path.join(out, 'executable-plan.json')) : null;

// V13 (P3.2 / FX-12): the forced run's SSP differs on the forced control; no all-failed control is met.
// W7-EO2 (2026-10-29): EvidenceOps marks a met control whose Tier 1 Stamper NOT_SAT was superseded by a later confirmed AdminOps
// write (live read met) with "Superseded later in the run:" in its narrative (ControlAssessor.supersedeTier1). V13 / V20 exempt it.
const isSuperseded = (entry) => /Superseded later in the run:/.test(String(entry?.implementationNarrative ?? '') + ' ' + String(entry?.assessmentFinding ?? ''));
check('V13', 'Forced-failure run: the forced control\'s SSP status differs; no failed/blocked control is met', () => {
  const fSspP = path.join(forcedDir, 'ssp.json'), fRepP = path.join(forcedDir, 'execution-report.json');
  const forced = exists(path.join(forcedDir, 'forced.json')) ? readJson(path.join(forcedDir, 'forced.json')) : null;
  if (!exists(fSspP) || !exists(fRepP)) return { pass: false, detail: `missing ${['ssp.json', 'execution-report.json', 'forced.json'].filter((f) => !exists(path.join(forcedDir, f))).join(', ')} under out/runs/forced (E8F)` };
  if (!ssp) return { pass: false, detail: 'no normal-run SSP JSON' };
  const fSsp = readJson(fSspP), fRep = readJson(fRepP);
  const entry = forced?.entry ?? '';
  const ctrl = (entry.match(/^([A-Z]{2}\.L[123]-[0-9.]+?)\.[a-z]/) ?? [])[1] ?? null;
  const problems = [];
  const fFailed = fRep.failed_tasks ?? [];
  const forcedTask = fFailed.find((t) => controlOfTask(t.task_id) === ctrl);
  if (!ctrl) problems.push(`cannot read the control from forced entry "${entry}"`);
  if (!forcedTask) problems.push(`the forced report has no failed task for ${ctrl} (failed: ${fFailed.map((t) => t.task_id).join(', ') || 'none'})`);
  // The flag must have fired: the report's forced_failures lists the entry with the task (a skipped entry is not forced).
  const ff = (fRep.forced_failures ?? []).find((f) => f.entry_id === entry);
  if (!ff) problems.push(`forced_failures does not list ${entry} (${JSON.stringify(fRep.forced_failures ?? null)}): the flag did not fire`);
  else if (forcedTask && !(ff.task_ids ?? []).includes(forcedTask.task_id)) problems.push(`forced_failures for ${entry} lists ${JSON.stringify(ff.task_ids)}, not ${forcedTask.task_id}`);
  const before = sspById(ssp).get(ctrl)?.status, after = sspById(fSsp).get(ctrl)?.status;
  if (before === undefined || after === undefined) problems.push(`${ctrl} missing from an SSP (normal ${before}, forced ${after})`);
  else if (before === after) problems.push(`${ctrl} status unchanged (${before}) between the normal and the forced SSP`);
  const metBad = [];
  for (const [rep, s, tag] of [[report, ssp, 'normal'], [fRep, fSsp, 'forced']]) {
    for (const c of allFailedControls(rep, exePlan)) if (sspById(s).get(c)?.status === 'met' && !isSuperseded(sspById(s).get(c))) metBad.push(`${tag}:${c}`);
  }
  if (metBad.length) problems.push(`controls with every task failed/blocked but met: ${metBad.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${ctrl}: ${before} -> ${after}; forced report failed ${fFailed.length} (${forcedTask.task_id}), forced_failures lists ${entry}; no all-failed control met in either run` };
});

// V17 (P3.4, replaces V6's band): the exact failed-task set equals the baseline, and every other task completed.
check('V17', 'Exact Stamper failed-task set equals expected-outputs; completed = total - failed', () => {
  if (!summary.stamper) return { pass: false, detail: 'no execution report' };
  if (!baseline?.stamper) return { pass: false, detail: 'no baseline summary.json' };
  const got = [...summary.stamper.failed_tasks].sort(), want = [...(baseline.stamper.failed_tasks ?? [])].sort();
  const same = JSON.stringify(got) === JSON.stringify(want);
  const s = summary.stamper;
  const full = s.completed === s.total_tasks - want.length && s.total_tasks === (baseline.stamper.total_tasks ?? 110);
  return { pass: same && full, detail: `failed set ${JSON.stringify(got)} ${same ? '=' : '!='} baseline ${JSON.stringify(want)}; completed ${s.completed} of ${s.total_tasks} (want ${s.total_tasks - want.length})` };
});

// V20 (P3.4 / FX-12): every not-met control, and every control whose tasks failed or were blocked, is on the POA&M:
// as an item (1-point controls) or as an eligibility blocker (3- and 5-point controls cannot be POA&M items).
check('V20', 'POA&M covers every not-met, not-assessed, failed or blocked control (item or eligibility blocker)', () => {
  const poam = exists(path.join(out, 'poam.json')) ? readJson(path.join(out, 'poam.json')) : null;
  if (!poam || !ssp) return { pass: false, detail: 'no POA&M or SSP JSON' };
  const notMet = (ssp.controlImplementations ?? []).filter((c) => c.status === 'not_met' || c.status === 'partial').map((c) => c.control_id);
  // W7-EO2 (2026-10-29): a control whose failed Stamper task was superseded by a later confirmed AdminOps write (live read met) is met and needs no POA&M item.
  const failed = allFailedControls(report, exePlan).filter((c) => !isSuperseded(sspById(ssp).get(c)));
  const notAssessed = (ssp.controlImplementations ?? []).filter((c) => c.status === 'not_assessed').map((c) => c.control_id);
  const need = [...new Set([...notMet, ...notAssessed, ...failed])];
  const items = new Set((poam.items ?? []).map((i) => i.control_id));
  const blockers = new Set((poam.eligibility?.blockers ?? []).map((b) => b.control_id));
  const uncovered = need.filter((c) => !items.has(c) && !blockers.has(c));
  return {
    pass: uncovered.length === 0,
    detail: uncovered.length
      ? `not on the POA&M: ${uncovered.join(', ')}`
      : `${need.length} controls (${notMet.length} not met/partial, ${notAssessed.length} not assessed, ${failed.length} failed/blocked) covered: ${need.filter((c) => items.has(c) && !blockers.has(c)).length} items, ${need.filter((c) => blockers.has(c)).length} blockers`,
  };
});

// V25 (P3.1 / P3.3; EO-collection W4.3): the shared bundle's manifest lists items 1-13 (12 = evidence-index with
// evidence-index.json, 13 = the manifest itself), every hash matches, and the identity scan is clean.
check('V25', 'Shared evidence bundle: items 1-13 present (12 = evidence index), hashes match, identity scan = 0', () => {
  if (!latestRun) return { pass: false, detail: 'no out/runs/latest.json (E8B bundle.mjs)' };
  const sharedDir = path.join(runsDir, latestRun.evidence, 'shared');
  const mPath = path.join(sharedDir, 'manifest.json');
  if (!exists(mPath)) return { pass: false, detail: `no ${path.relative(root, mPath)}` };
  const m = readJson(mPath);
  const problems = [];
  const ids = (m.items ?? []).map((i) => i.id);
  const absent = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter((i) => !ids.includes(i));
  const ix = (m.items ?? []).find((i) => i.id === 12);
  if (ix && !(ix.name === 'evidence-index' && (ix.files ?? []).some((f) => f.path.endsWith('evidence-index.json')))) problems.push(`item 12 is ${ix.name}, not evidence-index with evidence-index.json (bundle predates EO-collection W4)`);
  const empty = (m.items ?? []).filter((i) => !(i.files ?? []).length).map((i) => i.id);
  if (absent.length) problems.push(`items absent: ${absent.join(', ')}`);
  if (empty.length) problems.push(`items with no files: ${empty.join(', ')}`);
  if ((m.missing ?? []).length) problems.push(`${m.missing.length} expected files missing (e.g. ${m.missing.slice(0, 3).join(', ')})`);
  if (!m.cesId || m.cesId !== mp?.ces?.cesId) problems.push(`manifest cesId ${m.cesId} != pushed MP cesId ${mp?.ces?.cesId}`);
  let n = 0;
  const bad = [];
  for (const it of m.items ?? []) for (const f of it.files ?? []) {
    if (f.sha256 === null) continue;
    n++;
    const p = path.join(sharedDir, f.path);
    if (!exists(p) || sha(p) !== f.sha256) bad.push(f.path);
  }
  if (bad.length) problems.push(`${bad.length} hash mismatches (e.g. ${bad.slice(0, 3).join(', ')})`);
  const tokens = [];
  const tokFile = path.join(root, 'nb-tools', 'scan-tokens.txt');
  if (exists(tokFile)) tokens.push(...fs.readFileSync(tokFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
  const user = os.userInfo().username;
  if (user && user.length >= 3) tokens.push(`(?i)${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
  const scanPs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'identity-scan.ps1');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${q(scanPs)} -Path ${q(sharedDir)}${tokens.length ? ` -Extra @(${tokens.map(q).join(',')})` : ''}; exit $LASTEXITCODE`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = (r.stdout ?? '').split(/\r?\n/);
  const hits = lines.filter((l) => l.startsWith('  ')).length;
  if (r.status !== 0) problems.push(`identity scan exit ${r.status}: ${hits} hits (e.g. ${lines.filter((l) => l.startsWith('  ')).slice(0, 2).join(' | ').slice(0, 300)})`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${latestRun.runId}: 13 items, ${n} hashes match; identity scan clean (${tokens.length} extra tokens, token file ${exists(tokFile) ? 'present' : 'absent'}); cesId ${m.cesId}` };
});

// V27 (EVC.5 / DEC-2, DEC-7): the EC upload carries validated catalog ids, reaches EO's package under
// evidence/ec/<control>/<itemId>.json and the ledger, and changes no status.
check('V27', 'EC upload: catalog ids validated, in EO\'s package and ledger, statuses unchanged', () => {
  const upP = path.join(out, 'ec-upload.json');
  if (!exists(upP)) return { pass: false, detail: 'no out/ec-upload.json (E8.5)' };
  const up = readJson(upP);
  const CTRL = 'AC.L1-3.1.1';
  const problems = [];
  if (!up.itemId) problems.push(`no item in the EC response (${JSON.stringify(up).slice(0, 200)})`);
  if (up.form_id !== 'access_control_policy') problems.push(`form_id ${up.form_id}`);
  if (up.form_id_matched_by !== 'form_id') problems.push(`form_id_matched_by ${up.form_id_matched_by}`);
  if (up.catalog !== 'validated') problems.push(`catalog ${up.catalog}`);
  if (JSON.stringify(up.emx_ids) !== JSON.stringify(['EMX-IAM-004'])) problems.push(`emx_ids ${JSON.stringify(up.emx_ids)}`);
  if (!(up.controlIds ?? []).includes(CTRL)) problems.push(`controlIds ${JSON.stringify(up.controlIds)}`);
  // EO package: <prefix>/evidence/ec/<control>/<itemId>.json
  const pkgFiles = exists(path.join(out, 'eo-package')) ? fs.readdirSync(path.join(out, 'eo-package'), { recursive: true }).map((f) => f.split(path.sep).join('/')) : [];
  const meta = pkgFiles.find((f) => f.endsWith(`/evidence/ec/${CTRL}/${up.itemId}.json`));
  if (!meta) problems.push(`EO package has no evidence/ec/${CTRL}/${up.itemId}.json (${pkgFiles.length} package files)`);
  else {
    const mj = readJson(path.join(out, 'eo-package', meta));
    if (mj.form_id !== up.form_id || JSON.stringify(mj.emx_ids) !== JSON.stringify(up.emx_ids)) problems.push('package item JSON ids differ from the EC record');
  }
  // EO ledger: the control rollup lists the item with its ids
  const led = exists(path.join(out, 'eo-ledger.json')) ? readJson(path.join(out, 'eo-ledger.json')) : null;
  const roll = (led?.controls ?? []).find((c) => c.controlId === CTRL);
  const ref = (roll?.evidence ?? []).find((e) => e.itemId === up.itemId);
  if (!ref) problems.push(`EO ledger rollup ${CTRL} does not list the item`);
  else if (ref.form_id !== up.form_id || JSON.stringify(ref.emx_ids) !== JSON.stringify(up.emx_ids)) problems.push('ledger entry ids differ from the EC record');
  // DEC-7: no status effect. E8.5 runs before E7, so the pre-upload baseline is expected-outputs/summary.json.
  const keys = ['controls_met', 'controls_not_met', 'controls_partial', 'controls_not_assessed', 'sprs_score'];
  const diff = keys.filter((k) => summary.eo_assess?.[k] !== baseline?.eo_assess?.[k]);
  if (!baseline?.eo_assess) problems.push('no baseline eo_assess');
  else if (diff.length) problems.push(`EO counts differ from the pre-upload baseline: ${diff.map((k) => `${k} ${summary.eo_assess?.[k]} vs ${baseline.eo_assess[k]}`).join(', ')}`);
  const ci = sspById(ssp).get(CTRL);
  // W1.5: compared with the baseline's per-control status, not a hard-coded 'met'. A baseline written
  // before status_by_control existed cannot be compared; the status is then reported, not asserted.
  const wantStatus = baseline?.status_by_control?.[CTRL];
  if (wantStatus !== undefined && ci?.status !== wantStatus) problems.push(`SSP ${CTRL} status ${ci?.status} (baseline ${wantStatus})`);
  const statusNote = wantStatus !== undefined ? `SSP ${CTRL} ${ci?.status} = baseline` : `SSP ${CTRL} ${ci?.status} (not asserted: baseline has no status_by_control)`;
  if (JSON.stringify(ci?.evidenceReferences ?? []).includes(up.itemId ?? '\u0000')) problems.push('the item appears in evidenceReferences');
  const ingested = assess.find((e) => e.type === 'assess_ec_items');
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${up.itemId} (${up.form_id}, ${up.emx_ids.join(',')}, matched by ${up.form_id_matched_by}, ${up.catalog}); package ${meta}; ledger lists it; EO counts = baseline; ${statusNote}; assess_ec_items ${ingested?.count}` };
});

// ---------- Phase 4 (P4.4): V23, V26 ----------
// Harness: mx-e2e.ps1 sets MX_HARNESS (verify.ps1 passes no flag); --harness overrides. Under -Harness mx a missing
// tester record is "not run" and passes; under -Harness tester it fails. A record that is present is always judged.
const harness = String(a.harness ?? process.env.MX_HARNESS ?? 'mx').toLowerCase();
const notRun = (file) => (harness === 'tester'
  ? { pass: false, detail: `not run: no out/${file} (-Harness tester)` }
  : { pass: true, detail: `not run (-Harness ${harness}; out/${file} is required under -Harness tester)` });

// V23 (P4.1 / P4.4): ces-tester's muster-e2e run record: PASS, every required step rc 0, and the comparison
// (sim ledger vs step windows, post-Stamper /resolve state, readiness facts in RR-ACT ids) green.
check('V23', 'Tester run record: muster-e2e PASS, including the ledger comparison', () => {
  const p = path.join(out, 'tester-run.json');
  if (!exists(p)) return notRun('tester-run.json');
  const r = readJson(p);
  const problems = [];
  if (r.schema !== 'ces-tester/muster-e2e-run@1') problems.push(`schema ${r.schema}`);
  if (r.dry_run) problems.push('dry run record');
  if (r.status !== 'PASS') problems.push(`status ${r.status}`);
  const rows = r.steps ?? [];
  const bad = (r.required_steps ?? []).filter((id) => rows.find((s) => s.id === id)?.rc !== 0);
  if (bad.length) problems.push(`steps not rc 0: ${bad.join(', ')}`);
  const e1 = rows.find((s) => s.id === 'E1');
  if (steps.E1?.started && e1?.started !== steps.E1.started) problems.push('tester-run.json and steps.json are from different runs');
  const c = r.comparison;
  if (!c) problems.push('no comparison (step EX did not run)');
  else {
    if (!c.ledger?.pass) problems.push(`ledger comparison: ${(c.ledger?.rows ?? []).filter((x) => !x.pass).map((x) => `${x.check} (${x.actual})`).join('; ') || 'missing'}`);
    if (!c.state?.pass) problems.push(`expected state: ${(c.state?.assertions ?? []).filter((x) => x.result !== 'pass').map((x) => `${x.check} = ${x.actual}`).join('; ') || 'missing'}`);
    if (!c.facts?.pass) problems.push(`readiness facts ${c.facts?.matched}/${c.facts?.total}: ${(c.facts?.rows ?? []).filter((x) => !x.pass).map((x) => `${x.id} ${x.actual ?? 'none'} (want ${x.expected})`).join(', ')}`);
  }
  return {
    pass: problems.length === 0,
    detail: problems.length
      ? problems.join('; ')
      : `${r.scenario_id} PASS: ${r.required_steps.length} required steps rc 0; ledger ${c.ledger.rows.length}/${c.ledger.rows.length} (${c.ledger.writes} writes of ${c.ledger.entries} entries); state ${c.state.assertions.length}/${c.state.assertions.length}; facts ${c.facts.matched}/${c.facts.total}`,
  };
});

// V26 (P4.3 / P4.4): stacksim coverage-ao, run by the tester after the e2e (out/coverage-ao.json). The command seeds its own
// fresh m365_azure tenant with the gcc-high-g5 set (the set the aoops-g5 scenario declares). Pass = exit 0, a report written
// by this run, 96 commands, FAIL 0, PASS + HONEST-OPEN = total.
check('V26', 'stacksim coverage-ao (AO, 96 commands): pass, run by the tester', () => {
  const p = path.join(out, 'coverage-ao.json');
  if (!exists(p)) return notRun('coverage-ao.json');
  const r = readJson(p);
  const t = r.totals ?? {};
  const problems = [];
  if (r.rc !== 0) problems.push(`coverage-ao exit ${r.rc}`);
  if (t.total !== 96) problems.push(`total ${t.total} (expected 96)`);
  if (t.fail !== 0) problems.push(`FAIL ${t.fail}: ${(r.not_pass ?? []).filter((x) => x.status === 'FAIL').map((x) => x.id).slice(0, 10).join(', ')}`);
  if ((t.pass ?? 0) + (t.honestOpen ?? 0) !== t.total) problems.push(`PASS ${t.pass} + HONEST-OPEN ${t.honestOpen} != ${t.total}`);
  if (!r.report_generated_at || r.report_generated_at < r.started) problems.push(`report not from this run (generatedAt ${r.report_generated_at})`);
  if (r.pass !== true) problems.push(`tester verdict: ${(r.reasons ?? []).join('; ') || 'FAIL'}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${r.summary_line} (report ${r.report_generated_at})` };
});

// ---------- W5.2 (SSP uplift): V30-V36 ----------
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sharedBundle = latestRun ? path.join(runsDir, latestRun.evidence, 'shared') : null;
const poamJson = exists(path.join(out, 'poam.json')) ? readJson(path.join(out, 'poam.json')) : null;
const listFiles = (dir) => (exists(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isFile()) : []);

// V30: the package's lexicon is byte-identical to EO's; every lexicon hit in a met control's narrative (the text the
// W1.4 guard saw: the appended "Evidence disagreement:" / "Presence only:" paragraphs removed) has a consistencyFlags
// entry for that phrase, and no flag names a phrase that is not there (flags are honest). Matching ports
// NarrativeNegationGuard: case-insensitive literal, no letter or digit before a phrase that starts with one.
check('V30', 'Met-control narratives vs the negation lexicon: every hit flagged, every flag a hit; lexicon = EO\'s', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  const mine = path.join(scriptsDir, 'negation-lexicon.json');
  const eos = path.join(ces, 'ces-eo', 'data', 'narrative-negation-lexicon.json');
  const problems = [];
  if (!exists(mine) || !exists(eos)) return { pass: false, detail: `missing lexicon: ${[mine, eos].filter((p) => !exists(p)).map((p) => path.relative(root, p)).join(', ')}` };
  if (sha(mine) !== sha(eos)) problems.push(`scripts/negation-lexicon.json ${sha(mine).slice(0, 12)}… != EO's ${sha(eos).slice(0, 12)}…`);
  const phrases = readJson(mine).phrases ?? [];
  const pattern = (p) => new RegExp((/^[A-Za-z0-9]/.test(p) ? '(?<![A-Za-z0-9])' : '') + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const strip = (n) => String(n ?? '').replace(/\n\n(Evidence disagreement|Presence only): [\s\S]*?(?=\n\n(Evidence disagreement|Presence only): |$)/g, '');
  const met = (ssp.controlImplementations ?? []).filter((c) => c.status === 'met');
  const unflagged = [], stale = [];
  let hitControls = 0;
  for (const c of met) {
    const hits = phrases.filter((p) => pattern(p).test(strip(c.implementationNarrative)));
    const flags = new Set((c.consistencyFlags ?? []).map((f) => f.phrase));
    if (hits.length) hitControls++;
    for (const h of hits) if (!flags.has(h)) unflagged.push(`${c.control_id} "${h}"`);
    for (const f of flags) if (!hits.includes(f)) stale.push(`${c.control_id} "${f}"`);
  }
  const offMet = (ssp.controlImplementations ?? []).filter((c) => c.status !== 'met' && (c.consistencyFlags ?? []).length).map((c) => c.control_id);
  if (unflagged.length) problems.push(`${unflagged.length} unflagged hits: ${unflagged.slice(0, 6).join(', ')}`);
  if (stale.length) problems.push(`${stale.length} flags without a hit: ${stale.slice(0, 6).join(', ')}`);
  if (offMet.length) problems.push(`flags on non-met controls: ${offMet.join(', ')}`);
  // GC-PKG-2: every non-met control, too: no "implemented" / "continuously verified" claim in its narrative.
  const nonMet = (ssp.controlImplementations ?? []).filter((c) => c.status !== 'met');
  const claims = nonMetClaimHits(ssp.controlImplementations);
  if (claims.length) problems.push(`${claims.length} non-met controls claim implementation: ${claims.slice(0, 6).join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `lexicon ${phrases.length} phrases, hash ${sha(mine).slice(0, 12)}… = EO's; ${met.length} met controls, ${hitControls} hit the lexicon and every hit is flagged (honest flags; the hits themselves are scorecard metric 9); ${nonMet.length} non-met controls, none claims implementation` };
});

// V31: no not-assessed control renders "Not Applicable" in the DOCX. The text of word/document.xml (jszip from
// <WS>/ces/node_modules/jszip; PowerShell ZipFile fallback) is split at the control headings "<id> — <nist>"; each
// not-assessed control's block has no "Not Applicable" / "N/A" and its status line checks "Not Yet Assessed";
// the checked "Not Yet Assessed" count equals the not-assessed count; no checked "Not Applicable" / "Planned" anywhere.
let docxXml = null, docxReader = null, docxError = null;
{
  const docxPath = path.join(out, 'ssp.docx');
  if (exists(docxPath)) {
    try {
      const JSZip = createRequire(import.meta.url)(path.join(ces, 'node_modules', 'jszip'));
      docxXml = await (await JSZip.loadAsync(fs.readFileSync(docxPath))).file('word/document.xml').async('string');
      docxReader = 'jszip';
    } catch (e) {
      const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
      const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${q(docxPath)}); try { $r=New-Object IO.StreamReader($z.GetEntry('word/document.xml').Open(), [Text.Encoding]::UTF8); [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Out.Write($r.ReadToEnd()) } finally { $z.Dispose() }`;
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      if (r.status === 0 && r.stdout) { docxXml = r.stdout; docxReader = 'powershell'; } else docxError = `jszip: ${e instanceof Error ? e.message : e}; powershell exit ${r.status}`;
    }
  }
}
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const docxText = docxXml ? decodeXml(docxXml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, '')) : null;
check('V31', 'No not-assessed control shows "Not Applicable" in the DOCX text', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  if (!docxText) return { pass: false, detail: `cannot read word/document.xml (${docxError ?? 'no out/ssp.docx'})` };
  const lines = docxText.split('\n');
  const heading = /^([A-Z]{2}\.L[123]-\d+\.\d+\.\d+) — \d+\.\d+\.\d+$/;
  const starts = new Map();
  lines.forEach((l, i) => { const m = l.trim().match(heading); if (m && !starts.has(m[1])) starts.set(m[1], i); });
  const order = [...starts.entries()].sort((x, y) => x[1] - y[1]);
  const block = (id) => { const k = order.findIndex(([c]) => c === id); return k < 0 ? null : lines.slice(order[k][1], k + 1 < order.length ? order[k + 1][1] : lines.length).join('\n'); };
  const na = (ssp.controlImplementations ?? []).filter((c) => c.status === 'not_assessed').map((c) => c.control_id);
  const problems = [];
  const noHeading = na.filter((id) => !starts.has(id));
  if (noHeading.length) problems.push(`no DOCX heading for ${noHeading.join(', ')}`);
  for (const id of na.filter((x) => starts.has(x))) {
    const b = block(id);
    if (/Not Applicable|\bN\/A\b/.test(b)) problems.push(`${id}: block says Not Applicable / N/A`);
    if (!/☒ Not Yet Assessed/.test(b)) problems.push(`${id}: status line does not check "Not Yet Assessed"`);
  }
  const checkedNya = (docxText.match(/☒ Not Yet Assessed/g) ?? []).length;
  if (checkedNya !== na.length) problems.push(`"☒ Not Yet Assessed" ${checkedNya} != ${na.length} not-assessed controls`);
  const bad = (docxText.match(/☒ (Not Applicable|Planned)/g) ?? []).length;
  if (bad) problems.push(`${bad} checked "Not Applicable" / "Planned" boxes`);
  return { pass: problems.length === 0, detail: problems.length ? problems.slice(0, 8).join('; ') : `${na.length} not-assessed controls, each block checks "Not Yet Assessed" and never says Not Applicable; 0 checked Not Applicable / Planned (read with ${docxReader})` };
});

// V32: evidenceDetails (W3.1) cover the bundle's Stamper-evidenced controls and the hashes match the files.
// Stamper-evidenced = the union of metadata.controlIds over the bundle's 06-execution/evidence/**/*.json (what
// StamperEvidenceLoader reads; evidence-by-task duplicates and EC uploads excluded), limited to SSP controls.
// Each detail's path must be relative and resolve under the tenant plan-data folder, the bundle's 06-execution or
// the bundle root; sha256 = SHA-256 of the file bytes (not the file's own metadata.sha256Hash). Accepted spellings:
// path | relativePath | file, sha256 | hash, entryId | entry_id | entry.
check('V32', 'evidenceDetails cover the bundle\'s Stamper-evidenced controls; hashes match the files', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  if (!sharedBundle) return { pass: false, detail: 'no out/runs/latest.json (E8B bundle.mjs)' };
  const evFiles = listFiles(path.join(sharedBundle, '06-execution', 'evidence')).filter((f) => f.endsWith('.json'));
  const sspIds = new Set((ssp.controlImplementations ?? []).map((c) => c.control_id));
  const evidenced = new Set();
  for (const f of evFiles) { try { for (const id of readJson(f).metadata?.controlIds ?? []) if (sspIds.has(id)) evidenced.add(id); } catch { /* unreadable file: not evidence */ } }
  const withDetails = (ssp.controlImplementations ?? []).filter((c) => Array.isArray(c.evidenceDetails) && c.evidenceDetails.length);
  if (!withDetails.length) return { pass: false, detail: `pending W3.1: no control in ssp.json carries evidenceDetails (${evidenced.size} Stamper-evidenced controls from ${evFiles.length} bundle evidence files to cover)` };
  const byId = new Map(withDetails.map((c) => [c.control_id, c.evidenceDetails]));
  const problems = [];
  const uncovered = [...evidenced].filter((id) => !byId.has(id)).sort();
  if (uncovered.length) problems.push(`${uncovered.length} Stamper-evidenced controls without evidenceDetails: ${uncovered.slice(0, 8).join(', ')}`);
  // Stamper details are relative to the tenant evidence folder (W3.1); evidence-store details (kind !== 'stamper')
  // carry no file: they are verified against the tenant's evidence-store records (payloadSha256) instead.
  const tenantPl = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
  const bases = [path.join(sharedBundle, '06-execution', 'evidence'), path.join(sharedBundle, '06-execution'), sharedBundle, path.join(tenantPl, 'evidence'), tenantPl];
  const storeHashes = new Set();
  for (const rf of listFiles(path.join(root, 'out', 'eo', 'evidence-store')).filter((f) => f.endsWith('records.jsonl'))) {
    for (const line of fs.readFileSync(rf, 'utf8').split('\n')) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r.payloadSha256) storeHashes.add(r.payloadSha256); if (r.recordId) storeHashes.add(r.recordId); } catch { /* skip */ } }
  }
  let n = 0, nStore = 0;
  const abs = [], unresolved = [], mismatch = [], storeMissing = [];
  for (const [id, details] of byId) for (const d of details) {
    n++;
    const hash = d.sha256 ?? d.hash;
    if (d.kind && d.kind !== 'stamper') {
      nStore++;
      if (!hash || !(storeHashes.has(hash) || storeHashes.has(d.recordId))) storeMissing.push(`${id} ${d.kind} ${hash ?? '(no hash)'}`);
      continue;
    }
    const rel = d.path ?? d.relativePath ?? d.file;
    if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) { abs.push(`${id} ${rel ?? '(no path)'}`); continue; }
    // The tenant folder is re-stamped by the forced run (E8F) after the SSP was generated, so a detail's hash is
    // accepted when ANY copy (the bundle taken at E8B first, then the tenant folder) carries it.
    // W3.1: a detail's sha256 is Stamper's metadata.sha256Hash = sha256 of the record's rawResponse (not of the
    // file bytes). Accept when any copy's own hash field or recomputed rawResponse hash equals it.
    const candidates = bases.map((b) => path.join(b, rel)).filter(exists);
    if (!candidates.length) { unresolved.push(`${id} ${rel}`); continue; }
    const matches = candidates.some((p) => {
      try {
        const rec = readJson(p);
        if (rec?.metadata?.sha256Hash === hash) return true;
        const raw = typeof rec?.rawResponse === 'string' ? rec.rawResponse : JSON.stringify(rec?.rawResponse ?? '');
        return crypto.createHash('sha256').update(raw, 'utf8').digest('hex') === hash;
      } catch { return sha(p) === hash; }
    });
    if (!matches) mismatch.push(`${id} ${rel}`);
  }
  if (storeMissing.length) problems.push(`${storeMissing.length} evidence-store details not found in the store records (e.g. ${storeMissing.slice(0, 3).join(', ')})`);
  if (abs.length) problems.push(`${abs.length} details with an absolute or missing path (e.g. ${abs.slice(0, 3).join(', ')})`);
  if (unresolved.length) problems.push(`${unresolved.length} paths not found (e.g. ${unresolved.slice(0, 3).join(', ')})`);
  if (mismatch.length) problems.push(`${mismatch.length} hash mismatches (e.g. ${mismatch.slice(0, 3).join(', ')})`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${evidenced.size} Stamper-evidenced controls all carry evidenceDetails; ${n} details (${nStore} from the evidence store, verified against its records), all relative, all hashes match` };
});

// V33: §2.4 (inheritanceTable) rows = the CRM: the Shared row set equals the CRM's Shared set
// (sharedResponsibilityMatrix.controlDetails) and its count; each row's responsibility equals the CRM's; no
// excluded id is a §2.4 row, a CRM row or an SSP control.
check('V33', '§2.4 rows = CRM shared rows; no excluded id present', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  const t = ssp.inheritanceTable, crm = ssp.sharedResponsibilityMatrix;
  if (!t?.rows || !crm?.controlDetails) return { pass: false, detail: `missing ${!t?.rows ? 'inheritanceTable.rows' : ''} ${!crm?.controlDetails ? 'sharedResponsibilityMatrix.controlDetails' : ''}`.trim() };
  const problems = [];
  const shared = (rows) => new Set(rows.filter((r) => r.responsibility === 'Shared').map((r) => r.controlId));
  const tS = shared(t.rows), cS = shared(crm.controlDetails);
  const onlyT = [...tS].filter((x) => !cS.has(x)), onlyC = [...cS].filter((x) => !tS.has(x));
  if (onlyT.length || onlyC.length) problems.push(`Shared sets differ: §2.4 only ${onlyT.join(', ') || '-'}; CRM only ${onlyC.join(', ') || '-'}`);
  if (tS.size !== crm.shared) problems.push(`§2.4 Shared rows ${tS.size} != CRM shared ${crm.shared}`);
  const crmBy = new Map(crm.controlDetails.map((r) => [r.controlId, r.responsibility]));
  const differ = t.rows.filter((r) => crmBy.get(r.controlId) !== r.responsibility).map((r) => `${r.controlId} ${r.responsibility}/${crmBy.get(r.controlId)}`);
  if (differ.length) problems.push(`${differ.length} rows whose responsibility differs from the CRM: ${differ.slice(0, 5).join(', ')}`);
  const excluded = [...new Set([...(t.excludedIds ?? []), ...(crm.excludedIds ?? [])].map((e) => e.id ?? e))];
  const present = excluded.filter((id) => t.rows.some((r) => r.controlId === id) || crmBy.has(id) || (ssp.controlImplementations ?? []).some((c) => c.control_id === id));
  if (present.length) problems.push(`excluded ids present: ${present.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${t.rows.length} §2.4 rows; Shared ${tS.size} = CRM shared ${crm.shared}, same ids and per-row responsibility; ${excluded.length} excluded ids, none present` };
});

// V34: SSP components = the pushed IM's resources: every resource in the IM's resource arrays (entries with a
// resource_type; provenance excluded) appears as "<name> (<resource_type>)" in its section, and nothing else does.
check('V34', 'SSP components = IM resources', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  if (!pIM) return { pass: false, detail: 'no pushed IM' };
  const im = readJson(pIM);
  const inner = im.infrastructure ?? im.infrastructure_manifest ?? im;
  const want = [];
  for (const [section, v] of Object.entries(inner)) if (Array.isArray(v)) for (const r of v) if (r && r.resource_type) want.push(`${section}|${`${r.name ?? ''} (${r.resource_type})`.trim()}`);
  const got = (ssp.systemComponents?.sections ?? []).flatMap((s) => (s.components ?? []).map((c) => `${s.name}|${c}`));
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const w = count(want), g = count(got);
  const missing = [...w].filter(([k, n]) => (g.get(k) ?? 0) < n).map(([k]) => k);
  const extra = [...g].filter(([k, n]) => (w.get(k) ?? 0) < n).map(([k]) => k);
  const problems = [];
  if (!want.length) problems.push('the IM has no resources');
  if (missing.length) problems.push(`${missing.length} IM resources not in the SSP: ${missing.slice(0, 5).join(', ')}`);
  if (extra.length) problems.push(`${extra.length} SSP components not in the IM: ${extra.slice(0, 5).join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${got.length} components in ${(ssp.systemComponents?.sections ?? []).length} sections = ${want.length} IM resources` };
});

// V35: §14 (ssp.poamSummary) = out/poam.json: same poamId, item and blocker control sets, sprsScore and projection;
// every ledger-deficient control (eo-ledger.json deficiencies) is a POA&M item, an eligibility blocker, or a §14
// reconciliation entry with disposition no_poam and a reason. (Not the ledger's own per-control noPoam flag.)
check('V35', '§14 = poam.json; every ledger-deficient control is an item, a blocker or no_poam', () => {
  if (!ssp) return { pass: false, detail: 'no SSP JSON' };
  if (!poamJson) return { pass: false, detail: 'no out/poam.json' };
  const s = ssp.poamSummary;
  if (!s) return { pass: false, detail: 'ssp.json has no poamSummary (§14)' };
  const problems = [];
  if (s.poamId !== poamJson.poamId) problems.push(`§14 poamId ${s.poamId} != poam.json ${poamJson.poamId}`);
  const ids = (xs) => [...new Set((xs ?? []).map((x) => x.control_id))].sort().join(',');
  if (ids(s.items) !== ids(poamJson.items)) problems.push(`items differ: §14 [${ids(s.items)}] vs poam.json [${ids(poamJson.items)}]`);
  if (ids(s.blockers) !== ids(poamJson.eligibility?.blockers)) problems.push(`blockers differ: §14 ${(s.blockers ?? []).length} vs poam.json ${(poamJson.eligibility?.blockers ?? []).length}`);
  if (s.sprsScore !== poamJson.sprsScore) problems.push(`SPRS §14 ${s.sprsScore} != poam.json ${poamJson.sprsScore}`);
  if (s.projectedScoreAfterPoam !== poamJson.summary?.projectedScoreAfterPoam) problems.push(`projection §14 ${s.projectedScoreAfterPoam} != poam.json ${poamJson.summary?.projectedScoreAfterPoam}`);
  const led = exists(path.join(out, 'eo-ledger.json')) ? readJson(path.join(out, 'eo-ledger.json')) : null;
  if (!led) problems.push('no out/eo-ledger.json');
  else {
    const deficient = [...new Set((led.deficiencies ?? []).map((d) => d.controlId))];
    const items = new Set((poamJson.items ?? []).map((i) => i.control_id));
    const blockers = new Set((poamJson.eligibility?.blockers ?? []).map((b) => b.control_id));
    const noPoam = new Set((s.ledgerReconciliation?.controls ?? []).filter((c) => c.disposition === 'no_poam' && c.noPoamReason).map((c) => c.controlId));
    const lost = deficient.filter((c) => !items.has(c) && !blockers.has(c) && !noPoam.has(c));
    if (lost.length) problems.push(`${lost.length} ledger-deficient controls neither item, blocker nor no_poam: ${lost.slice(0, 8).join(', ')}`);
    if (!problems.length) return { pass: true, detail: `§14 = poam.json ${s.poamId.slice(0, 8)}… (${(s.items ?? []).length} items, ${(s.blockers ?? []).length} blockers, SPRS ${s.sprsScore}, projected ${s.projectedScoreAfterPoam}); ${deficient.length} ledger-deficient controls: ${deficient.filter((c) => items.has(c) && !blockers.has(c)).length} items, ${deficient.filter((c) => blockers.has(c)).length} blockers, ${deficient.filter((c) => !items.has(c) && !blockers.has(c)).length} no_poam` };
  }
  return { pass: false, detail: problems.join('; ') };
});

// V36: one assessed SPRS in the bundle. (a) The assessed values (bundle eo-assess*.json assess_summary.sprs_score,
// 03-poam sprsScore, 02-ssp poamSummary.sprsScore) are one number. (b) The POA&M projection is one number and every
// DOCX sentence that carries it next to "SPRS" / "score" says "projected". (c) No bundle artifact reports the
// assessed score while saying it "Cannot determine SPRS" (REVIEW #15; reworded by W4.1). Readiness numbers
// (10-readiness derived.sprs_now / sprs_after) are Muster readiness estimates, named so by their keys, and are
// listed, not counted as assessed; the W4.1 posture block that labels them is pending W4.1 and not read.
check('V36', 'Exactly one assessed SPRS in the bundle (EO\'s); the POA&M number labelled projection', () => {
  if (!sharedBundle) return { pass: false, detail: 'no out/runs/latest.json (E8B bundle.mjs)' };
  const rd = (rel) => { const p = path.join(sharedBundle, rel); return exists(p) ? readJson(p) : null; };
  // W6 follow-up (post-E7B SPRS, S3 run 60): the POA&M and SSP §14 are generated after E7B's re-assessment, so the one
  // assessed SPRS is the latest assessment in the run (scorecard.mjs sprsAuthority): E7B's when the scenario's E7A record
  // has expected_improvements and E7B's counts differ from E7 pass 3 by exactly those (or by nothing), else the E7 passes'.
  // The three E7 passes must agree among themselves; the documents must equal the authoritative value.
  const passes = [];
  for (const f of ['eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json']) {
    const sum = summaryOf(rd(`07-eo-assessment/${f}`));
    if (sum) passes.push({ file: `07/${f}`, summary: sum });
  }
  const s7 = summaryOf(rd('07-eo-assessment/eo-assess-7b.json') ?? freshJson(path.join(out, 'eo-assess-7b.json')));
  const e7aSprs = exists(path.join(out, 'adminops-e7a.json')) ? readJson(path.join(out, 'adminops-e7a.json')) : null;
  const improvements = e7aSprs && (!e7aSprs.tenant_slug || e7aSprs.tenant_slug === slug) ? e7aSprs.expected_improvements ?? [] : [];
  const ledgerW = new Map((rd('07-eo-assessment/eo-ledger.json')?.controls ?? []).map((c) => [c.controlId, Number(c.weight)]));
  const auth = sprsAuthority({ passes, e7b: s7 ? { file: 'eo-assess-7b.json', summary: s7 } : null, improvements, weightOf: (id) => (Number.isFinite(ledgerW.get(id)) ? ledgerW.get(id) : undefined) });
  const bp = rd('03-poam/poam.json'), bs = rd('02-ssp/ssp.json');
  const docs = [];
  if (bp) docs.push(['03-poam sprsScore', bp.sprsScore]);
  if (bs?.poamSummary) docs.push(['02-ssp §14 sprsScore', bs.poamSummary.sprsScore]);
  const assessed = [...passes.map((p) => [p.file, p.summary.sprs_score]), ...(s7 ? [['eo-assess-7b.json', s7.sprs_score]] : []), ...docs];
  const problems = [...auth.problems];
  const values = auth.value === null ? [] : [auth.value];
  if (!passes.length) problems.push('no assessed SPRS found in the bundle');
  const offDocs = docs.filter(([, v]) => v !== auth.value);
  if (offDocs.length) problems.push(`documents differ from the assessed SPRS ${auth.value ?? '?'} (${auth.source}): ${assessed.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const projections = [...new Set([bp?.summary?.projectedScoreAfterPoam, bs?.poamSummary?.projectedScoreAfterPoam].filter((v) => v !== undefined))];
  if (projections.length > 1) problems.push(`POA&M projections differ: ${projections.join(' vs ')}`);
  let labelled = 0;
  if (docxText && projections.length === 1) {
    // A deduction in the SPRS breakdown ("110 - 42 (12 not met)") is not the projection, even when the numbers coincide (S3, W9-R3).
    // FIN-01 (c): nor is a hyphenated or counted number ("90-day", "returned 90 objects") or a Secure Score read (S2, W9-R4a).
    const { unlabelled, labelled: lab } = projectionSentences(docxText, projections[0]);
    labelled = lab;
    if (unlabelled.length) problems.push(`DOCX sentences carry the projection ${projections[0]} without "projected": ${unlabelled.slice(0, 2).map((x) => `"${x.trim().slice(0, 120)}"`).join('; ')}`);
  } else if (!docxText) problems.push('DOCX text unreadable (projection labelling not checked)');
  const cannot = [];
  for (const f of ['eo-assess.json', 'eo-assess-2.json', 'eo-assess-3.json']) {
    const p = path.join(sharedBundle, '07-eo-assessment', f);
    if (exists(p) && /Cannot determine SPRS/i.test(fs.readFileSync(p, 'utf8'))) cannot.push(f);
  }
  if (cannot.length && values.length) problems.push(`${cannot.join(', ')} report SPRS ${values.join('/')} and also "Cannot determine SPRS value …" (pending W4.1 rewording)`);
  const rr = rd(`10-readiness/readiness-result-${slug}.json`);
  const readinessNote = rr?.derived?.sprs_now ? `; readiness estimates (not assessed) sprs_now ${rr.derived.sprs_now.sprs ?? '?'}, sprs_after ${rr.derived.sprs_now.sprs_after ?? rr.derived.sprs_after ?? '?'}` : '';
  return { pass: problems.length === 0, detail: problems.length ? `${problems.join('; ')}; ${auth.detail}${readinessNote}` : `one assessed SPRS ${values[0]} (${assessed.length} sources; ${auth.detail}); projection ${projections[0] ?? 'n/a'} labelled "projected" in ${labelled} DOCX sentence(s)${readinessNote}; W4.1 posture block pending` };
});

// ---------- EO-collection W4.4: V37-V44 (evidence store, collectors, freshness, drift) ----------
// Inputs: the EO evidence store <WS>/out/eo/evidence-store/<tenantId>/ (records.jsonl, payloads/, manifest.json,
// watermarks.json), eo-ledger.json, ssp.json, the four assess streams (E7 passes 1-3, E8F), the stored snapshot in
// the EO package, the bundle's Stamper evidence, the two sim ledgers (E7 and E8F) and the sim store.
const storeRoot = path.join(out, 'eo', 'evidence-store');
const storeDirs = exists(storeRoot) ? fs.readdirSync(storeRoot).map((d) => path.join(storeRoot, d)).filter((d) => exists(path.join(d, 'manifest.json'))) : [];
const storeDir = storeDirs.find((d) => readJson(path.join(d, 'manifest.json')).tenantSlug === slug) ?? (storeDirs.length === 1 ? storeDirs[0] : null);
const storeManifest = storeDir ? readJson(path.join(storeDir, 'manifest.json')) : null;
const storeLines = storeDir && exists(path.join(storeDir, 'records.jsonl')) ? fs.readFileSync(path.join(storeDir, 'records.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean) : [];
const storeRecords = storeLines.map((l) => JSON.parse(l));
const recordById = new Map(storeRecords.map((r) => [r.recordId, r]));
const payloadOf = (r) => { const p = storeDir && path.join(storeDir, 'payloads', `${r.payloadSha256}.json`); return exists(p) ? readJson(p) : null; };
const runTenantId = storeManifest?.tenantId ?? null;
const eoLedger = exists(path.join(out, 'eo-ledger.json')) ? readJson(path.join(out, 'eo-ledger.json')) : null;
// Synthetic-customer W2: E7B (out/eo-assess-7b.json, after AdminOps) sits between E7 pass 3 and E8F when the run made it;
// checks address the passes by name (passByName), never by a fixed index past pass 3.
const passFiles = [['E7 pass 1', path.join(out, 'eo-assess.json')], ['E7 pass 2', path.join(out, 'eo-assess-2.json')], ['E7 pass 3', path.join(out, 'eo-assess-3.json')],
  ...(exists(path.join(out, 'eo-assess-7b.json')) ? [['E7B', path.join(out, 'eo-assess-7b.json')]] : []), ['E8F', path.join(forcedDir, 'eo-assess.json')]];
const passes = passFiles.map(([name, p]) => ({ name, events: freshJson(p), stale: staleOf(p) }));
const passByName = (name) => passes.find((p) => p.name === name) ?? { name, events: null };
const ev = (pass, type) => (pass.events ?? []).find((e) => e.type === type) ?? null;
// Time fields: ISO, zone-less ISO (UTC) or PowerShell 5.1 /Date(ms)/.
const toMs = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const m = /\/Date\((-?\d+)/.exec(String(v)); if (m) return Number(m[1]);
  const s = String(v); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
};
const notW3 = 'run predates EO-collection W3';

// V37 (W3.4, B19): no objective is stale on a same-day run; every store-backed objective carries a freshness state.
check('V37', 'Freshness: every store-backed ledger objective is fresh; none stale or demoted', () => {
  if (!eoLedger) return { pass: false, detail: 'no out/eo-ledger.json' };
  const objs = eoLedger.objectives ?? [];
  const backed = objs.filter((o) => (o.evidenceRefs ?? []).length > 0);
  const withF = objs.filter((o) => o.freshness);
  const problems = [];
  const noF = backed.filter((o) => !o.freshness);
  if (noF.length) problems.push(`${noF.length} of ${backed.length} store-backed objectives carry no freshness field${withF.length === 0 ? ` (no objective carries one: ${notW3})` : ` (e.g. ${noF[0].objectiveId})`}`);
  const notFresh = backed.filter((o) => o.freshness && o.freshness !== 'fresh');
  if (notFresh.length) problems.push(`${notFresh.length} store-backed objectives not fresh (e.g. ${notFresh[0].objectiveId} ${notFresh[0].freshness})`);
  const stale = objs.filter((o) => o.freshness === 'stale' || o.staleDemoted);
  if (stale.length) problems.push(`${stale.length} objectives stale or demoted (e.g. ${stale[0].objectiveId})`);
  const states = countBy(withF, (o) => o.freshness);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${backed.length} store-backed objectives all fresh; freshness on ${withF.length} of ${objs.length} objectives ${JSON.stringify(states)}; 0 stale, 0 demoted` };
});

// V38: every store-backed detail (SSP evidenceDetails and ledger evidenceRefs) resolves to a store record with the same
// hash and a real collector identity (not ...@no-mgcontext); every record carries tenant, collector, query, endpoint, window.
check('V38', 'Provenance: every store-backed detail resolves to a record with a collector identity', () => {
  if (!storeDir) return { pass: false, detail: `no evidence store for ${slug} under out/eo/evidence-store` };
  const problems = [];
  const refs = [
    ...(ssp?.controlImplementations ?? []).flatMap((c) => (c.evidenceDetails ?? []).filter((d) => d.kind === 'evidence-store').map((d) => ({ at: `ssp:${c.control_id}`, recordId: d.recordId, sha256: d.sha256 }))),
    ...(eoLedger?.objectives ?? []).flatMap((o) => (o.evidenceRefs ?? []).map((r) => ({ at: `ledger:${o.objectiveId}`, recordId: r.recordId, sha256: r.sha256 }))),
  ];
  const unresolved = refs.filter((r) => !recordById.has(r.recordId));
  const hashBad = refs.filter((r) => recordById.has(r.recordId) && recordById.get(r.recordId).payloadSha256 !== r.sha256);
  const noId = refs.filter((r) => recordById.has(r.recordId) && (!recordById.get(r.recordId).collector?.identity || /@no-mgcontext$/.test(recordById.get(r.recordId).collector.identity)));
  if (!refs.length) problems.push('no store-backed detail in ssp.json or eo-ledger.json');
  if (unresolved.length) problems.push(`${unresolved.length} refs name no store record (e.g. ${unresolved[0].at})`);
  if (hashBad.length) problems.push(`${hashBad.length} refs' sha256 differs from the record's payload hash (e.g. ${hashBad[0].at})`);
  if (noId.length) problems.push(`${noId.length} refs rest on a record with no collector identity or @no-mgcontext (e.g. ${noId[0].at})`);
  const fieldsMissing = storeRecords.filter((r) => !r.tenantId || !r.collector?.name || !r.collector?.identity || !r.query || !r.endpoint || !r.window?.end);
  if (fieldsMissing.length) problems.push(`${fieldsMissing.length} records lack tenantId, collector, query, endpoint or window (e.g. seq ${fieldsMissing[0].seq})`);
  const ids = [...new Set(storeRecords.map((r) => r.collector?.identity))];
  const stamperIds = [...new Set((eoLedger?.objectives ?? []).flatMap((o) => o.executorIdentities ?? []))];
  const unknownStamper = stamperIds.filter((x) => /unknown/i.test(x));
  if (unknownStamper.length) problems.push(`Stamper executor identity unknown: ${unknownStamper.join(', ')}`);
  return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}${refs.length} refs (${refs.filter((r) => r.at.startsWith('ssp:')).length} SSP, ${refs.filter((r) => r.at.startsWith('ledger:')).length} ledger) resolve to ${new Set(refs.map((r) => r.recordId)).size} records; ${storeRecords.length} records, collector identities ${JSON.stringify(ids)}; Stamper executor identities (info) ${JSON.stringify(stamperIds)}` };
});

// V39 (W0.2a, B8): no positive source rests on an empty payload. In the stored snapshot, every Stamper source counted
// positive (evidence_import/imported) must match an evidence file (by its registry label) whose rawResponse is non-empty;
// and no met control's SSP Stamper SATs are all empty-payload when a Stamper tier decides it.
const pkgRoot = path.join(out, 'eo-package');
const pkgLatest = exists(pkgRoot) ? fs.readdirSync(pkgRoot).filter((d) => fs.statSync(path.join(pkgRoot, d)).isDirectory()).sort().pop() : null;
const storedSnapshot = pkgLatest && exists(path.join(pkgRoot, pkgLatest, 'assessments', 'latest-snapshot.json')) ? readJson(path.join(pkgRoot, pkgLatest, 'assessments', 'latest-snapshot.json')) : null;
check('V39', 'No positive source rests on an empty payload', () => {
  if (!storedSnapshot) return { pass: false, detail: 'no out/eo-package/<latest>/assessments/latest-snapshot.json' };
  const rawEv = latestRun ? path.join(runsDir, latestRun.evidence, 'raw', '06-execution', 'evidence') : null;
  const evRoot = exists(rawEv) ? rawEv : path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'evidence');
  const files = listFiles(evRoot).filter((p) => p.endsWith('.json')).map((p) => { try { return readJson(p); } catch { return null; } }).filter(Boolean);
  const isEmpty = (raw) => raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0) || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0);
  const byLabel = new Map();
  for (const f of files) { const l = f.registryEntry?.label; if (l) (byLabel.get(l) ?? byLabel.set(l, []).get(l)).push(f); }
  const problems = [];
  let positives = 0, unmatched = 0, emptySat = 0, emptyCounted = [];
  for (const c of storedSnapshot.controls ?? []) for (const s of c.sources ?? []) {
    if (s.type !== 'evidence_import') continue;
    const label = String(s.detail ?? '').replace(/ \[executor .*$/, '').trim();
    const fs_ = byLabel.get(label) ?? [];
    if (/SAT on an empty payload/.test(s.detail ?? '')) { emptySat++; if (s.result === 'imported') emptyCounted.push(`${c.control_id}: ${label}`); continue; }
    if (s.result !== 'imported') continue;
    positives++;
    if (!fs_.length) { unmatched++; continue; }
    if (fs_.every((f) => isEmpty(f.rawResponse))) emptyCounted.push(`${c.control_id}: ${label}`);
  }
  if (emptyCounted.length) problems.push(`${emptyCounted.length} positive sources rest on empty payloads (e.g. ${emptyCounted.slice(0, 3).join('; ')})`);
  const tierOf = (r) => Number((/^Tier (\d)/.exec(r ?? '') ?? [])[1] ?? 0);
  const allEmpty = (ssp?.controlImplementations ?? []).filter((c) => c.status === 'met').filter((c) => {
    const snap = (storedSnapshot.controls ?? []).find((x) => x.control_id === c.control_id);
    const t = tierOf(snap?.statusRationale);
    const sats = (c.evidenceDetails ?? []).filter((d) => d.kind === 'stamper' && d.verdict === 'SAT');
    return (t === 3 || t === 4) && sats.length > 0 && sats.every((d) => d.payloadEmpty);
  }).map((c) => c.control_id);
  if (allEmpty.length) problems.push(`met at a Stamper tier with only empty-payload SATs: ${allEmpty.join(', ')}`);
  if (unmatched) problems.push(`${unmatched} positive Stamper sources match no evidence file by label`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${positives} positive Stamper sources, each on a non-empty payload (${files.length} evidence files from ${path.relative(root, evRoot)}); ${emptySat} empty-payload SATs, all uncounted (no_query); snapshot ${storedSnapshot.snapshotId}` };
});

// V40: tenant-scoped. Every store record, every ledger evidenceRef and every SSP store detail names the run's tenant;
// tenant-suite ledger objectives carry the run's slug; the ledger and the SSP name the run's tenant.
check('V40', 'Tenant-scoped sources: no record, ref or ledger objective from another tenant', () => {
  if (!runTenantId) return { pass: false, detail: 'no evidence-store manifest (run tenant unknown)' };
  const problems = [];
  const foreignRecs = storeRecords.filter((r) => r.tenantId !== runTenantId || (r.tenantSlug && r.tenantSlug !== slug));
  if (foreignRecs.length) problems.push(`${foreignRecs.length} store records of another tenant (e.g. seq ${foreignRecs[0].seq} ${foreignRecs[0].tenantId})`);
  const refs = (eoLedger?.objectives ?? []).flatMap((o) => (o.evidenceRefs ?? []).map((r) => ({ o: o.objectiveId, t: r.tenantId })));
  const foreignRefs = refs.filter((r) => r.t !== runTenantId);
  if (foreignRefs.length) problems.push(`${foreignRefs.length} ledger refs of another tenant (e.g. ${foreignRefs[0].o} ${foreignRefs[0].t})`);
  if (eoLedger && eoLedger.tenantId !== runTenantId && eoLedger.tenantId !== slug) problems.push(`eo-ledger.json tenantId ${eoLedger.tenantId}`);
  const sspStore = (ssp?.controlImplementations ?? []).flatMap((c) => (c.evidenceDetails ?? []).filter((d) => d.kind === 'evidence-store').map((d) => ({ c: c.control_id, r: recordById.get(d.recordId) })));
  const sspForeign = sspStore.filter((x) => !x.r || x.r.tenantId !== runTenantId);
  if (sspForeign.length) problems.push(`${sspForeign.length} SSP store details not on this tenant's records (e.g. ${sspForeign[0].c})`);
  const suite = (eoLedger?.objectives ?? []).filter((o) => o.source === 'tenant-suite');
  const suiteForeign = suite.filter((o) => o.tenantSlug && o.tenantSlug !== slug);
  if (suiteForeign.length) problems.push(`${suiteForeign.length} tenant-suite objectives from slug ${suiteForeign[0].tenantSlug}`);
  const collectForeign = passes.flatMap((p) => (ev(p, 'collect') && ev(p, 'collect').tenantId !== runTenantId ? [p.name] : []));
  if (collectForeign.length) problems.push(`collect events name another tenant: ${collectForeign.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `tenant ${runTenantId} (${slug}): ${storeRecords.length} records, ${refs.length} ledger refs, ${sspStore.length} SSP store details, ${suite.length} tenant-suite objectives, 4 collect events; ledger tenant ${eoLedger?.tenantId}` };
});

// V41 (W1.2, PE-8): watermarks never regress over the four passes; E7 passes 2 and 3 collect nothing new; E8F collects
// exactly the directory-audit rows its forced execute added (the sim-ledger writes of E8F, by request id = audit row id)
// and nothing from any other collector. Synthetic-customer W2 (PLAN §3): with E7B (five passes), E7B's C2 rows are exactly
// the sim-ledger writes of the E7A window (AdminOps), by id; E8F is the last pass.
check('V41', 'Watermarks monotonic; passes 2-3 collect nothing new; E7B collects exactly the E7A writes; E8F collects exactly its forced rows', () => {
  const problems = [];
  const missingPass = passes.filter((p) => !ev(p, 'collect')).map((p) => p.name);
  if (missingPass.length) return { pass: false, detail: `no collect event in: ${missingPass.join(', ')}` };
  const cols = passes.map((p) => new Map(ev(p, 'collect').collectors.map((c) => [c.planId, c])));
  const ids = [...cols[0].keys()];
  for (const id of ids) for (let i = 1; i < passes.length; i++) {
    const a = cols[i - 1].get(id), b = cols[i].get(id);
    if (!b) { problems.push(`${id} absent in ${passes[i].name}`); continue; }
    for (const k of ['lastWindowEnd', 'lastEventTime']) {
      if (a?.[k] && (!b[k] || toMs(b[k]) < toMs(a[k]))) problems.push(`${id} ${k} regresses ${passes[i - 1].name} ${a[k]} -> ${passes[i].name} ${b[k]}`);
    }
  }
  const bySource = new Map();
  for (const r of storeRecords) (bySource.get(r.sourceId) ?? bySource.set(r.sourceId, []).get(r.sourceId)).push(r);
  for (const [s, rs] of bySource) for (let i = 1; i < rs.length; i++) if (toMs(rs[i].window?.end) < toMs(rs[i - 1].window?.end)) problems.push(`${s}: record seq ${rs[i].seq} window end before seq ${rs[i - 1].seq}`);
  for (const i of [1, 2]) {
    const fresh = [...cols[i].values()].filter((c) => (c.newItems ?? 0) !== 0 || !['empty', 'success'].includes(c.status));
    if (fresh.length) problems.push(`${passes[i].name}: ${fresh.map((c) => `${c.planId} ${c.status} +${c.newItems}`).join(', ')}`);
  }
  const e8 = cols[cols.length - 1];
  const other = [...e8.values()].filter((c) => c.planId !== 'C2' && (c.newItems ?? 0) !== 0);
  if (other.length) problems.push(`E8F collected rows outside C2: ${other.map((c) => `${c.planId} +${c.newItems}`).join(', ')}`);
  const simLedger = (p) => (exists(p) ? (readJson(p).data ?? []) : null);
  const normal = simLedger(path.join(out, 'ledger.json')), forced = simLedger(path.join(forcedDir, 'ledger.json'));
  let detailE8 = '';
  if (!normal || !forced) problems.push('sim ledgers missing (out/ledger.json, out/runs/forced/ledger.json)');
  else {
    const seen = new Set(normal.map((e) => e.requestId));
    const added = forced.filter((e) => (e.type === 'create' || e.type === 'mutate') && !seen.has(e.requestId)).map((e) => e.requestId).sort();
    const c2 = (bySource.get('collect.directoryAudits') ?? []);
    const e8Rec = c2[c2.length - 1];
    const rows = e8Rec?.status === 'success' ? (payloadOf(e8Rec) ?? []) : [];
    const got = rows.map((r) => r.id).sort();
    const same = JSON.stringify(got) === JSON.stringify(added);
    if (!same) problems.push(`E8F C2 collected ${got.length} rows; the forced execute added ${added.length} writes (${got.filter((x) => !added.includes(x)).length} unexpected, ${added.filter((x) => !got.includes(x)).length} not collected)`);
    if (e8.get('C2')?.newItems !== got.length) problems.push(`E8F collect event says C2 +${e8.get('C2')?.newItems}, the record holds ${got.length}`);
    detailE8 = `E8F C2 +${got.length} = the ${added.length} sim writes of the forced execute (ids equal)`;
    const iB = passes.findIndex((p) => p.name === 'E7B');
    if (iB >= 0) {
      const inA = (e) => !!steps.E7A && e.ts >= steps.E7A.started && e.ts <= steps.E7A.ended;
      const aoWrites = normal.filter((e) => (e.type === 'create' || e.type === 'mutate') && e.sessionType !== 'seed' && inA(e)).map((e) => e.requestId).sort();
      const inB = (r) => !!steps.E7B && toMs(r.collectedAt) >= toMs(steps.E7B.started) && toMs(r.collectedAt) <= toMs(steps.E7B.ended);
      const bRecs = c2.filter(inB);
      const bGot = bRecs.flatMap((r) => (r.status === 'success' ? (payloadOf(r) ?? []) : [])).map((r) => r.id).sort();
      if (bRecs.length === 0) problems.push('no C2 record collected during E7B');
      if (JSON.stringify(bGot) !== JSON.stringify(aoWrites)) problems.push(`E7B C2 collected ${bGot.length} rows; E7A wrote ${aoWrites.length} (${bGot.filter((x) => !aoWrites.includes(x)).length} unexpected, ${aoWrites.filter((x) => !bGot.includes(x)).length} not collected)`);
      if ((cols[iB].get('C2')?.newItems ?? 0) !== bGot.length) problems.push(`E7B collect event says C2 +${cols[iB].get('C2')?.newItems}, the records hold ${bGot.length}`);
      detailE8 += `; E7B C2 +${bGot.length} = the ${aoWrites.length} E7A (AdminOps) sim writes (ids equal)`;
    }
  }
  return { pass: problems.length === 0, detail: problems.length ? problems.slice(0, 8).join('; ') : `${ids.length} collectors over ${passes.length} passes: no watermark regresses (collect events and record windows); passes 2-3 +0 everywhere; ${detailE8}; other collectors +0 on E8F` };
});

// V42 (W1.1): the hash chain recomputes (record hashes, links, payload hashes) and the manifest's head and count match.
check('V42', 'Hash chain intact: records, links and payloads recompute; manifest head and count match', () => {
  if (!storeDir) return { pass: false, detail: `no evidence store for ${slug}` };
  if (!canon?.canonicalSha256) return { pass: false, detail: 'ces-shared dist canonicalHash.js not importable' };
  const problems = [];
  let prev = '0'.repeat(64), firstBreak = null;
  storeRecords.forEach((r, i) => {
    const { recordSha256, ...rest } = r;
    const brk = (m) => { problems.push(m); firstBreak ??= i + 1; };
    if (r.seq !== i + 1) brk(`line ${i + 1} carries seq ${r.seq}`);
    if (r.prevRecordSha256 !== prev) brk(`seq ${r.seq}: prev link broken`);
    if (canon.canonicalSha256(rest) !== recordSha256) brk(`seq ${r.seq}: record hash does not recompute`);
    const pf = path.join(storeDir, 'payloads', `${r.payloadSha256}.json`);
    if (!exists(pf)) brk(`seq ${r.seq}: payload file missing`);
    else if (sha(pf) !== r.payloadSha256) brk(`seq ${r.seq}: payload bytes hash ${sha(pf).slice(0, 12)}…`);
    prev = recordSha256;
  });
  if (storeManifest.recordCount !== storeRecords.length) problems.push(`manifest recordCount ${storeManifest.recordCount} != ${storeRecords.length} records`);
  if (storeRecords.length && storeManifest.headSha256 !== prev) problems.push(`manifest head ${String(storeManifest.headSha256).slice(0, 12)}… != last record ${prev.slice(0, 12)}…`);
  if ((storeManifest.chain ?? []).length !== storeRecords.length) problems.push(`manifest chain lists ${(storeManifest.chain ?? []).length} records`);
  return { pass: problems.length === 0, detail: problems.length ? `first break at seq ${firstBreak ?? '-'}: ${problems.slice(0, 5).join('; ')}` : `${storeRecords.length} records recompute (record hash, prev link, payload bytes); manifest head ${prev.slice(0, 12)}… and count ${storeManifest.recordCount} match; tenant ${runTenantId}` };
});

// V43a (W3.3): E8F's drift regressions are exactly SC.L2-3.13.15 (met -> not met), and the automatic POA&M reconcile
// on E8F opened or reopened at least one item.
check('V43a', 'Regression: E8F regressions = exactly SC.L2-3.13.15 (plus the scenario allowed_reverts controls); the auto-reconcile added or reopened >= 1', () => {
  const p = passByName('E8F');
  // Synthetic-customer W2 (PLAN §3 overlap rule): controls the scenario's allowed_reverts name may also regress on E8F.
  const e7aRev = exists(path.join(out, 'adminops-e7a.json')) ? readJson(path.join(out, 'adminops-e7a.json')).allowed_reverts ?? [] : [];
  const mayRegress = new Set(['SC.L2-3.13.15', ...e7aRev.flatMap((r) => r.controls ?? [])]);
  if (!p.events) return { pass: false, detail: 'no out/runs/forced/eo-assess.json' };
  const d = ev(p, 'drift'), rec = ev(p, 'poam_reconciled');
  const problems = [];
  if (!d) problems.push(`no drift event on E8F (${notW3})`);
  else {
    const ids = (d.regressions ?? []).map((r) => r.controlId).sort();
    if (!ids.includes('SC.L2-3.13.15') || ids.some((x) => !mayRegress.has(x))) problems.push(`regressions ${JSON.stringify(ids)}${mayRegress.size > 1 ? ` (allowed: ${[...mayRegress].sort().join(', ')})` : ''}`);
    // S1 fix (2026-10-28): judge the SC.L2-3.13.15 entry itself; regressions[0] was another control on run 27.
    const r = (d.regressions ?? []).find((x) => x.controlId === 'SC.L2-3.13.15');
    if (r && !(r.previous?.status === 'met' && r.current?.status === 'not_met')) problems.push(`SC.L2-3.13.15 ${r.previous?.status} -> ${r.current?.status}`);
  }
  if (!rec) problems.push(`no poam_reconciled event on E8F (${notW3})`);
  else if (((rec.summary?.newThisRun ?? 0) + (rec.summary?.reopenedThisRun ?? 0)) < 1) problems.push(`reconcile newThisRun ${rec.summary?.newThisRun} + reopenedThisRun ${rec.summary?.reopenedThisRun} < 1`);
  const errs = (p.events ?? []).filter((e) => e.type === 'drift_error' || e.type === 'poam_reconcile_failed').map((e) => e.type);
  if (errs.length) problems.push(`E8F events: ${errs.join(', ')}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `E8F regressions ${JSON.stringify((d.regressions ?? []).map((r) => r.controlId).sort())}: SC.L2-3.13.15 met -> not_met (tier ${d.regressions.find((r) => r.controlId === 'SC.L2-3.13.15')?.previous?.tier} -> ${d.regressions.find((r) => r.controlId === 'SC.L2-3.13.15')?.current?.tier}); reconcile new ${rec.summary.newThisRun} + reopened ${rec.summary.reopenedThisRun}` };
});

// V43b (W3.2): no false drift across the E7 passes: passes 2 and 3 empty; pass 1 has no regression (it compares with the
// previous run's last snapshot, so its improvements are not asserted).
// W0 drift baseline (2026-10-28): EO skips snapshots stored with metadata.forced (the E8F assess sends forced=1), so pass 1
// compares with the previous run's last E7 pass, not its E8F. On a tenant's first run pass 1 has no previous snapshot: its
// drift event is a baseline (baseline: true, previousSnapshotId: null, regressions: []), which this check passes.
check('V43b', 'Drift: no drift across the E7 passes (2 and 3 empty; pass 1 no regression)', () => {
  // W8-ENC: pass-1 regressions on the scenario's expected_improvements (out/adminops-e7a.json, the list V47 reads) are
  // excused and reported: E7A fixes them, E7B snapshots them met, and the next run's sim reset re-breaks them. Judge in
  // verify-w4.mjs (judgeV43b). Read here, not from the e7a const further down (declared after this check runs).
  const e7aV43b = exists(path.join(out, 'adminops-e7a.json')) ? readJson(path.join(out, 'adminops-e7a.json')) : null;
  const expectedIds = e7aV43b && (!e7aV43b.tenant_slug || e7aV43b.tenant_slug === slug) ? (e7aV43b.expected_improvements ?? []).map((x) => x.controlId) : [];
  return judgeV43b({ passes, driftOf: (p) => ev(p, 'drift'), expectedIds, notW3 });
});

// V44 (W2, PE-8): the date filter is honoured. Every row in each windowed collector record is dated inside the record's
// window; the negative case: the sim's seeded UAL rows older than 30 days (before pass 1) and every UAL row older than the
// earliest C1a window are in no stored payload.
const TIME_FIELD = {
  'collect.unifiedAuditLog': 'CreationDate', 'collect.directoryAudits': 'activityDateTime', 'collect.signIns': 'createdDateTime',
  'collect.pimActivations': 'createdDateTime', 'collect.riskDetections': 'detectedDateTime', 'collect.riskyUsers': 'riskLastUpdatedDateTime',
  'collect.securityAlerts': 'lastUpdateDateTime', 'collect.securityIncidents': 'lastUpdateDateTime', 'collect.tvmAssessmentRecency': 'LastAssessed',
  'collect.secureScores': 'createdDateTime', 'collect.tvmVulnerabilities': 'eoObservedDateTime', 'collect.secureScoreControlProfiles': 'eoObservedDateTime',
  'collect.deviceCompliance': 'eoObservedDateTime',
  // Synthetic-customer W2: C10 (AdminOps rows; one record per row, the payload is the row object).
  'collect.adminOps': 'timestamp',
  // Gap closure FLOW-4: C11 (Stamper evidence files and rows, chained at assess time).
  'collect.stamperEvidence': 'observedAt',
};
check('V44', 'Date filter honoured: collected rows inside their window; seeded rows older than the window never collected', () => {
  if (!storeDir) return { pass: false, detail: `no evidence store for ${slug}` };
  const problems = [];
  let rowsChecked = 0, recsChecked = 0;
  const allIds = new Set();
  for (const r of storeRecords.filter((x) => x.sourceId.startsWith('collect.') && x.status === 'success')) {
    const field = TIME_FIELD[r.sourceId];
    const pl = payloadOf(r);
    const rows = Array.isArray(pl) ? pl : pl ? [pl] : [];
    for (const row of rows) { allIds.add(String(row.Identity ?? row.id ?? '')); }
    if (!field) { problems.push(`${r.sourceId}: no time field known`); continue; }
    recsChecked++;
    const lo = toMs(r.window?.start), hi = toMs(r.window?.end);
    const out_ = rows.filter((row) => { const t = toMs(row[field]); return !Number.isFinite(t) || (Number.isFinite(lo) && t < lo) || t > hi; });
    rowsChecked += rows.length;
    if (out_.length) problems.push(`${r.sourceId} seq ${r.seq}: ${out_.length} of ${rows.length} rows outside [${r.window?.start}, ${r.window?.end}] (e.g. ${out_[0][field]})`);
  }
  const simStorePath = path.join(ces, 'tenant-stacksim', '.stacksim', 'tenants', slug, 'store.json');
  const simUal = exists(simStorePath) ? Object.values(readJson(simStorePath).collections?.unifiedAuditLog ?? {}) : null;
  let neg = '';
  if (!simUal) problems.push(`no sim store at ${path.relative(root, simStorePath)} (negative case not checked)`);
  else {
    const ualRecs = storeRecords.filter((r) => r.sourceId === 'collect.unifiedAuditLog');
    const firstEnd = toMs((ev(passes[0], 'collect')?.collectors ?? []).find((c) => c.planId === 'C1a')?.lastWindowEnd ?? storeRecords[0]?.collectedAt);
    const earliest = Math.min(...ualRecs.map((r) => toMs(r.window?.start)).filter(Number.isFinite));
    const old30 = simUal.filter((u) => toMs(u.CreationDate) < firstEnd - 30 * 86400000);
    const beforeWindow = simUal.filter((u) => toMs(u.CreationDate) < earliest);
    const leaked = beforeWindow.filter((u) => allIds.has(String(u.Identity ?? u.id)));
    if (!old30.length) problems.push('the sim store has no UAL row older than 30 days (the negative case is vacuous)');
    if (leaked.length) problems.push(`${leaked.length} UAL rows older than the earliest C1a window were collected (e.g. ${leaked[0].id} ${leaked[0].CreationDate})`);
    neg = `; negative case: ${old30.length} seeded UAL rows older than 30 days (${old30.map((u) => String(u.CreationDate).slice(0, 10)).join(', ')}) and all ${beforeWindow.length} rows before the earliest C1a window (${new Date(earliest).toISOString()}) absent from every payload`;
  }
  return { pass: problems.length === 0, detail: problems.length ? problems.slice(0, 6).join('; ') : `${rowsChecked} rows in ${recsChecked} collector records, all inside their windows${neg}` };
});

// ---------- Synthetic-customer W0: V49, V58 ----------
// Both apply to a synthetic customer only (the package carries customers/<slug>/customer.json). muster-partial is not
// one: its bundle stays under V25's scan, and its generated documents name no fictional customer.
const synthetic = isSyntheticCustomer(slug);
const notSynthetic = { pass: true, detail: `not a synthetic customer (no customers/${slug}/customer.json): not checked` };

// V49: identity scan over the V49 scope (v49-scope.mjs: the shared bundle, the simulator scenario and seed files for the
// slug, customers/<slug>/, the AdminOps shared-database rows of the tenant, the EvidenceOps store records and payloads)
// with nb-tools/scan-tokens.txt + the workstation user name (the company name is not a token), plus the org-id patterns of PLAN §2
// over customers/<slug>/*.json. The scan runs with -NoContext: the detail and the report give files and counts only.
check('V49', 'Identity scan of the synthetic-customer scope = 0 hits; org ids match the fictional patterns', () => {
  if (!synthetic) return notSynthetic;
  const scope = v49Scope({ root, slug });
  const report = path.join(out, 'v49', slug, 'identity-scan.json');
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
  const scanPs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'identity-scan.ps1');
  const problems = [];
  if (!scope.roots.length) problems.push('nothing to scan');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${q(scanPs)} -Path @(${scope.roots.map(q).join(',')}) -Extra @(${scope.tokens.map(q).join(',')}) -NoContext -Root ${q(root)} -Scenario ${q(slug)} -Report ${q(report)}; exit $LASTEXITCODE`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rep = exists(report) ? readJson(report) : null;
  if (!rep) problems.push(`no scan report (identity-scan exit ${r.status})`);
  else if (r.status !== 0 || rep.hits_total) problems.push(`${rep.hits_total} hits in ${rep.files.length} files (report ${path.relative(root, report)})`);
  // Org ids (PLAN §2): UEI SIMX + 8, CAGE 9S + 3, domain <slug>.simtenant.onmicrosoft.us, phones 555-01xx, ZIP 00000.
  const custDir = path.join(scriptsDir, '..', 'customers', slug);
  const idBad = [];
  const walk = (o, at) => {
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${at}[${i}]`)); return; }
    if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) walk(v, at ? `${at}.${k}` : k); return; }
    if (typeof o !== 'string') return;
    const leaf = at.split('.').pop().toLowerCase();
    if (leaf === 'uei' && !/^SIMX[A-Z0-9]{8}$/.test(o)) idBad.push(at);
    if (leaf === 'cage' && !/^9S[A-Z0-9]{3}$/.test(o)) idBad.push(at);
    if (/(^|_)zip$/.test(leaf) && o !== '00000') idBad.push(at);
    if (/phone/.test(leaf) && !/555-01\d\d$/.test(o)) idBad.push(at);
    for (const d of o.match(/@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []) if (d.toLowerCase() !== `@${slug}.simtenant.onmicrosoft.us`) idBad.push(`${at} (mail domain)`);
    if (leaf === 'domain' && o !== `${slug}.simtenant.onmicrosoft.us`) idBad.push(at);
  };
  let jsonFiles = 0;
  for (const f of exists(custDir) ? fs.readdirSync(custDir).filter((x) => x.endsWith('.json')) : []) { jsonFiles++; walk(readJson(path.join(custDir, f)), f); }
  if (idBad.length) problems.push(`${idBad.length} org ids off the fictional patterns (e.g. ${idBad.slice(0, 4).join(', ')})`);
  const kinds = Object.entries(scope.sources).filter(([k]) => k !== 'adminops_note').map(([k, v]) => `${k} ${v.length}`).join(', ');
  return { pass: problems.length === 0, detail: `${problems.length ? `${problems.join('; ')}; ` : ''}${rep?.files_scanned ?? 0} files scanned (${kinds}; adminops ${scope.sources.adminops_note}); ${scope.tokens.length} extra tokens, token file ${scope.tokenFile ? 'present' : 'absent'}; ${jsonFiles} customer JSON files id-checked` };
});

// V58: every document rendered for a synthetic customer carries a visible "SIMULATED CUSTOMER (FICTIONAL): ..." marker:
//   SSP JSON    systemName starts with the marker, or ssp.simulation.fictional === true   (EO SspGenerator)
//   SSP DOCX    the cover (first 3000 characters of the document text) carries the marker  (EO SSP DOCX export)
//   POA&M JSON  a string field carries the marker, or poam.simulation.fictional === true   (EO POA&M generator)
//   policies    every out/plan/policies/*.md (first 3000 characters) and *.docx              (Muster policy renderer)
//   reports     every out/plan/reports/* file                                                (Muster MG-11 report writers)
//   forced SSP  out/runs/forced/ssp.json, as the SSP JSON                                    (EO SspGenerator)
const V58_MARK = /SIMULATED CUSTOMER \(FICTIONAL\):/;
const docxTextOf = async (file) => {
  try {
    const JSZip = createRequire(import.meta.url)(path.join(ces, 'node_modules', 'jszip'));
    const xml = await (await JSZip.loadAsync(fs.readFileSync(file))).file('word/document.xml').async('string');
    return decodeXml(xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, ''));
  } catch { return null; }
};
const v58Docs = [];
if (synthetic) {
  const pol = path.join(planDir, 'policies'), reps = path.join(planDir, 'reports');
  for (const f of exists(pol) ? fs.readdirSync(pol).sort() : []) {
    const p = path.join(pol, f);
    if (f.endsWith('.md')) v58Docs.push({ owner: 'Muster policy renderer', at: `out/plan/policies/${f}`, text: fs.readFileSync(p, 'utf8').slice(0, 3000) });
    else if (f.endsWith('.docx')) v58Docs.push({ owner: 'Muster policy renderer', at: `out/plan/policies/${f}`, text: ((await docxTextOf(p)) ?? '').slice(0, 3000) });
  }
  for (const f of exists(reps) ? fs.readdirSync(reps).sort() : []) {
    const p = path.join(reps, f);
    if (!fs.statSync(p).isFile()) continue;
    v58Docs.push({ owner: 'Muster MG-11 report writer', at: `out/plan/reports/${f}`, text: f.endsWith('.docx') ? ((await docxTextOf(p)) ?? '') : fs.readFileSync(p, 'utf8') });
  }
}
check('V58', 'Every SSP, DOCX, POA&M, policy and report of a synthetic customer carries "SIMULATED CUSTOMER (FICTIONAL): ..."', () => {
  if (!synthetic) return notSynthetic;
  const missing = [];
  const jsonMarked = (o) => o?.simulation?.fictional === true || V58_MARK.test(JSON.stringify(o ?? ''));
  if (!ssp) missing.push('out/ssp.json absent (EO SspGenerator)');
  else if (!(ssp.simulation?.fictional === true || V58_MARK.test(String(ssp.systemName ?? '')))) missing.push('out/ssp.json systemName / simulation flag (EO SspGenerator)');
  const fSspP = path.join(forcedDir, 'ssp.json');
  if (exists(fSspP)) { const f = readJson(fSspP); if (!(f.simulation?.fictional === true || V58_MARK.test(String(f.systemName ?? '')))) missing.push('out/runs/forced/ssp.json systemName / simulation flag (EO SspGenerator)'); }
  if (!docxText) missing.push('out/ssp.docx unreadable or absent (EO SSP DOCX export)');
  else if (!V58_MARK.test(docxText.slice(0, 3000))) missing.push('out/ssp.docx cover (EO SSP DOCX export)');
  if (!poamJson) missing.push('out/poam.json absent (EO POA&M generator)');
  else if (!jsonMarked(poamJson)) missing.push('out/poam.json (EO POA&M generator)');
  const pol = v58Docs.filter((d) => d.at.startsWith('out/plan/policies/'));
  const rep = v58Docs.filter((d) => d.at.startsWith('out/plan/reports/'));
  if (!pol.length) missing.push('no out/plan/policies documents (Muster policy renderer)');
  if (!rep.length) missing.push('no out/plan/reports files (Muster MG-11 report writer)');
  const unmarked = v58Docs.filter((d) => !V58_MARK.test(d.text));
  const byOwner = countBy(unmarked, (d) => d.owner);
  for (const [owner, n] of Object.entries(byOwner)) missing.push(`${n} ${owner} file(s) unmarked (e.g. ${unmarked.find((d) => d.owner === owner).at})`);
  const total = 3 + (exists(fSspP) ? 1 : 0) + v58Docs.length;
  return { pass: missing.length === 0, detail: missing.length ? `${missing.length} gaps over ${total} documents: ${missing.join('; ')}` : `${total} documents carry the marker (SSP JSON + DOCX cover, POA&M, ${pol.length} policy files, ${rep.length} report files${exists(fSspP) ? ', forced SSP' : ''})` };
});

// ---------- Synthetic-customer W1: V54 (overrides retired) ----------
// V54 (PLAN §3): no overrides file is loaded; the twelve operator keys come from Muster with a provenance; only
// initialPassword is generated (by the harness, into the Stamper environment). All of:
//   (a) logs/E6-overrides.out has the line "overrides: not needed" and logs/E6-overrides.json mode is "not-needed";
//   (b) out/executable-plan.json variables equal the pushed TM tenant_identity values for the twelve keys;
//   (c) each key's provenance is discovered | derived | answered (overrides-gate.mjs provenanceFor: the TM's
//       tenant_identity.operator_value_provenance.values, else the SI/TCP provenance maps);
//   (d) neither overrides file (package root, customers/<slug>/) appears in the bundle manifests, by SHA-256 or by name;
//   (e) logs/E5-translate.{out,err} carry no UNRESOLVED_VARIABLE except initialPassword (Stamper's CLI does not read
//       STAMPER_INITIAL_PASSWORD yet: LOG-W1-harness open item 1);
//   (f) the plan's initialPassword is absent or a <<CES_SECRET:...>> sentinel, and the retired placeholder password
//       appears in none of the run's plan, report, steps, record, E5/E6/E8F logs or bundle files.
// FIN-35 S-1 (GD-e): the TCP and SI Baseline are no longer in Stamper's plans folder; E3's out/plan holds the same envelopes.
const pTCP = latest(planDir, 'tcp-');
const pSI = latest(planDir, 'si-baseline-');
check('V54', 'Overrides retired: the twelve keys come from Muster with provenance; only initialPassword is generated', () => {
  const problems = [];
  const logDir = path.join(out, 'logs');
  const ovOut = exists(path.join(logDir, 'E6-overrides.out')) ? fs.readFileSync(path.join(logDir, 'E6-overrides.out'), 'utf8') : null;
  const ovLog = exists(path.join(logDir, 'E6-overrides.json')) ? readJson(path.join(logDir, 'E6-overrides.json')) : null;
  if (!ovOut || !ovOut.split(/\r?\n/).some((l) => l.trim() === OVERRIDES_NOT_NEEDED_LINE)) problems.push(`(a) E6-overrides.out lacks "${OVERRIDES_NOT_NEEDED_LINE}"${ovOut ? ` (has: ${ovOut.trim().slice(0, 160)})` : ' (absent)'}`);
  if (ovLog?.mode !== 'not-needed') problems.push(`(a) E6-overrides.json mode ${ovLog ? `${ovLog.mode ?? 'none (pre-W1 log: applied ' + (ovLog.applied ?? []).length + ')'}` : 'absent'}`);
  const ti = tmBody(tm)?.tenant_identity ?? {};
  const vars = exePlan?.variables ?? null;
  if (!vars) problems.push('(b) out/executable-plan.json absent');
  else {
    const neq = TENANT_IDENTITY_KEYS.filter((k) => !isPresent(ti[k]) || vars[k] !== ti[k]);
    if (neq.length) problems.push(`(b) ${neq.length} keys absent from the TM or unequal in the plan: ${neq.join(', ')}`);
  }
  const prov = { tm, tcp: exists(pTCP) ? readJson(pTCP) : null, si: exists(pSI) ? readJson(pSI) : null };
  const badProv = TENANT_IDENTITY_KEYS.map((k) => [k, provenanceFor(k, prov)]).filter(([, p]) => !ALLOWED_PROVENANCE.includes(p));
  if (badProv.length) problems.push(`(c) ${badProv.length} keys without a discovered/derived/answered provenance: ${badProv.map(([k, p]) => `${k}=${p ?? 'none'}`).join(', ')}`);
  const ovFiles = [path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'sim-overrides.json'), path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'customers', slug, 'sim-overrides.json')].filter(exists);
  const ovHashes = new Set(ovFiles.map(sha));
  const bundleFiles = [];
  if (latestRun) for (const k of ['raw', 'shared']) {
    const mf = path.join(runsDir, latestRun.evidence, k, 'manifest.json');
    if (exists(mf)) for (const it of readJson(mf).items ?? []) for (const f of it.files ?? []) bundleFiles.push({ k, ...f });
  }
  if (!latestRun) problems.push('(d) no out/runs/latest.json (E8B bundle.mjs)');
  const ovInBundle = bundleFiles.filter((f) => (f.sha256 && ovHashes.has(f.sha256)) || /sim-overrides/i.test(String(f.path)));
  if (ovInBundle.length) problems.push(`(d) overrides file in the bundle: ${ovInBundle.map((f) => `${f.k}/${f.path}`).join(', ')}`);
  const tr = ['E5-translate.out', 'E5-translate.err'].map((f) => path.join(logDir, f)).filter(exists).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const unresolved = [...new Set([...tr.matchAll(/UNRESOLVED_VARIABLE: (\w+)/g)].map((m) => m[1]))].filter((n) => !HARNESS_GENERATED_KEYS.includes(n)).sort();
  if (unresolved.length) problems.push(`(e) ${unresolved.length} UNRESOLVED_VARIABLE at translate: ${unresolved.join(', ')}`);
  const pwVar = vars?.initialPassword;
  if (pwVar !== undefined && !/^<<CES_SECRET:\w+>>$/.test(String(pwVar))) problems.push('(f) the plan carries a plain initialPassword value');
  const placeholder = 'SimOnly-Placeholder-Not-A-Secret';
  const scanFiles = ['executable-plan.json', 'execution-report.json', 'steps.json', 'tester-run.json'].map((f) => path.join(out, f))
    .concat(exists(logDir) ? fs.readdirSync(logDir).filter((f) => /^(E5|E6|E8F)-/.test(f)).map((f) => path.join(logDir, f)) : [])
    .concat(latestRun ? bundleFiles.map((f) => path.join(runsDir, latestRun.evidence, f.k, f.path)) : [])
    .filter(exists);
  const leaked = scanFiles.filter((f) => fs.readFileSync(f).includes(placeholder));
  if (leaked.length) problems.push(`(f) the retired placeholder password is in ${leaked.length} files (e.g. ${path.relative(root, leaked[0]).split(path.sep).join('/')})`);
  const generated = HARNESS_GENERATED_KEYS.join(', ');
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `overrides not needed; ${TENANT_IDENTITY_KEYS.length} keys equal TM tenant_identity with provenance (${Object.entries(countBy(TENANT_IDENTITY_KEYS.map((k) => provenanceFor(k, prov)), (p) => p)).map(([p, n]) => `${p} ${n}`).join(', ')}); no overrides file in ${bundleFiles.length} bundle entries; 0 UNRESOLVED_VARIABLE besides ${generated}; ${scanFiles.length} files free of the retired placeholder` };
});

// ---------- Synthetic-customer W2: V45-V48 (AdminOps in the loop) ----------
// Inputs: out/adminops-e7a.json (the tester's E7A record: ops, calls, AO evidence row ids and hashes, expected_improvements,
// allowed_reverts), the AO evidence rows in <WS>/pl/ces.db (collection adminops_evidence, read-only), the E7B assess stream
// (out/eo-assess-7b.json) and its drift record (out/eo/assessments/<snapshotId>/drift.json), the two sim ledgers, and the
// E8F overlap proof (out/runs/forced/ao-overlap.json). Under -Harness mx (no E7A) V45, V46 and V48 are "not run"; V47 runs
// whenever E7B ran (expected improvements: none without an E7A record).
const e7aFile = path.join(out, 'adminops-e7a.json');
const e7a = exists(e7aFile) ? readJson(e7aFile) : null;
const aoDbPath = path.join(root, 'pl', 'ces.db');
let aoDbCache;
const aoDb = () => {
  if (aoDbCache === undefined) {
    try {
      const Database = createRequire(import.meta.url)(path.join(ces, 'node_modules', 'better-sqlite3'));
      aoDbCache = exists(aoDbPath) ? new Database(aoDbPath, { readonly: true, fileMustExist: true }) : null;
    } catch {
      aoDbCache = null;
    }
  }
  return aoDbCache;
};
const aoRow = (id) => {
  const db = aoDb();
  const r = db?.prepare("SELECT tenant_id, data FROM ces_records WHERE collection = 'adminops_evidence' AND id = ?").get(id);
  return r ? { tenantId: r.tenant_id, ...JSON.parse(r.data) } : null;
};
const e7aCalls = (e7a?.ops ?? []).flatMap((o) => (o.calls ?? []).filter((c) => c.evidence_row_id).map((c) => ({ op: o, call: c })));
// W9-C1 (2P-H): an op's two-person mode, from the mode its AO rows recorded (data.evidence.metadata.twoPersonApproval;
// AO-private, not on the contract row); the E7A call record's relayed copy when ces.db is unreadable. A row with no
// recorded mode (an AO build before the switch) counts as 'on'.
const aoOpMode = (op) => aoTwoPersonMode((op.calls ?? []).filter((c) => c.evidence_row_id).map((c) => (aoDb() ? aoRow(c.evidence_row_id) : null)?.evidence?.metadata?.twoPersonApproval?.mode ?? c.two_person_mode));
const inStep = (id, ts) => !!steps[id] && !!ts && toMs(ts) >= toMs(steps[id].started) && toMs(ts) <= toMs(steps[id].ended);
const simWrites = (p) => (exists(p) ? (readJson(p).data ?? []) : null)?.filter((e) => !String(e.type).startsWith('read') && e.sessionType !== 'seed') ?? null;
const objKey = (e) => `${e.objectType}/${e.objectId}`;
// W2 follow-up (per-run AdminOps isolation): ces.db is append-only and shared across runs, so EO reads only the AO rows timed
// from this run's start (CES_EO_ADMINOPS_SINCE = E1's start, recorded by E7 and by the E7A record). Every C10
// (collect.adminOps) record of this run then holds a row of this run, no E7 pass collects one of E7A's rows (FIX-EL: step EL's
// A-22 row predates E7 by design, so an E7 C10 record holding only EL's rows is allowed), and E7B's reader counts this run's
// rows only. Six-year retention is a production property; the window is the simulator's.
const aoSince = e7a?.adminops_since ?? steps.E7?.adminops_since ?? null;
const aoWindowProblems = (rowsExpected, appliesExpected, elIds = new Set()) => {
  const problems = [];
  if (!aoSince) return ['no AdminOps run window (E7 adminops_since) recorded'];
  if (!steps.E1 || toMs(aoSince) !== toMs(steps.E1.started)) problems.push(`AdminOps run window ${aoSince} is not E1's start (${steps.E1?.started})`);
  const c10 = storeRecords.filter((r) => r.sourceId === 'collect.adminOps');
  const early = c10.filter((r) => r.status === 'success').flatMap((r) => { const pl = payloadOf(r); return Array.isArray(pl) ? pl : pl ? [pl] : []; }).filter((x) => !x?.timestamp || toMs(x.timestamp) < toMs(aoSince));
  if (early.length) problems.push(`${early.length} C10 records hold an AO row from before this run (e.g. ${early[0]?.rowId})`);
  // FIX-EL: EL's A-22 row exists before E7, so E7's C10 may collect it; a C10 record holding EL's rows only is not E7A's.
  const inE7 = c10.filter((r) => r.status === 'success' && inStep('E7', r.collectedAt) && !c10HoldsOnlyElRows(payloadOf(r), elIds));
  if (inE7.length) problems.push(`${inE7.length} C10 records with AO rows were collected in E7, before E7A`);
  const aa = ev(passByName('E7B'), 'assess_adminops');
  if (aa && rowsExpected !== null && aa.total !== rowsExpected) problems.push(`E7B assess_adminops.total ${aa.total} (this run's rows: ${rowsExpected})`);
  if (aa && appliesExpected !== null && aa.live !== appliesExpected) problems.push(`E7B assess_adminops.live ${aa.live} (this run's applies: ${appliesExpected})`);
  return problems;
};
const revertAllowed = (key) => (e7a?.allowed_reverts ?? []).some((r) => key === `${r.objectType}/${r.objectId}` || (r.objectId === undefined && key.startsWith(`${r.objectType}/`)));

// V45: per op, the two AO evidence rows the tier requires, on the registry tenant id; a T3 executed row names an approver
// other than the requestor (two-person ON; with it OFF, the mode the rows record, a T3 op has T2's rows and no approver); E7B's assess_adminops.live covers every apply; once C10 (collect.adminOps) is built, every
// executed row's hash is in a C10 record of the EO store.
check('V45', 'AdminOps: every E7A op has a result and its AO evidence rows (T2 dry_run + executed; T3 blocked_pending_approval + executed, approver != requestor, or with two-person approval OFF dry_run + executed, no approver) on the registry tenant; E7B reads exactly this run\'s rows (run window = E1 start); every row has a C10 (collect.adminOps) record with its hash, when C10 is built', () => {
  if (!e7a) {
    // -Harness mx runs no E7A; the run window still holds: no AO row of an earlier run reaches EO.
    if (harness !== 'mx' || !steps.E7?.adminops_since) return notRun('adminops-e7a.json');
    const wp = aoWindowProblems(0, 0);
    return { pass: wp.length === 0, detail: wp.length ? wp.join('; ') : `no E7A under -Harness mx; AdminOps run window ${aoSince} = E1 start: no earlier run's AO row in EO (C10 and E7B)` };
  }
  const problems = [];
  if (e7a.schema !== 'ces-tester/adminops-e7a@1') problems.push(`schema ${e7a.schema}`);
  if (!steps.E7A || e7a.started < steps.E7A.started) problems.push('the E7A record is not from this run (steps.json E7A)');
  if (!aoDb() && e7aCalls.length) problems.push(`AO evidence store not readable (${path.relative(root, aoDbPath).split(path.sep).join('/')})`);
  let rows = 0;
  const rowSha = [];
  for (const op of e7a.ops ?? []) {
    if (!op.ok) problems.push(`${op.op}: ${op.detail ?? 'not ok'}`);
    const mode = op.tier === 'T3' ? aoOpMode(op) : 'on';
    const want = aoTierCalls(op.tier, mode);
    for (const [call, outcome] of want) {
      const c = (op.calls ?? []).find((x) => x.call === call);
      if (!c?.evidence_row_id) { problems.push(`${op.op} ${call}: no evidence row id`); continue; }
      const r = aoDb() ? aoRow(c.evidence_row_id) : null;
      if (!r) { problems.push(`${op.op} ${call}: row ${c.evidence_row_id} not in adminops_evidence`); continue; }
      rows++;
      const m = r.metadata ?? {};
      if (m.outcome !== outcome) problems.push(`${op.op} ${call}: outcome ${m.outcome} (want ${outcome})`);
      if (m.tenantId !== e7a.tenant_id || r.tenantId !== e7a.tenant_id) problems.push(`${op.op} ${call}: tenant ${m.tenantId} (want ${e7a.tenant_id})`);
      if (c.evidence_sha256 && m.sha256 !== c.evidence_sha256) problems.push(`${op.op} ${call}: row hash differs from the CLI result`);
      if (m.requestorUPN !== e7a.requestor_upn) problems.push(`${op.op} ${call}: requestor is not the operator principal`);
      if (op.tier === 'T3' && mode === 'on' && call === 'apply' && (!m.approverUPN || m.approverUPN === m.requestorUPN)) problems.push(`${op.op}: executed row approver ${m.approverUPN ? 'equals the requestor' : 'missing'}`);
      if (m.sha256) rowSha.push(m.sha256);
    }
  }
  const applies = (e7a.ops ?? []).filter((o) => (o.calls ?? []).some((c) => c.call === 'apply')).length;
  const aa = ev(passByName('E7B'), 'assess_adminops');
  if (!aa) problems.push('no assess_adminops event on E7B');
  // FIX-EL (R-F11): step EL's A-22 rows (correlation leaver-flow:<flowId>, this tenant, stamped inside EL) are this run's
  // rows too. They are counted on their own, from ces.db; E7A's accounting above is unchanged.
  const elRecFile = path.join(out, 'leaver-flow.json');
  const leaver = elLeaverOf(exists(elRecFile) ? readJson(elRecFile) : null, steps);
  const elDb = leaver && aoDb()
    ? aoDb().prepare("SELECT id, tenant_id, data FROM ces_records WHERE collection = 'adminops_evidence' AND json_extract(data, '$.metadata.correlationId') = ?").all(`leaver-flow:${leaver.flowId}`).map((r) => ({ id: r.id, tenantId: r.tenant_id, ...JSON.parse(r.data) }))
    : [];
  const el = elAoRows(leaver, elDb, e7a.tenant_id);
  if (leaver && !el.live.length) problems.push(`EL confirmed ${leaver.userId} but no live A-22 row with correlation leaver-flow:${leaver.flowId} on ${e7a.tenant_id} inside EL`);
  for (const r of el.rows) if (r.metadata?.sha256) rowSha.push(r.metadata.sha256);
  // The run window makes E7B's counts this run's: live = the applies (+ EL's live rows), total = the rows E7A's calls
  // reported (+ EL's rows).
  problems.push(...aoWindowProblems(e7aCalls.length + el.rows.length, applies + el.live.length, el.ids));
  const c10Built = exists(path.join(ces, 'ces-eo', 'dist', 'eo', 'collect', 'adminOpsCollector.js'));
  let c10 = 'C10 not built yet: AO evidence rows checked in ces.db only';
  if (c10Built) {
    // LOG-W2-eo.md section 4 item 7: a C10 payload row carries aoSha256 = the ces.db row's data.metadata.sha256.
    const c10Sha = new Set(storeRecords.filter((r) => r.sourceId === 'collect.adminOps').flatMap((r) => { const pl = payloadOf(r); return (Array.isArray(pl) ? pl : pl ? [pl] : []).map((x) => x?.aoSha256); }).filter(Boolean));
    const missing = rowSha.filter((h) => !c10Sha.has(h));
    if (missing.length) problems.push(`${missing.length} of ${rowSha.length} AO rows have no C10 (collect.adminOps) record with their hash`);
    c10 = `C10: ${rowSha.length - missing.length}/${rowSha.length} AO rows recorded in collect.adminOps with the matching hash`;
  }
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.slice(0, 8).join('; ') : (e7a.ops ?? []).length === 0
      ? `no AdminOps ops in this scenario (adminops_ops empty); E7B assess_adminops live ${aa?.live}`
      : `${e7a.ops.length} ops (${e7a.ops.map((o) => `${o.op} ${o.tier}`).join(', ')}): ${rows} AO evidence rows on ${e7a.tenant_id}; run window ${aoSince} (E1 start): E7B total ${aa.total} = ${e7aCalls.length} rows${leaver ? ` + ${el.rows.length} EL row(s)` : ''}, live ${aa.live} = ${applies} applies${leaver ? ` + ${el.live.length} EL apply(ies) (A-22, leaver-flow:${leaver.flowId})` : ''}, no earlier run's row; ${c10}`,
  };
});

// V46: each write op's paired sim read (the confirm check) showed the new state; the sim writes of the E7A window exist
// exactly when the run had write ops; every AO evidence row of this run is stamped inside the E7A window.
check('V46', 'AdminOps writes: each write op\'s confirming sim read shows the new state; AO writes and AO evidence rows fall in the E7A window only', () => {
  if (!e7a) return notRun('adminops-e7a.json');
  const problems = [];
  const writes = simWrites(path.join(out, 'ledger.json'));
  if (!writes) return { pass: false, detail: 'no out/ledger.json' };
  if (!steps.E7A) return { pass: false, detail: 'no E7A window in steps.json' };
  const inA = writes.filter((e) => inStep('E7A', e.ts));
  const writeOps = (e7a.ops ?? []).filter((o) => o.kind === 'write');
  if (writeOps.length && inA.length === 0) problems.push('write ops ran but the sim recorded no write in the E7A window');
  if (!writeOps.length && inA.length) problems.push(`no write ops, yet ${inA.length} sim writes in the E7A window`);
  for (const o of writeOps) if (!o.confirm?.pass) problems.push(`${o.op}: confirming read ${o.confirm ? `failed (${o.confirm.actual})` : 'missing'}`);
  const late = e7aCalls.map(({ op, call }) => ({ op, call, r: aoDb() ? aoRow(call.evidence_row_id) : null })).filter(({ r }) => !r || !inStep('E7A', r.metadata?.timestamp));
  if (late.length) problems.push(`${late.length} AO evidence rows not stamped inside E7A (e.g. ${late[0].op.op} ${late[0].call.call})`);
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `${writeOps.length} write op(s) (${writeOps.map((o) => o.op).join(', ') || 'none'}): confirming reads pass; ${inA.length} sim writes in E7A (${[...new Set(inA.map(objKey))].join(', ') || 'none'}); ${e7aCalls.length} AO rows stamped inside E7A`,
  };
});

// V47: E7B's drift (against E7 pass 3) improves exactly the scenario's expected_improvements and regresses nothing; its
// POA&M reconcile opens or reopens nothing.
check('V47', 'E7B drift: improvements = the scenario expected_improvements exactly; no regression; drift baseline = E7 pass 3; nothing new opens on the POA&M', () => {
  const p = passByName('E7B');
  if (!p.events) return harness === 'tester' ? { pass: false, detail: 'no out/eo-assess-7b.json (E7B)' } : { pass: false, detail: 'no out/eo-assess-7b.json (E7B runs under both harnesses)' };
  const problems = [];
  const sid = ev(p, 'assess_summary')?.snapshotId;
  const driftFile = sid ? path.join(out, 'eo', 'assessments', sid, 'drift.json') : null;
  if (!exists(driftFile)) return { pass: false, detail: `no drift record for the E7B snapshot ${sid ?? '(none)'}` };
  const d = readJson(driftFile);
  const got = (d.controls ?? []).filter((c) => c.change === 'improvement').map((c) => c.controlId).sort();
  const want = (e7a?.expected_improvements ?? []).map((x) => x.controlId).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`improvements ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
  const reg = (d.regressions ?? []).map((r) => r.controlId);
  if (reg.length) problems.push(`regressions ${JSON.stringify(reg)}`);
  const pass3 = ev(passByName('E7 pass 3'), 'assess_summary')?.snapshotId;
  if (!pass3 || d.previousSnapshotId !== pass3) problems.push(`drift baseline ${d.previousSnapshotId} is not E7 pass 3 (${pass3})`);
  const rec = ev(p, 'poam_reconciled');
  if (!rec) problems.push('no poam_reconciled event on E7B');
  else if ((rec.summary?.newThisRun ?? 0) + (rec.summary?.reopenedThisRun ?? 0) !== 0) problems.push(`POA&M reconcile opened ${rec.summary.newThisRun} and reopened ${rec.summary.reopenedThisRun}`);
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `E7B vs E7 pass 3: improvements ${JSON.stringify(got)} = expected; 0 regressions (${d.summary?.tierOrSourceOnly ?? 0} tier/source-only); POA&M closed ${rec.summary?.closedThisRun ?? 0} this run, none opened`,
  };
});

// V48: the forced run (E8F) reverts no AO change outside allowed_reverts: the AO-touched objects (the E7A window's sim
// writes) are not Stamper E6 targets and are not written by E8F, and each write op's confirming read still passes after
// E8F, unless allowed_reverts lists the object.
check('V48', 'Overlap: no Stamper (E6 or E8F) write and no E8F revert on an AdminOps-touched object outside allowed_reverts', () => {
  if (!e7a) return notRun('adminops-e7a.json');
  const writes = simWrites(path.join(out, 'ledger.json'));
  const forcedW = simWrites(path.join(forcedDir, 'ledger.json'));
  const ovFile = path.join(forcedDir, 'ao-overlap.json');
  if (!writes || !forcedW) return { pass: false, detail: 'sim ledgers missing (out/ledger.json, out/runs/forced/ledger.json)' };
  if (!exists(ovFile)) return { pass: false, detail: 'no out/runs/forced/ao-overlap.json (E8F)' };
  const problems = [];
  const ao = new Set(writes.filter((e) => inStep('E7A', e.ts)).map(objKey));
  const e6 = new Set(writes.filter((e) => inStep('E6', e.ts)).map(objKey));
  const seen = new Set(writes.map((e) => e.requestId));
  const e8f = new Set(forcedW.filter((e) => !seen.has(e.requestId) && inStep('E8F', e.ts)).map(objKey));
  const withE6 = [...ao].filter((k) => e6.has(k) && !revertAllowed(k));
  const withE8f = [...ao].filter((k) => e8f.has(k) && !revertAllowed(k));
  if (withE6.length) problems.push(`AO and Stamper E6 both wrote ${withE6.join(', ')}`);
  if (withE8f.length) problems.push(`E8F wrote AO-touched ${withE8f.join(', ')}`);
  const ov = readJson(ovFile);
  const reverted = (ov.checks ?? []).filter((c) => c.before === 'pass' && c.after !== 'pass' && !(e7a.allowed_reverts ?? []).some((r) => r.objectType === c.object_type));
  if (reverted.length) problems.push(`E8F reverted: ${reverted.map((c) => c.check).join('; ')}`);
  const notBefore = (ov.checks ?? []).filter((c) => c.before !== 'pass');
  if (notBefore.length) problems.push(`AO state already gone before E8F: ${notBefore.map((c) => c.check).join('; ')}`);
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `${ao.size} AO-touched objects (${[...ao].join(', ') || 'none'}): no E6 or E8F Stamper write on them; ${(ov.checks ?? []).length} confirming reads pass before and after E8F; allowed_reverts ${(e7a.allowed_reverts ?? []).length}`,
  };
});

// ---------- Synthetic-customer W3: V55 (postchecks assert state) ----------
// V55 (PLAN §3, as specified for the W3 Stamper slice): over this run's Stamper records,
//  (a) every executed SET-path entry's record (registry snapshot has a SET and is not evidence-only; not a read-only
//      prohibition / renderable use) carries metadata.postcheckMode; 'state' ones are counted (passed / failed);
//  (b) SET-path records that are SAT on presence only are listed, and their count <= presence_max;
//  (c) no-action tasks (manual-gate records whose gateAction is not 'approved', renderables without a policyRef)
//      <= gates_max;
//  (d) no SAT without an action: no manual-gate record SAT unless approved, no renderable SAT without a policyRef,
//      no results-manifest 'sat' for a control whose only gate had no action.
// Thresholds: ces-tester scenarios/muster/<slug>-e2e.json postcheck_thresholds { presence_max, gates_max }; defaults
// presence_max = 2 (the SET-path entries the registry leaves presence: AC.L2-3.1.1.group-create,
// AU.L2-3.3.6.audit-reduction), gates_max = 24 (PLAN §5 W3). A failed state assertion does not fail V55 (it is an
// honest NOT_SAT that V6 / V17 report); its count is in the detail.
check('V55', 'Postchecks assert state: every executed SET-path record carries postcheckMode; presence-only SATs <= threshold; no-action gates <= threshold; no SAT without an action', () => {
  const scenarioFile = path.join(ces, 'ces-tester', 'scenarios', 'muster', `${slug}-e2e.json`);
  const thr = (exists(scenarioFile) ? readJson(scenarioFile).postcheck_thresholds : null) ?? {};
  const presenceMax = Number.isInteger(thr.presence_max) ? thr.presence_max : 2;
  const gatesMax = Number.isInteger(thr.gates_max) ? thr.gates_max : 24;
  const tenantPl = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
  const rawExec = latestRun ? path.join(runsDir, latestRun.evidence, 'raw', '06-execution') : null;
  const evRoot = rawExec && exists(path.join(rawExec, 'evidence')) ? path.join(rawExec, 'evidence') : path.join(tenantPl, 'evidence');
  const byTaskRoot = rawExec && exists(path.join(rawExec, 'evidence-by-task')) ? path.join(rawExec, 'evidence-by-task') : path.join(tenantPl, 'evidence-by-task');
  const load = (p) => { try { return readJson(p); } catch { return null; } };
  const records = listFiles(evRoot).filter((p) => p.endsWith('.json')).map((p) => ({ p, r: load(p) })).filter((x) => x.r?.registryEntry);
  const setPath = records.filter(({ r }) => String(r.registryEntry.set_command ?? '').trim() !== '' && r.registryEntry.idempotency !== 'evidence-only'
    && !String(r.metadata?.commandExecuted ?? '').startsWith('[manual/evidence-only]'));
  const problems = [];
  if (!setPath.length) problems.push(`no executed SET-path record under ${path.relative(root, evRoot)}`);
  const unlabelled = setPath.filter(({ r }) => !['state', 'presence'].includes(r.metadata?.postcheckMode));
  if (unlabelled.length) problems.push(`${unlabelled.length} SET-path records without metadata.postcheckMode (e.g. ${unlabelled.slice(0, 3).map(({ r }) => r.registryEntry.entry_id).join(', ')})`);
  const state = setPath.filter(({ r }) => r.metadata?.postcheckMode === 'state');
  const stateFailed = state.filter(({ r }) => r.complianceVerdict !== 'SAT');
  const presence = setPath.filter(({ r }) => r.metadata?.postcheckMode === 'presence');
  const presenceSat = presence.filter(({ r }) => r.complianceVerdict === 'SAT');
  if (presenceSat.length > presenceMax) problems.push(`${presenceSat.length} presence-only SATs > presence_max ${presenceMax}`);
  const taskFiles = listFiles(byTaskRoot);
  const gates = taskFiles.filter((p) => path.basename(p) === 'manual-gate.json').map((p) => ({ p, r: load(p) })).filter((x) => x.r);
  const renders = taskFiles.filter((p) => path.basename(p) === 'policy-reference.json').map((p) => ({ p, r: load(p) })).filter((x) => x.r);
  const noActionGates = gates.filter(({ r }) => r.metadata?.gateAction !== 'approved');
  const unreferenced = renders.filter(({ r }) => !r.metadata?.policyRef);
  if (noActionGates.length + unreferenced.length > gatesMax) problems.push(`no-action tasks ${noActionGates.length} gates + ${unreferenced.length} unreferenced renderables > gates_max ${gatesMax}`);
  const satNoAction = [
    ...gates.filter(({ r }) => r.complianceVerdict === 'SAT' && r.metadata?.gateAction !== 'approved').map(({ p }) => `gate ${path.basename(path.dirname(p))}`),
    ...renders.filter(({ r }) => r.complianceVerdict === 'SAT' && !r.metadata?.policyRef).map(({ p }) => `renderable ${path.basename(path.dirname(p))}`),
  ];
  const manifestPath = latest(path.join(tenantPl, 'state'), 'execution-results-');
  const manifest = manifestPath && !manifestPath.endsWith('.delivery.json') ? load(manifestPath) : null;
  if (manifest) {
    const verdictOf = Object.fromEntries((manifest.results ?? []).map((x) => [x.controlId, x.verdict]));
    for (const { r } of noActionGates) for (const cid of r.metadata?.controlIds ?? []) if (verdictOf[cid] === 'sat') satNoAction.push(`results manifest ${cid} sat with a no-action gate`);
  }
  if (satNoAction.length) problems.push(`SAT without an action: ${satNoAction.join('; ')}`);
  const pcFile = latest(path.join(tenantPl, 'state'), 'postcheck-results-');
  const pc = pcFile ? load(pcFile) : null;
  const pcInfo = pc?.counts ? `; postchecks (info) ${JSON.stringify(pc.counts.byOutcome)}` : '; postcheck-results file: none';
  return {
    pass: problems.length === 0,
    detail: `${problems.length ? `${problems.join('; ')}; ` : ''}SET-path records ${setPath.length}: state ${state.length} (passed ${state.length - stateFailed.length}, failed ${stateFailed.length}${stateFailed.length ? `: ${stateFailed.map(({ r }) => r.registryEntry.entry_id).join(', ')}` : ''}), presence ${presence.length} (SAT ${presenceSat.length}: ${presenceSat.map(({ r }) => `${r.registryEntry.entry_id} [${r.metadata?.presenceReason ?? 'no reason'}]`).join('; ') || 'none'}; presence_max ${presenceMax}); manual gates ${gates.length} (no action ${noActionGates.length}), renderables ${renders.length} (policy-referenced ${renders.length - unreferenced.length}); no-action ${noActionGates.length + unreferenced.length} / gates_max ${gatesMax}${exists(scenarioFile) && thr.presence_max !== undefined ? '' : ' (default thresholds)'}${pcInfo}`,
  };
});

// Synthetic-customer W4: scorecard, GAPS and checks V50-V53, V56, V57, plus W6 V59 (scripts/verify-w4.mjs).
// W7-PKG: --exclude-honest-nulls <file> applies FQ-1's disposition to SC-8a (scorecard.mjs); W4 returns its
// scorecard and GAPS for V64, V67 and V69-V71.
// PH-11 Q4 (founder 2026-11-01): applied by default with scripts\honest-nulls-fq1.json; "--exclude-honest-nulls off" turns it off.
const w4mod = await import('./verify-w4.mjs');
const { resolveHonestNullsArg } = await import('./scorecard.mjs');
const w4 = await w4mod.registerW4Checks(check, { root, slug, out, honestNullsFile: resolveHonestNullsArg(a['exclude-honest-nulls']) });

// ---------- W7: V60-V71 (PLAN.md §5; the judges are in scripts/verify-w4.mjs) ----------
// Inputs: the bundle's raw 01-plans/pushed and /persisted (bundle.mjs), Stamper's plans folder, the MP, plan-trace.json,
// the executable plan's variables, the E7A record, EO's E7B store reads and drift, the SSP, the EO package snapshot, the
// EO log and W4's scorecard / GAPS. A check whose artefact a scenario does not have takes the skip path its detail names.
const rawBundle = latestRun ? path.join(runsDir, latestRun.evidence, 'raw') : null;
const bundlePushed = rawBundle ? path.join(rawBundle, '01-plans', 'pushed') : null;
const bundlePersisted = rawBundle ? path.join(rawBundle, '01-plans', 'persisted') : null;
const itemsOf = (pl) => (Array.isArray(pl) ? pl : Array.isArray(pl?.value) ? pl.value : pl ? [pl] : []);
// The last successful (or empty) EO store read of a source collected inside E7B (E8F's forced reads come later).
const e7bRead = (sourceId) => {
  const r = storeRecords.filter((x) => x.sourceId === sourceId && (x.status === 'success' || x.status === 'empty') && inStep('E7B', x.collectedAt)).pop();
  return r ? itemsOf(payloadOf(r)) : null;
};
const sspCtlOf = (cid) => (ssp?.controlImplementations ?? []).find((c) => c.control_id === cid) ?? null;
const snapCtlOf = (cid) => (storedSnapshot?.controls ?? []).find((c) => c.control_id === cid) ?? null;
const e7bSid = ev(passByName('E7B'), 'assess_summary')?.snapshotId;
const e7bDrift = e7bSid && exists(path.join(out, 'eo', 'assessments', e7bSid, 'drift.json')) ? readJson(path.join(out, 'eo', 'assessments', e7bSid, 'drift.json')) : null;
const gapsRows = w4?.gaps?.rows ?? [];

// V60: the pushed CUI Boundary and its MP hash reference; Stamper recorded it verified.
check('V60', 'CUI Boundary: exactly one cui-boundary-<slug>-*.json pushed; its hash = canonicalSha256(artifact) = MP inputs.cui_boundary_ref (ids equal); Stamper recorded it verified; or skipped with a reason in plan-trace.json', () => {
  const pushed = exists(bundlePushed) ? fs.readdirSync(bundlePushed) : [];
  if (!bundlePushed) return { pass: false, detail: 'no evidence bundle (out/runs/latest.json)' };
  const f = latest(bundlePushed, `cui-boundary-${slug}-`);
  return w4mod.judgeV60({ slug, boundary: trace?.boundary ?? null, pushed, envelope: f ? readJson(f) : null, mpRef: mp?.inputs?.cui_boundary_ref ?? null, recompute: canon ? canon.canonicalSha256 : null, stamperRef: exePlan?.variables?._cui_boundary_ref ?? null });
});

// V61: the persisted BTC Confirmation and the plan's BTC warnings.
check('V61', 'BTC Confirmation: 01-plans/persisted/btc-confirmation-<slug>-*.json parses as the vendored type; failed gates = the plan\'s BTC warnings', () => {
  const f = bundlePersisted ? latest(bundlePersisted, `btc-confirmation-${slug}-`) : null;
  return w4mod.judgeV61({ btc: f ? readJson(f) : null, btcFile: f ? path.basename(f) : null, mpRef: mp?.inputs?.btc_confirmation_ref ?? null, warnings: trace?.validation?.warnings ?? [] });
});

// V62: the six hand-off envelopes in Stamper's plans folder are MP-referenced (orchestrator ruling 10-29).
check('V62', 'Hand-off envelopes: the six envelopes (SI Baseline, TCP, Readiness Posture in EO intake; policy-inputs profile, policy-set manifest, CUI Boundary in the Stamper plans folder) are MP-referenced with the same id and hash; none unreferenced; no EO-only envelope in the plans folder', () => {
  if (!fs.existsSync(plansDir)) return { pass: false, detail: `no plans folder ${path.relative(root, plansDir)}` };
  // FIN-35 S-1 (GD-e): the three Stamper-stored kinds from the plans folder, the three EO-only kinds from EO's newest intake receipt.
  return w4mod.judgeV62({ plansFiles: fs.readdirSync(plansDir), readEnv: (f) => readJson(path.join(plansDir, f)), mpInputs: mp?.inputs ?? {}, recompute: canon ? canon.canonicalSha256 : null, boundary: trace?.boundary ?? null, intake: w4mod.readEoIntake(path.join(out, 'eo'), slug), readIntake: (f) => readJson(f) });
});

// V63: no E7A op "not run"; every resources.* key has a provenance.
check('V63', 'E7A: no AdminOps op ends "not run"; every resources.* key and op parameter has a provenance', () => {
  if (!e7a) return harness === 'tester' ? notRun('adminops-e7a.json') : { pass: true, detail: `not run (-Harness ${harness}: no E7A)` };
  return w4mod.judgeV63({ e7a });
});

// V64 (S3): the break-glass CA exclusion after E7A, A-19 x2 at T3, S3-D04 fixed.
check('V64', 'S3 after E7A: every customer CA policy excludes resources.breakglass_user_id; both A-19 runs T3 (approver != requestor; with two-person approval OFF, dry run + apply, no approver), confirms passed; V59 counts S3-D04 fixed', () => {
  const cust = exists(path.join(scriptsDir, '..', 'customers', slug, 'customer.json')) ? readJson(path.join(scriptsDir, '..', 'customers', slug, 'customer.json')) : null;
  const orgc = exists(path.join(scriptsDir, '..', 'customers', slug, 'org-content.json')) ? readJson(path.join(scriptsDir, '..', 'customers', slug, 'org-content.json')) : null;
  const bgId = (function find(o) { if (!o || typeof o !== 'object') return null; if (typeof o.breakGlassUserId === 'string') return o.breakGlassUserId; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } return null; })(orgc);
  return w4mod.judgeV64({ slug, e7a, caPolicies: e7bRead('conditionalAccess'), customerPolicies: cust?.conditional_access ?? [], breakGlassUserId: bgId, d04: (w4?.gaps?.deficiencies?.rows ?? []).find((x) => x.id === 'S3-D04') ?? null, modeOf: aoOpMode });
});

// V65 (S1, S2), FIN-01 (a): the PS.L2-3.9.2 honest drop. A-21 runs and confirms, the bound leaver workflow is scheduled at
// E7B, and the personnel records store still decides PS.L2-3.9.2 (not_met, no move from E7 pass 3).
check('V65', 'S1, S2: A-21 ran, wrote and confirmed; the bound leaver workflow is enabled, scheduled, with a disable task at E7B; PS.L2-3.9.2 stays not_met, decided by the personnel records store (honest drop)', () => w4mod.judgeV65Drop({
  slug, driftCtl: (e7bDrift?.controls ?? []).find((c) => c.controlId === 'PS.L2-3.9.2') ?? null, sspCtl: sspCtlOf('PS.L2-3.9.2'), snapCtl: snapCtlOf('PS.L2-3.9.2'), workflows: e7bRead('lifecycleWorkflows'), e7a,
}));

// V66 (ruling 1): no credit from built-in Exchange protection.
check('V66', 'No positive source for SC.L2-3.13.15 / SI.L1-3.14.2 names a built-in Exchange policy; discovery never answers "yes" from built-ins alone', () => w4mod.judgeV66({
  snapshotControls: storedSnapshot?.controls ?? [], sspControls: ssp?.controlImplementations ?? [], facts: readiness?.facts ?? [], observations: discovery?.observations ?? [],
  captureText: (ref) => { const p = path.join(out, ref); return exists(p) && !staleOf(p) ? fs.readFileSync(p, 'utf8') : null; },
}));

// V67 (ruling 2): a weaker sign-in frequency earns no credit and is a reconciliation row.
check('V67', 'Sign-in frequency weaker than 8 h: CMMC-SessionTimeout written at <= 8 h, no credit on the weaker policy, a GAPS reconciliation row naming both values', () => {
  const prof = latest(planDir, 'policy-inputs-profile-');
  return w4mod.judgeV67({ caPolicies: e7bRead('conditionalAccess'), profileOdps: prof ? readJson(prof).artifact?.odps ?? null : null, sspCtl: sspCtlOf('AC.L2-3.1.11'), gapsRows });
});

// V68: terminal events, and a retried fetch after every EO respawn.
check('V68', 'The E7 passes and eo-assess-7b.json end with a terminal event; every EO-log respawn is followed by a retried fetch', () => {
  const logs = ['E7-eo.out', 'E7-eo.err'].map((f) => path.join(out, 'logs', f)).filter((p) => exists(p) && !staleOf(p)).map((p) => ({ file: `out/logs/${path.basename(p)}`, text: fs.readFileSync(p, 'utf8') }));
  return w4mod.judgeV68({ passes: ['E7 pass 1', 'E7 pass 2', 'E7 pass 3', 'E7B'].map((n) => { const p = passByName(n); return { name: n, events: p.events, stale: p.stale }; }), logs });
});

// V69 (S1, S2): SC-8a within threshold, or FQ-1 applied with reasons (PH-11 Q4: applied by default).
check('V69', 'S1, S2: SC-8a within threshold, or the FQ-1 disposition applied (default; --exclude-honest-nulls off disables it), each excluded control listed with its reason', () => {
  if (!w4?.sc) return { pass: false, detail: `scorecard not available: ${w4?.error ?? 'not computed'}` };
  return w4mod.judgeV69({ slug, sc8a: w4.sc.rows.find((r) => r.id === 'SC-8a') ?? null, gapsRows });
});

// V70: IA.L1-3.5.1 not met only on a corroborated shared login; name-only hits are GAPS review rows.
check('V70', 'Every IA.L1-3.5.1 not met cites a corroborating signal; name-only shared-login hits are GAPS review rows only', () => {
  if (!w4?.gaps) return { pass: false, detail: `GAPS not available: ${w4?.error ?? 'not computed'}` };
  return w4mod.judgeV70({ sspCtl: sspCtlOf('IA.L1-3.5.1'), snapCtl: snapCtlOf('IA.L1-3.5.1'), gapsRows });
});

// V71: AC.L1-3.1.1 after E6: Muster's basis (Stamper's E6 record of its predicate's lookup) and EO at E7 agree, or GAPS says why.
check('V71', 'After E6, Muster and EO agree on AC.L1-3.1.1, or GAPS holds a reconciliation row naming both bases', () => {
  if (!w4?.gaps) return { pass: false, detail: `GAPS not available: ${w4?.error ?? 'not computed'}` };
  const recs = rawBundle ? listFiles(path.join(rawBundle, '06-execution', 'evidence')).filter((p) => p.endsWith('.json')).map((p) => { try { return readJson(p); } catch { return null; } }) : [];
  const drifted = (e7bDrift?.controls ?? []).find((c) => c.controlId === 'AC.L1-3.1.1');
  return w4mod.judgeV71({
    stamperRec: recs.find((r) => r?.registryEntry?.entry_id === 'AC.L1-3.1.1.ca-mfa-compliant-device') ?? null,
    discoveryAnswer: (readiness?.facts ?? []).find((f) => f.question_id === 'RR-ACT-AC_L1_3_1_1')?.answer ?? null,
    eoStatus: drifted ? drifted.previous?.status : sspCtlOf('AC.L1-3.1.1')?.status ?? null, gapsRows,
  });
});

// ---------- W8: V72 (PLAN.md W8 §7; the judge is in scripts/verify-w4.mjs) ----------
// S1 only. Stamper's built translateForTenant() runs in process (no server, no simulator) in modes cli and gui on the pushed
// MP and TM (pMP, pTM) with the scenario slug as tenant, as E6's `stamper translate` does; cli mode leaves the IM unset (found
// beside the TM, as E6 finds it), gui mode names the latest pushed IM (pIM). The tenant registry is mx-e2e's (<WS>\tenants,
// <WS>\pl) when the environment names none; the tenant is passed only while its record exists (the tester harness tears the
// ephemeral sim record down before E9; the record feeds plan variables only, which (b) excludes). Outputs go to a temp folder,
// removed after; E6's plan is out/executable-plan.json (exePlan).
const v72 = slug === 's1-mach' ? await (async () => {
  if (!pMP || !pTM) throw new Error('no pushed MP / TM');
  process.env.CES_TENANT_ROOT ??= path.join(root, 'tenants');
  process.env.CES_PIPELINE_ROOT ??= path.join(root, 'pl');
  const stx = await import(pathToFileURL(path.join(ces, 'ces-stamper', 'dist', 'translators', 'translateForTenant.js')).href);
  const cfg = await import(pathToFileURL(path.join(ces, 'ces-stamper', 'dist', 'config', 'ClientConfig.js')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-v72-'));
  // PH-6 R-UI (V72): the harness tears the live record down before verify; E6 translated WITH it, and the record gates
  // entries, not only variables (AZ-ID-003 needs the tenant's appId). The run's snapshot stands in, in a private root.
  const tenantRoot0 = process.env.CES_TENANT_ROOT;
  const snapshot = path.join(out, 'sim-registry-record.json');
  let tenantSource = 'live';
  // Decided on the file system BEFORE the first registry call: Stamper's module registry keeps its first view of the root.
  if (!fs.existsSync(path.join(process.env.CES_TENANT_ROOT, 'sim', `${slug}.json`)) && fs.existsSync(snapshot)) {
    fs.mkdirSync(path.join(tmp, 'tenants', 'sim'), { recursive: true });
    fs.copyFileSync(snapshot, path.join(tmp, 'tenants', 'sim', `${slug}.json`));
    process.env.CES_TENANT_ROOT = path.join(tmp, 'tenants');
    tenantSource = 'snapshot out/sim-registry-record.json';
  }
  const tenant = fs.existsSync(await cfg.resolveTenantJsonPath(slug)) ? slug : null;
  try {
    const project = async (mode, extra) => {
      const outputPath = path.join(tmp, `${mode}.json`);
      await stx.translateForTenant({ mode, missionPlanPath: pMP, manifestPath: pTM, outputPath, ...(tenant ? { tenant } : {}), ...extra });
      return stx.projectExecutablePlan(readJson(outputPath));
    };
    return { cli: await project('cli', {}), gui: await project('gui', pIM ? { infraManifestPath: pIM } : {}), e6: exePlan ? stx.projectExecutablePlan(exePlan) : null, tenant: tenant ? `${tenant} (${tenantSource})` : null };
  } finally {
    process.env.CES_TENANT_ROOT = tenantRoot0;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => ({ error: e instanceof Error ? e.message : String(e) })) : null;
check('V72', 'S1: translateForTenant cli and gui projections are equal; the cli projection equals E6\'s executable plan (variables excluded)', () => w4mod.judgeV72({ slug, ...(v72 ?? {}) }));

// ---------- W8-UIT1: V73 (PLAN.md §8b, docs/context/w8/UI-TRACK.md §5; the judge is in scripts/verify-w4.mjs) ----------
// Step EU (mx-e2e.ps1, after E8F) runs ces-tester's ui-e2e Stamper use case and writes out/ui-e2e-stamper.json, with each
// variant's files under out/ui/<variant>/ (executable-plan.json, execution-report.json, ledger.json) and its execute window.
// verify reloads them and the twin's (exePlan, out/execution-report.json, out/ledger.json, steps.E6) and recomputes (a)-(c);
// the projection is Stamper's built projectExecutablePlan() (as V72). FIN-35: every scenario gates (V73 x4).
const v73 = await (async () => {
  const recFile = path.join(out, 'ui-e2e-stamper.json');
  const record = exists(recFile) ? readJson(recFile) : null;
  const uiFile = (rel) => (rel ? path.join(out, ...String(rel).split('/')) : null);
  const loadOrNull = (f) => (exists(f) ? readJson(f) : null);
  const stx = record ? await import(pathToFileURL(path.join(ces, 'ces-stamper', 'dist', 'translators', 'translateForTenant.js')).href) : null;
  const project = (plan) => (plan && stx ? stx.projectExecutablePlan(plan) : null);
  const twinLedger = loadOrNull(path.join(out, 'ledger.json'));
  const variants = (record?.variants ?? []).map((v) => ({
    id: v.variant, ran: !!v.ran, reason: v.reason ?? null, error: v.error ?? null, testerPass: !!v.pass,
    projection: v.ran && stx ? project(loadOrNull(uiFile(v.files?.executable_plan))) : null,
    report: v.ran ? loadOrNull(uiFile(v.files?.execution_report)) : null,
    ledger: v.ran ? loadOrNull(uiFile(v.files?.ledger))?.data ?? null : null,
    window: v.execute_window ?? null,
    // W8-UIT3: (c) compares the mutated objects' end state from each side's sim store snapshot.
    store: v.ran ? loadOrNull(uiFile(v.files?.sim_store)) : null,
  }));
  return {
    record, stale: staleOf(recFile), variants,
    twin: { projection: project(exePlan), report: loadOrNull(path.join(out, 'execution-report.json')), ledger: twinLedger?.data ?? null, window: steps.E6?.started && steps.E6?.ended ? { started: steps.E6.started, ended: steps.E6.ended } : null, store: loadOrNull(uiFile(record?.twin?.sim_store)) },
  };
})().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
check('V73', 'All four scenarios (FIN-33 / FIN-35): the Stamper UI run (legacy console; SPA once /app/ is built) equals its headless twin on (a) the executable plan projection without variables, (b) the failed set, (c) the mutated objects\' end state, keyed by natural identity', () => w4mod.judgeV73({ slug, ...v73 }));

// ---------- Gap closure VER-1: V74, V75 (GAP-CLOSURE-PLAN.md §5; the judges are in scripts/verify-gap.mjs) ----------
// V74: the built guard (ces-shared dist/security/psGuard.js) renders every AO template (ces-ao dist RegistryBridge over
// ces-ao/src/registry/ao-commands.registry.json, read now, never copied) and every command of out/executable-plan.json with
// the breakout payloads; the bare-token kinds are Stamper's PS_TOKEN_KINDS (dist/utils/templateResolver.js) when built.
const gapmod = await import('./verify-gap.mjs');
const v74 = await (async () => {
  const guard = await import(pathToFileURL(path.join(ces, 'ces-shared', 'dist', 'security', 'psGuard.js')).href);
  const bridge = await import(pathToFileURL(path.join(ces, 'ces-ao', 'dist', 'registry', 'RegistryBridge.js')).href);
  const registry = readJson(path.join(ces, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json'));
  let kinds = {};
  try { kinds = (await import(pathToFileURL(path.join(ces, 'ces-stamper', 'dist', 'utils', 'templateResolver.js')).href)).PS_TOKEN_KINDS ?? {}; } catch { kinds = {}; }
  return { guard, kinds, aoCommands: registry.length, aoSources: gapmod.aoTemplates(bridge.translateAoCommandToCommandEntry, registry), planSources: exePlan ? gapmod.planCommands(exePlan) : null };
})().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
check('V74', 'Every AO template and every executable-plan command, rendered with 40+ breakout payloads by the built guard: single-quoted spots keep the payload inside one single-quoted literal, double-quoted and bare spots reject it; zero passes', () => (v74.error ? { pass: false, detail: `error: ${v74.error}` } : gapmod.judgeV74(v74)));

// V75: out/auth-probe.json (SEC-4, mx-e2e.ps1 Invoke-AuthProbe), staleness as V73; E7A from steps.json and its record (e7a).
const authProbeFile = path.join(out, 'auth-probe.json');
check('V75', 'AO and EO ran with tokens: tokenless /api calls got 401, E7A with the tokens succeeded, AO /api/health shows auth "ENFORCED" (bind reported, not judged)', () => gapmod.judgeV75({ probe: exists(authProbeFile) ? readJson(authProbeFile) : null, probeFile: 'out/auth-probe.json', stale: staleOf(authProbeFile), steps, e7a }));

// ---------- Gap closure FLOW-6 / NS-3: V86, V81 (GAP-CLOSURE-PLAN.md §5; the judges are in scripts/verify-gap.mjs) ----------
// V86: RETIRED (founder ruling 2026-10-30, depth plan ROLE-1: Muster receives no execution results). Never judged, reads no
// evidence; the entry stays so verify.json keeps the id (the number is not reused). V100 below checks the loop is gone.
{ const r = gapmod.judgeV86(); checks.push({ id: 'V86', title: 'Muster results loop (retired)', pass: r.pass, retired: r.retired, detail: r.detail }); }
// V100 (depth plan ROLE-1, harness scope): out/steps.json E6.muster_api_url, out/muster-results.json (must be absent),
// directive-status-*.json under pl/Stamper/plan-data/<slug>/state and out/st/state (must be absent), the newest
// pl/Stamper/plan-data/<slug>/state/execution-results-*.json (must exist; EO reads it), out/execution-report.json delivery.
check('V100', 'Muster holds no execution results: E6 ran without CES_MUSTER_API_URL, no muster-results.json, no directive-status file; the EO-read results manifest still exists', () => {
  const v100State = path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'state');
  const v100Dirs = [v100State, path.join(out, 'st', 'state')];
  const directiveStatusFiles = [];
  for (const d of v100Dirs) {
    if (!fs.existsSync(d)) continue;
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.startsWith('directive-status-')) directiveStatusFiles.push(path.relative(root, p).split(path.sep).join('/')); } };
    walk(d);
  }
  const manifestName = fs.existsSync(v100State) ? fs.readdirSync(v100State).filter((x) => x.startsWith('execution-results-') && x.endsWith('.json') && !x.endsWith('.delivery.json')).sort().pop() : null;
  const resultsManifest = manifestName ? `pl/Stamper/plan-data/${slug}/state/${manifestName}` : null;
  return gapmod.judgeV100({ e6: steps.E6 ?? null, musterResultsPresent: exists(path.join(out, 'muster-results.json')), directiveStatusFiles, resultsManifest, report });
});
// V81: out/eo-records.json (NS-3 posts at E7, ces-tester, on by default since D-7) against the customer files
// (build-customer-records.mjs); out/eo-interviews.json (NS-4t interview posts at E7); out/ssp.json PS / AT narratives (ssp).
const eoRecordsFile = path.join(out, 'eo-records.json');
const eoInterviewsFile = path.join(out, 'eo-interviews.json');
const v81Expected = await import('./build-customer-records.mjs').then((m) => m.eoRecordExpectations(m.loadEoRecordPosts(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), slug)));
// PKG-2 (NS-3b, D-2): the PS readiness EO takes from the organisation's screening and lifecycle records, which E8.5 uploads
// with every records/catalog.json item (customers/<slug>/records; kinds personnel_screening / personnel_lifecycle).
const v81OrgReadiness = (() => {
  const dir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'customers', slug, 'records');
  if (!exists(path.join(dir, 'catalog.json'))) return null;
  const rows = { screening: [], lifecycle: [] };
  for (const i of readJson(path.join(dir, 'catalog.json')).items ?? []) {
    const key = i.record_kind === 'personnel_screening' ? 'screening' : i.record_kind === 'personnel_lifecycle' ? 'lifecycle' : null;
    if (key) rows[key].push(...(readJson(path.join(dir, i.file)).rows ?? []));
  }
  return gapmod.v81OrgReadiness(rows);
})();
check('V81', 'EO\'s personnel, training, risk and offboarding stores match the customer files, the SSP\'s PS / AT narratives cite them, and EO holds the interview records (policies reported, not judged)', () => gapmod.judgeV81({ slug, expected: v81Expected, record: exists(eoRecordsFile) ? readJson(eoRecordsFile) : null, stale: staleOf(eoRecordsFile), harness, interviews: exists(eoInterviewsFile) ? readJson(eoInterviewsFile) : null, interviewsStale: staleOf(eoInterviewsFile), ssp, orgReadiness: v81OrgReadiness }));
// ---------- Gap closure FLOW-4: V85 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V85: EO's evidence store (out/eo/evidence-store/<tenantId>/, records of collector C11 collect.stamperEvidence) against the
// Stamper evidence files EO assesses from (read as StamperEvidenceLoader keeps them: *.json with metadata.controlIds) and
// the tenant's ces.db stamper_evidence_metadata rows (pl/ces.db, read only through the workspace's better-sqlite3).
const v85 = (() => {
  const records = storeRecords.filter((r) => r.sourceId === gapmod.V85_SOURCE).map((r) => ({ endpoint: r.endpoint, status: r.status, payload: payloadOf(r) }));
  const evDir = path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'evidence');
  const files = [];
  for (const f of listFiles(evDir).filter((p) => p.endsWith('.json'))) {
    const bytes = fs.readFileSync(f);
    let doc = null;
    try { doc = JSON.parse(bytes.toString('utf8')); } catch { continue; }
    const ids = doc?.metadata?.controlIds;
    if (!Array.isArray(ids) || ids.length === 0) continue;
    files.push({ relPath: path.relative(evDir, f).replace(/\\/g, '/'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  let rows = null, rowsError = null, otherTenantRows = 0, earlierRoundRows = 0;
  const dbFile = path.join(root, 'pl', 'ces.db');
  if (!exists(dbFile)) rows = [];
  else if (!runTenantId) rowsError = 'no store tenant id';
  else {
    try {
      const Database = createRequire(path.join(ces, 'ces-shared', 'package.json'))('better-sqlite3');
      const db = new Database(dbFile, { readonly: true, fileMustExist: true });
      try {
        const all = db.prepare("SELECT id, tenant_id, data, created_at FROM ces_records WHERE collection = 'stamper_evidence_metadata'").all();
        // PH-11 (LOG-PH11-EO.md §6): EO's C11 chains only the newest Stamper run's rows; earlier rounds' rows (ces.db is
        // long-lived and WORM) are history, so only rows written since this run's E1 (runStartMs, steps.E1.started) are judged.
        ({ rows, otherTenantRows, earlierRoundRows } = gapmod.v85RowsOfRun(all, runTenantId, runStartMs));
      } finally { db.close(); }
    } catch (e) { rowsError = e instanceof Error ? e.message : String(e); }
  }
  return { storePresent: !!storeDir, records, files, rows, rowsError, otherTenantRows, earlierRoundRows, statusBy: summary.status_by_control, baselineBy: baseline?.status_by_control ?? null };
})();
// FIN-19: plus the FLOW-4 tenant-id clause (FLOW-4 open item 2): rows under Stamper's own tenant id only are a red.
check('V85', 'Every Stamper evidence file EO assesses from and every stamper_evidence_metadata row is in EO\'s hash chain with the same hash; statuses unchanged from the baseline; the rows sit under EO\'s tenant id', () => {
  const main = gapmod.judgeV85(v85);
  const tid = gapmod.judgeV85Tenant(v85);
  return { pass: main.pass && tid.pass, detail: `${main.detail}; ${tid.detail}; ${v85.earlierRoundRows} earlier-round row(s) under EO's id (history, not judged)` };
});
// ---------- Gap closure FLOW-1: V82 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V82: muster-api's WORM rows in <root>\pl\ces.db, read and overwrite-probed on a temp COPY (ces-shared dist CesRepository);
// compared with out/push-response.json (E4), the pushed files in Stamper's plans folder and out/discovery-result.json (E2).
const v82 = await (async () => {
  const repoMod = await import(pathToFileURL(path.join(ces, 'ces-shared', 'dist', 'persistence', 'CesRepository.js')).href);
  const collected = await gapmod.collectV82({ dbFile: path.join(root, 'pl', 'ces.db'), slug, repoMod, tmpRoot: os.tmpdir() });
  const pushResponseFile = path.join(out, 'push-response.json');
  const pushResponse = exists(pushResponseFile) && !staleOf(pushResponseFile) ? readJson(pushResponseFile) : null;
  const fileSha = Object.fromEntries((pushResponse?.pushed ?? []).map((n) => [n, exists(path.join(plansDir, n)) ? sha(path.join(plansDir, n)) : null]));
  const discFile = path.join(out, 'discovery-result.json');
  return { slug, collected, pushResponse, fileSha, discoverySha: exists(discFile) && !staleOf(discFile) ? sha(discFile) : null, runStartMs, e4Mode: steps.E4?.mode ?? null };
})().catch((e) => ({ slug, collected: { error: `error: ${e instanceof Error ? e.message : String(e)}` } }));
check('V82', 'Muster WORM rows (muster_plan_push, muster_discovery) exist for this run, their hashes equal the pushed files and discovery-result.json, and an overwrite probe on a copy of ces.db is refused', () => gapmod.judgeV82(v82));
// ---------- Gap closure KB-2: V90 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V90: the built KB-1 assessor KBs and the 800-171A reference (ces-shared dist/data, read now) and out/ssp.json's
// assessmentApproach per control (EO GC-KB-2). The index part (GC-PKG-3): the newest EO package's evidence-index.json
// (out/eo-package/<pkgLatest>/, null when absent) has an objective row for every met SSP control.
{
  const kbData = (f) => { const p = path.join(ces, 'ces-shared', 'dist', 'data', f); return exists(p) ? readJson(p) : null; };
  const v90Index = pkgLatest && exists(path.join(pkgRoot, pkgLatest, 'evidence-index.json')) ? readJson(path.join(pkgRoot, pkgLatest, 'evidence-index.json')) : null;
  check('V90', 'Both assessor KBs cover the 110 practices and all 320 objectives resolve; the SSP has an assessment approach for every practice; the EO evidence index has a row per met control', () => gapmod.judgeV90({
    approach: kbData('assessor-approach.reference.json'),
    matrix: kbData('assessor-evidence-matrix.reference.json'),
    objectivesRef: kbData('assessment-objectives.reference.json'),
    ssp,
    index: v90Index,
  }));
}
// ---------- Gap closure NS-1b: V80 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V80: the stored snapshot (storedSnapshot, V39) against the tenant's eo_document_reviews and eo_approver_token_mints rows
// (pl/ces.db, read only through the workspace's better-sqlite3, rows of this run's slug), the run's EC items
// (pl/EvidenceCollector/storage/<slug>/items/*.json, uploadedBy) and the 800-171A objectives reference (ces-shared dist/data).
{
  let reviews = null, reviewsError = null, mints = [], otherTenantReviews = 0;
  const dbFile = path.join(root, 'pl', 'ces.db');
  if (!exists(dbFile)) reviews = [];
  else {
    try {
      const Database = createRequire(path.join(ces, 'ces-shared', 'package.json'))('better-sqlite3');
      const db = new Database(dbFile, { readonly: true, fileMustExist: true });
      try {
        const rowsOf = (col) => db.prepare('SELECT tenant_slug, data FROM ces_records WHERE collection = ?').all(col);
        const all = rowsOf('eo_document_reviews');
        reviews = all.filter((r) => r.tenant_slug === slug).map((r) => JSON.parse(r.data));
        otherTenantReviews = all.length - reviews.length;
        mints = rowsOf('eo_approver_token_mints').filter((r) => r.tenant_slug === slug).map((r) => JSON.parse(r.data));
      } finally { db.close(); }
    } catch (e) { reviewsError = e instanceof Error ? e.message : String(e); }
  }
  const ecDir = path.join(root, 'pl', 'EvidenceCollector', 'storage', slug, 'items');
  let ecItems = null;
  // DB-1: EC keeps its item records as ec_items rows in pl/ces.db (the per-item JSON mirror is gone);
  // the item folder is read only when the database has no such rows (pre-DB-1 runs).
  try {
    const db = aoDb();
    const rows = db ? db.prepare("SELECT data FROM ces_records WHERE collection = 'ec_items' AND tenant_slug = ?").all(slug) : [];
    ecItems = rows.length
      ? rows.map((r) => JSON.parse(r.data))
      : exists(ecDir) ? fs.readdirSync(ecDir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(ecDir, f))) : [];
  } catch { ecItems = null; }
  const objPath = path.join(ces, 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json');
  // PKG-2: the customer's designated probe (customers/<slug>/document-reviews.json probe: an upload no review cites).
  const reviewsDocV80 = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'customers', slug, 'document-reviews.json');
  const probeDecl = exists(reviewsDocV80) ? readJson(reviewsDocV80).probe ?? null : null;
  check('V80', 'Every non-stack control met by document review has a review per objective from an approver-token holder who is not the uploader; an upload with no review stays uncredited (not_assessed unless a stack tier or, for PS / AT, EO\'s store decides; the designated probe stays not_assessed)', () => gapmod.judgeV80({
    snapshot: storedSnapshot, reviews, reviewsError, mints, ecItems, otherTenantReviews,
    objectivesRef: exists(objPath) ? readJson(objPath) : null, probeDecl,
  }));
}
// ---------- Gap closure FLOW-2b: V83 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V83: Stamper's stamper_evidence_metadata rows in <root>\pl\ces.db (read and overwrite-probed on a temp COPY with the
// ces-shared dist CesRepository) against every file under pl/Stamper/plan-data/<slug>/evidence and evidence-by-task.
const v83 = await (async () => {
  const repoMod = await import(pathToFileURL(path.join(ces, 'ces-shared', 'dist', 'persistence', 'CesRepository.js')).href);
  const planDataDir = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
  const collected = await gapmod.collectV83({ dbFile: path.join(root, 'pl', 'ces.db'), planDataDir, repoMod, tmpRoot: os.tmpdir() });
  const files = exists(planDataDir)
    ? ['evidence', 'evidence-by-task'].flatMap((d) => listFiles(path.join(planDataDir, d))).map((f) => ({
      relPath: path.relative(planDataDir, f).replace(/\\/g, '/'), sha256: sha(f), mtimeMs: fs.statSync(f).mtimeMs,
    }))
    : null;
  return { collected, files, runStartMs };
})().catch((e) => ({ collected: { error: `error: ${e instanceof Error ? e.message : String(e)}` } }));
check('V83', 'Every Stamper evidence file of this run has a WORM stamper_evidence_metadata row whose latest attempt carries the file\'s sha256; no row changed after it was written; an overwrite probe on a copy of ces.db is refused', () => gapmod.judgeV83(v83));
// ---------- Gap closure API-3a + FLOW-5: V88 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V88: out/plan-compile.json (E3's POST /api/plan/compile record) and out/plan against out/plan-script (the retired runner,
// same inputs, run standalone at E3); E1-E4 logs, steps.json, tester-run.json and E6-overrides.json for a harness-generated
// initialPassword; the pushed TM / IM and the executable plan for the reference; logs/E6-execute.out for its resolution.
const v88 = await (async () => {
  const { docxText: v88DocxText } = await import('./scorecard.mjs');
  const logDir = path.join(out, 'logs');
  const recordFile = path.join(out, 'plan-compile.json');
  const planFiles = await gapmod.v88ReadPlanDir(planDir, v88DocxText);
  const scriptFiles = await gapmod.v88ReadPlanDir(path.join(out, 'plan-script'), v88DocxText);
  const planFileSha = {};
  if (exists(planDir)) {
    const walk = (rel) => fs.readdirSync(path.join(planDir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
    for (const n of walk('')) planFileSha[n] = sha(path.join(planDir, n));
  }
  const logs = {};
  if (exists(logDir)) for (const f of fs.readdirSync(logDir).filter((x) => /^E[1-4][-.]/.test(x))) logs[`logs/${f}`] = fs.readFileSync(path.join(logDir, f), 'utf8');
  for (const f of ['steps.json', 'tester-run.json']) if (exists(path.join(out, f))) logs[f] = fs.readFileSync(path.join(out, f), 'utf8');
  const e6File = path.join(logDir, 'E6-execute.out');
  const ovFile = path.join(logDir, 'E6-overrides.json');
  return {
    steps,
    record: exists(recordFile) ? readJson(recordFile) : null,
    recordStale: staleOf(recordFile),
    planFileSha: exists(planDir) ? planFileSha : null,
    compare: planFiles && scriptFiles ? gapmod.v88ComparePlans(planFiles, scriptFiles) : null,
    twinRc: steps.E3?.script_twin_rc ?? null,
    logs,
    overridesLog: exists(ovFile) ? readJson(ovFile) : null,
    tm,
    im: exists(pIM) ? readJson(pIM) : null,
    plan: exePlan,
    e6Out: exists(e6File) ? fs.readFileSync(e6File, 'utf8') : null,
  };
})().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
// FIN-19: V88 (f), the reference's read budget (FIN-17 SP-7): muster-api's call record and E8F's probe read.
const v88f = (() => {
  const callsFile = path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'state', 'muster-eo-calls.jsonl');
  const calls = exists(callsFile) ? fs.readFileSync(callsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }) : null;
  const forcedV88 = exists(path.join(runsDir, 'forced', 'forced.json')) ? readJson(path.join(runsDir, 'forced', 'forced.json')) : null;
  return { calls, ref: v88.record?.initial_password_ref ?? null, e8fRan: !!steps.E8F, probeStatus: forcedV88?.secret_probe_status ?? null };
})();
const v88fCallLines = (await import('./verify-fin29.mjs')).judgeMusterCallLines({ calls: v88f.calls, answersPresent: exists(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'customers', slug, 'interview-answers.json')) });
check('V88', 'E3 compiled through POST /api/plan/compile and its plan equals the retired runner\'s minus run-variant values; no harness-generated initialPassword; the pushed TM / IM holds muster-api\'s secret reference, which Stamper\'s E6 log shows resolved; the reference allows exactly the E6 and E8F reads', () => {
  if (v88.error) return { pass: false, detail: `error: ${v88.error}` };
  const main = gapmod.judgeV88(v88);
  const f = gapmod.judgeV88F(v88f);
  // FIN-29 (g): E6 keeps muster-api's E3/E4 call lines (FIN-19 open item 1).
  const g = v88fCallLines;
  return { pass: main.pass && f.pass && g.pass, detail: `${main.detail}; ${f.detail}; ${g.detail}` };
});
// ---------- Gap closure PKG-3: V79 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V79: the newest extracted EO package (out/eo-package/<pkgLatest>/, V39) — every file with the sha256 of its bytes, its
// integrity-manifest.json and evidence-index.json — against the pushed policy-set manifest (Stamper plans/, documents)
// and EO's Stamper chain: the last C11 index record in the evidence store (storeRecords, V37) and its file records' payloads.
{
  const pkgDirV79 = pkgLatest ? path.join(pkgRoot, pkgLatest) : null;
  const v79Files = pkgDirV79 ? Object.fromEntries(listFiles(pkgDirV79).map((p) => [path.relative(pkgDirV79, p).split(path.sep).join('/'), sha(p)])) : null;
  const v79Read = (f) => (pkgDirV79 && exists(path.join(pkgDirV79, f)) ? readJson(path.join(pkgDirV79, f)) : null);
  const pPolicySetV79 = latest(path.join(root, 'pl', 'Stamper', 'plan-data', slug, 'plans'), 'policy-set-manifest-');
  const pushedPolicyCount = exists(pPolicySetV79) ? (readJson(pPolicySetV79).artifact?.documents ?? []).length : null;
  const c11 = storeRecords.filter((r) => r.sourceId === 'collect.stamperEvidence' && r.status === 'success');
  // The index the package was built from (stamper-evidence/chain.json; a later pass such as E8F appends newer ones), else the last.
  const v79ChainDoc = v79Read('stamper-evidence/chain.json');
  const c11Index = c11.find((r) => r.endpoint === 'stamper_evidence/index' && r.recordId === v79ChainDoc?.indexRecordId)
    ?? c11.filter((r) => r.endpoint === 'stamper_evidence/index').pop();
  let chain = null;
  if (c11Index) {
    const fileIds = payloadOf(c11Index)?.fileIds ?? [];
    chain = fileIds.map((id) => {
      const rec = c11.find((r) => r.endpoint === 'stamper_evidence/file' && r.query === `stamper_evidence/${id}`);
      const pl = rec ? payloadOf(rec) : null;
      return pl ? { relPath: pl.relPath, fileSha256: pl.fileSha256 } : { relPath: `<no record for ${id}>`, fileSha256: null };
    });
  }
  check('V79', 'The EO package has policies/ (count = pushed policy envelopes), personnel/, stamper-evidence/ (= EO\'s Stamper chain) and an EO-built evidence-index.json whose every row resolves to a zip file with a matching hash; the integrity manifest covers them', () => gapmod.judgeV79({
    pkgName: pkgLatest, files: v79Files, integrity: v79Read('integrity-manifest.json'), index: v79Read('evidence-index.json'), pushedPolicyCount, chain, harness,
  }));
}
// ---------- Gap closure FLOW-3: V84 (GAP-CLOSURE-PLAN.md §5; the judge is in scripts/verify-gap.mjs) ----------
// V84: out/eo-intake.json (ces-tester E7's POST /api/intake/muster and EO's receipt) against out/push-response.json, the
// pushed files in Stamper's plans folder (sha256 of their bytes; envelopes' hash_sha256 and artifact_id), the pushed
// policy-set manifest's documents, and the SSP's authorizationBoundary.cuiBoundarySource (out/ssp.json, E8).
{
  const eoIntakeFile = path.join(out, 'eo-intake.json');
  const pushRespV84 = exists(path.join(out, 'push-response.json')) ? readJson(path.join(out, 'push-response.json')) : null;
  const planFilesV84 = {};
  for (const name of pushRespV84?.pushed ?? []) {
    const f = path.join(plansDir, name);
    if (!exists(f)) continue;
    const j = readJson(f);
    planFilesV84[name] = { sha256: sha(f), ...(j && typeof j === 'object' && j.artifact && typeof j.hash_sha256 === 'string' ? { hash_sha256: j.hash_sha256, artifact_id: j.artifact_id } : {}) };
  }
  const pPolicySetV84 = latest(plansDir, 'policy-set-manifest-');
  const pushedPolicyDocs = exists(pPolicySetV84) ? (readJson(pPolicySetV84).artifact?.documents ?? []) : null;
  check('V84', 'EO intake receipt hashes equal the pushed files; the EO policy store count equals the pushed policies; the SSP boundary section cites the CUI Boundary envelope hash', () => gapmod.judgeV84({
    harness, record: exists(eoIntakeFile) ? readJson(eoIntakeFile) : null, stale: staleOf(eoIntakeFile), pushResponse: pushRespV84, planFiles: planFilesV84, pushedPolicyDocs, ssp, mpInputs: mp?.inputs ?? null,
  }));
}
// ---------- Gap closure NS-4: V78, stale-build clause (GAP-CLOSURE-PLAN.md §5; PKG-1 gate) ----------
// ---------- GC-NS-4 judges (begin): pure; scripts/gap-ns4.test.mjs loads this block from the source ----------
// V78 (part): E8F's out/runs/forced/forced.json records the package build mx-e2e.ps1 attempts between the forced assess and
// the forced ssp/generate (stale_build_status, stale_build_reason). The forced assess saved a newer snapshot and POA&M while
// the SSP still records E7B's snapshotId, so EO's PKG-1 gate must refuse it: 409 "Package build refused: ...". Not run
// (reported, not failed) under -Harness tester, whose E8F (ces-tester) makes no stale-build attempt yet, and when this run
// has no E8F step (-SkipForcedRun). The other V78 clauses (cover, SSP, POA&M and E7B share one snapshotId; age limit; both
// DOCX present) are not judged here.
const V78_PART = 'stale-build clause only; the snapshotId, age and DOCX clauses of V78 are not yet checked';
function judgeV78Stale({ harness, e8fStep = null, forced = null, forcedStale = null }) {
  // NS-4t: ces-tester's E8F writes stale_build_status too, so both harnesses are judged.
  if (!e8fStep) return { pass: true, detail: `not run: this run has no E8F step (-SkipForcedRun); ${V78_PART}` };
  if (forcedStale) return { pass: false, detail: `${forcedStale}; ${V78_PART}` };
  if (!forced) return { pass: false, detail: `no out/runs/forced/forced.json (E8F); ${V78_PART}` };
  const st = forced.stale_build_status;
  const why = String(forced.stale_build_reason ?? '');
  if (st === undefined || st === null) return { pass: false, detail: `E8F made no stale-build attempt (forced.json has no stale_build_status; assess_rc ${forced.assess_rc ?? '?'}); ${V78_PART}` };
  if (st === 409 && /^Package build refused: /.test(why)) return { pass: true, detail: `E8F's stale build was refused: HTTP 409 "${why.slice(0, 200)}"; ${V78_PART}` };
  if (st === 200) return { pass: false, detail: `E8F's stale build was NOT refused (HTTP 200; the PKG-1 gate let a mixed-snapshot package through${forced.stale_build_zip_removed ? '; its zip was removed' : ''}); ${V78_PART}` };
  return { pass: false, detail: `E8F's stale build got HTTP ${st} "${why.slice(0, 200)}", not 409 "Package build refused: ..."; ${V78_PART}` };
}
// ---------- GC-NS-4 judges (end) ----------
{
  const forcedFileV78 = path.join(forcedDir, 'forced.json');
  // FIN-19: the snapshotId, age and DOCX clauses (judgeV78Clauses) beside the stale-build clause.
  const pkgDirV78 = pkgLatest ? path.join(pkgRoot, pkgLatest) : null;
  const pkgFilesV78 = pkgDirV78 ? listFiles(pkgDirV78).map((f) => path.relative(pkgDirV78, f).split(path.sep).join('/')) : null;
  const poamV78 = exists(path.join(out, 'poam.json')) ? readJson(path.join(out, 'poam.json')) : null;
  check('V78', "The cover's snapshotId equals the SSP's, the POA&M's and E7B's; SSP and POA&M inside the age limit; both DOCX in the package; E8F's stale build was refused with 409", () => {
    const stale = judgeV78Stale({ harness, e8fStep: steps.E8F ?? null, forced: exists(forcedFileV78) ? readJson(forcedFileV78) : null, forcedStale: staleOf(forcedFileV78) });
    const rest = gapmod.judgeV78Clauses({
      cover: pkgDirV78 && exists(path.join(pkgDirV78, 'cover-sheet.json')) ? readJson(path.join(pkgDirV78, 'cover-sheet.json')) : null,
      ssp, poam: poamV78, e7bId: steps.E7B?.assessment_id ?? null, pkgFiles: pkgFilesV78, maxAgeHours: Number(process.env.EO_PACKAGE_MAX_AGE_HOURS ?? 24),
    });
    return { pass: stale.pass && rest.pass, detail: `${rest.detail}; ${stale.detail.replace(`; ${V78_PART}`, '')}` };
  });
}
// ---------- Secrets: V101, V102 (SECRETS-PLAN.md SP-11, SP-5; reserved, not authored yet) ----------
// V101 = out/secret-scan.json exists, is from this run and shows 0 hits for every run secret. V102 = under -Tls, every
// module answered /api/health over https with this run's certificate and a plain-http call to the same port failed.
// ---------- Cost gate: V103-V108 (COST-GATE-SPEC.md §6.3 V101-V106 renumbered; LOG-GC-CG.md §7; judges in verify-gap.mjs) ----------
{
  const shSrc = (f) => { const p = path.join(ces, 'ces-shared', 'src', 'data', f); return exists(p) ? readJson(p) : null; };
  const costItems = shSrc('cost-items.reference.json');
  const costEstimates = shSrc('cost-estimates.reference.json');
  const fresh = (p) => !Number.isFinite(runStartMs) || fs.statSync(p).mtimeMs >= runStartMs;
  const tenantPlanData = path.join(root, 'pl', 'Stamper', 'plan-data', slug);
  // V103: this run's Stamper cost-gate records and the E7A AO rows' cost record (data.evidence.metadata.costGate, AO-private).
  const costEvidence = listFiles(path.join(tenantPlanData, 'cost-gate-evidence')).filter((p) => p.endsWith('.json') && fresh(p)).map((p) => {
    const j = readJson(p);
    return { file: path.basename(p), dp: j?.metadata?.dp ?? null, outcome: j?.outcome ?? null };
  });
  const aoCostRows = e7aCalls.map(({ op, call }) => ({ op: op.op, outcome: (aoDb() ? aoRow(call.evidence_row_id) : null)?.evidence?.metadata?.costGate?.outcome ?? null }));
  const recurringIds = costItems ? (costItems.items ?? []).filter((i) => i.kind === 'registry_entry' && i.cost_gate?.recurring).map((i) => i.item_id) : null;
  check('V103', 'No recurring SET ran: the key-vault entry is cost_gated_off in the executable plan, nothing is acked, no recurring entry is in the plan, no accepted DP-2 record, no AO recurring op enabled', () => gapmod.judgeV103({ plan: exePlan, recurringIds, evidence: costEvidence, aoRows: aoCostRows }));
  // V104: the pushed Mission Plan's notice against out/plan-compile.json (E3's 200 body, recorded by plan-compile.mjs).
  const compileRecFile = path.join(out, 'plan-compile.json');
  // FIN-19: plus the MX_SUMMARY and push COST_RECURRING clauses FIN-17 landed (judgeV104Lines; was V104_DEFERRED).
  check('V104', 'The Mission Plan carries the recurring-cost notice; items_hash is the canonical SHA-256 of items; the compile 200 body carries the same notice; all four (m365_azure) list at least 1 item; MX_SUMMARY recurring_items and the push COST_RECURRING line agree', () => {
    const recV104 = exists(compileRecFile) ? readJson(compileRecFile) : null;
    const main = gapmod.judgeV104({
      slug, mp, record: recV104, recordStale: staleOf(compileRecFile), e3Mode: steps.E3?.mode ?? null,
      sha256Hex: (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex'),
    });
    const lines = gapmod.judgeV104Lines({ mp, record: recV104, pushResponse: exists(path.join(out, 'push-response.json')) ? readJson(path.join(out, 'push-response.json')) : null });
    return { pass: main.pass && lines.pass, detail: `${main.detail.replace(`; ${gapmod.V104_DEFERRED}`, '')}; ${lines.detail}` };
  });
  // V105: the raw Stamper registries (src/registry), the catalogue and the price file; the costly-cmdlet list from the built Stamper.
  const regDir = path.join(ces, 'ces-stamper', 'src', 'registry');
  const registries = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].map((f) => (exists(path.join(regDir, f)) ? { source: `ces-stamper:${f}`, entries: readJson(path.join(regDir, f)).entries ?? [] } : null));
  let costlyPatternsIn = null;
  try { costlyPatternsIn = (await import(pathToFileURL(path.join(ces, 'ces-stamper', 'dist', 'core', 'CostGate.js')).href)).costlyPatternsIn ?? null; } catch { costlyPatternsIn = null; }
  check('V105', 'Cost data is sound: CG-lint items 1-4 and 6 over both Stamper registries, no catalogue drift for registry_entry rows, price_date at most 180 days old', () => gapmod.judgeV105({ registries: registries.every(Boolean) ? registries : null, catalogue: costItems, estimates: costEstimates, costlyPatternsIn, nowMs: Date.now() }));
  // V106: the executable plan, ces-ao's registry (read now) and the E7A record.
  const aoRegFile = path.join(ces, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json');
  check('V106', 'The firewall is a last resort: no firewall entry in the executable plan; F-12 is Tier 3, recurring and last_resort with a standard alternative; E7A ran no F-12', () => gapmod.judgeV106({ plan: exePlan, aoRegistry: exists(aoRegFile) ? readJson(aoRegFile) : null, e7a }));
  // V107: the Infrastructure Manifest pushed by this run (an older one left in plans/ is not this run's).
  check('V107', 'Muster defaults are off: the m365_azure Infrastructure Manifest has Free Defender plans, a Standard vault, RSA keys, 90-day workspace retention, no AzureFirewallSubnet, private endpoint or private DNS zone; all four push one', () => gapmod.judgeV107({ slug, im: exists(pIM) && !staleOf(pIM) ? readJson(pIM) : null }));
  // V108: this run's SSP statuses against the baseline's, with the SPRS weights; this run's Stamper evidence file names.
  const weightsFile = path.join(ces, 'ces-shared', 'dist', 'data', 'sprs-weights.json');
  const sprsW = exists(weightsFile) ? new Map((readJson(weightsFile).controls ?? []).map((c) => [c.control_id, Number(c.weight)])) : null;
  const evDirV108 = path.join(tenantPlanData, 'evidence');
  const evFiles = exists(evDirV108) ? listFiles(evDirV108).filter(fresh).map((p) => path.basename(p).toLowerCase()) : null;
  check('V108', 'The cost gate is score-neutral: every control status and SPRS equal the baseline except SC.L2-3.13.10 (unchanged, or met -> not_met without a BitLocker-escrow resolver); the key-escrow evidence is written and the key-vault evidence is not', () => gapmod.judgeV108({
    statusBy: summary.status_by_control, baselineBy: baseline?.status_by_control ?? null, baselineName: baseline ? path.relative(path.dirname(fileURLToPath(import.meta.url)), baselinePath).split(path.sep).join('/') : 'the baseline',
    weightOf: sprsW ? (id) => sprsW.get(id) ?? 0 : null, evFiles,
    // FIN-01 (b): the controls EO's personnel / training records store decided (NS-3b) are the store's moves, not the gate's.
    storeDecided: (storedSnapshot?.controls ?? []).filter((c) => gapmod.V80_STORE_DECIDED.test(c.statusRationale ?? '')).map((c) => c.control_id),
  }));
}
// ---------- FIN-19 (finishing plan PH-1 harness): V76, V87, V110-V114 (FINISH-PLAN.md §1.3; judges in verify-gap.mjs) ----------
{
  const fin19Read = (f) => (exists(f) ? readJson(f) : null);
  const objRefFin19 = fin19Read(path.join(ces, 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json'));
  const aoRegFin19 = fin19Read(path.join(ces, 'ces-ao', 'src', 'registry', 'ao-commands.registry.json'));
  const pkgDirFin19 = pkgLatest ? path.join(pkgRoot, pkgLatest) : null;
  // V76: the AO registry, this run's E7A rows (ces.db adminops_evidence) and the package's adminops/ row files.
  const e7aRowsV76 = e7aCalls.map(({ op, call }) => ({ op: op.op, rowId: call.evidence_row_id, row: aoDb() ? aoRow(call.evidence_row_id) : null }));
  const pkgRowsV76 = pkgDirFin19 ? listFiles(path.join(pkgDirFin19, 'adminops')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = fin19Read(f) ?? {};
    return { file: `adminops/${path.basename(f)}`, commandId: j.commandId ?? null, evidenceObjectives: j.evidenceObjectives ?? [], controlIds: j.controlIds ?? [] };
  }) : null;
  check('V76', 'Every AO evidence row names at least one existing objective of its command\'s controls: the AO registry, this run\'s E7A rows in ces.db, and the EO package\'s adminops rows', () => gapmod.judgeV76({ aoRegistry: aoRegFin19, objectivesRef: objRefFin19, e7aRows: e7aRowsV76, pkgRows: pkgRowsV76 }));

  // V87: E8's `eo package build` (out/eo-package-cli/) against the API build (out/eo-package/), same snapshot.
  const v87 = await (async () => {
    const { docxText: v87DocxText } = await import('./scorecard.mjs');
    const inner = (d) => (exists(d) ? fs.readdirSync(d).filter((x) => fs.statSync(path.join(d, x)).isDirectory()).sort().pop() : null);
    const cliRoot = path.join(out, 'eo-package-cli');
    const cliInner = inner(cliRoot);
    const apiFiles = pkgDirFin19 ? await gapmod.v88ReadPlanDir(pkgDirFin19, v87DocxText) : null;
    const cliFiles = cliInner ? await gapmod.v88ReadPlanDir(path.join(cliRoot, cliInner), v87DocxText) : null;
    const recFile = path.join(out, 'eo-package-cli.json');
    return {
      record: fin19Read(recFile), recordStale: staleOf(recFile),
      compare: apiFiles && cliFiles ? gapmod.v88ComparePlans(apiFiles, cliFiles) : null,
      apiFiles: apiFiles?.length ?? 0, cliFiles: cliFiles?.length ?? 0,
    };
  })().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  check('V87', '`eo package build` gives the same package (file set and contents minus run-variant values) as the API build of the same snapshot', () => (v87.error ? { pass: false, detail: `error: ${v87.error}` } : gapmod.judgeV87(v87)));

  // V110: the stored snapshot (twin) and each EU variant's EO probe (ces-tester ui-e2e-run.ts, out/ui/<variant>/eo-eu-probe.json).
  const uiScenarioFin19 = path.join(ces, 'ces-tester', 'scenarios', 'ui', `${slug}-stamper-ui-e2e.json`);
  const uiRootFin19 = path.join(out, 'ui');
  const euProbes = exists(uiRootFin19)
    ? fs.readdirSync(uiRootFin19).map((v) => path.join(uiRootFin19, v, 'eo-eu-probe.json')).filter((f) => exists(f) && !staleOf(f)).map((f) => fin19Read(f))
    : [];
  check('V110', 'A GUI-approved manual gate never credits a non-stack control: the twin\'s snapshot has no non-stack control met by a gate record, and EO\'s assess over the EU run\'s own root leaves every gate-approved non-stack control uncredited', () => gapmod.judgeV110({ snapshot: storedSnapshot, euExpected: exists(uiScenarioFin19), euProbes }));

  // V111: the SSP JSON and DOCX text (E8), EO's interview records (E7, V81) and the E7A record.
  const interviewsFin19 = fin19Read(path.join(out, 'eo-interviews.json'));
  check('V111', 'SSP truthfulness: no affirmative claim on a not_met / not_assessed control; PS.L2-3.9.2 on terminations and transfers; held resolved where the source exists; EC counts agree with the finding; "Non-Technology Stack" only on the non-stack set', () => gapmod.judgeV111({
    ssp, docxText: docxText ?? null, interviewsHeld: (interviewsFin19?.listed ?? 0) > 0, adminOpsRan: e7aCalls.length > 0,
  }));

  // V112: E8.5b's record, the EC items and every review row of the slug (history) in ces.db, E8.6b's record.
  const dbRows = (col) => { try { return aoDb()?.prepare('SELECT data FROM ces_records WHERE collection = ? AND tenant_slug = ?').all(col, slug).map((r) => JSON.parse(r.data)) ?? null; } catch { return null; } };
  const reviewsDocFin19 = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'customers', slug, 'document-reviews.json');
  const reviewDoc = fin19Read(reviewsDocFin19);
  const uploadFile = path.join(out, 'ec-upload-eo-route.json');
  const cliFile = path.join(out, 'eo-review-cli.json');
  check('V112', 'An upload through EO\'s own upload route records its uploader and catalog ids; `eo review` posts a review that counts under GD-b; a superseding review replaces the earlier one', () => gapmod.judgeV112({
    upload: fin19Read(uploadFile), uploadStale: staleOf(uploadFile), ecItems: dbRows('ec_items'),
    cli: fin19Read(cliFile), cliStale: staleOf(cliFile), reviewsAll: dbRows('eo_document_reviews'),
    uploaderUpn: reviewDoc?.uploader?.upn ?? null, hasReviewer: !!reviewDoc?.reviewer?.upn, wantFormId: fin19Read(uploadFile)?.form_id ?? null,
  }));

  // V113: E7C's record (S1 only) and the ces.db rows its calls wrote.
  const costFile = path.join(out, 'adminops-cost.json');
  check('V113', 'An AO op that starts a recurring cost shows its price in the dry run, is refused without DP-1 and on a wrong DP-2, and runs with DP-1 plus the correct DP-2 on the simulated tenant; every call evidenced', () => gapmod.judgeV113({
    probeOp: slug === 's1-mach' ? 'E-01' : null, record: fin19Read(costFile), recordStale: staleOf(costFile), rowOf: (id) => (aoDb() ? aoRow(id) : null),
  }));

  // V114: push-response.json (muster-api's own EO intake), the pushed files, plan-compile.json, plan-compile-mu.json + out/plan-mu, muster-probes.json.
  const v114 = await (async () => {
    const { docxText: v114DocxText } = await import('./scorecard.mjs');
    const pushResp = fin19Read(path.join(out, 'push-response.json'));
    const planFiles = {};
    for (const name of pushResp?.pushed ?? []) { const f = path.join(plansDir, name); if (exists(f)) planFiles[name] = { sha256: sha(f) }; }
    const apiPlan = await gapmod.v88ReadPlanDir(planDir, v114DocxText);
    const muPlan = await gapmod.v88ReadPlanDir(path.join(out, 'plan-mu'), v114DocxText);
    return {
      pushResponse: pushResp, planFiles, compileRecord: freshJson(path.join(out, 'plan-compile.json')),
      answersPresent: exists(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'customers', slug, 'interview-answers.json')),
      mu: freshJson(path.join(out, 'plan-compile-mu.json')), compare: apiPlan && muPlan ? gapmod.v88ComparePlans(apiPlan, muPlan) : null,
      probes: freshJson(path.join(out, 'muster-probes.json')),
    };
  })().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  check('V114', 'Muster\'s own EO intake call at push returned 201 with the push hashes; the interview-record send is recorded; `mu plan compile` equals the API compile; a cross-file push without an override gets 409; a second tenant gets 404 on a claimed slug', () => (v114.error ? { pass: false, detail: `error: ${v114.error}` } : gapmod.judgeV114(v114)));
}
// ---------- FIN-29 (finishing plan PH-2 harness): V77, V89, V101, V115-V117, V119-V122, V126-V130 (verify-fin29.mjs hub) ----------
{
  const listFilesFin29 = (d) => {
    const acc = [];
    const walk = (x) => { let es; try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) acc.push(p); } };
    walk(d);
    return acc;
  };
  const weightsFin29 = path.join(ces, 'ces-shared', 'dist', 'data', 'sprs-weights.json');
  const objRefFile29 = path.join(ces, 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json');
  const vctx = {
    root, out, ces, pkg: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), slug, harness, steps,
    plansDir, tenantPlanData: path.join(root, 'pl', 'Stamper', 'plan-data', slug),
    readJson, exists, staleOf, freshJson, listFiles: listFilesFin29,
    readEoIntake: v5w4.readEoIntake, // FIN-35 S-1 (V122 (c))
    ssp, summary, baseline, snapshot: storedSnapshot, docxText: docxText ?? null,
    db: aoDb,
    dbRows: (collection, tenantSlug = slug) => { try { const db = aoDb(); if (!db) return null; return (tenantSlug ? db.prepare('SELECT data FROM ces_records WHERE collection = ? AND tenant_slug = ?').all(collection, tenantSlug) : db.prepare('SELECT data FROM ces_records WHERE collection = ?').all(collection)).map((r) => JSON.parse(r.data)); } catch { return null; } },
    objectivesRef: exists(objRefFile29) ? readJson(objRefFile29) : null,
    sprsWeights: exists(weightsFin29) ? new Map((readJson(weightsFin29).controls ?? []).map((c) => [c.control_id, Number(c.weight)])) : null,
  };
  const { runFin29Checks } = await import('./verify-fin29.mjs');
  for (const r of await runFin29Checks(vctx)) checks.push(r);

  // ---------- FIN-35 / VER-4: V91-V99 (depth plan §5; judges in scripts/verify-depth.mjs) and V123-V125 + V73 x4 ----------
  const regFile = (n) => path.join(ces, 'ces-stamper', 'src', 'registry', n);
  const registriesDepth = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].flatMap((n) => {
    if (!exists(regFile(n))) return [];
    const r = readJson(regFile(n));
    return (Array.isArray(r) ? r : (r.entries ?? [])).map((e) => ({ ...e, _registry: n }));
  });
  const dctx = {
    ...vctx,
    exePlan, report, registries: registriesDepth,
    im: exists(pIM) ? readJson(pIM) : null,
    ledger: exists(path.join(out, 'ledger.json')) ? (readJson(path.join(out, 'ledger.json')).data ?? null) : null,
    v72: v72 && !v72.error ? v72 : null,
  };
  try {
    const { runDepthChecks } = await import('./verify-depth.mjs');
    for (const r of await runDepthChecks(dctx)) checks.push(r);
  } catch (e) {
    for (const id of ['V91', 'V92', 'V93', 'V94', 'V95', 'V96', 'V97', 'V98', 'V99']) checks.push({ id, title: `${id} (VER-4)`, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
  try {
    const { runFin35Checks } = await import('./verify-fin35.mjs');
    for (const r of await runFin35Checks({ ...dctx, aoRow: (id) => (aoDb() ? aoRow(id) : null) })) checks.push(r);
  } catch (e) {
    for (const id of ['V123', 'V124', 'V125']) checks.push({ id, title: `${id} (FIN-35)`, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
}
const result = { pass: checks.every((c) => c.pass), scenario: slug, baseline: baseline ? path.basename(baselinePath) : null, harness, checks };
fs.writeFileSync(path.join(out, 'verify.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.id} ${c.title}: ${c.detail}`);
console.log(`verify: ${result.pass ? 'ALL CHECKS PASS' : 'FAILED'}`);
process.exitCode = result.pass ? 0 : 1;
