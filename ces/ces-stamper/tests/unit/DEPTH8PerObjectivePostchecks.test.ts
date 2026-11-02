// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-8 (depth plan DEPTH-REPORT-AND-PLAN.md §4; proof V97): Stamper runs postchecks per objective.
//  - presence checks count only the control's own evidence, never the plan's;
//  - an expected-value check records the observed value, the entry and the control whose read it used;
//  - AU.L2-3.3.7: a w32tm peer `time.windows.com,0x9` equals the answered `time.windows.com`;
//  - the local results manifest carries a verdict per objective; the control verdict is unchanged.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PostcheckRunner,
  evaluateExpectedValue,
  normalizeNtpPeer,
  objectiveVerdictsByControl,
  runPostcheckResults,
  clearRunPostcheckResults,
  type ObjectiveCheck,
} from '../../src/core/PostcheckRunner';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';
import { attachObjectiveVerdicts, publishExecutionResults } from '../../src/core/ExecutionResultsPublisher';

const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-depth8-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});
beforeEach(() => clearRunPostcheckResults());

const records = [
  { entryId: 'AU.L2-3.3.7.time-sync', controlIds: ['AU.L2-3.3.7'], postcheckMode: 'state' as const, verdict: 'SAT', statePassed: true, stateOutput: JSON.stringify({ timeServer: 'time.windows.com,0x9' }) },
  { entryId: 'AC.L2-3.1.16.wifi-profile', controlIds: ['AC.L2-3.1.16'], postcheckMode: 'state' as const, verdict: 'SAT', statePassed: true, stateOutput: JSON.stringify({ ssid: 'S1-MACH-CORP' }) },
  { entryId: 'AC.L2-3.1.10.screen-lock', controlIds: ['AC.L2-3.1.10'], postcheckMode: 'presence' as const, verdict: 'SAT', statePassed: false, stateOutput: JSON.stringify({ passwordMinutesOfInactivityBeforeScreenTimeout: 15 }) },
];
const artifacts = [{ control_ids: ['MP.L2-3.8.9'] }, { control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'] }];
const runner = (recs = records, arts: unknown[] = artifacts) =>
  new PostcheckRunner({} as any, { getPlanEvidence: () => arts } as any, undefined, () => recs);
const chk = (control: string, objective: string, ev?: ObjectiveCheck['expected_value'], method: ObjectiveCheck['method'] = 'config_export'): ObjectiveCheck => ({
  id: `post-chk_${objective}`, description: `${objective}: d`, method, expected: `${objective}: d`, on_fail: 'flag', control_id: control, objective_id: objective,
  ...(ev ? { expected_value: ev } : {}),
});

describe('DEPTH-8: presence checks use only the control\'s own evidence', () => {
  it('another control\'s artifact does not satisfy this control (was a free pass on plan-wide evidence)', async () => {
    const r = await runner().runCheck(chk('PE.L1-3.10.1', 'PE.L1-3.10.1[a]'), 'p', false);
    expect(r).toMatchObject({ passed: false, mode: 'presence', outcome: 'fail', evidence_control_ids: ['PE.L1-3.10.1'], objective_id: 'PE.L1-3.10.1[a]' });
  });
  it('an artifact tagged with the control passes', async () => {
    const r = await runner().runCheck(chk('AU.L2-3.3.2', 'AU.L2-3.3.2[a]'), 'p', false);
    expect(r).toMatchObject({ passed: true, mode: 'presence', outcome: 'pass', evidence_control_ids: ['AU.L2-3.3.2'] });
  });
  it('an entry record of the control in this run passes', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.10', 'AC.L2-3.1.10[c]'), 'p', false);
    expect(r).toMatchObject({ passed: true, mode: 'presence', evidence_control_ids: ['AC.L2-3.1.10'] });
  });
  it('no control on the check: no evidence counted, fail', async () => {
    const c = { ...chk('X', 'X[a]') };
    delete (c as { control_id?: string }).control_id;
    expect(await runner().runCheck(c, 'p', false)).toMatchObject({ passed: false, mode: 'presence', evidence_control_ids: [] });
  });
});

describe('DEPTH-8: expected-value checks record what the read held', () => {
  it('pass: observed value, read entry and read control are this control\'s', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.16', 'AC.L2-3.1.16[a]', { path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP', source: 'answered' }), 'p', false);
    expect(r).toMatchObject({ passed: true, outcome: 'pass', observed_value: ['S1-MACH-CORP'], read_entry_id: 'AC.L2-3.1.16.wifi-profile', read_control_id: 'AC.L2-3.1.16',
      expected_value: { path: '$.ssid', op: 'equals', value: 'S1-MACH-CORP', source: 'answered' } });
  });
  it('fail: the observed value is recorded', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.10', 'AC.L2-3.1.10[b]', { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 }), 'p', false);
    expect(r).toMatchObject({ passed: false, outcome: 'fail', observed_value: [15], read_entry_id: 'AC.L2-3.1.10.screen-lock', read_control_id: 'AC.L2-3.1.10' });
  });
  it('path missing in the read: not assessed, observed null', async () => {
    const r = await runner().runCheck(chk('AC.L2-3.1.16', 'AC.L2-3.1.16[b]', { path: '$.wifiSecurityType', op: 'equals', value: 'wpa2Enterprise' }), 'p', false);
    expect(r).toMatchObject({ outcome: 'not_assessed', observed_value: null, missing_path: '$.wifiSecurityType' });
  });
  it('no read for the control: not assessed and nothing observed (never a pass)', async () => {
    const r = await runner().runCheck(chk('IA.L2-3.5.7', 'IA.L2-3.5.7[c]', { path: '$.passwordMinimumLength', op: 'gte', value: 14 }), 'p', false);
    expect(r.outcome).toBe('not_assessed');
    expect(r.passed).toBe(false);
    expect(r.observed_value).toBeUndefined();
  });
});

