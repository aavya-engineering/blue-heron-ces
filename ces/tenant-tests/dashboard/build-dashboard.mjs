// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// build-dashboard.mjs — generate a self-contained HTML dashboard from the latest
// G-EUT-1 run report. No external deps, no network: embeds the run data + metadata
// inline so the file opens offline (double-click). Reproducible for every run.
//
//   node tenant-tests/dashboard/build-dashboard.mjs [path-to-run.json]
//
// Output: docs/tenant-tests/results/dashboard.html

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const resultsDir = join(repoRoot, 'docs', 'tenant-tests', 'results');

// ---- locate the run json (arg, else newest run-*.json) ----
let runPath = process.argv[2];
if (!runPath) {
  const runs = readdirSync(resultsDir).filter(f => /^run-.*\.json$/.test(f)).sort();
  if (!runs.length) { console.error('No run-*.json found in ' + resultsDir); process.exit(1); }
  runPath = join(resultsDir, runs[runs.length - 1]);
}
const run = JSON.parse(readFileSync(runPath, 'utf8').replace(/^﻿/, ''));

// ---- canonical CMMC 2.0 L2 catalog (110) + CES registry evaluator coverage ----
const catalog = JSON.parse(readFileSync(join(__dirname, 'cmmc-l2-controls.json'), 'utf8').replace(/^﻿/, ''));
const stripLevel = id => id.replace(/\.L[12]-/, '-');   // AC.L2-3.1.1 -> AC-3.1.1
let evalIds = new Set();
try {
  const reg = JSON.parse(readFileSync(join(repoRoot, 'ces-shared', 'src', 'data', 'control-signal-registry.json'), 'utf8').replace(/^﻿/, ''));
  for (const [k, v] of Object.entries(reg)) if (v && v.evaluator) evalIds.add(stripLevel(k));
} catch { /* registry optional */ }

// ---- enrichment metadata (from docs/tenant-tests/END-USER-USE-CASES.md) ----
const PERSONAS = {
  P1: 'CUI Engineer — core workforce; full CUI access',
  P2: 'Program Manager / Contracts — heavy external collaboration',
  P3: 'Business staff (finance/HR) — no CUI; must be excluded',
  P4: 'New hire — onboarding; access pending',
  P5: 'Departing employee — offboarding target',
  P6: 'Client IT admin / owner-operator — privileged, Day-2 admin',
  P7: 'External partner / guest — must be constrained',
  P8: 'Remote / traveling worker — off-site, conditional access',
};

const PRACTICES = {
  'IA.L2-3.5.1': 'Identify & authenticate users before access (MFA enforcement)',
  'IA.L2-3.5.3': 'Multifactor authentication — no weak methods (SMS/voice)',
  'IA.L2-3.5.7': 'Password complexity & lockout (14+ chars, banned list)',
  'AC.L2-3.1.1': 'Limit system access to authorized users (CUI group + CA)',
  'AC.L2-3.1.2': 'Limit access to permitted transactions/functions (lifecycle)',
  'AC.L2-3.1.3': 'Control flow of CUI (DLP, information barriers)',
  'AC.L2-3.1.4': 'Separation of duties (PIM approval)',
  'AC.L2-3.1.5': 'Least privilege / just-in-time admin (PIM eligible)',
  'AC.L2-3.1.7': 'Prevent non-privileged users running privileged functions (break-glass)',
  'AC.L2-3.1.12': 'Monitor & control remote access sessions (named locations, geo)',
  'AC.L2-3.1.18': 'Control connection of mobile devices (compliant-device CA)',
  'AC.L2-3.1.20': 'Verify & control external connections (external sharing)',
  'CM.L2-3.4.1': 'Baseline configuration & inventory (Autopilot, BitLocker, compliance)',
  'CM.L2-3.4.2': 'Enforce security config settings (baseline drift)',
  'CM.L2-3.4.7': 'Restrict nonessential programs (application control / WDAC)',
  'MP.L2-3.8.1': 'Protect CUI on media (sensitivity labels)',
  'MP.L2-3.8.3': 'Sanitize media before disposal/reuse (device wipe)',
  'SC.L2-3.13.8': 'Cryptographic protection of CUI in transit (IRM/OME/TLS)',
  'SI.L2-3.14.1': 'Identify & correct flaws timely (patch management)',
  'AU.L2-3.3.1': 'Create & retain audit records (90+ day retention, Sentinel)',
  'AT.L2-3.2.2': 'Train personnel on security duties (training-gated access)',
  'IR.L2-3.6.1': 'Operational incident-handling capability (Sentinel triage)',
};

const TIERS = {
  T1: 'Policy-state — read-only check that the enforcing policy exists, is enabled, and is correctly scoped.',
  T2: 'Behavioral-evidence — read-only audit/sign-in log check that the control actually fired in practice.',
  T3: 'Interactive-simulation — a real/synthetic user walks the path. Requires test personas (skipped stubs for now).',
};

const VERDICTS = {
  PASS: 'Control verifiably enforced.',
  FAIL: 'Probe ran; enforcement absent or misscoped — a finding about the tenant, never a test defect.',
  INCONCLUSIVE: 'Probe ran but evidence is insufficient (quiet logs, permission gap, or channel limit).',
  SKIPPED: 'Prerequisite missing (channel not built, or a T3 stub). Always carries a reason.',
};

const HEADER_HELP = {
  Control: 'The CMMC 2.0 Level 2 practice under test. Hover a practice ID for its NIST 800-171 intent.',
  'Use case': 'The end-user day-to-day scenario (UC-NN) from the use-case catalog that exercises this control.',
  Personas: 'Which tenant roles walk this scenario. Hover a Pn chip for the role.',
  Test: 'The specific probe run against the live tenant.',
  Tier: 'How the control is verified: T1 policy-state, T2 behavioral-evidence, T3 interactive.',
  Verdict: 'PASS / FAIL / INCONCLUSIVE / SKIPPED. Hover for the meaning of each.',
  Detail: 'What the probe observed — for a FAIL, exactly what was wrong.',
};

