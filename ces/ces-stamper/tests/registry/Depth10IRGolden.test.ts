// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-10.8 (PH-12 P12-R4, IR batch): the new entry, the IR credits on two SI entries, and the attack-sim
// re-aim, checked against the reads the simulator returns (tenant-stacksim src/resolvers/depth10IRResolvers.test.ts).
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues, creditByObjective } from '../../src/translators/objectiveCredit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const MAILBOX = 'secops@sim.example';
/** PowerShellAdapter.resolveVerification: placeholders in `equals` resolve before the rule runs. */
const resolved = (id: string, vars: Record<string, string>) => {
  const ev = JSON.parse(JSON.stringify(entry(id).verification!.evidence)) as { equals?: string; checks?: Array<{ equals?: string }> };
  const r = (s: string) => s.replace(/\{([A-Za-z_]\w*)\}/g, (m, k: string) => vars[k] ?? m);
  if (ev.equals !== undefined) ev.equals = r(ev.equals);
  for (const c of ev.checks ?? []) if (c.equals !== undefined) c.equals = r(c.equals);
  return ev;
};
const verify = (stdout: string, id: string, vars: Record<string, string> = {}) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout, exitCode: 0 }, { evidence: resolved(id, vars) } as never).passed;

/** Get-ReportSubmissionPolicy after the SET, as the simulator returns it and Select-Object | ConvertTo-Json renders it. */
const REPORTING_READ = {
  Identity: 'DefaultReportSubmissionPolicy', EnableReportToMicrosoft: true,
  ReportJunkToCustomizedAddress: true, ReportJunkAddresses: [MAILBOX],
  ReportNotJunkToCustomizedAddress: true, ReportNotJunkAddresses: [MAILBOX],
  ReportPhishToCustomizedAddress: true, ReportPhishAddresses: [MAILBOX],
};
const DEFAULT_READ = { ...REPORTING_READ, ReportJunkToCustomizedAddress: false, ReportJunkAddresses: [], ReportNotJunkToCustomizedAddress: false, ReportNotJunkAddresses: [], ReportPhishToCustomizedAddress: false, ReportPhishAddresses: [] };

describe('DEPTH-10.8 IR.L2-3.6.1.user-reporting', () => {
  const id = 'IR.L2-3.6.1.user-reporting';

  it('is one get-then-set Exchange entry for IR.L2-3.6.1[g] with a Learn source and a literal expected value', () => {
    expect(registry.allEntries.filter(e => e.entry_id === id)).toHaveLength(1);
    expect(entry(id)).toMatchObject({ control_ids: ['IR.L2-3.6.1'], objective_ids: ['IR.L2-3.6.1[g]'], engine: 'exchange', idempotency: 'get-then-set', variables_required: ['securityEmail'] });
    expect(entry(id).source).toBe('https://learn.microsoft.com/powershell/module/exchangepowershell/set-reportsubmissionpolicy');
    expect(entry(id).set_command).toMatch(/^Set-ReportSubmissionPolicy -Identity DefaultReportSubmissionPolicy /);
    const ev = entry(id).verification!.evidence as { jsonpath: string; equals: string; checks: Array<{ jsonpath: string; equals?: string }> };
    expect(ev).toMatchObject({ jsonpath: '$.ReportPhishToCustomizedAddress', equals: 'True' });
    expect(ev.checks.some(c => c.jsonpath === ev.jsonpath && c.equals === ev.equals)).toBe(true);
  });

  it('is SAT on the read after the SET, NOT_SAT on the default policy, on another mailbox, and on an empty read', () => {
    const vars = { securityEmail: MAILBOX };
    expect(verify(JSON.stringify(REPORTING_READ), id, vars)).toBe(true);
    expect(verify(JSON.stringify(DEFAULT_READ), id, vars)).toBe(false);
    expect(verify(JSON.stringify({ ...REPORTING_READ, ReportPhishAddresses: ['someone.else@sim.example'] }), id, vars)).toBe(false);
    expect(verify('', id, vars)).toBe(false);
  });

  it('the translator writes the expected value on the IR.L2-3.6.1[g] postcheck, and it holds on the read', () => {
    const objective = 'IR.L2-3.6.1[g]';
    const pcs = [{ id: `post-${objective}`, description: '', method: 'config_export', expected: '', on_fail: 'warn', control_id: 'IR.L2-3.6.1', objective_id: objective }];
    expect(applyRegistryExpectedValues(pcs as never, [{ objective_id: objective, type: 'configure', entry_ids: [id] }] as never, new Map([[id, entry(id)]]))).toBe(1);
    const expected = (pcs[0] as { expected_value?: { path: string; op: 'equals'; value: unknown } }).expected_value!;
    expect(expected).toMatchObject({ path: '$.ReportPhishToCustomizedAddress', op: 'equals', value: 'True', source: 'registry' });
    expect(evaluateExpectedValue(JSON.stringify(REPORTING_READ), expected)).toMatchObject({ found: true, passed: true });
    expect(evaluateExpectedValue(JSON.stringify(DEFAULT_READ), expected)).toMatchObject({ found: true, passed: false });
  });
});

