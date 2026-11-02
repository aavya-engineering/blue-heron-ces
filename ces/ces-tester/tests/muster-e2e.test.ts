// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// P4.1 / P4.3: the muster-e2e scenario type (loader, dry-run step plan,
// comparison functions, SSE helpers) and the coverage-ao pass predicate.
// Nothing here starts a server or the sim.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMusterE2eFile, loadMusterE2eFile, validateMusterE2e } from '../src/scenarios/musterE2eFile.js';
import { discoverScenarioFiles } from '../src/scenarios/scenarioFile.js';
import { runMusterE2e, MUSTER_E2E_STEP_IDS, REQUIRED_STEPS, eoAssessUrl } from '../src/flow/muster-e2e-run.js';
import { compareFacts, compareLedger, scenarioWriteSteps } from '../src/flow/muster-e2e-compare.js';
import { aoCoveragePredicate } from '../src/flow/ao-coverage.js';
import { parseSseFrames, isStopEvent, sseExitCode, buildPushBody } from '../src/flow/mx-io.js';

const FILE = path.resolve('scenarios', 'muster', 'muster-partial-e2e.json');

describe('muster-e2e scenario file', () => {
  it('loads and validates; declares the sim scenario and RR-ACT expected facts', async () => {
    expect(await isMusterE2eFile(FILE)).toBe(true);
    const s = await loadMusterE2eFile(FILE);
    expect(s.sim_scenario).toBe('muster-partial');
    expect(Object.keys(s.expected_facts).every((k) => k.startsWith('RR-ACT-'))).toBe(true);
    expect(Object.keys(s.expected_facts)).toHaveLength(8);
    expect(s.expected_state.checks.length).toBeGreaterThan(0);
    expect(s.ao_coverage).toEqual({ enabled: true, expected_total: 96 });
  });

  it('rejects a wrong type and a non RR-ACT fact id', async () => {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
    expect(() => validateMusterE2e({ ...raw, type: 'scenario' })).toThrow(/muster-e2e schema/);
    expect(() => validateMusterE2e({ ...raw, expected_facts: { 'iam-001': 'no' } })).toThrow(/muster-e2e schema/);
  });

  it('a frozen-schema scenario is not a muster-e2e file, and run-all does not glob scenarios/muster/', async () => {
    expect(await isMusterE2eFile(path.resolve('scenarios', 'clean-tenant-mfa-baseline.json'))).toBe(false);
    const top = await discoverScenarioFiles(path.resolve('scenarios'));
    expect(top.some((f) => f.includes(`${path.sep}muster${path.sep}`))).toBe(false);
  });
});

describe('muster-e2e dry run', () => {
  it('plans every step in the package order and writes nothing', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-dry-'));
    const lines: string[] = [];
    const rec = await runMusterE2e({
      scenario: await loadMusterE2eFile(FILE),
      scenarioPath: FILE,
      wsRoot: ws,
      packageRoot: path.join(ws, 'pkg'),
      dryRun: true,
      skipForcedRun: true,
      log: (l) => lines.push(l),
    });
    expect(rec.status).toBe('DRY-RUN');
    expect(rec.steps.map((s) => s.id)).toEqual([...MUSTER_E2E_STEP_IDS]);
    expect(rec.steps.find((s) => s.id === 'E8F')?.status).toBe('skipped');
    expect(rec.steps.find((s) => s.id === 'E6')?.commands.join(' ')).toContain('--tenant muster-partial');
    expect(rec.required_steps).toEqual(REQUIRED_STEPS);
    expect(lines.some((l) => l.startsWith('[E8.5]'))).toBe(true);
    expect(JSON.stringify(rec)).not.toContain(ws);
    expect(await fs.readdir(ws)).toEqual([]);
  });
});

describe('muster-e2e forced assess flag (W0 drift baseline)', () => {
  it('eoAssessUrl adds forced=1 only for the forced assess', () => {
    expect(eoAssessUrl('s1-mach')).toBe('http://127.0.0.1:4002/api/assess?tenant=s1-mach');
    expect(eoAssessUrl('s1-mach', { forced: true })).toBe('http://127.0.0.1:4002/api/assess?tenant=s1-mach&forced=1');
  });

  it('the E8F step sends forced=1; the E7 passes do not', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-forced-'));
    const rec = await runMusterE2e({
      scenario: await loadMusterE2eFile(FILE),
      scenarioPath: FILE,
      wsRoot: ws,
      packageRoot: path.join(ws, 'pkg'),
      dryRun: true,
      skipForcedRun: false,
      log: () => {},
    });
    const cmds = (id: string) => rec.steps.find((s) => s.id === id)?.commands.join(' ') ?? '';
    expect(cmds('E8F')).toContain('/api/assess?tenant=muster-partial&forced=1');
    expect(cmds('E7')).toContain('/api/assess?tenant=muster-partial');
    expect(cmds('E7')).not.toContain('forced=1');
    expect(await fs.readdir(ws)).toEqual([]);
  });
});

