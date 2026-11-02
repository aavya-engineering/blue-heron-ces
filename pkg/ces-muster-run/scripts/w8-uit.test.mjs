// W8-UIT1 tests (PLAN.md section 8b, docs/context/w8/UI-TRACK.md section 5: V73, the UI run equals its headless twin; step EU):
//   node --test scripts/w8-uit.test.mjs
// Self-contained: every fixture is synthetic (fictional names); the only package files read are verify.mjs's and mx-e2e.ps1's
// sources (read only), plus ces-tester's ui-e2e-compare.ts when present (W8-UIT3: the (c) rules must match). Nothing in the workspace is written; Stamper, ces-tester and the simulator are not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeV43b, judgeV73, v73FailedSet, v73MutatedRows, v73MutatedObjects, v73EndState, V73_NATURAL_KEYS, V73_VOLATILE } from './verify-w4.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLUG = 's1-mach';
const E6 = { started: '2026-10-29T10:00:00.000Z', ended: '2026-10-29T10:10:00.000Z' };
const EU = { started: '2026-10-29T12:00:00.000Z', ended: '2026-10-29T12:30:00.000Z' };
const row = (ts, type, objectType, objectId, sessionType = 'operator') => ({ ts, type, objectType, objectId, sessionType });
const projection = (ids = ['step_task_AC.L1-3.1.1_p1_a', 'step_task_IA.L2-3.5.3_p1_b']) => ({
  tasks: ids.map((id) => ({ id, engine: 'powershell', directive: 'automated', controls: [id.split('_')[2]], sub_commands: [{ id: `${id}.sub`, set_command: 'Set-Thing', get_command: 'Get-Thing', evidence_commands: [], org_values: null, lookup: null, verification: null }] })),
  variables: { tenantName: 'fabrikam-machining' },
});
const leaver = (extra = {}) => ({ id: 'u-leaver', displayName: 'Leaver One', accountEnabled: false, ...extra });
const simStore = (collections) => ({ collections });
const twin = () => ({
  projection: projection(),
  report: { failed_tasks: [{ task_id: 'step_task_IA.L2-3.5.3_p1_b' }] },
  ledger: [row('2026-10-29T10:01:00.000Z', 'mutate', 'users', 'u-leaver'), row('2026-10-29T10:02:00.000Z', 'read', 'users', 'u-leaver'), row('2026-10-29T11:00:00.000Z', 'mutate', 'users', 'u-ao')],
  window: E6,
  store: simStore({ users: { 'u-leaver': leaver() } }),
});
const legacy = (extra = {}) => ({
  id: 'legacy', ran: true, reason: null, error: null, testerPass: true,
  projection: { ...projection(), variables: { tenantName: 'other' } },
  report: { failed_tasks: [{ task_id: 'step_task_IA.L2-3.5.3_p1_b' }] },
  ledger: [row('2026-10-29T12:05:00.000Z', 'mutate', 'users', 'u-leaver'), row('2026-10-29T12:06:00.000Z', 'mutate', 'users', 'u-x', 'seed')],
  window: EU,
  store: simStore({ users: { 'u-leaver': leaver() } }),
  ...extra,
});
const spaNotBuilt = { id: 'spa', ran: false, reason: 'not run: /app/ is not built (public/app/index.html absent under ces-stamper)', error: null, testerPass: false, projection: null, report: null, ledger: null, window: null, store: null };
const record = { slug: SLUG, variants: [] };
const ok = () => ({ slug: SLUG, record, stale: null, twin: twin(), variants: [legacy(), spaNotBuilt] });

test('V73: legacy equal to the twin and the SPA not built passes; the detail counts tasks, failures and rows', () => {
  const r = judgeV73(ok());
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /legacy = twin: 2 tasks \(variables excluded\), 1 failed, 1 mutated objects \(1 ledger rows\) with the same end state/);
  assert.match(r.detail, /spa not run \(\/app\/ not built\)/);
});

test('V73: the SPA, once it runs, gates like legacy', () => {
  const i = ok();
  i.variants[1] = { ...legacy({ id: 'spa' }) };
  assert.equal(judgeV73(i).pass, true, judgeV73(i).detail);
  i.variants[1] = legacy({ id: 'spa', testerPass: false, report: { failed_tasks: [] } });
  const r = judgeV73(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /^spa: \(b\) failed set differs: UI only \[\], twin only \[step_task_IA\.L2-3\.5\.3_p1_b\]/);
});