// A FAIL disposition is a finding; give each a short severity from FINDINGS.md.
const SEVERITY = {
  'UC-14|No standing Global Admins except break-glass': 'HIGH',
  'UC-02|CUI-authorized group exists and is populated': 'HIGH',
  'UC-06|CUI group is a strict subset of users (boundary exists)': 'HIGH',
  'UC-08|Intune device compliance policy exists': 'MED',
  'UC-03|Protection transport rules enabled (IRM/OME/encryption)': 'MED',
  'UC-11|Autopilot deployment profile exists': 'LOW',
};

// Per-TEST control attribution. A use case can map to several controls, but each
// individual probe usually targets ONE of them — attributing the case's whole practice
// list to every probe would taint unrelated controls with an unrelated verdict. This map
// pins each probe (caseId|test) to the specific control(s) it verifies. Tests not listed
// fall back to their case's full Practices array (single-control cases).
const TEST_CONTROLS = {
  'UC-01|CA policy requires MFA for all users': ['IA-3.5.1'],
  'UC-01|Weak MFA methods (SMS/voice) disabled': ['IA-3.5.3'],
  'UC-01|Recent interactive sign-ins satisfied MFA': ['IA-3.5.1'],
  'UC-02|CUI-authorized group exists and is populated': ['AC-3.1.1'],
  'UC-02|CUI sensitivity label is published': ['MP-3.8.1'],
  'UC-02|Compliant-device CA policy enabled': ['AC-3.1.18'],
  'UC-03|Protection transport rules enabled (IRM/OME/encryption)': ['SC-3.13.8'],
  'UC-03|DLP policies protect CUI content': ['AC-3.1.3'],
  'UC-03|Mail flow evidence (message trace)': ['SC-3.13.8'],
  'UC-08|Intune device compliance policy exists': ['CM-3.4.1'],
  'UC-08|CA requires compliant device for access': ['AC-3.1.18'],
  'UC-08|Non-compliant device blocks observed': ['AC-3.1.18'],
  'UC-11|Autopilot deployment profile exists': ['CM-3.4.1'],
  'UC-11|BitLocker enforcement configured': ['CM-3.4.1'],
  'UC-11|Training gate (CA withholds access until training complete)': ['AT-3.2.2'],
  'UC-12|AO registry provides the offboarding command set (local check)': ['AC-3.1.2', 'MP-3.8.3'],
  'UC-12|Offboarding activity evidence in directory audits': ['AC-3.1.2', 'MP-3.8.3'],
  'UC-14|No standing Global Admins except break-glass': ['AC-3.1.5'],
  'UC-14|PIM eligible assignments exist (JIT model in use)': ['AC-3.1.4', 'AC-3.1.5'],
  'UC-14|Break-glass account excluded from CA policies': ['AC-3.1.7'],
  'UC-15|Guest invitation policy restricted': ['AC-3.1.20'],
  'UC-15|Guest role is restricted (not member-equivalent)': ['AC-3.1.20', 'AC-3.1.3'],
  'UC-17|Windows Update ring configuration exists': ['SI-3.14.1'],
  'UC-17|Managed device fleet compliance rate': ['CM-3.4.2'],
};

// ---- shape the data: group by control (practice), then use case ----
const rows = run.results.map(r => ({
  caseId: r.CaseId, caseName: r.CaseName,
  personas: r.Personas || [], practices: r.Practices || [],
  controls: (r.Controls || []).filter(Boolean),
  test: r.Test, tier: r.Tier, verdict: r.Verdict, detail: r.Detail,
  severity: SEVERITY[`${r.CaseId}|${r.Test}`] || null,
}));
// control id -> friendly title, from the canonical catalog (for table/modal tooltips)
const CONTROL_TITLE = {};
for (const c of catalog.controls) CONTROL_TITLE[c.id] = c.title;

const counts = rows.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
const total = rows.length;

// per-test control attribution (prefer the test's own Controls, else legacy map/case)
const controlsForRow = r => {
  if (r.controls && r.controls.length) return r.controls;
  const pinned = TEST_CONTROLS[`${r.caseId}|${r.test}`];
  return (pinned || r.practices.map(stripLevel));
};
// control rollup keyed by canonical control id: worst verdict wins for the badge
const VERDICT_RANK = { FAIL: 0, INCONCLUSIVE: 1, BLOCKED: 2, SKIPPED: 3, PASS: 4 };
const byControl = {};
for (const r of rows) {
  for (const cid of controlsForRow(r)) {
    (byControl[cid] ||= { practice: cid, title: CONTROL_TITLE[cid] || '', rows: [] }).rows.push(r);
  }
}
for (const c of Object.values(byControl)) {
  c.worst = c.rows.map(r => r.verdict).sort((a, b) => VERDICT_RANK[a] - VERDICT_RANK[b])[0];
  c.counts = c.rows.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
}

// per-persona rollup
const byPersona = {};
for (const r of rows) for (const p of r.personas) {
  const b = (byPersona[p] ||= { PASS: 0, FAIL: 0, INCONCLUSIVE: 0, SKIPPED: 0 });
  b[r.verdict]++;
}

const findings = rows.filter(r => r.verdict === 'FAIL')
  .sort((a, b) => ({ HIGH: 0, MED: 1, LOW: 2 }[a.severity] ?? 3) - ({ HIGH: 0, MED: 1, LOW: 2 }[b.severity] ?? 3));