describe('muster-e2e comparison', () => {
  it('facts: a missing fact is a miss, a matching set passes', () => {
    const exp = { 'RR-ACT-A': 'no', 'RR-ACT-B': 'yes' };
    const bad = compareFacts(exp, { facts: [{ question_id: 'RR-ACT-A', answer: 'no' }] }, 'x');
    expect(bad.pass).toBe(false);
    expect(bad.rows.find((r) => r.id === 'RR-ACT-B')?.actual).toBeNull();
    const good = compareFacts(exp, { facts: [{ question_id: 'RR-ACT-A', answer: 'no' }, { question_id: 'RR-ACT-B', answer: 'yes' }] }, 'x');
    expect(good).toMatchObject({ pass: true, matched: 2, total: 2 });
    expect(compareFacts(exp, null, 'x').pass).toBe(false);
  });

  it('ledger: windows, seed rows and reads follow the verify V7 rule', () => {
    const windows = {
      E2: { started: '2026-01-01T00:00:01.000Z', ended: '2026-01-01T00:00:02.000Z' },
      E6: { started: '2026-01-01T00:00:03.000Z', ended: '2026-01-01T00:00:09.000Z' },
    };
    const entries = [
      { ts: '2026-01-01T00:00:00.000Z', type: 'create', objectType: 'users', sessionType: 'seed' },
      { ts: '2026-01-01T00:00:01.500Z', type: 'read-serve', objectType: 'caPolicies', sessionType: 'graph' },
      { ts: '2026-01-01T00:00:04.000Z', type: 'mutate', objectType: 'caPolicies', objectId: 'CMMC-X', sessionType: 'graph' },
    ];
    const spec = { no_writes_during: ['E2'], writes_only_during: 'E6', min_writes_during: { E6: 1 }, mutated: [{ objectType: 'caPolicies', objectId: 'CMMC-X' }] };
    expect(compareLedger(spec, entries, windows).pass).toBe(true);
    const late = [...entries, { ts: '2026-01-01T00:00:10.000Z', type: 'mutate', objectType: 'users', sessionType: 'graph' }];
    const r = compareLedger(spec, late, windows);
    expect(r.pass).toBe(false);
    expect(r.rows.find((x) => x.check.includes('inside E6'))?.actual).toBe('1 outside');
    expect(compareLedger(spec, entries, { E6: windows.E6 }).pass).toBe(false);
  });

  it('ledger (S1 fix): scenario-build writes in [E1 start, E2 start) are not operator writes', () => {
    // Run 27 shape: 134 E1 build PATCHes (actor "ao", like every sim mutation), 0 in E2, 50 in E6.
    const windows = {
      E1: { started: '2026-10-28T10:32:19.484Z', ended: '2026-10-28T10:32:28.265Z' },
      E2: { started: '2026-10-28T10:32:28.266Z', ended: '2026-10-28T10:33:57.413Z' },
      E6: { started: '2026-10-28T10:34:01.696Z', ended: '2026-10-28T10:37:14.907Z' },
    };
    const w = (ts: string, objectType = 'users') => ({ ts, type: 'mutate', objectType, sessionType: 'graph' });
    const build = [w('2026-10-28T10:32:26.446Z'), w('2026-10-28T10:32:28.107Z'), w('2026-10-28T10:32:28.265Z')];
    const stamper = [w('2026-10-28T10:34:03.182Z', 'caPolicies'), w('2026-10-28T10:37:05.606Z', 'caPolicies')];
    const seed = { ts: '2026-10-28T10:32:19.603Z', type: 'create', objectType: 'users', sessionType: 'seed' };
    const spec = { build_window: { from: 'E1', before: 'E2' }, no_writes_during: ['E2'], writes_only_during: 'E6', min_writes_during: { E6: 1 }, mutated: [{ objectType: 'caPolicies' }] };
    const ok = compareLedger(spec, [seed, ...build, ...stamper], windows, 3);
    expect(ok.pass).toBe(true);
    expect(ok).toMatchObject({ writes: 5, build_writes: 3 });
    expect(ok.rows.find((x) => x.check.includes('inside E6'))?.actual).toBe('0 outside');
    // Without the build window the run-27 failure reproduces.
    const { build_window: _bw, ...old } = spec;
    expect(compareLedger(old, [seed, ...build, ...stamper], windows).rows.find((x) => x.check.includes('inside E6'))?.actual).toBe('3 outside');
    // A build count that differs from the scenario's write steps fails.
    expect(compareLedger(spec, [seed, ...build, ...stamper], windows, 2).pass).toBe(false);
    expect(compareLedger(spec, [seed, ...build, ...stamper], windows).pass).toBe(false);
    // A write during E2 (discovery) still fails; it is not in the build window.
    const r = compareLedger(spec, [seed, ...build, w('2026-10-28T10:33:00.000Z'), ...stamper], windows, 3);
    expect(r.pass).toBe(false);
    expect(r.rows.find((x) => x.check.includes('during E2'))?.actual).toBe('1');
    // A build-window object type does not satisfy a mutated[] row; only operator writes do.
    expect(compareLedger({ ...spec, mutated: [{ objectType: 'users' }] }, [seed, ...build, ...stamper], windows, 3).pass).toBe(false);
    // Missing E1 window: the build row fails instead of passing vacuously.
    expect(compareLedger(spec, [seed, ...stamper], { E2: windows.E2, E6: windows.E6 }, 0).pass).toBe(false);
  });

  it('scenarioWriteSteps counts the non-GET steps of a sim scenario file', () => {
    expect(scenarioWriteSteps({ steps: [{ method: 'PATCH' }, { method: 'GET' }, { method: 'post' }] })).toBe(2);
    expect(scenarioWriteSteps({})).toBe(0);
    expect(scenarioWriteSteps(null)).toBeUndefined();
  });
});

