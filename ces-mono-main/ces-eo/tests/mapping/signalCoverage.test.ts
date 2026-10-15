// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-D (EO-03) — the six automatic-signal-coverage controls are (a) each evaluated correctly
 * from reads ComplianceSignalFetcher actually performs, read-only, into the same signal ids the
 * evaluators read, and (b) backed by real fixture data end to end: fixture signals ->
 * SignalToControlMapper -> verdicts.
 *
 * FC-EO-H (2026-09-28): these six entries were originally an EO-owned registry overlay
 * (`src/eo/mapping/eoRegistryOverlay.ts`, merged by `src/eo/mapping/effectiveRegistry.ts`).
 * ces-shared 2.8.0 promoted them verbatim into the shared Microsoft control-signal registry
 * itself, so the overlay/merge mechanism is deleted; this file (renamed from
 * signalCoverageOverlay.test.ts) drops the merge-mechanics tests (now dead code) and keeps the
 * fetcher + end-to-end coverage, which is still exactly what production evaluates today.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry } from '../../src/eo/mapping/evaluators/index';
import { ComplianceSignalFetcher, COVERAGE_ENDPOINTS } from '../../src/eo/ingestion/ComplianceSignalFetcher';

const COVERAGE_CONTROL_IDS = ['AT.L2-3.2.1', 'AT.L2-3.2.3', 'AU.L2-3.3.5', 'PS.L2-3.9.2', 'RA.L2-3.11.2', 'SC.L2-3.13.7'];
const FIX = path.resolve(__dirname, '../fixtures/signal-coverage');
const load = (f: string): any => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf-8')).payload;

beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] }); });
afterAll(() => { jest.useRealTimers(); });

describe('coverage controls are registered with a graph signal and a real evaluator', () => {
  it('the shared registry covers exactly the six controls, each with a graph signal and a registered evaluator', () => {
    const shared = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/control-signal-registry'), 'utf-8')) as
      Record<string, { signals?: Array<{ type: string; endpoint?: string }>; evaluator: string }>;
    for (const id of COVERAGE_CONTROL_IDS) {
      const e = shared[id];
      expect(e).toBeDefined();
      expect(e.signals?.some(s => s.type === 'graph')).toBe(true);
      expect(typeof evaluatorRegistry[e.evaluator]).toBe('function');
    }
  });

  it('every coverage-control endpoint is one the fetcher reads', () => {
    const shared = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/control-signal-registry'), 'utf-8')) as
      Record<string, { signals?: Array<{ type: string; endpoint?: string }> }>;
    const fetched = new Set<string>([...Object.values(COVERAGE_ENDPOINTS), '/deviceManagement/deviceConfigurations']);
    for (const id of COVERAGE_CONTROL_IDS) {
      for (const s of shared[id].signals ?? []) if (s.endpoint) expect(fetched.has(s.endpoint)).toBe(true);
    }
  });
});

// ---------- fetcher: reads, read-only, right ids ----------
function fakeSession(respond: (cmd: string) => unknown) {
  const cmds: string[] = [];
  return {
    cmds,
    execute: async (_engine: string, cmd: string) => {
      cmds.push(cmd);
      const out = respond(cmd);
      if (out instanceof Error) throw out;
      return { stdout: JSON.stringify(out) + '\nEO_EXECUTION_SUCCESS', stderr: '', exitCode: 0 };
    },
  };
}

const RESPONSES: Array<[RegExp, () => unknown]> = [
  [/getAttackSimulationTrainingUserCoverage/, () => load('training-user-coverage.json')],
  [/\/v1\.0\/users\?/, () => load('users.json')],
  [/security\/incidents/, () => load('incidents.json')],
  [/lifecycleWorkflows/, () => load('lifecycle-workflows.json')],
  [/roleManagement\/directory\/roleAssignments/, () => load('role-assignments.json')],
  [/\/v1\.0\/deviceManagement\/managedDevices/, () => load('managed-devices.json')],
  [/runHuntingQuery/, () => load('hunting-tvm.json')],
  [/Get-MgDeviceManagementDeviceConfiguration/, () => load('device-configurations-sdk.json')],
];
const respond = (cmd: string) => { for (const [re, f] of RESPONSES) if (re.test(cmd)) return f(); return { value: [] }; };