// ---- 110-control coverage map: which controls our test cases exercise, + status ----
// Index each test row under the specific control(s) it verifies (controlsForRow, defined above).
const rowsByControl = {};
for (const r of rows) for (const cid of controlsForRow(r)) {
  (rowsByControl[cid] ||= []).push(r);
}
const coverage = catalog.controls.map(c => {
  const trs = rowsByControl[c.id] || [];
  const verdicts = trs.map(t => t.verdict);
  // Mission-plan applicability dispositions (G-EUT-4) are non-failing and win over FAIL/etc:
  // a control the mission plan marks N/A / ATTEST / INHERITED / IN_SCOPE_DEFERRED shows that
  // disposition, not a red gap. (An IN_SCOPE control with a real FAIL still shows FAIL below.)
  const DISPO = { NOT_APPLICABLE: 'NA', ATTEST: 'ATTEST', INHERITED: 'INHERITED', IN_SCOPE_DEFERRED: 'DEFERRED', CES_PRODUCED: 'PRODUCED' };
  const dispo = verdicts.map(v => DISPO[v]).find(Boolean);
  let status;                                   // control-level coverage status
  if (dispo && !verdicts.includes('FAIL')) status = dispo;
  else if (!trs.length) status = evalIds.has(c.id) ? 'EVALUATOR_ONLY' : 'NOT_COVERED';
  else if (verdicts.includes('FAIL')) status = 'FAIL';
  else if (verdicts.some(v => v === 'PASS')) status = verdicts.every(v => v === 'PASS' || v === 'SKIPPED' || DISPO[v]) ? 'PASS' : 'PARTIAL';
  else if (verdicts.every(v => v === 'SKIPPED')) status = 'SKIPPED';   // documented manual/out-of-channel
  else if (verdicts.every(v => v === 'BLOCKED' || v === 'SKIPPED')) status = 'BLOCKED'; // T3/CRM pending a named input
  else status = 'INCONCLUSIVE';                 // ran, but no PASS and no FAIL
  return {
    id: c.id, family: c.family, title: c.title,
    hasEvaluator: evalIds.has(c.id),
    hasRun: trs.length > 0,
    status,
    tests: trs.map(t => ({ caseId: t.caseId, test: t.test, tier: t.tier, verdict: t.verdict, detail: t.detail, severity: t.severity })),
    rowIdx: trs.map(t => rows.indexOf(t)),
  };
});
const covCounts = coverage.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), {});
const covExercised = coverage.filter(c => c.hasRun).length;

// ---- G-EUT-5: assessment-objective coverage (320) + SPRS cert-blockers ----
// CMMC L2 is scored at 320 NIST 800-171A objectives, not 110 practices: ONE unmet
// objective fails the practice. This section is the true headline. A probe supplies
// the *Examine* method only; an objective needing Interview/Test stays PARTIAL until
// those methods have evidence (never shown as fully met). 5-point (no_poam) practices
// cannot go on a POA&M, so a FAIL on one is a CERTIFICATION BLOCKER, not a remediable gap.
let objCatalog = [], sprsByControl = {}, probeMap = [];
try { objCatalog = JSON.parse(readFileSync(join(repoRoot, 'tenant-tests', 'profiles', 'nist-800-171a-objectives.json'), 'utf8').replace(/^﻿/, '')).objectives || []; } catch { /* optional */ }
try { for (const w of (JSON.parse(readFileSync(join(repoRoot, 'tenant-tests', 'profiles', 'sprs-weights.json'), 'utf8').replace(/^﻿/, '')).weights || [])) sprsByControl[stripLevel(w.control)] = w; } catch { /* optional */ }
try { probeMap = JSON.parse(readFileSync(join(repoRoot, 'tenant-tests', 'profiles', 'probe-objective-map.json'), 'utf8').replace(/^﻿/, '')).map || []; } catch { /* optional */ }

// objective id (e.g. "AC.L2-3.1.7[c]") -> the probes (case|test) that Examine it, from the map
const objToProbes = {};
for (const e of probeMap) for (const oid of (e.objectives || [])) (objToProbes[oid] ||= []).push(`${e.case}|${e.test}`);
// (case|test) -> worst verdict from THIS run (PENDING if the probe isn't in this run yet)
const runVerdictByProbe = {};
for (const r of rows) {
  const k = `${r.caseId}|${r.test}`;
  const cur = runVerdictByProbe[k];
  runVerdictByProbe[k] = cur == null ? r.verdict : [cur, r.verdict].sort((a, b) => VERDICT_RANK[a] - VERDICT_RANK[b])[0];
}
// controls the mission plan dispositions out-of-scope (non-failing) -> their objectives are out-of-scope
const dispoByControl = {};
for (const r of rows) if (r.caseId === 'SCOPE') { const DISPO = { NOT_APPLICABLE: 'NA', ATTEST: 'ATTEST', INHERITED: 'INHERITED', IN_SCOPE_DEFERRED: 'DEFERRED' }; for (const cid of r.controls) if (DISPO[r.verdict]) dispoByControl[cid] = DISPO[r.verdict]; }

const objectives = objCatalog.map(o => {
  const oid = `${o.control}[${o.objective}]`;
  const cidStrip = stripLevel(o.control);
  const probes = objToProbes[oid] || [];
  const verdicts = probes.map(p => runVerdictByProbe[p]).filter(Boolean);
  const runStatus = verdicts.length ? verdicts.sort((a, b) => VERDICT_RANK[a] - VERDICT_RANK[b])[0] : (probes.length ? 'PENDING' : null);
  const methods = o.methods || [];
  const otherMethods = methods.filter(m => m !== 'Examine');   // Interview / Test still owed
  let status;
  if (probes.length) {
    // Examine-covered by the map. Reflect the ACTUAL run: a probe absent from this run
    // (renamed/added since) is PENDING re-run, not yet evidenced.
    if (runStatus === 'FAIL') status = 'FAIL';
    else if (runStatus === 'PENDING') status = 'PENDING';      // probe not in this run yet
    else if (otherMethods.length) status = 'PARTIAL';          // Examine done; Interview/Test pending
    else status = 'MET';                                       // Examine-only objective, fully met
  } else if (dispoByControl[cidStrip]) {
    status = dispoByControl[cidStrip];                         // out-of-scope by mission disposition
  } else {
    status = 'UNEXAMINED';                                     // no probe: needs Interview/Test/docs
  }
  const w = sprsByControl[cidStrip];
  return { oid, control: o.control, cidStrip, objective: o.objective, statement: o.statement, methods, otherMethods, family: o.control.split('.')[0], probes, runStatus, status, weight: w ? w.weight : null, noPoam: !!(w && w.no_poam) };
});
const objCounts = objectives.reduce((a, o) => (a[o.status] = (a[o.status] || 0) + 1, a), {});
const objExamined = objectives.filter(o => o.probes.length).length;

