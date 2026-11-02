// PH-5 (R-F2 red closure, agent R-MX): the harness helpers behind V77 (E7S not applicable), V110 (console-approved
// gates), V116 (pseudo-console host failure) and V119 (the AC.L1-3.1.1 drift seed).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AO_SWEEP_SCENARIO_REL, loadAoRegistry, loadAoSweepScenario, notApplicableReason, runAoSweep } from '../src/flow/ao-sweep-run.js';
import { consoleApprovedGates, consoleEscId, scanGateRecords } from '../src/flow/fin19-steps.js';
import { hostFailure } from '../src/flow/fin29-stamper.js';
import { creditsAcL1, pickDriftSeed } from '../src/flow/fin29-eo-muster.js';

const REG = loadAoRegistry(path.resolve('..', 'ces-ao'));
const sc = loadAoSweepScenario(path.resolve(AO_SWEEP_SCENARIO_REL));
const cmd = (id: string) => REG.find((c) => c.id === id)!;

describe('V77: E7S not applicable, only with the discovery\'s absence proof', () => {
  const absent = { standing_admin_upn: 'no simulator object: standing GA', android_app_protection_policy_id: 'no simulator object: Android policy', cui_group_mail: 'no simulator object: GET /v1.0/groups: CUI-Authorized-Users, its mail' };
  it('the S1 scenario lists A-10, B-08, B-09 and D-11', () => {
    expect(Object.keys(sc.not_applicable ?? {}).sort()).toEqual(['A-10', 'B-08', 'B-09', 'D-11']);
  });
  it('names the reason and the proving key for each listed op (direct input, sourced key in snake form)', () => {
    expect(notApplicableReason(cmd('A-10'), sc, absent)).toMatch(/; discovery: standing_admin_upn: no simulator object: /);
    expect(notApplicableReason(cmd('B-08'), sc, absent)).toMatch(/; discovery: android_app_protection_policy_id: no simulator object: /);
    expect(notApplicableReason(cmd('B-09'), sc, absent)).toMatch(/android_app_protection_policy_id/);
    expect(notApplicableReason(cmd('D-11'), sc, absent)).toMatch(/; discovery: cui_group_mail: /);
  });
  it('is null without proof (a read failure, nothing missing) or for an op not listed', () => {
    expect(notApplicableReason(cmd('A-10'), sc, {})).toBeNull();
    expect(notApplicableReason(cmd('A-10'), sc, { standing_admin_upn: 'read failed: ECONNREFUSED' })).toBeNull();
    expect(notApplicableReason(cmd('F-12'), sc, { public_ip_name: 'no simulator object: x' })).toBeNull();
  });
  it('runAoSweep records the op not applicable with no call, and ok excludes it from the dry-run count', async () => {
    let calls = 0;
    const out = await runAoSweep({
      commands: [cmd('A-10')], scenario: sc, slug: 's1-mach', env: {}, resourcesMissing: absent,
      record: { tenant: { tenant_id: 't', domain: 'd' }, resources: { operator_upn: 'op@d' } },
      runCli: async () => { calls++; return { rc: 0, stdout: '{}', stderr: '' }; },
    });
    expect(calls).toBe(0);
    expect(out.ops[0]).toMatchObject({ op: 'A-10', dry_run_ok: false, calls: [] });
    expect(out.ops[0].not_applicable).toMatch(/standing_admin_upn/);
    expect(out.totals).toMatchObject({ commands: 1, not_applicable: 1, not_run: 0 });
    expect(out.ok).toBe(true);
  });
  it('without proof the op still fails as not run (a real gap stays red)', async () => {
    const out = await runAoSweep({ commands: [cmd('A-10')], scenario: sc, slug: 's1-mach', env: {}, resourcesMissing: {}, record: { tenant: { tenant_id: 't', domain: 'd' }, resources: { operator_upn: 'op@d' } }, runCli: async () => ({ rc: 0, stdout: '{}', stderr: '' }) });
    expect(out.ops[0].not_run).toMatch(/standing_admin_upn/);
    expect(out.ok).toBe(false);
  });
});

