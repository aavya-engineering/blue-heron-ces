// DEPTH-0 tests (ces-strategy docs/context/depth/DEPTH-REPORT-AND-PLAN.md §4 row DEPTH-0).
//   node --test scripts/depth-coverage.test.mjs
// Reads the real S1 plan, objectives reference, registries and tenant-stacksim sources (read only); writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  DEFAULTS, VERDICTS, computeScenario, controlView, loadRegistries, loadResolverInfo, classifyCommand, run,
} from './depth-coverage.mjs';

const S1_PLAN = DEFAULTS.plans[0];
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const objectives = readJson(DEFAULTS.objectives).objectives;
const vdoc = readJson(DEFAULTS.verdicts);
const s1Plan = readJson(S1_PLAN);

// Part 1 totals (DEPTH-REPORT-AND-PLAN.md, "Objective verdict (320)") were 22 / 63 / 41 / 45 / 19 / 80 / 50 (floor 140).
// PH-12 (DEPTH-10.1..10.11 verdicts merged by P12-INT, LOG-PH12-INT.md item 2, plus its item 3 rows): 62 / 75 / 6 / 124 / 0 / 4 / 49.
// PH-13 (P13-INT, LOG-PH13-INT.md): the verdict tables of LOG-PH13-REG.md (AC.L2-3.1.6[b], CM.L2-3.4.1[d], CM.L2-3.4.9[c] ->
// partial; SI.L1-3.14.4[a] -> configured), LOG-PH13-LV.md (PS.L2-3.9.2[b] -> configured, AdminOps A-22 + the verify-only
// leaver read) and the founder's AU.L2-3.3.4 ruling (LOG-PH13-FX.md §3: [a], [b], [c] -> configured by the verified alert policy).
const PART1 = { configured: 67, partial: 77, read_only: 2, manual_or_document: 124, unrelated: 0, none: 1, definitional: 49 };
const FLOOR = 3; // AC.L2-3.1.18[c] (read_only, cannot tie), CM.L2-3.4.5[h] (read_only, simulator seed gap), IA.L2-3.5.7[d] (none)

// Per-family totals (configured/partial/read_only/manual/unrelated/none/definitional): the family reports' tables
// before PH-12, the DEPTH-10 batches' verdict tables after (LOG-PH12-R1..R5, LOG-PH12-INT).
const FAMILIES = {
  AC: [15, 25, 1, 9, 0, 0, 20], AT: [0, 0, 0, 4, 0, 0, 5], AU: [10, 7, 0, 6, 0, 0, 6], CM: [11, 7, 1, 9, 0, 0, 16],
  IA: [12, 5, 0, 5, 0, 1, 2], IR: [3, 1, 0, 10, 0, 0, 0], MA: [0, 3, 0, 7, 0, 0, 0], MP: [2, 3, 0, 10, 0, 0, 0],
  PE: [0, 0, 0, 16, 0, 0, 0], PS: [1, 1, 0, 2, 0, 0, 0], RA: [4, 1, 0, 4, 0, 0, 0], CA: [0, 0, 0, 14, 0, 0, 0],
  SC: [2, 20, 0, 19, 0, 0, 0], SI: [7, 4, 0, 9, 0, 0, 0],
};

const s1 = (registry = loadRegistries(DEFAULTS.registries)) => computeScenario({
  label: 's1', planPath: S1_PLAN, plan: s1Plan, objectives, registry, verdicts: vdoc.verdicts, baselineView: controlView(s1Plan),
});

test('verdict file covers exactly the 320 reference objectives, one known verdict each', () => {
  const ref = objectives.map((o) => o.objectiveId).sort();
  assert.equal(ref.length, 320);
  assert.deepEqual(Object.keys(vdoc.verdicts).sort(), ref);
  for (const [id, v] of Object.entries(vdoc.verdicts)) assert.ok(VERDICTS.includes(v.verdict), `${id}: ${v.verdict}`);
});

test('S1 reproduces the verdict-file totals 67 / 77 / 2 / 124 / 0 / 1 / 49 and the V91 floor 3 (10 after PH-12, 140 before)', () => {
  const r = s1();
  assert.equal(r.total_objectives, 320);
  assert.deepEqual(r.counts, { ...PART1, unrated: 0 });
  assert.equal(r.uncovered_floor, 1 + 0 + 2);
  assert.equal(r.uncovered_floor, FLOOR);
  assert.equal(r.differs_from_s1_controls.length, 0);
});

test('S1 reproduces every family report total', () => {
  const r = s1();
  for (const [fam, want] of Object.entries(FAMILIES)) {
    const got = VERDICTS.map((v) => r.objectives.filter((o) => o.objective_id.startsWith(`${fam}.`) && o.verdict === v).length);
    assert.deepEqual(got, want, fam);
  }
});

