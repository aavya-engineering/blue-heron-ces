// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * DEPTH-3 (credit by objective, V93), DEPTH-5 (no read-only "implement", V92), DEPTH-4 (manual paths keep
 * actions, no platform inheritance on RA/CA, V96) and DEPTH-6 (objective coverage, warn mode, V91), on a
 * synthetic directive-mode Mission Plan translated with the real registry (depth plan §4).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { ManifestReader } from '../../src/translators/ManifestReader';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { loadObjectives, controlOfObjective, refuseImplementWithoutConfiguration } from '../../src/translators/objectiveCredit';
import { PLATFORM_INHERITED_BASIS } from '../../src/server/routes/assess.routes.js';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');
const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
const byId = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const subsOf = (t: ExeTask) => (t.action.args._sub_commands ?? []) as SubCommand[];

// PH-12 merge: + MA.L2-3.7.4, which still has only a read (MA.L2-3.7.4.media-check); AC.L2-3.1.8 gained SETs in DEPTH-10.3 (P12-R2).
const IMPLEMENT = ['MP.L2-3.8.1', 'MP.L2-3.8.2', 'MA.L2-3.7.1', 'MA.L2-3.7.2', 'AC.L2-3.1.8', 'AU.L2-3.3.4', 'MA.L2-3.7.5', 'CM.L2-3.4.1', 'IA.L2-3.5.7', 'MA.L2-3.7.4'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-depth3456-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function translate() {
  const mp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-mission-plan.json'), 'utf-8'));
  const hp = mp.outputs.human_readable_mission_plan;
  const base = hp.steps.find((s: any) => s.task_type === 'configuration') ?? hp.steps[0];
  const step = (control: string) => ({
    ...clone(base), id: `step_task_${control}_d3`, title: `Step (${control})`, task_type: 'configuration',
    control_coverage: [{ control_id: control, support_type: 'Configurable', gap_rationale: 'gap' }], depends_on: [], dependencies: [],
  });
  hp.steps = IMPLEMENT.map(step);
  hp.control_directives = [
    ...IMPLEMENT.map(c => ({ control_id: c, directive: 'implement', step_ids: [`task_${c}_d3`] })),
    { control_id: 'MP.L2-3.8.7', directive: 'manual' },
    { control_id: 'RA.L2-3.11.1', directive: 'inherit-fedramp', justification: 'claimed by the CSP' },
    { control_id: 'MP.L2-3.8.6', directive: 'document-prohibition' },
  ];
  const tm = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'synthetic-tenant-manifest.json'), 'utf-8'));
  (tm.tenant_manifest ?? tm).normative_controls.push({
    control_id: 'MP.L2-3.8.6', required_state: 'Portable media encrypted',
    verification: [{ id: 'chk_obj_MP.L2-3.8.6_a', description: 'Examine the BitLocker policy', method: 'config_export', expected: 'BitLocker enforced', on_fail: 'flag', objective_id: 'MP.L2-3.8.6[a]', assessment_methods: ['examine', 'test'] }],
    evidence_artifacts: [],
  });
  const tmPath = path.join(tmp, 'tm.json');
  fs.writeFileSync(tmPath, JSON.stringify(tm));
  return new PlanTranslator(registry).translate(mp, ManifestReader.fromFile(tmPath));
}

const result = translate();
const plan = result.plan;
const graph = plan.execution_graph;
const taskFor = (c: string) => graph.find(t => t.controls.includes(c));

