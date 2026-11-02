// FIN-29 (finishing plan PH-2 harness): the hub (V101, V122, V88 (g)), the SP-11 R6 token path, the W8-IDS identity-scan
// fix, the sim-PFX sweep and the FD-17 customer-file additions. Fictional values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeV101, judgeV122, judgeMusterCallLines, runFin29Checks, V101_REQUIRED_SECRETS, SECRET_SCAN_SCHEMA, FIN29_AREAS } from './verify-fin29.mjs';
import { resolveToken, TOKEN_ENV } from './plan-compile.mjs';
import { isSimThrowawayPfx, refusedRoot, findSimPfx } from './sim-pfx-sweep.mjs';
import { loadDocumentReviews } from './build-customer-records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const win = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-pkg-'));

const goodScan = (over = {}) => ({
  schema: SECRET_SCAN_SCHEMA, taken: '2026-10-31T10:00:00.000Z',
  roots: [{ name: 'out', files: 10 }, { name: 'eo-evidence-store', files: 5 }, { name: 'ec-store', files: 3 }, { name: 'stamper-evidence', files: 7 }],
  secrets: V101_REQUIRED_SECRETS.map((name) => ({ name, length: 48, hits: 0, files_with_hits: 0, encodings: [] })),
  hit_files: [], ...over,
});

test('V101: a clean scan of every run secret over the four roots passes', () => {
  const r = judgeV101({ scan: goodScan(), steps: { E1: { started: '2026-10-31T09:00:00.000Z' } } });
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /0 hits/);
});