describe('DEPTH-10.8 IR credits on SI entries (analysis, containment)', () => {
  it('mde-onboarding credits IR.L2-3.6.1[d] and user-risk-policy credits IR.L2-3.6.1[e]; their own SI control stays first', () => {
    // PH-12 merge (LOG-PH12-R5 diff C): onboarding also credits Defender Vulnerability Management scanning (RA.L2-3.11.2, RA.L2-3.11.3).
    expect(entry('SI.L1-3.14.1.mde-onboarding')).toMatchObject({ control_ids: ['SI.L1-3.14.1', 'SI.L2-3.14.6', 'IR.L2-3.6.1', 'RA.L2-3.11.2', 'RA.L2-3.11.3', 'CM.L2-3.4.1', 'CM.L2-3.4.9'], objective_ids: ['SI.L1-3.14.1[b]', 'SI.L2-3.14.6[a]', 'IR.L2-3.6.1[d]', 'RA.L2-3.11.2[b]', 'RA.L2-3.11.2[c]', 'RA.L2-3.11.2[d]', 'RA.L2-3.11.3[a]', 'CM.L2-3.4.1[d]', 'CM.L2-3.4.9[c]'] }); // PH13-REG adds the CM inventory objectives
    expect(entry('SI.L2-3.14.7.user-risk-policy')).toMatchObject({ control_ids: ['SI.L2-3.14.7', 'IR.L2-3.6.1'], objective_ids: ['SI.L2-3.14.7[b]', 'IR.L2-3.6.1[e]'] });
  });

  it('DEPTH-3: each runs once, in its SI task; the IR task keeps its own entries and gets credits[]', () => {
    const sub = (id: string) => ({ id, set_command: entry(id).set_command, get_command: entry(id).get_command });
    const task = (id: string, control: string, subs: string[]) => ({ id, controls: [control], depends_on: [] as string[], action: { engine: 'mgraph', command: '', args: { _directive: 'implement', _sub_commands: subs.map(sub) } } });
    const si1 = task('t-si1', 'SI.L1-3.14.1', ['SI.L1-3.14.1.mde-onboarding']);
    const si7 = task('t-si7', 'SI.L2-3.14.7', ['SI.L2-3.14.7.user-risk-policy']);
    const ir1 = task('t-ir1', 'IR.L2-3.6.1', ['IR.L2-3.6.1.atp-enable', 'IR.L2-3.6.1.user-reporting', 'SI.L1-3.14.1.mde-onboarding', 'SI.L2-3.14.7.user-risk-policy']);
    const byId = new Map(registry.allEntries.map(e => [e.entry_id, e]));
    const { tasks } = creditByObjective([si1, si7, ir1] as never, byId, []);
    const ids = (t: { action: { args: { _sub_commands: Array<{ id: string }> } } }) => t.action.args._sub_commands.map(s => s.id);
    const out = tasks as unknown as Array<{ id: string; credits?: Array<{ objective_id: string; entry_id: string }>; action: { args: { _sub_commands: Array<{ id: string }> } } }>;
    expect(ids(out.find(t => t.id === 't-ir1')!)).toEqual(['IR.L2-3.6.1.atp-enable', 'IR.L2-3.6.1.user-reporting']);
    expect(ids(out.find(t => t.id === 't-si1')!)).toEqual(['SI.L1-3.14.1.mde-onboarding']);
    expect(out.find(t => t.id === 't-si1')!.credits).toEqual(expect.arrayContaining([{ objective_id: 'IR.L2-3.6.1[d]', entry_id: 'SI.L1-3.14.1.mde-onboarding' }]));
    expect(out.find(t => t.id === 't-si7')!.credits).toEqual([{ objective_id: 'IR.L2-3.6.1[e]', entry_id: 'SI.L2-3.14.7.user-risk-policy' }]);
  });
});

describe('DEPTH-10.8 IR.L2-3.6.3.attack-sim becomes a manual upload item', () => {
  const id = 'IR.L2-3.6.3.attack-sim';

  it('is manual-only (the AT.L2-3.2.1.training-evidence pattern), tagged IR.L2-3.6.3[a], and sends no Graph call', () => {
    const e = entry(id);
    expect(e).toMatchObject({ engine: 'manual_gate', manual_only: true, set_command: '', get_command: '', idempotency: 'evidence-only', objective_ids: ['IR.L2-3.6.3[a]'] });
    expect(e.evidence_commands).toHaveLength(1);
    expect(e.evidence_commands[0]).toMatch(/^@\{archetype='EMX-IR-TEST-001';status='manual_upload_required';/);
    for (const c of [e.get_command, ...e.evidence_commands]) expect(c).not.toMatch(/Invoke-MgGraphRequest|attackSimulation|alerts_v2/);
    expect(e.source).toBe('https://learn.microsoft.com/defender-office-365/attack-simulation-training-get-started');
  });

  it('DEPTH-4: a manual gate for IR.L2-3.6.3 does not keep it as a running sub-command', () => {
    const own = registry.allEntries.filter(e => e.control_ids[0] === 'IR.L2-3.6.3' && !e.manual_only).map(e => e.entry_id);
    expect(own).toEqual([]);
  });
});