describe('DEPTH-8: AU.L2-3.3.7 false fail fixed', () => {
  it('a w32tm peer with flags equals the server name', async () => {
    const r = await runner().runCheck(chk('AU.L2-3.3.7', 'AU.L2-3.3.7[b]', { path: '$.timeServer', op: 'equals', value: 'time.windows.com', source: 'answered' }), 'p', false);
    expect(r).toMatchObject({ passed: true, outcome: 'pass', observed_value: ['time.windows.com,0x9'] });
  });
  it('the normalisation is narrow: another server still fails; non-peer strings are unchanged', () => {
    expect(evaluateExpectedValue(JSON.stringify({ timeServer: 'ntp.example.invalid,0x9' }), { path: '$.timeServer', op: 'equals', value: 'time.windows.com' }).passed).toBe(false);
    expect(normalizeNtpPeer('time.windows.com,0x9')).toBe('time.windows.com');
    expect(normalizeNtpPeer('a,b')).toBe('a,b');
    expect(normalizeNtpPeer('time.windows.com,0x9 ntp2,0x1')).toBe('time.windows.com,0x9 ntp2,0x1');
    expect(normalizeNtpPeer(5)).toBe(5);
  });
});

describe('DEPTH-8: a verdict per objective in the local results manifest', () => {
  it('groups by control and objective; fail > not_assessed > pass; manual is not assessed; results without an objective are left out', async () => {
    const r = runner();
    await r.runCheck(chk('AU.L2-3.3.7', 'AU.L2-3.3.7[b]', { path: '$.timeServer', op: 'equals', value: 'time.windows.com' }), 'p', false);
    await r.runCheck(chk('AU.L2-3.3.7', 'AU.L2-3.3.7[a]', undefined, 'manual'), 'p', false);
    await r.runCheck(chk('AC.L2-3.1.10', 'AC.L2-3.1.10[b]', { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 }), 'p', false);
    await r.runCheck(chk('AC.L2-3.1.10', 'AC.L2-3.1.10[b]'), 'p', false);
    await r.runCheck({ id: 'post-legacy', description: 'd', method: 'config_export', expected: 'x', on_fail: 'f', control_id: 'AC.L2-3.1.16' }, 'p', false);
    const v = objectiveVerdictsByControl(r.getResults());
    expect([...v.keys()].sort()).toEqual(['AC.L2-3.1.10', 'AU.L2-3.3.7']);
    expect(v.get('AU.L2-3.3.7')!.map(o => [o.objective_id, o.verdict])).toEqual([['AU.L2-3.3.7[a]', 'not_assessed'], ['AU.L2-3.3.7[b]', 'pass']]);
    const ac10 = v.get('AC.L2-3.1.10')!;
    expect(ac10).toHaveLength(1);
    expect(ac10[0].verdict).toBe('fail');
    expect(ac10[0].postchecks.map(p => p.mode)).toEqual(['state', 'presence']);
    expect(ac10[0].postchecks[0]).toMatchObject({ expected_value: { op: 'lte' }, observed_value: [15], read_control_id: 'AC.L2-3.1.10' });
  });

  it('dry-run results are neither recorded for the manifest nor turned into verdicts', async () => {
    const r = runner();
    await r.runCheck(chk('AU.L2-3.3.7', 'AU.L2-3.3.7[b]', { path: '$.timeServer', op: 'equals', value: 'time.windows.com' }), 'dry', true);
    expect(runPostcheckResults('dry')).toEqual([]);
    expect(objectiveVerdictsByControl(r.getResults()).size).toBe(0);
  });

  it('the written manifest carries objectives[] on the control row; the row verdict is unchanged; other rows keep their shape', async () => {
    const r = runner();
    await r.runCheck(chk('AU.L2-3.3.7', 'AU.L2-3.3.7[b]', { path: '$.timeServer', op: 'equals', value: 'time.windows.com' }), 'translated-mp-8', false);
    await r.runCheck(chk('AC.L2-3.1.10', 'AC.L2-3.1.10[b]', { path: '$.passwordMinutesOfInactivityBeforeScreenTimeout', op: 'lte', value: 10 }), 'translated-mp-8', false);
    const c = new ExecutionResultsCollector();
    c.recordControlResult('AU.L2-3.3.7', 'automated', ResultVerdict.SAT, 'completed');
    c.recordControlResult('AC.L2-3.1.10', 'automated', ResultVerdict.SAT, 'completed');
    c.recordControlResult('PE.L1-3.10.1', 'manual_gate', ResultVerdict.PROVISIONAL, 'manual_gate_pending');
    const { manifest, manifestPath } = await publishExecutionResults(c, { plan_id: 'translated-mp-8', variables: { _source_plan_id: 'mp-8' } }, 'depth8');
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const row = (id: string) => onDisk.results.find((x: { controlId: string }) => x.controlId === id);
    expect(row('AU.L2-3.3.7')).toMatchObject({ verdict: 'sat', objectives: [{ objective_id: 'AU.L2-3.3.7[b]', verdict: 'pass' }] });
    // The failed objective is reported; the control verdict stays Stamper's task verdict (EO holds status).
    expect(row('AC.L2-3.1.10')).toMatchObject({ verdict: 'sat', objectives: [{ objective_id: 'AC.L2-3.1.10[b]', verdict: 'fail' }] });
    expect(row('PE.L1-3.10.1').objectives).toBeUndefined();
    expect(manifest.results).toHaveLength(3);
    expect(manifestPath.startsWith(PIPELINE_ROOT)).toBe(true);
  });

  it('explicit postchecks win over the recorded ones; no objective-keyed results attach nothing', () => {
    const c = new ExecutionResultsCollector();
    c.recordControlResult('AC.L1-3.1.1', 'automated', ResultVerdict.SAT, 'completed');
    const m = c.buildManifestForPlan('run', 't', { plan_id: 'translated-x' });
    expect(attachObjectiveVerdicts(m, [{ check_id: 'c', passed: true, mode: 'presence', control_id: 'AC.L1-3.1.1' }])).toBe(0);
    expect(attachObjectiveVerdicts(m, [{ check_id: 'c', passed: true, mode: 'presence', outcome: 'pass', control_id: 'AC.L1-3.1.1', objective_id: 'AC.L1-3.1.1[a]' }])).toBe(1);
  });
});