test('V101: a hit, a missing secret, a missing root, a short secret, an early scan and a value field are red', () => {
  const hit = goodScan();
  hit.secrets[0] = { ...hit.secrets[0], hits: 2, files_with_hits: 1 };
  hit.hit_files = ['out/logs/x.log'];
  assert.match(judgeV101({ scan: hit }).detail, /LEAK: ec_secret 2 hit/);
  assert.match(judgeV101({ scan: goodScan({ secrets: goodScan().secrets.slice(1) }) }).detail, /not scanned: ec_secret/);
  assert.match(judgeV101({ scan: goodScan({ roots: goodScan().roots.slice(0, 2) }) }).detail, /roots not scanned: ec-store, stamper-evidence/);
  const short = goodScan(); short.secrets[1] = { ...short.secrets[1], length: 8 };
  assert.match(judgeV101({ scan: short }).detail, /too short/);
  assert.match(judgeV101({ scan: goodScan(), steps: { E1: { started: '2026-10-31T11:00:00.000Z' } } }).detail, /before this run's E1/);
  const val = goodScan(); val.secrets[0] = { ...val.secrets[0], value: 'x' };
  assert.match(judgeV101({ scan: val }).detail, /unexpected fields/);
  assert.equal(judgeV101({ scan: null }).pass, false);
  assert.equal(judgeV101({ scan: null, harness: 'mx' }).pass, true);
});

test('V122 (a)(b): Planner gone; red while the folder, a workspace, a script or a gate suite remains', () => {
  const pkg = { workspaces: ['ces-shared', 'ces-stamper'], scripts: { test: 'npm run test --workspaces' } };
  const gate = { suites: [{ suite: 'ces-shared' }, { suite: 'ces-muster' }] };
  assert.equal(judgeV122({ plannerDirExists: false, rootPkg: pkg, unitGate: gate }).pass, true);
  const bad = judgeV122({ plannerDirExists: true, rootPkg: { workspaces: ['ces-planner'], scripts: { planner: 'x', 'build:fe': 'npm -w ces-planner run build' } }, unitGate: { suites: [{ suite: 'ces-planner' }] } });
  assert.equal(bad.pass, false);
  for (const re of [/still exists/, /workspaces still name ces-planner/, /scripts still name ces-planner: planner, build:fe/, /runs a ces-planner suite/]) assert.match(bad.detail, re);
});

test('V88 (g): the E3/E4 call lines survive E6', () => {
  assert.equal(judgeMusterCallLines({ calls: [{ event: 'eo_interviews' }, { event: 'eo_intake' }, { event: 'secret_read' }], answersPresent: true }).pass, true);
  assert.match(judgeMusterCallLines({ calls: [{ event: 'secret_read' }], answersPresent: true }).detail, /no eo_intake line.*no eo_interviews/);
  assert.equal(judgeMusterCallLines({ calls: [{ event: 'eo_intake' }], answersPresent: false }).pass, true);
  assert.equal(judgeMusterCallLines({ calls: null }).pass, false);
});

test('hub: a missing area module yields red rows for each of its checks; the hub rows are present', async () => {
  const d = tmp();
  const vctx = { out: d, ces: d, steps: {}, harness: 'tester', exists: fs.existsSync, readJson: (f) => JSON.parse(fs.readFileSync(f, 'utf8')), staleOf: () => null };
  const rows = await runFin29Checks(vctx, { dir: d });
  for (const a of FIN29_AREAS) for (const id of a.ids) assert.match(rows.find((r) => r.id === id)?.detail ?? '', /is missing/);
  assert.ok(rows.some((r) => r.id === 'V101'));
  assert.ok(rows.some((r) => r.id === 'V122'));
});

test('SP-11 R6: plan-compile.mjs takes the bearer from the env; --token only with a deprecation warning', () => {
  const warns = [];
  assert.equal(resolveToken({ token: 'argv-tok' }, { [TOKEN_ENV]: 'env-tok' }, (m) => warns.push(m)), 'env-tok');
  assert.equal(warns.length, 0);
  assert.equal(resolveToken({ token: 'argv-tok' }, {}, (m) => warns.push(m)), 'argv-tok');
  assert.match(warns[0], /deprecated/);
  assert.equal(resolveToken({}, {}), undefined);
});

test('SP-11 R6: mx-e2e.ps1 passes no --token on any command line and stays CRLF-only', () => {
  const b = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'));
  let cr = 0, lf = 0, crlf = 0;
  for (let i = 0; i < b.length; i++) { if (b[i] === 10) { lf++; if (b[i - 1] === 13) crlf++; } if (b[i] === 13) cr++; }
  assert.equal(cr, lf);
  assert.equal(crlf, lf);
  assert.doesNotMatch(b.toString('utf8'), /'--token'/);
  assert.match(b.toString('utf8'), /\$env:MUSTER_API_TOKEN = \$MusterToken/);
});

test('W8-IDS: identity-scan.ps1 catches doubled and JSON-escaped user-profile paths', { skip: !win && 'Windows PowerShell only' }, () => {
  const d = tmp();
  const BS = String.fromCharCode(92);
  const cases = {
    'doubled.json': JSON.stringify({ p: `C:${BS}Users${BS}example-person${BS}AppData` }), // JSON doubles the backslashes
    'escaped-slash.json': `{"p":"C:${BS}/Users${BS}/example-person${BS}/x"}`,
    'lower.txt': `c:${BS}users${BS}example-person`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const f = path.join(d, name);
    fs.writeFileSync(f, text);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'identity-scan.ps1'), '-Path', f], { encoding: 'utf8' });
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
  }
  const clean = path.join(d, 'clean.json');
  fs.writeFileSync(clean, JSON.stringify({ p: `C:${BS}ces-nb${BS}out${BS}x.json` }));
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'identity-scan.ps1'), '-Path', clean], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('sim-PFX sweep: matches only simulator throwaways and refuses protected roots', () => {
  const j = (...p) => path.join(...p);
  assert.equal(isSimThrowawayPfx(j('W', 'out', 'ao', 'sim', 's1-mach.pfx')), true);
  assert.equal(isSimThrowawayPfx(j('E', 'w8-s1-eu-2', 'ui', 'spa', 'sim.pfx')), true);
  assert.equal(isSimThrowawayPfx(j('T', 'w4-st3-rb-x', 'sim-cert.pfx')), true);
  assert.equal(isSimThrowawayPfx(j('T', 'tenant-app.pfx')), false);
  assert.equal(isSimThrowawayPfx(j('T', 'sim.pfx.bak')), false);
  const home = tmp();
  assert.match(refusedRoot(path.join(home, '.ces', 'tenants'), home), /refused/);
  assert.equal(refusedRoot(tmp(), home), null);
  const d = tmp();
  fs.mkdirSync(j(d, 'ao', 'sim'), { recursive: true });
  fs.writeFileSync(j(d, 'ao', 'sim', 'x.pfx'), 'x');
  fs.writeFileSync(j(d, 'keep.pfx'), 'x');
  assert.deepEqual(findSimPfx([d]).map((f) => path.relative(d, f).split(path.sep).join('/')), ['ao/sim/x.pfx']);
});