describe('ComplianceSignalFetcher coverage reads', () => {
  it('reads seven collections into the signal ids the evaluators use; only the hunting query is a POST', async () => {
    const sm = fakeSession(respond);
    const f = new ComplianceSignalFetcher(sm as any, {} as any);
    const out = await f.fetchCoverageSignals(Date.parse('2026-09-28T12:00:00Z'));
    expect(out.map(s => s.signalId).sort()).toEqual(
      ['directoryUsers', 'lifecycleWorkflows', 'managedDevicesAll', 'roleAssignmentsAll', 'securityIncidents', 'trainingUserCoverage', 'tvmAssessmentRecency']);
    expect(out.every(s => s.status === 'success' && s.source === 'graph')).toBe(true);
    for (const c of sm.cmds) {
      expect(c).not.toMatch(/-Method\s+(PATCH|PUT|DELETE)|\b(New|Set|Update|Remove)-Mg/i);
      if (/-Method POST/.test(c)) expect(c).toMatch(/\/v1\.0\/security\/runHuntingQuery/);
      else expect(c).toMatch(/-Method GET/);
    }
    // incidents are windowed to the last 90 days
    expect(sm.cmds.find(c => /security\/incidents/.test(c))).toContain('createdDateTime%20ge%202026-06-30');
  });

  it('403 → not_assessed; other failure → error (never success with empty data)', async () => {
    const f403 = new ComplianceSignalFetcher(fakeSession(() => Object.assign(new Error('Forbidden'), { statusCode: 403 })) as any, {} as any);
    expect((await f403.fetchGraphCollection('x', '/users', '/v1.0/users')).status).toBe('not_assessed');
    const fErr = new ComplianceSignalFetcher(fakeSession(() => new Error('boom')) as any, {} as any);
    const r = await fErr.fetchGraphCollection('x', '/users', '/v1.0/users');
    expect(r.status).toBe('error');
    expect(r.rawData).toBeNull();
  });

  it('fetchAllSignals includes the coverage reads', async () => {
    const f = new ComplianceSignalFetcher(fakeSession(respond) as any,
      { runExchangeCommands: async () => [], runPurviewCommands: async () => [] } as any);
    const ids = (await f.fetchAllSignals()).map(s => s.signalId);
    for (const id of ['trainingUserCoverage', 'directoryUsers', 'securityIncidents', 'lifecycleWorkflows', 'roleAssignmentsAll', 'managedDevicesAll', 'tvmAssessmentRecency']) {
      expect(ids).toContain(id);
    }
  });
});

describe('end to end: fetched fixture signals → mapper → verdicts', () => {
  it('each coverage control is evaluated automatically from the fetched signals', async () => {
    const f = new ComplianceSignalFetcher(fakeSession(respond) as any,
      { runExchangeCommands: async () => [], runPurviewCommands: async () => [] } as any);
    const signals: SignalResult[] = await f.fetchAllSignals();
    const byId = new Map(new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).map(a => [a.control_id, a]));
    const status = (id: string) => byId.get(id)?.status;
    expect(status('AT.L2-3.2.1')).toBe('partial');   // user3's training is > 365 days old
    expect(status('AT.L2-3.2.3')).toBe('partial');   // only user1 completed insider-threat training
    expect(status('AU.L2-3.3.5')).toBe('met');
    expect(status('PS.L2-3.9.2')).toBe('met');
    expect(status('RA.L2-3.11.2')).toBe('met');
    expect(status('SC.L2-3.13.7')).toBe('met');
    for (const id of COVERAGE_CONTROL_IDS) expect(byId.get(id)?.classification).toBe('automated');
  });

  it('with every coverage read failing, no coverage control is met', async () => {
    const f = new ComplianceSignalFetcher(fakeSession(() => new Error('down')) as any,
      { runExchangeCommands: async () => [], runPurviewCommands: async () => [] } as any);
    const signals = await f.fetchAllSignals();
    const res = new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).filter(a => COVERAGE_CONTROL_IDS.includes(a.control_id));
    expect(res).toHaveLength(6);
    expect(res.every(a => a.status === 'not_assessed')).toBe(true);
  });
});