test('V73 (a): a task difference names the first task and field; variables never count', () => {
  const i = ok();
  i.variants[0].projection.tasks[1].engine = 'graph';
  i.variants[0].testerPass = false;
  const r = judgeV73(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /legacy: \(a\) UI translate projection != twin \(variables excluded\): first difference task 1 step_task_IA\.L2-3\.5\.3_p1_b, field engine/);
  const missing = ok();
  missing.variants[0].projection = null;
  missing.variants[0].testerPass = false;
  assert.match(judgeV73(missing).detail, /\(a\) no UI executable plan projection/);
});

test('V73 (c): only non-seed, non-read writes inside each window count, as a multiset', () => {
  assert.deepEqual(v73MutatedRows(twin().ledger, E6), ['mutate users/u-leaver']);
  assert.equal(v73MutatedRows(twin().ledger, null), null);
  const i = ok();
  i.variants[0].ledger.push(row('2026-10-29T12:07:00.000Z', 'mutate', 'users', 'u-leaver'));
  i.variants[0].testerPass = false;
  const r = judgeV73(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /\(c\) mutated objects differ \(UI 1 objects \/ 2 rows, twin 1 objects \/ 1 rows\): writes differ \[users\/Leaver One \(UI 2, twin 1\)\]/);
  const noWin = ok();
  noWin.twin.window = null;
  noWin.variants[0].testerPass = false;
  assert.match(judgeV73(noWin).detail, /\(c\) no twin out\/ledger\.json, E6 window or twin sim store snapshot/);
  const noStore = ok();
  noStore.variants[0].store = null;
  noStore.variants[0].testerPass = false;
  assert.match(judgeV73(noStore).detail, /\(c\) no UI ledger snapshot, execute window or UI sim store snapshot/);
});

// W8-UIT3: the S1 finding (w8-s1-eu-2): the twin's intent d6423d02-..., the UI's f90a8e83-..., both CMMC-Win11-Baseline.
const intent = (id, extra = {}) => ({ id, displayName: 'CMMC-Win11-Baseline', templateId: '5ec0ba5e-0000-4000-8000-000000000001', isAssigned: true, lastModifiedDateTime: '2026-10-29T10:03:00.000Z', ...extra });
const withIntent = (twinIntent, uiIntent) => {
  const i = ok();
  i.twin.ledger.push(row('2026-10-29T10:03:00.000Z', 'mutate', 'deviceManagementIntents', twinIntent.id));
  i.twin.store.collections.deviceManagementIntents = { [twinIntent.id]: twinIntent };
  i.variants[0].ledger.push(row('2026-10-29T12:07:00.000Z', 'mutate', 'deviceManagementIntents', uiIntent.id));
  i.variants[0].store.collections.deviceManagementIntents = { [uiIntent.id]: uiIntent };
  return i;
};

test('V73 (c) W8-UIT3: the same object under a fresh server GUID is equal (natural key; id and timestamps dropped)', () => {
  const r = judgeV73(withIntent(intent('d6423d02-7f3f-438e-b42c-2cc2d5b43c18'), intent('f90a8e83-e50b-438b-b9ae-22e4c0a69098', { lastModifiedDateTime: '2026-10-29T12:07:00.000Z' })));
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /2 mutated objects \(2 ledger rows\) with the same end state/);
  const objs = v73MutatedObjects([row('2026-10-29T12:07:00.000Z', 'mutate', 'deviceManagementIntents', 'g2')], EU, simStore({ deviceManagementIntents: { g2: intent('g2') } }));
  assert.deepEqual(objs.map((o) => o.identity), ['deviceManagementIntents/CMMC-Win11-Baseline']);
});

test('V73 (c) W8-UIT3: a genuine difference still fails: an end-state field, another name, an object on one side only', () => {
  const field = withIntent(intent('g1'), intent('g2', { isAssigned: false }));
  field.variants[0].testerPass = false;
  assert.match(judgeV73(field).detail, /end state differs \[deviceManagementIntents\/CMMC-Win11-Baseline \(field isAssigned\)\]/);
  const named = withIntent(intent('g1'), intent('g2', { displayName: 'Other-Baseline' }));
  named.variants[0].testerPass = false;
  assert.match(judgeV73(named).detail, /UI only \[deviceManagementIntents\/Other-Baseline\], twin only \[deviceManagementIntents\/CMMC-Win11-Baseline\]/);
  const state = ok();
  state.variants[0].store.collections.users['u-leaver'] = leaver({ accountEnabled: true });
  state.variants[0].testerPass = false;
  assert.match(judgeV73(state).detail, /end state differs \[users\/Leaver One \(field accountEnabled\)\]/);
});