// SPRS certification blockers: a FAIL on a 5-point (no_poam) practice cannot be POA&M'd.
const certBlockers = Object.values(byControl)
  .filter(c => c.worst === 'FAIL' && sprsByControl[c.practice] && sprsByControl[c.practice].no_poam)
  .map(c => ({ control: c.practice, title: c.title, weight: sprsByControl[c.practice].weight,
    fails: c.rows.filter(r => r.verdict === 'FAIL').map(r => ({ test: r.test, detail: r.detail })) }));

const objSummary = {
  total: objCatalog.length, examined: objExamined,
  met: objCounts.MET || 0, partial: objCounts.PARTIAL || 0, fail: objCounts.FAIL || 0, pending: objCounts.PENDING || 0,
  unexamined: objCounts.UNEXAMINED || 0,
  dispositioned: (objCounts.NA || 0) + (objCounts.ATTEST || 0) + (objCounts.INHERITED || 0) + (objCounts.DEFERRED || 0),
};

const payload = { run: { tenant: run.tenant, startedAt: run.startedAt, runFile: runPath.split(/[\\/]/).pop() },
  counts, total, rows, byControl, byPersona, findings, PERSONAS, PRACTICES, TIERS, VERDICTS, HEADER_HELP,
  coverage, covCounts, covExercised, covTotal: catalog.controls.length, families: catalog.families, CONTROL_TITLE,
  objectives, objCounts, objSummary, certBlockers };

