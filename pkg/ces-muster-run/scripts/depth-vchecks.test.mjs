// VER-4: the depth checks V91-V99 (verify-depth.mjs). Fixture plans and registries, plus one read-only probe of the real
// R-F1 S1 plan (skipped when the evidence folder is absent). Fictional values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  judgeV91, judgeV92, judgeV93, judgeV94, judgeV95, judgeV96, judgeV97, judgeV98, judgeV99, v99BlocksRebaseline,
  runDepthChecks, quotingProblem, isCommentOrPlaceholder, stepControls, depthFloor, DEPTH_PREDICTION_SCHEMA, DEPTH_CHECKS,
} from './verify-depth.mjs';

const OBJ = {
  objectives: [
    { objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1', description: 'authorized users are identified' },
    { objectiveId: 'AC.L1-3.1.1[b]', controlId: 'AC.L1-3.1.1', description: 'access is enforced for authorized users' },
    { objectiveId: 'RA.L2-3.11.1[a]', controlId: 'RA.L2-3.11.1', description: 'the frequency to assess risk is defined' },
  ],
};
const REG = [
  { entry_id: 'AC.L1-3.1.1.ca', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.1[b]'], source: 'https://learn.microsoft.com/x', set_command: "New-Policy -Name 'x'", get_command: 'Get-Policy', manual_only: false },
  { entry_id: 'AC.L1-3.1.1.read', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.1[a]'], source: 'https://learn.microsoft.com/y', set_command: '', get_command: 'Get-User', manual_only: false },
  { entry_id: 'RA.L2-3.11.1.doc', control_ids: ['RA.L2-3.11.1'], objective_ids: ['RA.L2-3.11.1[a]'], source: 's', set_command: '', get_command: '', manual_only: true, engine: 'manual_gate' },
  { entry_id: 'AZ-LOG-001', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.1[b]'], source: 's', set_command: 'New-AzThing', get_command: 'Get-AzThing', manual_only: false, azure_tier: 'sentinel' },
  { entry_id: 'AZ-VM-001', control_ids: ['AC.L1-3.1.1'], objective_ids: ['AC.L1-3.1.1[b]'], source: 's', set_command: 'New-AzVM', get_command: 'Get-AzVM', manual_only: false, azure_tier: 'full' },
];
const sub = (id) => ({ ...REG.find((e) => e.entry_id === id), id });
const task = (id, directive, controls, subs, extra = {}) => ({ id, controls, action: { command: 'summary', args: { _directive: directive, _step_title: `Step (${controls[0]})`, _sub_commands: subs } }, ...extra });
const plan = (over = {}) => ({
  plan_id: 'p1',
  execution_graph: [
    task('step_task_AC.L1-3.1.1_a', 'implement', ['AC.L1-3.1.1'], [sub('AC.L1-3.1.1.ca'), sub('AC.L1-3.1.1.read')]),
    task('manual-RA.L2-3.11.1', 'manual', ['RA.L2-3.11.1'], [{ id: 'manual-RA.L2-3.11.1', engine: 'manual_gate' }]),
  ],
  postchecks: [],
  ...over,
});
const coverage = () => [
  { objective_id: 'AC.L1-3.1.1[a]', type: 'uncovered', reason: 'read only today' },
  { objective_id: 'AC.L1-3.1.1[b]', type: 'configure', entry_ids: ['AC.L1-3.1.1.ca'] },
  { objective_id: 'RA.L2-3.11.1[a]', type: 'document' },
];

test('helpers: comment/placeholder, quoting lint, step controls', () => {
  assert.equal(isCommentOrPlaceholder('# todo'), true);
  assert.equal(isCommentOrPlaceholder("'...'"), true);
  assert.equal(isCommentOrPlaceholder('Set-X -A 1'), false);
  assert.equal(quotingProblem("Set-X -Name 'a''b'"), null);
  assert.equal(quotingProblem("Set-X -Name 'a"), 'unbalanced single quote');
  assert.equal(quotingProblem('Set-X -Name "a'), 'unbalanced double quote');
  assert.deepEqual(stepControls(task('step_task_AC.L1-3.1.1_a', 'implement', ['AC.L1-3.1.1'], [])), ['AC.L1-3.1.1']);
  assert.equal(DEPTH_CHECKS.length, 9);
});

test('V91: not landed without objective_coverage[]; warn mode with a floor; each failure clause; fail mode', () => {
  const nl = judgeV91({ plan: plan(), objectivesRef: OBJ, registries: REG, floor: 140 });
  assert.equal(nl.pass, false);
  assert.match(nl.detail, /^not landed: DEPTH-6 \(the executable plan has no objective_coverage\[\]\); measured today: 3 in-scope objectives, floor 140/);
  const ok = judgeV91({ plan: plan({ objective_coverage: coverage() }), objectivesRef: OBJ, registries: REG, floor: 1 });
  assert.equal(ok.pass, true, ok.detail);
  assert.match(ok.detail, /uncovered 1 <= floor 1/);
  assert.match(judgeV91({ plan: plan({ objective_coverage: coverage() }), objectivesRef: OBJ, registries: REG, floor: 0 }).detail, /1 uncovered objective\(s\) > floor 0/);
  const bad = coverage();
  bad[1] = { objective_id: 'AC.L1-3.1.1[b]', type: 'configure', entry_ids: ['AC.L1-3.1.1.read'] };
  bad.push({ objective_id: 'AC.L1-3.1.1[b]', type: 'manual' }, { objective_id: 'ZZ[a]', type: 'manual' });
  bad[2] = { objective_id: 'RA.L2-3.11.1[a]', type: 'inherited' };
  const r = judgeV91({ plan: plan({ objective_coverage: bad }), objectivesRef: OBJ, registries: REG, floor: 5 });
  assert.equal(r.pass, false);
  assert.match(r.detail, /more than one record: AC\.L1-3\.1\.1\[b\]/);
  assert.match(r.detail, /unknown objectives: ZZ\[a\]/);
  assert.match(r.detail, /configure record\(s\) without a configuring entry/);
  assert.match(r.detail, /without a basis: RA\.L2-3\.11\.1\[a\]/);
  assert.match(judgeV91({ plan: plan({ objective_coverage: [{ objective_id: 'AC.L1-3.1.1[a]', type: 'maybe' }] }), objectivesRef: OBJ, registries: REG, floor: 5 }).detail, /no named type/);
  assert.match(judgeV91({ plan: plan({ objective_coverage: coverage() }), objectivesRef: OBJ, registries: REG, mode: 'fail' }).detail, /fail mode: 1 uncovered/);
  assert.match(judgeV91({ plan: plan({ objective_coverage: coverage() }), objectivesRef: OBJ, registries: REG, floor: null }).detail, /no floor/);
});

test('V92: read-only implement, comment / placeholder command, report-only enforce credit', () => {
  assert.equal(judgeV92({ plan: plan(), objectivesRef: OBJ }).pass, true);
  const ro = plan();
  ro.execution_graph[0].action.args._sub_commands = [sub('AC.L1-3.1.1.read')];
  assert.match(judgeV92({ plan: ro, objectivesRef: OBJ }).detail, /1 implement-directive task\(s\) whose sub-commands are all reads/);
  const cm = plan();
  cm.execution_graph[0].action.command = '# configure later';
  assert.match(judgeV92({ plan: cm, objectivesRef: OBJ }).detail, /comment or placeholder: step_task_AC\.L1-3\.1\.1_a \(action\.command\)/);
  const rep = plan();
  rep.execution_graph[0].action.args._sub_commands[0] = { ...sub('AC.L1-3.1.1.ca'), set_command: "New-Ca -State 'enabledForReportingButNotEnforced'" };
  assert.match(judgeV92({ plan: rep, objectivesRef: OBJ }).detail, /report-only CA write\(s\) credited to an "enforce" objective: AC\.L1-3\.1\.1\.ca -> AC\.L1-3\.1\.1\[b\]/);
});

test('V93: not landed without credits[]; over-tagging, bad credit, entry twice', () => {
  const nl = judgeV93({ plan: plan(), objectivesRef: OBJ });
  assert.match(nl.detail, /^not landed: DEPTH-3 \(no task carries credits\[\]\); measured today: 0 over-tagged/);
  const p = plan();
  p.execution_graph[0].credits = [{ objective_id: 'AC.L1-3.1.1[b]' }];
  assert.equal(judgeV93({ plan: p, objectivesRef: OBJ }).pass, true);
  p.execution_graph[0].controls.push('RA.L2-3.11.1');
  p.execution_graph[0].credits.push({ objective_id: 'NOPE' });
  p.execution_graph[1].action.args._sub_commands.push(sub('AC.L1-3.1.1.ca'));
  const r = judgeV93({ plan: p, objectivesRef: OBJ });
  assert.match(r.detail, /controls\[\] exceed the step's controls: step_task_AC\.L1-3\.1\.1_a \(\+RA\.L2-3\.11\.1\)/);
  assert.match(r.detail, /without an existing objective id: step_task_AC\.L1-3\.1\.1_a:NOPE/);
  assert.match(r.detail, /executed more than once in one run: AC\.L1-3\.1\.1\.ca x2/);
});

test('V94: not landed without objective-keyed postchecks; then each clause', () => {
  const boiler = [{ id: 'p0', description: '[Postcheck] AC.L1-3.1.1: Examine documentation and configuration exports for AC.L1-3.1.1', control_id: 'AC.L1-3.1.1' }];
  assert.match(judgeV94({ plan: plan({ postchecks: boiler }), objectivesRef: OBJ }).detail, /^not landed: DEPTH-7 .*1 boilerplate/);
  const good = [
    { id: 'a', objective_id: 'AC.L1-3.1.1[a]', control_id: 'AC.L1-3.1.1' },
    { id: 'b', objective_id: 'AC.L1-3.1.1[b]', control_id: 'AC.L1-3.1.1', expected_value: { path: '$.state', op: 'eq', value: 'enabled' } },
    { id: 'c', objective_id: 'RA.L2-3.11.1[a]', control_id: 'RA.L2-3.11.1' },
  ];
  const ok = judgeV94({ plan: plan({ postchecks: good, objective_coverage: coverage() }), objectivesRef: OBJ });
  assert.equal(ok.pass, true, ok.detail);
  const bad = [...good.slice(0, 1), { ...good[1], expected_value: undefined }, good[1], ...boiler, { id: 'x', objective_id: 'ZZ[a]', control_id: 'ZZ.L9-9.9.9' }];
  const r = judgeV94({ plan: plan({ postchecks: bad, objective_coverage: coverage() }), objectivesRef: OBJ });
  assert.match(r.detail, /keyed to an unknown objective: ZZ\[a\]/);
  assert.match(r.detail, /with no postcheck: RA\.L2-3\.11\.1\[a\]/);
  assert.match(r.detail, /more than one postcheck: AC\.L1-3\.1\.1\[b\] x2/);
  assert.match(r.detail, /1 boilerplate postcheck row/);
  assert.match(r.detail, /outside the 110 practices: ZZ\.L9-9\.9\.9/);
  const noEv = judgeV94({ plan: plan({ postchecks: [good[0], { ...good[1], expected_value: undefined }, good[2]], objective_coverage: coverage() }), objectivesRef: OBJ });
  assert.match(noEv.detail, /configure objective\(s\) whose postcheck has no expected_value: AC\.L1-3\.1\.1\[b\]/);
});

test('V95: enclave filter, m365_only, no AZ entries, CLI != GUI', () => {
  const withAz = plan();
  withAz.execution_graph[0].action.args._sub_commands.push(sub('AZ-LOG-001'));
  assert.equal(judgeV95({ plan: withAz, im: { infrastructure_model: 'm365_sentinel' }, registries: REG }).pass, true);
  assert.match(judgeV95({ plan: plan(), im: { infrastructure_model: 'm365_azure' }, registries: REG }).detail, /holds no AZ-\* entry .*DEPTH-2/);
  assert.match(judgeV95({ plan: withAz, im: { infrastructure_model: 'm365_only' }, registries: REG }).detail, /m365_only plan holds 1 AZ-\*/);
  withAz.execution_graph[0].action.args._sub_commands.push(sub('AZ-VM-001'));
  assert.match(judgeV95({ plan: withAz, im: { infrastructure_model: 'm365_sentinel' }, registries: REG }).detail, /outside the m365_sentinel enclave filter: AZ-VM-001/);
  assert.match(judgeV95({ plan: plan(), im: { infrastructure_model: 'm365_only' }, registries: REG, v72: { cli: { a: 1 }, gui: { a: 2 } } }).detail, /CLI and GUI plan projections differ/);
  assert.match(judgeV95({ plan: plan(), im: null, registries: REG }).detail, /no infrastructure_model/);
});

test('V96: manual tasks keep entries, no manual-only SAT, no platform_inherited on RA/CA', () => {
  const reg = [...REG, { entry_id: 'RA.L2-3.11.1.scan', control_ids: ['RA.L2-3.11.1'], objective_ids: ['RA.L2-3.11.1[a]'], source: 's', set_command: 'Start-Scan', manual_only: false }];
  assert.match(judgeV96({ plan: plan(), registries: reg }).detail, /dropped their non-manual-only entries: RA\.L2-3\.11\.1 \(1: RA\.L2-3\.11\.1\.scan\)/);
  assert.equal(judgeV96({ plan: plan(), registries: REG, results: { results: [] } }).pass, true);
  const sat = { results: [{ controlId: 'RA.L2-3.11.1', directive: 'manual', verdict: 'sat', entries: [{ entry_id: 'RA.L2-3.11.1.doc', verdict: 'sat' }] }] };
  assert.match(judgeV96({ plan: plan(), registries: REG, results: sat }).detail, /2 manual-only path\(s\) yield SAT/);
  const inh = { results: [{ controlId: 'CA.L2-3.12.2', directive: 'automated', verdict: 'platform_inherited' }] };
  assert.match(judgeV96({ plan: plan(), registries: REG, results: inh }).detail, /platform_inherited claimed on CA\.L2-3\.12\.2/);
});

test('V97: no manifest; not landed; each clause', () => {
  assert.match(judgeV97({ results: null }).detail, /no Stamper results manifest/);
  assert.match(judgeV97({ results: { results: [{ controlId: 'AC.L1-3.1.1', verdict: 'sat' }] } }).detail, /^not landed: DEPTH-8/);
  const good = { executablePlanId: 'p1', results: [{ controlId: 'AC.L1-3.1.1', objectives: [{ objective_id: 'AC.L1-3.1.1[b]', verdict: 'sat', postchecks: [{ check_id: 'c1', mode: 'state', expected_value: { path: '$.s', op: 'eq', value: 1 }, observed_value: 1, read_control_id: 'AC.L1-3.1.1' }] }] }] };
  assert.equal(judgeV97({ results: good, plan: { plan_id: 'p1' } }).pass, true);
  const bad = { executablePlanId: 'p0', results: [{ controlId: 'AC.L1-3.1.1', objectives: [
    { objective_id: 'AC.L1-3.1.1[a]', postchecks: [{ check_id: 'c2', mode: 'presence', evidence_control_ids: ['AC.L1-3.1.1', 'AU.L2-3.3.1'] }] },
    { objective_id: 'AC.L1-3.1.1[b]', verdict: 'not_sat', postchecks: [{ check_id: 'c1', mode: 'state', expected_value: { path: '$.s', op: 'eq', value: 1 }, read_control_id: 'IA.L2-3.5.3' }] },
  ] }] };
  const r = judgeV97({ results: bad, plan: { plan_id: 'p1' } });
  assert.match(r.detail, /manifest is for p0, the plan is p1/);
  assert.match(r.detail, /without a verdict: AC\.L1-3\.1\.1\[a\]/);
  assert.match(r.detail, /no observed value: AC\.L1-3\.1\.1\[b\]:c1/);
  assert.match(r.detail, /read another control's state/);
  assert.match(r.detail, /presence check\(s\) using other controls' evidence/);
});

test('V98: objective ids, source, quoting, simulator answers', () => {
  const ok = judgeV98({ plan: plan(), registries: REG, objectivesRef: OBJ, ledger: [{ type: 'read-serve' }] });
  assert.equal(ok.pass, true, ok.detail);
  const reg = REG.map((e) => (e.entry_id === 'AC.L1-3.1.1.ca' ? { ...e, objective_ids: ['RA.L2-3.11.1[a]'], source: '', set_command: "New-Policy -Name 'x" } : e.entry_id === 'AC.L1-3.1.1.read' ? { ...e, objective_ids: [] } : e));
  const p = plan();
  p.execution_graph[0].action.args._sub_commands.push({ id: 'GHOST.entry', set_command: 'x' });
  const r = judgeV98({ plan: p, registries: reg, objectivesRef: OBJ, ledger: [{ type: 'unresolved' }], simulatorUnanswered: [{ entry_id: 'AC.L1-3.1.1.read' }] });
  assert.match(r.detail, /not in either registry: GHOST\.entry/);
  assert.match(r.detail, /without objective_ids: AC\.L1-3\.1\.1\.read/);
  assert.match(r.detail, /do not resolve to the entry's controls: AC\.L1-3\.1\.1\.ca:RA\.L2-3\.11\.1\[a\]/);
  assert.match(r.detail, /without a source: AC\.L1-3\.1\.1\.ca/);
  assert.match(r.detail, /quoting lint finding\(s\): AC\.L1-3\.1\.1\.ca\.set_command \(unbalanced single quote\)/);
  assert.match(r.detail, /1 simulator ledger row\(s\) marked unanswered/);
  assert.match(r.detail, /simulator cannot answer .*AC\.L1-3\.1\.1\.read/);
});

test('V99: no slice declared, prediction missing, match, mismatch; v99BlocksRebaseline', () => {
  const none = judgeV99({ prediction: null, observed: { sprs: 80 }, scoringSlices: [] });
  assert.equal(none.pass, true);
  assert.equal(v99BlocksRebaseline(none), false);
  const miss = judgeV99({ prediction: null, observed: { sprs: 80 }, scoringSlices: ['DEPTH-4'] });
  assert.match(miss.detail, /^not landed: DEPTH-12 prediction missing/);
  assert.equal(v99BlocksRebaseline(miss), true);
  const pred = { schema: DEPTH_PREDICTION_SCHEMA, scenario: 's1-mach', slices: ['DEPTH-4'], predicted: { sprs: 78, statuses: { 'RA.L2-3.11.1': 'not_assessed' } } };
  const match = judgeV99({ prediction: pred, observed: { sprs: 78, statuses: { 'RA.L2-3.11.1': 'not_assessed' } }, scoringSlices: ['DEPTH-4'], slug: 's1-mach' });
  assert.equal(match.pass, true, match.detail);
  assert.equal(v99BlocksRebaseline(match), false);
  const mm = judgeV99({ prediction: pred, observed: { sprs: 80, statuses: { 'RA.L2-3.11.1': 'met' } }, scoringSlices: ['DEPTH-4', 'DEPTH-8'], slug: 's2-eng' });
  assert.equal(mm.pass, false);
  assert.match(mm.detail, /prediction is for s1-mach, not s2-eng/);
  assert.match(mm.detail, /does not cover declared slice\(s\) DEPTH-8/);
  assert.match(mm.detail, /SPRS predicted 78, observed 80/);
  assert.match(mm.detail, /RA\.L2-3\.11\.1 not_assessed != met/);
  assert.match(mm.detail, /awaiting founder acceptance, do not re-baseline$/);
  assert.equal(v99BlocksRebaseline(mm), true);
  assert.equal(v99BlocksRebaseline(null), true);
});

test('runDepthChecks: nine rows, floor from depth-coverage.json lowered by depth-floor.json, a throwing judge is a red row', async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'depth-v-'));
  fs.mkdirSync(path.join(pkg, 'out'));
  fs.writeFileSync(path.join(pkg, 'out', 'depth-coverage.json'), JSON.stringify({ scenarios: [{ label: 's1-mach', uncovered_floor: 140 }], simulator_unanswered: [] }));
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const vctx = { out: path.join(pkg, 'run-out'), pkg, slug: 's1-mach', tenantPlanData: path.join(pkg, 'pd'), readJson, exists: fs.existsSync, summary: { eo_assess: { sprs_score: 80 }, status_by_control: {} }, objectivesRef: OBJ, exePlan: plan(), registries: REG, im: { infrastructure_model: 'm365_only' }, report: null, ledger: [], v72: null };
  assert.deepEqual(depthFloor(vctx), { floor: 140, source: 'out/depth-coverage.json', simulatorUnanswered: [] });
  fs.writeFileSync(path.join(pkg, 'depth-floor.json'), JSON.stringify({ 's1-mach': 120 }));
  assert.equal(depthFloor(vctx).floor, 120);
  const rows = await runDepthChecks(vctx, {});
  assert.deepEqual(rows.map((r) => r.id), ['V91', 'V92', 'V93', 'V94', 'V95', 'V96', 'V97', 'V98', 'V99']);
  assert.match(rows[0].detail, /floor 120/);
  assert.equal(rows[8].pass, true);
  const broken = await runDepthChecks({ ...vctx, exePlan: { execution_graph: [null] } }, {});
  assert.ok(broken.some((r) => /^error: /.test(r.detail)));
  fs.rmSync(pkg, { recursive: true, force: true });
});

const RF1 = 'C:\\ces-nb\\evidence\\gc-rf1-s1-mach';
const WT = 'C:\\ces-nb\\wt\\ces';
test('real R-F1 S1 plan: every judge runs without throwing (counts recorded)', { skip: !fs.existsSync(path.join(RF1, 'executable-plan.json')) }, async () => {
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
  const regDir = path.join(WT, 'ces-stamper', 'src', 'registry');
  const registries = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].flatMap((f) => {
    const r = readJson(path.join(regDir, f));
    return (Array.isArray(r) ? r : r.entries).map((e) => ({ ...e, _registry: f }));
  });
  const vctx = {
    out: path.join(RF1, 'no-out'), pkg: 'C:\\ces-nb\\pkg\\ces-muster-run', slug: 's1-mach', tenantPlanData: path.join(RF1, 'no-pd'), readJson, exists: fs.existsSync,
    summary: readJson(path.join(RF1, 'summary.json')), objectivesRef: readJson(path.join(WT, 'ces-shared', 'src', 'data', 'assessment-objectives.reference.json')),
    exePlan: readJson(path.join(RF1, 'executable-plan.json')), registries, im: { infrastructure_model: 'm365_azure' }, report: readJson(path.join(RF1, 'execution-report.json')), ledger: null, v72: null,
  };
  const rows = await runDepthChecks(vctx, {});
  assert.equal(rows.length, 9);
  for (const r of rows) {
    assert.ok(!/^error: /.test(r.detail), `${r.id}: ${r.detail}`);
    console.log(`${r.id} ${r.pass ? 'PASS' : 'FAIL'} ${r.detail.slice(0, 600)}`);
  }
});