describe('coverage-ao pass predicate (V26)', () => {
  const t = '2026-10-27T00:00:00.000Z';
  const results = (n: number, status = 'PASS') => Array.from({ length: n }, (_, i) => ({ id: `X-${i}`, status }));
  it('passes on exit 0, a fresh report, 95 of 95 and no FAIL', () => {
    const report = { generatedAt: '2026-10-27T00:05:00.000Z', totals: { total: 95, pass: 95, honestOpen: 0, fail: 0 }, results: results(95) };
    expect(aoCoveragePredicate({ rc: 0, report, startedAt: t, expectedTotal: 95 })).toEqual({ pass: true, reasons: [] });
  });
  it('fails on a stale report, a FAIL, a short total or a non-zero exit', () => {
    const fresh = '2026-10-27T00:05:00.000Z';
    expect(aoCoveragePredicate({ rc: 0, report: { generatedAt: '2026-09-28T18:01:43.915Z', totals: { total: 95, pass: 95, honestOpen: 0, fail: 0 }, results: results(95) }, startedAt: t, expectedTotal: 95 }).pass).toBe(false);
    expect(aoCoveragePredicate({ rc: 1, report: { generatedAt: fresh, totals: { total: 95, pass: 94, honestOpen: 0, fail: 1 }, results: results(95) }, startedAt: t, expectedTotal: 95 }).reasons).toContain('FAIL 1');
    expect(aoCoveragePredicate({ rc: 0, report: { generatedAt: fresh, totals: { total: 90, pass: 90, honestOpen: 0, fail: 0 }, results: results(90) }, startedAt: t, expectedTotal: 95 }).pass).toBe(false);
    expect(aoCoveragePredicate({ rc: 0, report: null, startedAt: t, expectedTotal: 95 }).pass).toBe(false);
  });
  it('counts HONEST-OPEN as not failing (the tool\'s own rule)', () => {
    const report = { generatedAt: '2026-10-27T00:05:00.000Z', totals: { total: 95, pass: 93, honestOpen: 2, fail: 0 }, results: results(95) };
    expect(aoCoveragePredicate({ rc: 0, report, startedAt: t, expectedTotal: 95 }).pass).toBe(true);
  });
});

describe('mx-helpers ports (sse, push)', () => {
  it('parses complete frames, skips keepalives, keeps the tail', () => {
    const { events, rest } = parseSseFrames('data: {"type":"a"}\n\n: keepalive\n\ndata: not-json\n\ndata: {"type":"connection_log","phase":"done"}\n\ndata: {"ty');
    expect(events).toEqual([{ type: 'a' }, { type: 'connection_log', phase: 'done' }]);
    expect(rest).toBe('data: {"ty');
    expect(isStopEvent(events[1], 'connection_log:done')).toBe(true);
    expect(isStopEvent(events[1], 'assess_done')).toBe(false);
    expect(sseExitCode(events, true)).toBe(0);
    expect(sseExitCode([...events, { type: 'assess_error' }], true)).toBe(1);
    expect(sseExitCode(events, false)).toBe(1);
  });

  it('builds the push body with the hand-off envelopes when present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mx-push-'));
    for (const [f, v] of [
      ['manual-mission-plan-s-1.json', { mp: 1 }],
      ['manual-mission-plan-s-2.json', { mp: 2 }],
      ['tenant-manifest-s-1.json', { tm: 1 }],
      ['tcp-s-1.json', { tcp: 1 }],
    ] as const) {
      await fs.writeFile(path.join(dir, f), JSON.stringify(v));
    }
    expect(buildPushBody(dir, 's')).toEqual({ tenant_slug: 's', missionPlan: { mp: 2 }, tenantManifest: { tm: 1 }, tcp: { tcp: 1 } });
  });
});