test('V73 (c) W8-UIT3: no natural key, or a shared one, keys by id; an object in neither store compares as absent; the rules match the tester', () => {
  const rows = [row('2026-10-29T10:01:00.000Z', 'mutate', 'groupMember', 'group-1|user-48'), row('2026-10-29T10:02:00.000Z', 'create', 'deviceConfigurations', 'dc-4'), row('2026-10-29T10:03:00.000Z', 'create', 'deviceConfigurations', 'dc-5'), row('2026-10-29T10:04:00.000Z', 'mutate', 'transportConfig', 'transportConfig')];
  const st = simStore({ deviceConfigurations: { 'dc-4': { id: 'dc-4', displayName: 'Same' }, 'dc-5': { id: 'dc-5', displayName: 'Same' } }, transportConfig: { transportConfig: { id: 'transportConfig', SmtpClientAuthenticationDisabled: true } } });
  assert.deepEqual(v73MutatedObjects(rows, E6, st).map((o) => [o.identity, o.state === null]), [['deviceConfigurations/dc-4', false], ['deviceConfigurations/dc-5', false], ['groupMember/group-1|user-48', true], ['transportConfig/transportConfig', false]]);
  assert.equal(v73EndState({ id: 'x', createdDateTime: 'a', nested: { WhenChangedUTC: 'b', keep: 1 } }), '{"nested":{"keep":1}}');
  assert.equal(v73MutatedObjects(rows, E6, null), null);
  const testerFile = path.join(HERE, '..', '..', '..', 'ces', 'ces-tester', 'src', 'flow', 'ui-e2e-compare.ts');
  if (!fs.existsSync(testerFile)) return;
  const tester = fs.readFileSync(testerFile, 'utf8');
  assert.ok(tester.includes(`export const NATURAL_KEY_FIELDS = [${V73_NATURAL_KEYS.map((k) => `'${k}'`).join(', ')}] as const;`), 'natural keys = the tester\'s');
  assert.ok(tester.includes(`export const VOLATILE_FIELD = ${V73_VOLATILE.toString()};`), 'volatile rule = the tester\'s');
});

test('V73: the tester record must agree with the recomputation', () => {
  const i = ok();
  i.variants[0].testerPass = false;
  const r = judgeV73(i);
  assert.equal(r.pass, false);
  assert.match(r.detail, /the tester's record says differs, verify recomputed equal/);
});

test('V73: no record, a stale record, a record for another slug, legacy not run, a UI error or a SPA not run for another reason fail', () => {
  assert.match(judgeV73({ ...ok(), record: null }).detail, /no out\/ui-e2e-stamper\.json \(step EU did not run\)/);
  assert.equal(judgeV73({ ...ok(), stale: 'stale artefact from an earlier run: ui-e2e-stamper.json' }).pass, false);
  assert.match(judgeV73({ ...ok(), record: { slug: 's2-eng' } }).detail, /is for s2-eng/);
  const notRun = ok();
  notRun.variants[0] = { ...spaNotBuilt, id: 'legacy', reason: 'ports in use: 3000' };
  const r = judgeV73(notRun);
  assert.equal(r.pass, false);
  assert.match(r.detail, /legacy console not run: ports in use: 3000/);
  const err = ok();
  err.variants[0] = legacy({ error: 'timed out after 180000ms waiting for #tenantSelect option', testerPass: false });
  assert.match(judgeV73(err).detail, /legacy: the UI run failed: timed out/);
  const spaOther = ok();
  spaOther.variants[1] = { ...spaNotBuilt, reason: 'no headless twin to compare against: missing out/ledger.json' };
  assert.match(judgeV73(spaOther).detail, /spa not run: no headless twin/);
  assert.match(judgeV73({ ...ok(), error: 'Cannot find module translateForTenant.js' }).detail, /V73 inputs failed to load/);
});

test('V73 x4 (FIN-35): every scenario gates; a missing record or a failed UI run is red on S2, S3 and mp too', () => {
  const r = judgeV73({ slug: 's3-def', record: null, variants: [] });
  assert.equal(r.pass, false);
  assert.match(r.detail, /no out\/ui-e2e-stamper\.json \(step EU did not run\)/);
  const withRec = judgeV73({ slug: 'muster-partial', record: { slug: 'muster-partial' }, variants: [legacy({ testerPass: false, error: 'x' })] });
  assert.equal(withRec.pass, false);
  assert.match(withRec.detail, /legacy: the UI run failed: x/);
  const s2 = judgeV73({ ...ok(), slug: 's2-eng', record: { slug: 's2-eng' } });
  assert.equal(s2.pass, true, s2.detail);
});

test('v73FailedSet: sorted unique task ids, ignoring rows without one', () => {
  assert.deepEqual(v73FailedSet({ failed_tasks: [{ task_id: 'b' }, { task_id: 'a' }, { task_id: 'b' }, { error: 'e' }] }), ['a', 'b']);
  assert.deepEqual(v73FailedSet(null), []);
});

test('verify.mjs V73 block: reads the record and each variant\'s files, Stamper dist projection, the twin\'s E6 window, judge wired', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  const start = src.indexOf('// ---------- W8-UIT1: V73');
  assert.ok(start > src.indexOf("check('V72'"), 'V73 block after V72');
  const block = src.slice(start, src.indexOf('const result = {', start));
  for (const needle of ["'ui-e2e-stamper.json'", "'dist', 'translators', 'translateForTenant.js'", 'projectExecutablePlan', 'v.files?.executable_plan', 'v.files?.execution_report', 'v.files?.ledger', 'v.files?.sim_store', 'record?.twin?.sim_store', 'v.execute_window', 'steps.E6?.started', 'staleOf(recFile)', "check('V73'", 'w4mod.judgeV73']) {
    assert.ok(block.includes(needle), `V73 block has ${needle}`);
  }
});