test('sub_commands follow control_ids, not over-tagging', () => {
  const r = s1();
  const subs = (id) => r.objectives.find((o) => o.objective_id === id).sub_commands;
  // AU.L2-3.3.1 ran three SETs (DEPTH-AC-AT-AU-CM-IA.md §1); with no objective_ids all three reach [c].
  const untagged = loadRegistries(DEFAULTS.registries).map(({ objective_ids, ...e }) => e);
  const subsUntagged = (id) => s1(untagged).objectives.find((o) => o.objective_id === id).sub_commands;
  assert.deepEqual(subsUntagged('AU.L2-3.3.1[c]').sort(), ['AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.audit-retention', 'AU.L2-3.3.1.org-customization']);
  // DEPTH-1a tags narrow them: audit-enable names [c], audit-retention names [f]; PH-12 (LOG-PH12-R1.md, "tag only")
  // tagged org-customization AU.L2-3.3.1[c] too, so [c] carries both and [f] still only the retention entry.
  assert.deepEqual(subs('AU.L2-3.3.1[c]').sort(), ['AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.org-customization']);
  assert.deepEqual(subs('AU.L2-3.3.1[f]'), ['AU.L2-3.3.1.audit-retention']);
  // AU.L2-3.3.4: no registry match, nothing ran.
  assert.deepEqual(subs('AU.L2-3.3.4[a]'), []);
  // SC.L2-3.13.16 is carried by 10 tasks; IA.L2-3.5.7.password-protection is not tagged to it.
  const sc = r.objectives.find((o) => o.objective_id === 'SC.L2-3.13.16[a]');
  assert.ok(sc.tasks.length >= 10);
  assert.ok(sc.sub_commands.includes('CM.L2-3.4.1.compliance-policy-windows'));
  assert.ok(!sc.sub_commands.includes('IA.L2-3.5.7.password-protection'));
  // Manual gates keep their pseudo-entry.
  assert.deepEqual(subs('PE.L1-3.10.1[a]'), ['manual-PE.L1-3.10.1']);
});

// Registries with the objective_ids field removed (another slice is adding it to the live files).
const withoutField = () => loadRegistries(DEFAULTS.registries).map(({ objective_ids, ...e }) => e);

test('works without objective_ids: no claims, control-level sub-commands, same totals', () => {
  const r = s1(withoutField());
  for (const o of r.objectives) assert.deepEqual(o.registry_claims, []);
  const row = r.objectives.find((o) => o.objective_id === 'AU.L2-3.3.1[e]');
  assert.equal(row.sub_commands.length, 3);
  assert.deepEqual(r.counts, { ...PART1, unrated: 0 });
});

test('works with the live registries, whatever objective_ids they carry today', () => {
  const r = s1();
  assert.deepEqual(r.counts, { ...PART1, unrated: 0 });
  assert.equal(r.uncovered_floor, FLOOR);
});

test('with objective_ids: sub_commands narrow to entries naming the objective, registry_claims list them', () => {
  const reg = withoutField().map((e) => {
    if (e.entry_id === 'AU.L2-3.3.1.audit-retention') return { ...e, objective_ids: ['AU.L2-3.3.1[c]'] };
    if (e.entry_id === 'AU.L2-3.3.1.audit-enable') return { ...e, objective_ids: ['AU.L2-3.3.1[c]', 'AU.L2-3.3.1[d]'] };
    return e;
  });
  const r = s1(reg);
  const row = (id) => r.objectives.find((o) => o.objective_id === id);
  assert.deepEqual(row('AU.L2-3.3.1[c]').sub_commands.sort(), ['AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.audit-retention', 'AU.L2-3.3.1.org-customization']);
  assert.deepEqual(row('AU.L2-3.3.1[d]').sub_commands.sort(), ['AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.org-customization']);
  assert.deepEqual(row('AU.L2-3.3.1[e]').sub_commands, ['AU.L2-3.3.1.org-customization']);
  assert.deepEqual(row('AU.L2-3.3.1[c]').registry_claims.sort(), ['AU.L2-3.3.1.audit-enable', 'AU.L2-3.3.1.audit-retention']);
  // Verdicts come from the reports, so the totals do not move.
  assert.deepEqual(r.counts, { ...PART1, unrated: 0 });
});

test('a changed control is flagged differs_from_s1 and keeps its S1 verdict', () => {
  const plan = structuredClone(s1Plan);
  const t = plan.execution_graph.find((x) => x.id.startsWith('prohibition-MP.L2-3.8.6'));
  t.action.args._sub_commands[0].set_command = 'New-MgDeviceManagementDeviceConfiguration -BodyParameter $b';
  const r = computeScenario({ label: 'fixture', planPath: 'fixture', plan, objectives, registry: [], verdicts: vdoc.verdicts, baselineView: controlView(s1Plan) });
  assert.deepEqual(r.differs_from_s1_controls.map((d) => d.control_id), ['MP.L2-3.8.6']);
  const row = r.objectives.find((o) => o.objective_id === 'MP.L2-3.8.6[a]');
  assert.equal(row.differs_from_s1, true);
  assert.equal(row.verdict, vdoc.verdicts['MP.L2-3.8.6[a]'].verdict);
});

test('simulator classification: modelled, generic and unanswered calls', () => {
  const info = loadResolverInfo(DEFAULTS.stacksim);
  const level = (cmd) => classifyCommand(cmd, info).map((c) => c.level);
  assert.deepEqual(level("Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.us/v1.0/identity/conditionalAccess/policies'"), ['modelled']);
  assert.deepEqual(level("Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.us/v1.0/deviceManagement/deviceConfigurations/{id}/assign'"), ['modelled']);
  assert.deepEqual(level('Get-NoSuchThingAnywhere | ConvertTo-Json'), ['unanswered']);
  assert.deepEqual(level('az network nsg list -o json'), ['modelled']);
  assert.deepEqual(level('az vm list -o json'), ['unanswered']);
  assert.deepEqual(level('# KQL: SigninLogs | take 1'), []);
});

test('full run: five plans, S1 floor 3 (10 after PH-12, 140 before), simulator_unanswered is a list of registry entries', () => {
  const r = run({});
  assert.equal(r.scenarios.length, DEFAULTS.plans.length);
  assert.equal(r.scenarios[0].uncovered_floor, FLOOR);
  assert.ok(Array.isArray(r.simulator_unanswered));
  for (const u of r.simulator_unanswered) {
    assert.ok(u.entry_id && u.calls.length > 0 && u.calls.every((c) => c.level === 'unanswered'));
  }
  assert.ok(r.simulator.registry_entries_checked > 0);
});