// ---- HTML template (CES brand: navy/heron/teal/gold; light+dark) ----
const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CES · End-User Tenant Test Dashboard</title>
<style>
  :root{
    --navy:#0F2540; --heron:#2E6C8E; --teal:#1FB6A6; --gold:#C9A227;
    --pass:#1F9D57; --fail:#D64545; --inc:#C9A227; --skip:#7A8699;
    --bg:#F4F6F9; --card:#FFFFFF; --ink:#0F2540; --muted:#5A6B7E; --line:#E1E7EF;
  }
  html[data-theme="dark"]{
    --navy:#0B1B2E; --bg:#0D1826; --card:#132434; --ink:#E7EEF6; --muted:#9DB0C4; --line:#22394F;
    --pass:#37C77F; --fail:#F0736F; --inc:#E3BE4C; --skip:#8FA0B4;
  }
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
  header{background:linear-gradient(100deg,var(--navy),var(--heron));color:#fff;padding:20px 28px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  header .brand{font-weight:700;font-size:19px;letter-spacing:.3px}
  header .brand small{display:block;font-weight:400;font-size:12px;opacity:.8;letter-spacing:.5px}
  header .meta{font-size:13px;opacity:.9;margin-left:auto;text-align:right}
  .themebtn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:20px;padding:6px 14px;cursor:pointer;font-size:13px}
  main{max-width:1200px;margin:0 auto;padding:24px 20px 60px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:10px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;cursor:pointer;transition:transform .08s,box-shadow .08s}
  .kpi:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(15,37,64,.10)}
  .kpi .n{font-size:30px;font-weight:700;line-height:1}
  .kpi .l{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-top:6px}
  .kpi.sel{outline:2px solid var(--teal)}
  .bar{display:flex;height:12px;border-radius:8px;overflow:hidden;margin:14px 0 22px;border:1px solid var(--line)}
  .bar>span{display:block}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .v-PASS{color:var(--pass)} .bg-PASS{background:var(--pass)}
  .v-FAIL{color:var(--fail)} .bg-FAIL{background:var(--fail)}
  .v-INCONCLUSIVE{color:var(--inc)} .bg-INCONCLUSIVE{background:var(--inc)}
  .v-SKIPPED{color:var(--skip)} .bg-SKIPPED{background:var(--skip)}
  .v-BLOCKED{color:var(--gold)} .bg-BLOCKED{background:var(--gold)}
  /* coverage grid — the 110 controls */
  .covwrap{display:flex;flex-direction:column;gap:14px}
  .fam{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .fam h4{margin:0 0 10px;font-size:13px;display:flex;align-items:center;gap:8px}
  .fam h4 .fc{color:var(--muted);font-weight:400}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:6px}
  .cell{border-radius:7px;padding:7px 4px;text-align:center;font-size:11px;font-weight:600;cursor:pointer;border:1px solid transparent;color:#fff;line-height:1.25;position:relative}
  .cell small{display:block;font-weight:400;font-size:9px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cell:hover{outline:2px solid var(--ink)}
  .st-PASS{background:var(--pass)} .st-FAIL{background:var(--fail)} .st-INCONCLUSIVE{background:var(--inc);color:#3a2f00}
  .st-PARTIAL{background:linear-gradient(135deg,var(--pass) 50%,var(--inc) 50%)}
  .st-SKIPPED{background:transparent;color:var(--skip);border:1px dotted var(--skip)}
  .st-EVALUATOR_ONLY{background:transparent;color:var(--heron);border:1px dashed var(--heron)}
  .st-NOT_COVERED{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .st-NA{background:var(--navy);color:#fff;opacity:.55} .st-INHERITED{background:var(--heron);color:#fff}
  .st-ATTEST{background:var(--gold);color:#3a2f00} .st-DEFERRED{background:transparent;color:var(--gold);border:1px dashed var(--gold)}
  .st-PRODUCED{background:var(--teal);color:#fff}
  .st-MET{background:var(--pass)} .st-PENDING{background:transparent;color:var(--heron);border:1px dashed var(--heron)}
  .st-BLOCKED{background:transparent;color:var(--gold);border:1px dashed var(--gold)}
  .st-UNEXAMINED{background:transparent;color:var(--muted);border:1px solid var(--line)}
  /* SPRS certification-blocker banner (5-point / no_poam FAIL) */
  .certban{background:var(--fail);color:#fff;border-radius:12px;padding:14px 18px;margin:16px 0 4px;box-shadow:0 6px 18px rgba(214,69,69,.25)}
  .certban h3{margin:0 0 6px;font-size:16px;display:flex;align-items:center;gap:8px}
  .certban .cb{background:rgba(255,255,255,.14);border-radius:8px;padding:8px 12px;margin-top:8px;font-size:13px}
  .certban b{font-weight:700}
  .cellw{position:absolute;top:2px;right:3px;font-size:8px;opacity:.9}
  .leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:6px 0 14px}
  .leg span{display:inline-flex;align-items:center;gap:5px}
  .sw{width:12px;height:12px;border-radius:3px;display:inline-block}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:30px 0 12px;border-bottom:1px solid var(--line);padding-bottom:8px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}
  th{background:var(--card);font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);cursor:help;position:relative}
  tbody tr{cursor:pointer}
  tbody tr:hover{background:rgba(31,182,166,.06)}
  tr:last-child td{border-bottom:none}
  .badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600;color:#fff}
  .chip{display:inline-block;background:rgba(46,108,142,.12);color:var(--heron);border-radius:20px;padding:1px 8px;font-size:12px;margin:1px 2px;cursor:help}
  html[data-theme="dark"] .chip{background:rgba(46,108,142,.28);color:#bfe0f0}
  .sev{font-size:11px;font-weight:700;padding:1px 7px;border-radius:4px;margin-left:6px}
  .sev-HIGH{background:var(--fail);color:#fff} .sev-MED{background:var(--gold);color:#3a2f00} .sev-LOW{background:var(--skip);color:#fff}
  .practice{font-weight:600;cursor:help;border-bottom:1px dotted var(--muted)}
  .muted{color:var(--muted)}
  .detail{font-size:13px}
  /* modal */
  .overlay{position:fixed;inset:0;background:rgba(9,20,34,.55);display:none;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;z-index:50}
  .overlay.open{display:flex}
  .modal{background:var(--card);border-radius:14px;max-width:760px;width:100%;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .modal h3{margin:0;padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;font-size:17px}
  .modal .body{padding:18px 22px}
  .modal .x{margin-left:auto;cursor:pointer;font-size:22px;line-height:1;color:var(--muted);background:none;border:none}
  .kv{display:grid;grid-template-columns:130px 1fr;gap:6px 14px;font-size:14px;margin:10px 0}
  .kv .k{color:var(--muted)}
  .testrow{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
  .testrow .top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .tip{position:absolute;left:0;top:100%;margin-top:6px;background:var(--navy);color:#fff;padding:8px 11px;border-radius:8px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0;width:250px;line-height:1.4;display:none;z-index:20;box-shadow:0 6px 20px rgba(0,0,0,.3)}
  th:hover .tip{display:block}
  footer{max-width:1200px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:12px}
  a{color:var(--teal)}
</style>
</head>
<body>
<header>
  <div class="brand">CES · Compliance Evidence System<small>End-User Tenant Test — CMMC 2.0 Level 2 enforcement</small></div>
  <div class="meta" id="meta"></div>
  <button class="themebtn" onclick="toggleTheme()">◐ Theme</button>
</header>
<main>
  <div class="cards" id="kpis"></div>
  <div class="bar" id="bar"></div>
  <div id="certblockers"></div>

  <h2>Assessment-objective coverage — <span id="obj-count" style="text-transform:none;letter-spacing:0"></span></h2>
  <p class="muted" style="margin:-4px 0 12px;font-size:13px">CMMC L2 is scored at <b>320 NIST 800-171A objectives</b>, not 110 practices — one unmet objective fails the practice. A tenant probe supplies the <b>Examine</b> method only; an objective that also needs Interview/Test stays <b>Partial</b> until those have evidence (Phases 3–4).</p>
  <div class="leg">
    <span><i class="sw st-MET"></i>Met (Examine-only objective, passed)</span>
    <span><i class="sw st-PARTIAL"></i>Partial (Examine done; Interview/Test pending)</span>
    <span><i class="sw st-FAIL"></i>Fail</span>
    <span><i class="sw st-PENDING"></i>Examine pending re-run</span>
    <span><i class="sw st-UNEXAMINED"></i>Unexamined (needs Interview/Test/docs)</span>
    <span><i class="sw st-NA"></i>Out-of-scope (mission disposition)</span>
  </div>
  <div class="covwrap" id="objwrap"></div>

  <div id="findings"></div>

  <h2>CMMC 2.0 Level 2 coverage — <span id="cov-count" style="text-transform:none;letter-spacing:0"></span></h2>
  <div class="leg">
    <span><i class="sw st-PASS"></i>Pass</span>
    <span><i class="sw st-FAIL"></i>Fail (finding)</span>
    <span><i class="sw st-INCONCLUSIVE"></i>Inconclusive</span>
    <span><i class="sw st-PARTIAL"></i>Partial</span>
    <span><i class="sw st-BLOCKED"></i>Blocked (pending a named input)</span>
    <span><i class="sw st-SKIPPED"></i>Documented manual / out-of-channel</span>
    <span><i class="sw st-NA"></i>N/A (mission scope)</span>
    <span><i class="sw st-ATTEST"></i>Manual attestation</span>
    <span><i class="sw st-INHERITED"></i>Platform-inherited</span>
    <span><i class="sw st-PRODUCED"></i>Produced by EvidenceOps</span>
    <span><i class="sw st-DEFERRED"></i>In-scope deferred</span>
    <span><i class="sw st-EVALUATOR_ONLY"></i>CES evaluator, not in this suite</span>
    <span><i class="sw st-NOT_COVERED"></i>Not covered</span>
  </div>
  <div class="covwrap" id="covwrap"></div>

  <h2 id="controls-h">Tested controls <span class="muted" style="text-transform:none;letter-spacing:0">— click a row for its test cases &amp; evidence</span></h2>
  <table id="controls"><thead><tr id="chead"></tr></thead><tbody id="cbody"></tbody></table>
  <h2>Coverage by persona</h2>
  <table id="personas"><thead><tr><th>Persona<span class="tip">Which tenant role. Hover a row for the full description.</span></th><th>Pass</th><th>Fail</th><th>Inconclusive</th><th>Skipped</th></tr></thead><tbody id="pbody"></tbody></table>
</main>
<footer id="foot"></footer>

<div class="overlay" id="overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <h3 id="mtitle"></h3>
    <div class="body" id="mbody"></div>
  </div>
</div>

<script id="data" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const VORDER = ['PASS','FAIL','INCONCLUSIVE','BLOCKED','SKIPPED'];
let filter = null;

document.getElementById('meta').innerHTML =
  'Tenant <b>'+D.run.tenant+'</b><br>'+new Date(D.run.startedAt).toLocaleString()+' · '+D.total+' tests';
document.getElementById('foot').innerHTML =
  'Source: docs/tenant-tests/results/'+D.run.runFile+' · Suite: G-EUT-1 · Read-only, live tenant. '+
  'A FAIL is a finding about the tenant, not a test defect.';

function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function ctitle(id){return D.CONTROL_TITLE[id]||D.PRACTICES[id]||''}
function rowControls(r){return (r.controls&&r.controls.length)?r.controls:(r.practices||[]).map(p=>p.replace(/\\.L[12]-/,'-'))}

// KPIs
const kpiWrap = document.getElementById('kpis');
kpiWrap.innerHTML = '<div class="kpi '+(!filter?'sel':'')+'" data-v="" onclick="setFilter(null)"><div class="n">'+D.total+'</div><div class="l">Total tests</div></div>'+
  VORDER.map(v=>'<div class="kpi" data-v="'+v+'" onclick="setFilter(\\''+v+'\\')"><div class="n v-'+v+'">'+(D.counts[v]||0)+'</div><div class="l">'+v+'</div></div>').join('');

// stacked bar
document.getElementById('bar').innerHTML = VORDER.map(v=>{
  const w = 100*(D.counts[v]||0)/D.total; return w? '<span class="bg-'+v+'" style="width:'+w+'%" title="'+v+': '+(D.counts[v]||0)+'"></span>':''; }).join('');

// findings banner
if (D.findings.length){
  document.getElementById('findings').innerHTML =
    '<h2>Findings — '+D.findings.length+' failing check'+(D.findings.length>1?'s':'')+' <span class="muted" style="text-transform:none;letter-spacing:0">(click any for detail)</span></h2>'+
    '<table><thead><tr><th>Sev</th><th>Control</th><th>Use case</th><th>What went wrong</th></tr></thead><tbody>'+
    D.findings.map((f,i)=>'<tr onclick="openTest('+D.rows.indexOf(f)+')">'+
      '<td>'+(f.severity?'<span class="sev sev-'+f.severity+'">'+f.severity+'</span>':'<span class="muted">—</span>')+'</td>'+
      '<td>'+rowControls(f).map(p=>'<span class="practice" title="'+esc(ctitle(p))+'">'+p+'</span>').join('<br>')+'</td>'+
      '<td>'+esc(f.caseId)+' · '+esc(f.caseName)+'</td>'+
      '<td class="detail">'+esc(f.detail)+'</td></tr>').join('')+'</tbody></table>';
}

// controls table headers with tooltips
const heads = ['Control','Use case','Personas','Tests','Status'];
const headHelp = {Control:D.HEADER_HELP.Control,'Use case':D.HEADER_HELP['Use case'],Personas:D.HEADER_HELP.Personas,Tests:D.HEADER_HELP.Test,Status:D.HEADER_HELP.Verdict};
document.getElementById('chead').innerHTML = heads.map(h=>'<th>'+h+'<span class="tip">'+esc(headHelp[h])+'</span></th>').join('');

function renderControls(){
  const entries = Object.values(D.byControl).sort((a,b)=>a.practice.localeCompare(b.practice));
  const body = document.getElementById('cbody');
  body.innerHTML = entries.map(c=>{
    const rws = filter? c.rows.filter(r=>r.verdict===filter): c.rows;
    if(!rws.length) return '';
    const ucs=[...new Set(rws.map(r=>r.caseId))];
    const pers=[...new Set(rws.flatMap(r=>r.personas))].sort();
    const badges = VORDER.filter(v=>c.counts[v]).map(v=>'<span class="dot bg-'+v+'"></span>'+c.counts[v]).join(' &nbsp;');
    return '<tr onclick="openControl(\\''+c.practice+'\\')">'+
      '<td><span class="practice" title="'+esc(ctitle(c.practice))+'">'+c.practice+'</span> <span class="muted">'+esc(ctitle(c.practice))+'</span></td>'+
      '<td>'+ucs.map(esc).join(', ')+'</td>'+
      '<td>'+pers.map(p=>'<span class="chip" title="'+esc(D.PERSONAS[p]||'')+'">'+p+'</span>').join('')+'</td>'+
      '<td>'+rws.length+'</td>'+
      '<td>'+badges+'</td></tr>';
  }).join('');
}

function renderPersonas(){
  document.getElementById('pbody').innerHTML = Object.keys(D.byPersona).sort().map(p=>{
    const b=D.byPersona[p];
    return '<tr title="'+esc(D.PERSONAS[p]||'')+'"><td><span class="chip">'+p+'</span> <span class="muted">'+esc((D.PERSONAS[p]||'').split(' — ')[0])+'</span></td>'+
      '<td class="v-PASS">'+b.PASS+'</td><td class="v-FAIL">'+b.FAIL+'</td><td class="v-INCONCLUSIVE">'+b.INCONCLUSIVE+'</td><td class="v-SKIPPED">'+b.SKIPPED+'</td></tr>';
  }).join('');
}

// ---- 110-control coverage ----
function renderCoverage(){
  const exercised = D.covExercised, tot = D.covTotal;
  const passed = D.coverage.filter(c=>c.status==='PASS').length;
  const failed = D.coverage.filter(c=>c.status==='FAIL').length;
  const n = s => D.coverage.filter(c=>c.status===s).length;
  document.getElementById('cov-count').innerHTML =
    '<b>'+exercised+' of '+tot+'</b> controls exercised · '+
    '<span class="v-PASS">'+passed+' pass</span> · <span class="v-FAIL">'+failed+' fail</span> · '+
    n('PARTIAL')+' partial · '+n('INCONCLUSIVE')+' inconclusive · '+
    n('NA')+' N/A · '+n('ATTEST')+' attest · '+n('INHERITED')+' inherited · '+n('PRODUCED')+' EO-produced · '+n('DEFERRED')+' deferred · '+
    n('BLOCKED')+' blocked · '+n('SKIPPED')+' documented-manual · '+n('EVALUATOR_ONLY')+' evaluator-only · '+n('NOT_COVERED')+' uncovered';
  const byFam = {};
  for(const c of D.coverage){(byFam[c.family] ||= []).push(c);}
  document.getElementById('covwrap').innerHTML = Object.keys(byFam).map(fam=>{
    const cells = byFam[fam].map(c=>{
      const num = c.id.split('-')[1];
      return '<div class="cell st-'+c.status+'" title="'+esc(c.id+' · '+c.title+' — '+c.status.replace('_',' ').toLowerCase())+'" onclick="openCoverage(\\''+c.id+'\\')">'+num+'<small>'+esc(c.title)+'</small></div>';
    }).join('');
    const ex = byFam[fam].filter(c=>c.hasRun).length;
    return '<div class="fam"><h4>'+fam+' · '+esc(D.families[fam])+' <span class="fc">('+ex+'/'+byFam[fam].length+' exercised)</span></h4><div class="grid">'+cells+'</div></div>';
  }).join('');
}
function openCoverage(id){
  const c = D.coverage.find(x=>x.id===id);
  document.getElementById('mtitle').innerHTML = esc(c.id)+' · '+esc(c.title)+' <button class="x" onclick="closeModal()">×</button>';
  let h = '<div class="kv">'+
    '<div class="k">Family</div><div>'+c.family+' — '+esc(D.families[c.family])+'</div>'+
    '<div class="k">Coverage</div><div>'+(c.hasRun? (c.tests.length+' test case'+(c.tests.length>1?'s':'')+' in this suite') : (c.hasEvaluator? 'No suite test case — a CES control-signal evaluator exists for it' : 'Not covered by this suite'))+'</div>'+
    '<div class="k">Status</div><div><b class="'+(c.status==='FAIL'?'v-FAIL':c.status==='PASS'?'v-PASS':'muted')+'">'+c.status.replace('_',' ')+'</b></div>'+
    '</div>';
  if(c.tests.length){ h += '<h4 style="margin:14px 0 4px">Test cases exercising this control</h4>' +
    c.tests.map(t=>'<div class="testrow"><div class="top"><span class="badge bg-'+t.verdict+'">'+t.verdict+'</span>'+
      (t.severity?'<span class="sev sev-'+t.severity+'">'+t.severity+'</span>':'')+
      '<b>'+esc(t.caseId)+' · '+esc(t.test)+'</b>'+
      '<span class="chip" style="margin-left:auto" title="'+esc(D.TIERS[t.tier]||'')+'">'+t.tier+'</span></div>'+
      '<div class="detail">'+esc(t.detail)+'</div></div>').join('');
  } else {
    h += '<p class="muted">'+(c.hasEvaluator? 'This control has an automated CES control-signal evaluator (used by EvidenceOps), but no end-user test case in this suite yet — a candidate for the next suite increment.' : 'No CES evaluator and no suite test case. Typically a manual/physical/procedural control (e.g., PE physical protection, PS screening) or one not yet automated.')+'</p>';
  }
  document.getElementById('mbody').innerHTML = h;
  document.getElementById('overlay').classList.add('open');
}

function setFilter(v){
  filter=v;
  document.querySelectorAll('.kpi').forEach(k=>k.classList.toggle('sel',(k.dataset.v||'')===(v||'')));
  document.getElementById('controls-h').innerHTML = 'Controls <span class="muted" style="text-transform:none;letter-spacing:0">— '+(v?('filtered to '+v):'click a row for its test cases &amp; evidence')+'</span>';
  renderControls();
}

function openControl(practice){
  const c=D.byControl[practice];
  document.getElementById('mtitle').innerHTML = '<span class="practice" style="border:none">'+practice+'</span> <button class="x" onclick="closeModal()">×</button>';
  let h = '<div class="kv"><div class="k">Intent</div><div>'+esc(ctitle(practice)||'—')+'</div>'+
    '<div class="k">Test cases</div><div>'+c.rows.length+'</div></div>';
  h += c.rows.map(r=>testCard(r)).join('');
  document.getElementById('mbody').innerHTML=h;
  document.getElementById('overlay').classList.add('open');
}
function openTest(i){
  const r=D.rows[i];
  document.getElementById('mtitle').innerHTML = esc(r.caseId)+' · '+esc(r.caseName)+' <button class="x" onclick="closeModal()">×</button>';
  let h='<div class="kv">'+
    '<div class="k">Controls</div><div>'+rowControls(r).map(p=>'<span class="practice" title="'+esc(ctitle(p))+'">'+p+'</span> <span class="muted">'+esc(ctitle(p))+'</span>').join('<br>')+'</div>'+
    '<div class="k">Personas</div><div>'+r.personas.map(p=>'<span class="chip" title="'+esc(D.PERSONAS[p]||'')+'">'+p+'</span> '+esc((D.PERSONAS[p]||'').split(' — ')[0])).join('<br>')+'</div>'+
    '</div>'+testCard(r);
  document.getElementById('mbody').innerHTML=h;
  document.getElementById('overlay').classList.add('open');
}
function testCard(r){
  return '<div class="testrow"><div class="top">'+
    '<span class="badge bg-'+r.verdict+'">'+r.verdict+'</span>'+
    (r.severity?'<span class="sev sev-'+r.severity+'">'+r.severity+'</span>':'')+
    '<b>'+esc(r.test)+'</b>'+
    '<span class="chip" style="margin-left:auto" title="'+esc(D.TIERS[r.tier]||'')+'">'+r.tier+'</span></div>'+
    '<div class="detail">'+esc(r.detail)+'</div>'+
    '<div class="muted" style="font-size:12px;margin-top:8px">'+esc(D.VERDICTS[r.verdict]||'')+'</div></div>';
}
function closeModal(){document.getElementById('overlay').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

function toggleTheme(){
  const h=document.documentElement;
  h.dataset.theme = h.dataset.theme==='dark'?'light':'dark';
}

// ---- SPRS certification blockers (5-point / no_poam FAIL — cannot be POA&M'd) ----
function renderCertBlockers(){
  const el = document.getElementById('certblockers');
  if(!D.certBlockers || !D.certBlockers.length){ el.innerHTML=''; return; }
  el.innerHTML = '<div class="certban"><h3>⛔ '+D.certBlockers.length+' certification blocker'+(D.certBlockers.length>1?'s':'')+
    ' — 5-point practice FAIL, cannot go on a POA&amp;M</h3>'+
    '<div style="font-size:13px;opacity:.95">A 5-point (SPRS weight 5) practice that is NOT MET at assessment blocks certification outright (32 CFR §170.4) — it must be fixed before the C3PAO assessment, not planned for later.</div>'+
    D.certBlockers.map(b=>'<div class="cb"><b>'+esc(b.control)+'</b> · '+esc(b.title)+' <span style="opacity:.85">(weight '+b.weight+')</span>'+
      b.fails.map(f=>'<div style="margin-top:4px">• '+esc(f.test)+' — '+esc(f.detail)+'</div>').join('')+'</div>').join('')+'</div>';
}

// ---- assessment-objective coverage (320) ----
function renderObjectives(){
  const s = D.objSummary;
  document.getElementById('obj-count').innerHTML =
    '<b>'+s.examined+' of '+s.total+'</b> examined by a probe · '+
    '<span class="v-PASS">'+s.met+' met</span> · '+s.partial+' partial · '+
    '<span class="v-FAIL">'+s.fail+' fail</span> · '+s.pending+' pending re-run · '+
    s.dispositioned+' out-of-scope · <span class="muted">'+s.unexamined+' unexamined (Interview/Test/docs)</span>';
  const byFam = {};
  for(const o of D.objectives){ (byFam[o.family] ||= []).push(o); }
  const ORDER = ['AC','AT','AU','CM','IA','IR','MA','MP','PS','PE','RA','CA','SC','SI'];
  const fams = Object.keys(byFam).sort((a,b)=>ORDER.indexOf(a)-ORDER.indexOf(b));
  document.getElementById('objwrap').innerHTML = fams.map(fam=>{
    const objs = byFam[fam].sort((a,b)=>a.oid.localeCompare(b.oid,undefined,{numeric:true}));
    const cells = objs.map((o,i)=>{
      const label = o.control.replace(/\\.L[12]-/,'-').split('-')[1]+'['+o.objective+']';
      return '<div class="cell st-'+o.status+'" title="'+esc(o.oid+' — '+o.statement+' ['+o.status.toLowerCase()+']')+'" onclick="openObjective('+D.objectives.indexOf(o)+')">'+
        esc(label)+(o.noPoam?'<span class="cellw" title="5-point / cert-blocker">◆</span>':'')+'</div>';
    }).join('');
    const exN = objs.filter(o=>o.probes.length).length;
    return '<div class="fam"><h4>'+fam+' · '+esc(D.families[fam]||'')+' <span class="fc">('+exN+'/'+objs.length+' examined)</span></h4><div class="grid">'+cells+'</div></div>';
  }).join('');
}
function openObjective(i){
  const o = D.objectives[i];
  document.getElementById('mtitle').innerHTML = esc(o.oid)+' <button class="x" onclick="closeModal()">×</button>';
  const probes = o.probes.length ? o.probes.map(p=>esc(p)).join('<br>') : '<span class="muted">none — needs Interview / Test / signed documentation</span>';
  const methodNote = o.otherMethods.length ? ('Examine satisfied by probe; still owed: <b>'+o.otherMethods.join(' + ')+'</b>') : 'Examine is the only required method';
  document.getElementById('mbody').innerHTML = '<div class="kv">'+
    '<div class="k">Determination</div><div>'+esc(o.statement)+'</div>'+
    '<div class="k">Practice</div><div>'+esc(o.control)+' — '+esc(ctitle(o.cidStrip)||'')+(o.noPoam?' <span class="sev sev-HIGH">5-pt · cert-blocker</span>':(o.weight?' <span class="muted">(weight '+o.weight+')</span>':''))+'</div>'+
    '<div class="k">Assessment methods</div><div>'+esc((o.methods||[]).join(', '))+'</div>'+
    '<div class="k">Status</div><div><b class="'+(o.status==='FAIL'?'v-FAIL':(o.status==='MET'?'v-PASS':'muted'))+'">'+o.status.replace('_',' ')+'</b> — '+methodNote+'</div>'+
    '<div class="k">Examining probes</div><div>'+probes+'</div>'+
    '</div>';
  document.getElementById('overlay').classList.add('open');
}

setFilter(null); renderCertBlockers(); renderObjectives(); renderCoverage(); renderPersonas();
</script>
</body>
</html>`;

const outPath = join(resultsDir, 'dashboard.html');
writeFileSync(outPath, html, 'utf8');
console.log('Dashboard written: ' + outPath);
console.log('Source run: ' + runPath);