test('mx-e2e.ps1 step EU: port 3000 guarded, runs after E8F in both harnesses inside the V10 window, headed unless -UiHeadless, CRLF kept', () => {
  const raw = fs.readFileSync(path.join(HERE, 'mx-e2e.ps1'), 'utf8');
  assert.ok(!/(^|[^\r])\n/.test(raw), 'CRLF only');
  const src = raw.replace(/\r\n/g, '\n');
  assert.match(src, /\$Ports = @\(4390, 4011, 4002, 4001, 3000, 3001, 4173\)/);
  assert.match(src, /\[switch\]\$UiHeadless/);
  assert.match(src, /if \(\$UiHeadless\) \{ \$uargs \+= '--headless' \}/);
  assert.match(src, /'run-scenario', \$uiScenario, '--root', \$Root, '--package-root', \$Pkg/);
  assert.match(src, /Record 'EU' \$rc \$t/);
  assert.match(src, /ui-e2e-stamper\\\.json\|sim-store-e6\\\.json\|ui-e2e-\(ao\|eo\|muster\)\\\.json\|sim-store-e7a-pre\\\.json\|sim-store-e7b\\\.json\)\$'/);
  // FIN-35: step EU also runs the AO, EO and Muster console steps (EU-AO, EU-EO, EU-MU).
  assert.match(src, /function Invoke-ConsoleUiSteps \{/);
  assert.match(src, /Record \$s\.id \$rc \$t/);
  // R-UIT3-1: the E6-end sim store snapshot V73 (c) compares against.
  assert.match(src, /Copy-Item \$e6Store \(Join-Path \$OUT 'sim-store-e6\.json'\) -Force/);
  assert.match(src, /\$dirs = @\('plan', 'eo', 'st', 'disc', 'coverage-ao', 'ao', 'ui'\)/);
  // mx harness: EU in the finally, after the servers stop and before the 'after' outside snapshot (V10).
  const fin = src.lastIndexOf('} finally {');
  const stop = src.indexOf('Stop-Tree $simProc', fin);
  const eu = src.indexOf('if ($euReady) { try { Invoke-UiStep }', fin);
  const after = src.indexOf("Snapshot-Outside 'after'", fin);
  assert.ok(stop > fin && eu > stop && after > eu, 'mx: stop servers, then EU, then the after snapshot');
  assert.ok(src.indexOf("$euReady = Want 'E8F'") > src.indexOf("Record 'E8F' $rc $t $extra"), 'EU armed after E8F');
  // tester harness: EU after tester-run, with the tester's steps.json loaded first, before its finally.
  const tr = src.indexOf("Invoke-Logged 'tester-run'");
  const load = src.indexOf('$Steps = [ordered]@{}', tr);
  const teu = src.indexOf('try { Invoke-UiStep }', tr);
  const tfin = src.indexOf('} finally {', tr);
  assert.ok(tr > 0 && load > tr && teu > load && tfin > teu, 'tester: tester-run, load steps, EU, then the finally (Report-Ports, after snapshot)');
  assert.ok(!/[^\x00-\x7F]/.test(src.slice(src.indexOf('function Invoke-UiStep'), src.indexOf('}\n', src.indexOf("Record 'EU'")))), 'EU block is ASCII (PowerShell 5.1 reads the file without a BOM)');
});

// W8-ENC: V43b excuses pass-1 regressions on the scenario's expected_improvements (E7A fixes them, E7B snapshots them met,
// the next run's sim reset re-breaks them) and names them; any other regression still fails.
const v43bPass = (name, regs = [], extra = {}) => ({ name, events: [{ type: 'drift', regressions: regs.map((controlId) => ({ controlId })), empty: regs.length === 0, summary: {}, ...extra }] });
const v43b = (p1, p2 = [], p3 = [], expectedIds = ['PS.L2-3.9.2']) =>
  judgeV43b({ passes: [v43bPass('E7 pass 1', p1), v43bPass('E7 pass 2', p2), v43bPass('E7 pass 3', p3)], driftOf: (p) => p.events.find((e) => e.type === 'drift') ?? null, expectedIds });

test('V43b (W8-ENC): a pass-1 regression on an expected improvement is excused and reported', () => {
  const r = v43b(['PS.L2-3.9.2']);
  assert.equal(r.pass, true, r.detail);
  assert.match(r.detail, /excused on pass 1 .*PS.L2-3.9.2/);
});

test('V43b (W8-ENC): any other pass-1 regression still fails, and only it is named as a regression', () => {
  let r = v43b(['AC.L2-3.1.5']);
  assert.equal(r.pass, false);
  assert.match(r.detail, /E7 pass 1: regressions AC.L2-3.1.5/);
  r = v43b(['PS.L2-3.9.2', 'AC.L2-3.1.5']);
  assert.equal(r.pass, false);
  assert.match(r.detail, /E7 pass 1: regressions AC.L2-3.1.5(;|$)/);
  assert.doesNotMatch(r.detail, /regressions [^;]*PS.L2-3.9.2/);
  assert.match(r.detail, /excused on pass 1 .*PS.L2-3.9.2/);
});

test('V43b (W8-ENC): no excuse on passes 2 and 3, nor without expected_improvements', () => {
  assert.equal(v43b([], ['PS.L2-3.9.2']).pass, false);
  assert.equal(v43b([], [], ['PS.L2-3.9.2']).pass, false);
  const r = v43b(['PS.L2-3.9.2'], [], [], []);
  assert.equal(r.pass, false);
  assert.match(r.detail, /E7 pass 1: regressions PS.L2-3.9.2/);
  assert.equal(v43b([], [], [], []).pass, true);
});

test('V43b (W8-ENC): unchanged failure paths (no stream, no drift event, drift not empty, drift_error)', () => {
  const drift = (p) => p.events.find((e) => e.type === 'drift') ?? null;
  const ok = (n) => v43bPass(`E7 pass ${n}`);
  let r = judgeV43b({ passes: [{ name: 'E7 pass 1', events: null, stale: 'stale artefact' }, ok(2), ok(3)], driftOf: drift });
  assert.equal(r.pass, false); assert.match(r.detail, /E7 pass 1: stale artefact/);
  r = judgeV43b({ passes: [{ name: 'E7 pass 1', events: [] }, ok(2), ok(3)], driftOf: drift, notW3: 'pre-W3' });
  assert.equal(r.pass, false); assert.ok(r.detail.includes('E7 pass 1: no drift event (pre-W3)'), r.detail);
  r = judgeV43b({ passes: [ok(1), v43bPass('E7 pass 2', [], { empty: false }), ok(3)], driftOf: drift });
  assert.equal(r.pass, false); assert.match(r.detail, /E7 pass 2: drift not empty/);
  const p3 = ok(3); p3.events.push({ type: 'drift_error' });
  r = judgeV43b({ passes: [ok(1), ok(2), p3], driftOf: drift, expectedIds: ['PS.L2-3.9.2'] });
  assert.equal(r.pass, false); assert.match(r.detail, /E7 pass 3: drift_error/);
});

test('V43b (W8-ENC): verify.mjs calls the judge with adminops-e7a.json expected_improvements (the list V47 reads)', () => {
  const src = fs.readFileSync(path.join(HERE, 'verify.mjs'), 'utf8');
  const blk = src.slice(src.indexOf("check('V43b'"), src.indexOf("check('V44'"));
  assert.ok(blk.includes("'adminops-e7a.json'"), 'reads out/adminops-e7a.json');
  assert.ok(blk.includes('.expected_improvements'), 'reads expected_improvements');
  assert.ok(blk.includes('judgeV43b({'), 'calls judgeV43b');
});