describe('V110: gate records of console-approved tasks', () => {
  it('reads the task id from the record and matches the console\'s step and sub-command rows', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ph5-gates-'));
    const ebt = path.join(d, 'evidence-by-task');
    const task = 'step_task_MP.L1-3.8.3_abc';
    fs.mkdirSync(path.join(ebt, task), { recursive: true });
    fs.writeFileSync(path.join(ebt, task, 'manual-gate.json'), JSON.stringify({ rawResponse: JSON.stringify({ task_id: task, action: 'none' }), complianceVerdict: 'PROVISIONAL', metadata: { gate: 'manual', gateAction: 'none', controlIds: ['MP.L1-3.8.3'] } }));
    fs.mkdirSync(path.join(ebt, 'other_task'), { recursive: true });
    fs.writeFileSync(path.join(ebt, 'other_task', 'manual-gate.json'), JSON.stringify({ metadata: { gate: 'manual', gateAction: 'none', controlIds: ['PE.L2-3.10.6'] } }));
    const gates = scanGateRecords([ebt]);
    expect(gates.map((g) => g.task_id).sort()).toEqual(['other_task', task]);
    expect(consoleEscId(task)).toBe('step_task_MP-L1-3-8-3_abc');
    expect(consoleApprovedGates(gates, [`approval-${consoleEscId(task)}`]).map((g) => g.task_id)).toEqual([task]);
    expect(consoleApprovedGates(gates, ['sub-approval-other_task-x']).map((g) => g.task_id)).toEqual(['other_task']);
    expect(consoleApprovedGates(gates, ['approval-unrelated'])).toEqual([]);
  });
});

describe('V116: a pseudo-console host that failed is reported, not read as a quiet run', () => {
  it('finds the host\'s own failure lines and nothing else', () => {
    expect(hostFailure('noise\nUnable to find type [CesConPty].\nAt conpty-run.ps1:95')).toBe('Unable to find type [CesConPty].');
    expect(hostFailure('conpty-run: CreateProcess failed: 2')).toMatch(/CreateProcess failed/);
    expect(hostFailure('TTY=true\nType the entry id "x" to opt in')).toBeNull();
  });
});

describe('V119: the seed disables every policy AC.L1-3.1.1 credits', () => {
  const pol = (id: string, controls: string[], users: Record<string, unknown>, state = 'enabled') => ({ id, displayName: id, state, grantControls: { builtInControls: controls }, conditions: { users } });
  it('credits mfa + compliantDevice for all users or a group', () => {
    expect(creditsAcL1(pol('a', ['mfa', 'compliantDevice'], { includeUsers: ['All'] }))).toBe(true);
    expect(creditsAcL1(pol('b', ['mfa', 'compliantDevice'], { includeGroups: ['g1'] }))).toBe(true);
    expect(creditsAcL1(pol('c', ['mfa'], { includeUsers: ['All'] }))).toBe(false);
    expect(creditsAcL1(pol('d', ['mfa', 'compliantDevice'], { includeUsers: [] }))).toBe(false);
  });
  it('picks all credited enabled policies, else the old one-policy rule', () => {
    const s = pickDriftSeed([pol('x', ['mfa'], { includeUsers: ['All'] }), pol('S1-CA08', ['mfa', 'compliantDevice'], { includeGroups: ['g'] }), pol('CMMC-MFA-CompliantDevice', ['mfa', 'compliantDevice'], { includeUsers: ['All'] }), pol('off', ['mfa', 'compliantDevice'], { includeUsers: ['All'] }, 'disabled')]);
    expect(s?.policies.map((p) => p.policy_id)).toEqual(['S1-CA08', 'CMMC-MFA-CompliantDevice']);
    expect(s?.policy_id).toBe('S1-CA08');
    const old = pickDriftSeed([pol('x', ['block'], {}), pol('y', ['mfa'], {})]);
    expect(old?.policies.map((p) => p.policy_id)).toEqual(['y']);
  });
});