describe('DEPTH-3: credit by objective (V93)', () => {
  it('every task holds only its step controls', () => {
    for (const t of graph) expect(t.controls).toHaveLength(1);
    expect(taskFor('MP.L2-3.8.1')!.controls).toEqual(['MP.L2-3.8.1']);
  });

  it('an entry runs once, in its primary control task, and credits other controls by objective', () => {
    const holders = graph.filter(t => subsOf(t).some(s => s.id === 'MP.L2-3.8.1.cui-label'));
    expect(holders.map(t => t.controls[0])).toEqual(['MP.L2-3.8.1']);
    const credits = holders[0].credits ?? [];
    expect(credits).toEqual(expect.arrayContaining([{ objective_id: 'MP.L2-3.8.2[a]', entry_id: 'MP.L2-3.8.1.cui-label' }]));
    for (const c of credits) expect(holders[0].controls).not.toContain(controlOfObjective(c.objective_id));
    const ids = graph.flatMap(t => subsOf(t).map(s => s.id)).filter(id => registry.allEntries.some(e => e.entry_id === id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a task left with no sub-command is not planned; a credited control gets no gap-fill task, an uncredited one does', () => {
    expect(graph.some(t => t.id === 'step_task_MP.L2-3.8.2_d3')).toBe(false);
    expect(taskFor('MP.L2-3.8.2')).toBeUndefined();
    expect(result.warnings.some(w => w.startsWith('CREDIT_BY_OBJECTIVE: task step_task_MP.L2-3.8.2_d3'))).toBe(true);
    // update-ring names only MA.L2-3.7.1[a]: MA.L2-3.7.2 is not credited, so it is a gap-fill gate.
    expect(graph.some(t => t.id === 'step_task_MA.L2-3.7.2_d3')).toBe(false);
    expect(taskFor('MA.L2-3.7.2')!.action.engine).toBe('manual_gate');
  });

  it('a shared Windows compliance policy runs once and credits the other controls it names', () => {
    const holders = graph.filter(t => subsOf(t).some(s => s.id === 'CM.L2-3.4.1.compliance-policy-windows'));
    expect(holders).toHaveLength(1);
    expect(holders[0].controls).toEqual(['CM.L2-3.4.1']);
    expect((holders[0].credits ?? []).some(c => c.objective_id === 'IA.L2-3.5.7[a]')).toBe(true);
  });
});

describe('DEPTH-5: no implement task without a configuring sub-command (V92)', () => {
  it('every implement task has a SET; its command summarises the sub-commands and is never a comment', () => {
    const implement = graph.filter(t => t.action.args._directive === 'implement');
    expect(implement.length).toBeGreaterThan(0);
    for (const t of implement) {
      expect(subsOf(t).some(s => s.set_command.trim() !== '')).toBe(true);
      expect(t.action.command.trim().startsWith('#')).toBe(false);
      expect(t.action.command.startsWith(`${subsOf(t)[0].id}: `)).toBe(true);
    }
  });

  it('a read-only implement task is planned as validate, with the reason', () => {
    // PH-12 merge: AC.L2-3.1.8 now has SETs (DEPTH-10.3, P12-R2); MA.L2-3.7.4 is a control that still has only a read.
    const t = taskFor('MA.L2-3.7.4')!;
    expect(t.action.args._directive).toBe('validate');
    expect(t.type).toBe('validate');
    expect(String(t.action.args._implement_refused)).toContain('MA.L2-3.7.4.media-check');
    expect(result.warnings.some(w => w.startsWith('IMPLEMENT_REFUSED: task step_task_MA.L2-3.7.4_d3'))).toBe(true);
  });

  it('AC.L2-3.1.8 is now planned as implement with its configuring entries (DEPTH-10.3)', () => {
    const t = taskFor('AC.L2-3.1.8')!;
    expect(t.action.args._directive).toBe('implement');
    expect(subsOf(t).map(s => s.id)).toEqual(expect.arrayContaining(['AC.L2-3.1.8.smart-lockout', 'AC.L2-3.1.8.password-rule-settings']));
    expect(t.action.args._implement_refused).toBeUndefined();
  });

  // DEPTH-10.1 (P12-R1): AU.L2-3.3.4 was the last control with no main-registry entry; it now plans its alert policy.
  it('AU.L2-3.3.4 is now planned as implement with its configuring entry', () => {
    const t = taskFor('AU.L2-3.3.4')!;
    expect(t.action.args._directive).toBe('implement');
    expect(subsOf(t).map(s => s.id)).toContain('AU.L2-3.3.4.audit-config-alert');
    expect(result.warnings.some(w => w.startsWith('IMPLEMENT_REFUSED: task step_task_AU.L2-3.3.4_d3'))).toBe(false);
  });

  it('an implement task with no registry entry is not planned (it ran its prose or comment command before)', () => {
    // PH-12 merge: every control now has a main-registry entry, so the refusal is tested on a synthetic task.
    const warnings: string[] = [];
    const t = { id: 'step_task_X_d3', type: 'policy', controls: ['AU.L2-3.3.4'], action: { engine: 'mgraph', command: '# KQL: ...', args: { _directive: 'implement', _sub_commands: [] } } };
    expect(refuseImplementWithoutConfiguration([t] as never, new Map(), warnings)).toEqual([]);
    expect(warnings.some(w => w.startsWith('IMPLEMENT_REFUSED: task step_task_X_d3'))).toBe(true);
  });
});

describe('DEPTH-4: manual paths keep actions; no platform inheritance on RA/CA (V96)', () => {
  it('a manual gate keeps its own non-manual-only entries after the gate', () => {
    const gate = graph.find(t => t.id === 'manual-MP.L2-3.8.7')!;
    expect(gate.action.engine).toBe('manual_gate');
    const ids = subsOf(gate).map(s => s.id);
    expect(ids[0]).toBe('manual-MP.L2-3.8.7');
    const want = registry.allEntries.filter(e => e.control_ids[0] === 'MP.L2-3.8.7' && !e.manual_only).map(e => e.entry_id);
    expect(want.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(want));
    expect(ids.some(id => byId(id)?.manual_only)).toBe(false);
  });

  it('inherit-fedramp on RA.L2-3.11.1 is planned as a manual gate, never inherited', () => {
    const t = taskFor('RA.L2-3.11.1')!;
    expect(t.action.args._directive).toBe('manual');
    expect(graph.some(x => x.action.args._directive === 'inherit-fedramp' && x.controls.includes('RA.L2-3.11.1'))).toBe(false);
    expect(JSON.stringify(plan)).not.toMatch(/platform_inherited/);
  });

  it('the MP.L2-3.8.6 prohibition plans the BitLocker SET', () => {
    const t = taskFor('MP.L2-3.8.6')!;
    expect(t.action.args._directive).toBe('document-prohibition');
    const sub = subsOf(t).find(s => s.id === 'MP.L2-3.8.6.bitlocker')!;
    expect(sub.set_command).toBe(byId('MP.L2-3.8.6.bitlocker').set_command);
    expect(sub.idempotency).toBe(byId('MP.L2-3.8.6.bitlocker').idempotency);
  });

  it('a task holding a manual-only entry is a manual gate', () => {
    for (const t of graph) if (subsOf(t).some(s => s.manual_only)) expect(t.action.engine).toBe('manual_gate');
  });

  it('the GUI assess route claims no platform inheritance for RA or CA', () => {
    expect(PLATFORM_INHERITED_BASIS.map(([c]) => c).filter(c => /^(RA|CA)\./.test(c))).toEqual([]);
  });
});

describe('DEPTH-6: objective coverage, warn mode (V91)', () => {
  const cov = plan.objective_coverage ?? [];
  const objectives = loadObjectives();

  it('exactly one record of a named type per assessment objective', () => {
    expect(cov).toHaveLength(objectives.length);
    expect(new Set(cov.map(r => r.objective_id)).size).toBe(objectives.length);
    for (const r of cov) expect(['configure', 'document', 'manual', 'inherited', 'not_applicable', 'uncovered']).toContain(r.type);
  });

  it('configure names a planned SET entry that names the objective', () => {
    const planned = new Map(graph.flatMap(t => subsOf(t)).map(s => [s.id, s]));
    const configure = cov.filter(r => r.type === 'configure');
    expect(configure.length).toBeGreaterThan(0);
    for (const r of configure) {
      expect((r.entry_ids ?? []).some(id => planned.get(id)?.set_command.trim() && (byId(id).objective_ids ?? []).includes(r.objective_id) && !byId(id).manual_only)).toBe(true);
    }
  });

  // PH6-REG (LOG-DEPTH-3456 open item 4): remote-maintenance MFA is now created enabled, so its write configures [a].
  it('an enabled Conditional Access write configures its objective (MA.L2-3.7.5 is no longer report-only)', () => {
    expect(byId('MA.L2-3.7.5.remote-mfa').set_command).toContain("-State 'enabled'");
    expect(cov.find(r => r.objective_id === 'MA.L2-3.7.5[a]')!.type).toBe('configure');
  });

  it('an objective KB-1 evidences only by documents is document coverage; the uncovered ones are listed in a warning', () => {
    expect(cov.some(r => r.type === 'document' && /^KB-1 evidences it by /.test(r.reason ?? ''))).toBe(true);
    const n = cov.filter(r => r.type === 'uncovered').length;
    expect(result.warnings.some(w => w.startsWith(`OBJECTIVE_COVERAGE (warn): ${n} of ${objectives.length} objectives uncovered`))).toBe(true);
  });
});

describe('DEPTH-7 diffs A and B (LOG-DEPTH-78.md §6): postchecks keep their objective', () => {
  it('a TM verification row with objective_id reaches the plan postcheck, with its methods and the registry expected value', () => {
    const pc = plan.postchecks.find(p => p.id === 'post-chk_obj_MP.L2-3.8.6_a')!;
    expect(pc.objective_id).toBe('MP.L2-3.8.6[a]');
    expect(pc.assessment_methods).toEqual(['examine', 'test']);
    expect(plan.objective_coverage!.find(r => r.objective_id === 'MP.L2-3.8.6[a]')!.type).toBe('configure');
    expect(pc.expected_value).toEqual({ path: '$.bitLockerEncryptDevice', op: 'equals', value: 'true', source: 'registry' });
  });

  it('the executable plan schema keeps objective_id, credits and objective_coverage on load', async () => {
    const { ExecutablePlanSchema } = await import('../../src/types/schema.types');
    const parsed = ExecutablePlanSchema.parse(plan);
    expect(parsed.postchecks.find(p => p.id === 'post-chk_obj_MP.L2-3.8.6_a')!.objective_id).toBe('MP.L2-3.8.6[a]');
    expect(parsed.objective_coverage).toHaveLength(plan.objective_coverage!.length);
    expect(parsed.execution_graph.some(t => (t.credits ?? []).length > 0)).toBe(true);
  });
});