test('FD-17: the S1/S2 review plans load with the new artifacts; S1\'s probe moved to MP.L1-3.8.3', () => {
  const refFile = path.join(PKG, '..', '..', 'ces', 'ces-shared', 'src', 'data', 'assessment-objectives.reference.json');
  const objectivesRef = fs.existsSync(refFile) ? JSON.parse(fs.readFileSync(refFile, 'utf8')) : null;
  const objOf = (c) => (objectivesRef?.objectives ?? []).filter((o) => o.controlId === c).map((o) => o.objectiveId).sort();
  const full = (plan, c) => {
    const got = plan.reviews.filter((r) => r.control_id === c && r.verdict === 'met').map((r) => r.objective_id).sort();
    return objectivesRef ? JSON.stringify(got) === JSON.stringify(objOf(c)) : got.length > 0;
  };
  const s1 = loadDocumentReviews(PKG, 's1-mach', { objectivesRef });
  const s2 = loadDocumentReviews(PKG, 's2-eng', { objectivesRef });
  for (const c of ['PE.L2-3.10.2', 'PE.L2-3.10.6', 'CM.L2-3.4.4', 'CA.L2-3.12.4']) assert.ok(full(s1, c), `S1 ${c} has a met review on every objective`);
  for (const c of ['PE.L2-3.10.2', 'PE.L2-3.10.6', 'CM.L2-3.4.4']) assert.ok(full(s2, c), `S2 ${c} has a met review on every objective`);
  assert.equal(s2.reviews.some((r) => r.control_id === 'CA.L2-3.12.4'), false);
  assert.equal(s1.probe.control_id, 'MP.L1-3.8.3');
  assert.equal(s2.probe.control_id, 'CA.L2-3.12.4');
  for (const s of ['s1-mach', 's2-eng']) {
    for (const f of fs.readdirSync(path.join(PKG, 'customers', s, 'review-artifacts'))) {
      const t = fs.readFileSync(path.join(PKG, 'customers', s, 'review-artifacts', f), 'utf8');
      assert.match(t, /SIMULATED CUSTOMER \(FICTIONAL\)/, `${s}/${f} carries the fictional marker`);
      assert.ok(t.includes('\r\n') && !/[^\r]\n/.test(t), `${s}/${f} is CRLF like its siblings`);
    }
  }
});

test('R-F1 fix, V110 (a): Tier 3/4 stack proxies are not gate records; a manual-gate decider is', async () => {
  const { judgeV110, V110_GATE_DECIDED } = await import('./verify-gap.mjs');
  const proxies = [
    ['MA.L2-3.7.1', 'Tier 3 (state-verified execution verdict) decides: evidence_import/imported: Deploy Windows Update for Business Ring via Intune [executor stamper/2.2.3@no-mgcontext]'],
    ['MP.L2-3.8.4', 'Tier 3 (state-verified execution verdict) decides: evidence_import/imported: Create CUI Sensitivity Label with encryption'],
    ['CA.L2-3.12.1', 'Tier 4 (evidence-only Stamper SAT) decides; state not verified: evidence_import/imported: Compliance Assessment Evidence via Compliance Manager'],
  ];
  for (const [, r] of proxies) assert.equal(V110_GATE_DECIDED.test(r), false, r);
  const snap = { controls: proxies.map(([id, r]) => ({ control_id: id, status: 'met', statusRationale: r })) };
  assert.equal(judgeV110({ snapshot: snap }).pass, true);
  const gate = 'Tier 3 (state-verified execution verdict) decides: evidence_import/imported: [manual-gate] manual-PE.L1-3.10.1';
  assert.equal(V110_GATE_DECIDED.test(gate), true);
  assert.equal(judgeV110({ snapshot: { controls: [{ control_id: 'PE.L1-3.10.1', status: 'met', statusRationale: gate }] } }).pass, false);
});
