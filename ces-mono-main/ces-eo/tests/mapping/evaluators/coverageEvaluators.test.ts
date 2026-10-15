// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-D (EO-03) — the six new tenant signals behind the EO registry overlay.
 * Fixtures: tests/fixtures/signal-coverage/*.json (Graph v1.0 / SDK response shapes, synthetic ids).
 * Each evaluator: a verdict on the recorded fixture, plus the integrity cases — failed read →
 * not_assessed, EMPTY read → not_met, partial evidence → partial (never met).
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index';
import { listItems, prop } from '../../../src/eo/mapping/evaluators/coverage-evaluators';

const FIX = path.resolve(__dirname, '../../fixtures/signal-coverage');
const load = (f: string): any => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf-8')).payload;
const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success'): SignalResult =>
  ({ signalId, source: 'graph', endpoint, timestamp: '2026-09-28T12:00:00Z', rawData, status });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const training = () => sig('trainingUserCoverage', '/reports/security/getAttackSimulationTrainingUserCoverage', load('training-user-coverage.json'));
const users = (data: unknown = load('users.json')) => sig('directoryUsers', '/users', data);
const incidents = (data: unknown = load('incidents.json')) => sig('securityIncidents', '/security/incidents', data);
const workflows = (data: unknown = load('lifecycle-workflows.json')) => sig('lifecycleWorkflows', '/identityGovernance/lifecycleWorkflows/workflows', data);
const roles = (data: unknown = load('role-assignments.json')) => sig('roleAssignmentsAll', '/roleManagement/directory/roleAssignments', data);
const tvm = (data: unknown = load('hunting-tvm.json')) => sig('tvmAssessmentRecency', '/security/runHuntingQuery', data);
const devices = (data: unknown = load('managed-devices.json')) => sig('managedDevicesAll', '/deviceManagement/managedDevices', data);
const configs = (data: unknown = load('device-configurations-sdk.json')) => sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', data);
const failed = (s: SignalResult): SignalResult => ({ ...s, rawData: null, status: 'error' });

const ev = (name: string) => {
  const fn = evaluatorRegistry[name];
  if (!fn) throw new Error(`evaluator ${name} is not registered`);
  return fn;
};

beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z') }); });
afterAll(() => { jest.useRealTimers(); });

describe('shape helpers', () => {
  it('prop reads flat Graph JSON and SDK AdditionalProperties / PascalCase', () => {
    expect(prop({ enableSplitTunneling: false }, 'enableSplitTunneling')).toBe(false);
    expect(prop({ AdditionalProperties: { enableSplitTunneling: true } }, 'enableSplitTunneling')).toBe(true);
    expect(prop({ DisplayName: 'x' }, 'displayName')).toBe('x');
  });
  it('listItems handles value / results / bare arrays / empty', () => {
    expect(listItems({ value: [1, 2] })).toHaveLength(2);
    expect(listItems({ results: [1] })).toHaveLength(1);
    expect(listItems([1, 2, 3])).toHaveLength(3);
    expect(listItems({ value: [] })).toEqual([]);
    expect(listItems(null)).toEqual([]);
  });
});

describe('AT.L2-3.2.1 awarenessTrainingCoverageEvaluator', () => {
  const fn = () => ev('awarenessTrainingCoverageEvaluator');
  it('partial on the fixture: user3 last trained > 365 days ago; guest + unlicensed + disabled excluded', () => {
    const r = fn()([training(), users()]);
    expect(r.status).toBe('partial');
    expect(r.evidence).toContain('2/3');
    expect(r.evidence).toContain('user3@contoso.example');
  });
  it('met when every licensed, enabled member completed training within 365 days', () => {
    const u = clone(load('users.json')); u.value = u.value.filter((x: any) => x.id !== 'u-0003');
    expect(fn()([training(), users(u)]).status).toBe('met');
  });
  it('failed read → not_assessed; empty coverage → not_met; empty population → not_met', () => {
    expect(fn()([failed(training()), users()]).status).toBe('not_assessed');
    expect(fn()([training()]).status).toBe('not_assessed');
    expect(fn()([sig('trainingUserCoverage', '/x', { value: [] }), users()]).status).toBe('not_met');
    expect(fn()([training(), users({ value: [] })]).status).toBe('not_met');
  });
  it('an assigned-but-not-completed training never counts', () => {
    const t = clone(load('training-user-coverage.json'));
    for (const row of t.value) for (const tr of row.userTrainings) tr.trainingStatus = 'assigned';
    expect(fn()([sig('trainingUserCoverage', '/x', t), users()]).status).toBe('not_met');
  });
});

describe('AT.L2-3.2.3 insiderThreatTrainingEvaluator', () => {
  const fn = () => ev('insiderThreatTrainingEvaluator');
  it('partial on the fixture (only user1 completed the insider-threat training)', () => {
    const r = fn()([training(), users()]);
    expect(r.status).toBe('partial');
    expect(r.evidence).toContain('1/3');
  });
  it('met only when every in-scope user completed an insider-threat titled training', () => {
    const u = clone(load('users.json')); u.value = u.value.filter((x: any) => x.id === 'u-0001');
    expect(fn()([training(), users(u)]).status).toBe('met');
  });
  it('general awareness training alone is not insider-threat training', () => {
    const t = clone(load('training-user-coverage.json'));
    for (const row of t.value) row.userTrainings = row.userTrainings.filter((x: any) => !/insider/i.test(x.displayName));
    expect(fn()([sig('trainingUserCoverage', '/x', t), users()]).status).toBe('not_met');
  });
});

describe('AU.L2-3.3.5 incidentCorrelationEvaluator', () => {
  const fn = () => ev('incidentCorrelationEvaluator');
  it('met on the fixture: a recent incident correlates Defender for Office 365 + Endpoint alerts', () => {
    const r = fn()([incidents()]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('microsoftDefenderForEndpoint');
  });
  it('single-source incidents only → partial', () => {
    const d = clone(load('incidents.json')); d.value = d.value.filter((i: any) => i.id === 'inc-102');
    expect(fn()([incidents(d)]).status).toBe('partial');
  });
  it('stale incidents → not_met; empty → not_met; failed → not_assessed', () => {
    const d = clone(load('incidents.json')); for (const i of d.value) i.createdDateTime = '2026-01-01T00:00:00Z';
    expect(fn()([incidents(d)]).status).toBe('not_met');
    expect(fn()([incidents({ value: [] })]).status).toBe('not_met');
    expect(fn()([failed(incidents())]).status).toBe('not_assessed');
  });
});

describe('PS.L2-3.9.2 personnelActionAccessEvaluator', () => {
  const fn = () => ev('personnelActionAccessEvaluator');
  it('met on the fixture: leaver + mover enforced, the disabled account holds no role', () => {
    const r = fn()([workflows(), users(), roles()]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('Offboard on last day');
  });
  it('a disabled account still holding a directory role → not_met', () => {
    const ra = clone(load('role-assignments.json'));
    ra.value.push({ id: 'ra-9', principalId: 'u-0006', roleDefinitionId: '62e90394-69f5-4237-9190-012177145e10' });
    expect(fn()([workflows(), users(), roles(ra)]).status).toBe('not_met');
  });
  it('leaver not scheduled (on-demand only) → not_met; mover missing → partial', () => {
    const w1 = clone(load('lifecycle-workflows.json')); w1.value[0].isSchedulingEnabled = false;
    expect(fn()([workflows(w1), users(), roles()]).status).toBe('not_met');
    const w2 = clone(load('lifecycle-workflows.json')); w2.value = w2.value.filter((w: any) => w.category !== 'mover');
    expect(fn()([workflows(w2), users(), roles()]).status).toBe('partial');
  });
  it('a leaver workflow with no disable/delete task does not count', () => {
    const w = clone(load('lifecycle-workflows.json')); w.value[0].tasks = w.value[0].tasks.slice(1);
    expect(fn()([workflows(w), users(), roles()]).status).toBe('not_met');
  });
  it('empty workflows → not_met; any failed read → not_assessed', () => {
    expect(fn()([workflows({ value: [] }), users(), roles()]).status).toBe('not_met');
    expect(fn()([failed(workflows()), users(), roles()]).status).toBe('not_assessed');
    expect(fn()([workflows(), users()]).status).toBe('not_assessed');
  });
});

describe('RA.L2-3.11.2 vulnScanRecencyEvaluator', () => {
  const fn = () => ev('vulnScanRecencyEvaluator');
  it('met on the fixture: both managed Windows devices assessed within 7 days', () => {
    expect(fn()([tvm(), devices()]).status).toBe('met');
  });
  it('a stale device → partial; all stale → not_met', () => {
    const d = clone(load('hunting-tvm.json')); d.results[1].LastAssessed = '2026-08-01T00:00:00Z';
    expect(fn()([tvm(d), devices()]).status).toBe('partial');
    for (const r of d.results) r.LastAssessed = '2026-08-01T00:00:00Z';
    expect(fn()([tvm(d), devices()]).status).toBe('not_met');
  });
  it('managed desktops missing from the assessment → partial', () => {
    const m = clone(load('managed-devices.json')); m.value.push({ id: 'md-4', deviceName: 'wks-003', operatingSystem: 'Windows' });
    expect(fn()([tvm(), devices(m)]).status).toBe('partial');
  });
  it('empty results → not_met; failed → not_assessed', () => {
    expect(fn()([tvm({ schema: [], results: [] }), devices()]).status).toBe('not_met');
    expect(fn()([failed(tvm()), devices()]).status).toBe('not_assessed');
  });
});

describe('SC.L2-3.13.7 splitTunnelingEvaluator', () => {
  const fn = () => ev('splitTunnelingEvaluator');
  it('met on the SDK-shaped fixture (property under AdditionalProperties)', () => {
    const r = fn()([configs()]);
    expect(r.status).toBe('met');
    expect(r.evidence).toContain('Always On VPN - Enclave');
  });
  it('met on the flat Graph shape too', () => {
    const flat = [{ id: 'c1', displayName: 'VPN', '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false }];
    expect(fn()([configs({ value: flat })]).status).toBe('met');
  });
  it('split tunneling enabled OR unset → not_met', () => {
    const c = clone(load('device-configurations-sdk.json')); c[0].AdditionalProperties.enableSplitTunneling = true;
    expect(fn()([configs(c)]).status).toBe('not_met');
    delete c[0].AdditionalProperties.enableSplitTunneling;
    expect(fn()([configs(c)]).status).toBe('not_met');
  });
  it('no VPN profile → not_met; empty → not_met; failed → not_assessed', () => {
    const c = clone(load('device-configurations-sdk.json')).slice(1);
    expect(fn()([configs(c)]).status).toBe('not_met');
    expect(fn()([configs([])]).status).toBe('not_met');
    expect(fn()([failed(configs())]).status).toBe('not_assessed');
  });
});
