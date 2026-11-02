// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2 unit tests: translate (PC-06), execute (PC-07), dev quick run (PC-14), run log save
// (PC-08) and the FG-4 fixes. Requests are checked for method, path, query and body keys in
// order (AD-4). Fictional paths and tenants only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetcher } from '../api';
import type { Fetcher } from '../api';
import { useWorkflowStore } from './workflow';
import { currentRunLog, resetRunLog, setConsoleClock, useConsoleStore } from './console';
import {
  activeExecSource,
  approveRow,
  doTranslate,
  doTranslateAndExecute,
  doneBadge,
  executeFromMatrix,
  executeRetry,
  haltExecution,
  resetExecution,
  saveRunLog,
  setExecEventSourceFactory,
  targetForTenant,
  unwatchTenant,
  useExecuteStore,
  watchTenant,
} from './execute';
import type { ExecEventSource, ExecEventSourceFactory } from './execute';
import { useTranslateStore } from './translate';

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

class FakeSource implements ExecEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  emit(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  close() {
    this.closed = true;
  }
}

let calls: Call[] = [];
let sources: FakeSource[] = [];
let replies: Record<string, unknown> = {};
let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;
let restoreClock: (() => Date) | null = null;

const MP = 'C:/ces-fixture/plan-data/dev/mission-plan.json';
const TM = 'C:/ces-fixture/plan-data/dev/tenant-manifest.json';
const EP = 'C:/ces-fixture/plan-data/dev/plans/executable-plan-x.json';

function reply(method: string, path: string, body: unknown, status = 200) {
  replies[`${method} ${path}`] = { body, status };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = [];
  sources = [];
  replies = {};
  restoreFetch = setFetcher(async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    const path = url.split('?')[0];
    const r = (replies[`${method} ${path}`] as { body: unknown; status: number } | undefined) ?? { body: { ok: true }, status: 200 };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  restoreSource = setExecEventSourceFactory((url) => {
    const s = new FakeSource(url);
    sources.push(s);
    return s;
  });
  restoreClock = setConsoleClock(() => new Date('2026-10-29T12:00:00.000Z'));
  resetExecution();
  resetRunLog();
  useWorkflowStore.getState().reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  unwatchTenant();
  if (restoreFetch) setFetcher(restoreFetch);
  if (restoreSource) setExecEventSourceFactory(restoreSource);
  if (restoreClock) setConsoleClock(restoreClock);
  vi.restoreAllMocks();
});

const signature = (c: Call) => {
  const [path, query] = c.url.split('?');
  const q = query ? ` ?${Array.from(new URLSearchParams(query).keys()).join('&')}` : '';
  const b = c.body ? ` {${Object.keys(c.body).join(',')}}` : '';
  return `${c.method} ${path}${q}${b}`;
};

function devReady() {
  useWorkflowStore.getState().selectTenant('dev');
  useTranslateStore.getState().setPlanInputs({ missionPlan: MP, manifest: TM });
}

describe('FG-4 fix 1: the target follows the tenant', () => {
  it('dev selects Dry Run, a real tenant restores Tenant', () => {
    watchTenant();
    expect(useExecuteStore.getState().target).toBe('tenant');
    useWorkflowStore.getState().selectTenant('dev');
    expect(useExecuteStore.getState().target).toBe('dryrun');
    useWorkflowStore.getState().selectTenant('ridgeline-machining');
    expect(useExecuteStore.getState().target).toBe('tenant');
    expect(targetForTenant('dev')).toBe('dryrun');
    expect(targetForTenant('larkspur')).toBe('tenant');
  });

  it('a tenant change resets cards 3 and 4 and the connection gate', () => {
    watchTenant();
    useExecuteStore.setState({ connected: true, badge: { text: 'Complete', cls: 'status-done' } });
    useTranslateStore.getState().setBadge({ text: 'Translated', cls: 'status-done' });
    useWorkflowStore.getState().selectTenant('ridgeline-machining');
    expect(useExecuteStore.getState()).toMatchObject({ connected: false, badge: { text: 'Locked', cls: 'status-locked' } });
    expect(useTranslateStore.getState().badge.text).toBe('Locked');
    expect(calls).toEqual([]);
  });
});

describe('FG-4 fix 2: the done badge follows the summary', () => {
  it('Complete only when nothing failed; Partial or Failed otherwise', () => {
    expect(doneBadge(null).text).toBe('Complete');
    expect(doneBadge({ total: 3, pass: 3, fail: 0, skip: 0 }).text).toBe('Complete');
    expect(doneBadge({ total: 110, pass: 80, fail: 30, skip: 0 })).toEqual({ text: 'Partial (30 failed)', cls: 'status-partial' });
    expect(doneBadge({ total: 2, pass: 0, accomplished: 0, fail: 2, skip: 0 })).toEqual({ text: 'Failed (2 failed)', cls: 'status-error' });
    for (const s of [{ total: 2, pass: 1, fail: 1, skip: 0 }, { total: 2, pass: 0, fail: 2, skip: 0 }]) {
      expect(doneBadge(s).text).toMatch(/complete|failed|error|halted/i);
    }
  });
});

describe('translate (PC-06)', () => {
  it('needs both plan paths', async () => {
    await doTranslate();
    expect(calls).toEqual([]);
    expect(useConsoleStore.getState().status).toEqual({ text: 'Mission plan and manifest paths are required for translation.', tone: 'error' });
  });

  it('posts the legacy body, then validates the EP and unlocks Execute', async () => {
    devReady();
    useWorkflowStore.getState().completeStep('assess');
    reply('POST', '/api/translate', {
      success: true,
      planId: 'plan-fixture',
      totalTasks: 3,
      warnings: [],
      directiveCounts: { automated: 2, excluded: 1, nonstack: 0 },
      planDataPaths: { output: EP },
    });
    reply('GET', '/api/validate-file', { ok: true, exists: true });
    await doTranslate();
    expect(calls.map(signature)).toEqual([
      'POST /api/translate {missionPlan,manifest,tenant,gapsOnly,automatedOnly}',
      'GET /api/validate-file ?path',
    ]);
    expect(calls[0].body).toEqual({ missionPlan: MP, manifest: TM, tenant: 'dev', gapsOnly: false, automatedOnly: true });
    expect(useTranslateStore.getState()).toMatchObject({ outputPath: EP, badge: { text: 'Translated', cls: 'status-done' } });
    expect(useExecuteStore.getState()).toMatchObject({
      badge: { text: 'Pending' },
      epDisplay: { text: 'executable-plan-x.json', title: EP },
    });
    const steps = useWorkflowStore.getState().steps;
    expect(steps.translate).toBe('done');
    expect(steps.execute).toBe('ready');
    expect(useConsoleStore.getState().status?.text).toBe(
      'Translated: plan-fixture \u2014 3 tasks | Directives: Automated (2), Excluded (1), Non-Stack (0)',
    );
  });

  it('shows the server error from a 400 reply', async () => {
    devReady();
    reply('POST', '/api/translate', { success: false, error: 'missionPlan and manifest are required' }, 400);
    await doTranslate();
    expect(useConsoleStore.getState().status).toEqual({ text: 'Translation failed: missionPlan and manifest are required', tone: 'error' });
    expect(useTranslateStore.getState().badge.text).toBe('Error');
    expect(useWorkflowStore.getState().steps.translate).toBe('failed');
  });

  it('Gaps Only and Automated Only exclude each other', () => {
    const t = useTranslateStore.getState();
    t.setGapsOnly(true);
    expect(useTranslateStore.getState()).toMatchObject({ gapsOnly: true, automatedOnly: false });
    useTranslateStore.getState().setAutomatedOnly(true);
    expect(useTranslateStore.getState()).toMatchObject({ gapsOnly: false, automatedOnly: true });
  });
});

describe('execute (PC-07)', () => {
  it('refuses a real tenant that is not connected', () => {
    useWorkflowStore.getState().selectTenant('ridgeline-machining');
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    expect(sources).toHaveLength(0);
    expect(useConsoleStore.getState().status?.text).toBe('Tenant not connected. Set the Connection gate to Allow before executing.');
  });

  it('needs an EP path', () => {
    useWorkflowStore.getState().selectTenant('dev');
    executeFromMatrix();
    expect(sources).toHaveLength(0);
    expect(useConsoleStore.getState().status?.text).toBe('Provide the executable plan output path to execute.');
  });

  it('opens the stream with the legacy query keys and target, mode and toggles', () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    useExecuteStore.getState().setMode('manual');
    useExecuteStore.getState().setTarget('tenant');
    executeFromMatrix();
    expect(sources).toHaveLength(1);
    const url = new URL(sources[0].url, 'http://localhost');
    expect(url.pathname).toBe('/api/execute');
    expect(Array.from(url.searchParams.keys())).toEqual(['plan', 'mode', 'dryRun', 'tenant', 'verbose', 'uploadToBlob']);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      plan: EP,
      mode: 'manual',
      dryRun: 'false',
      tenant: 'dev',
      verbose: 'false',
      uploadToBlob: 'true',
    });
    expect(useExecuteStore.getState()).toMatchObject({ running: true, badge: { text: 'Executing...', cls: 'status-running' } });
    expect(useConsoleStore.getState().resultsHidden).toBe(true);
    expect(currentRunLog()).toMatchObject({ planPath: EP, tenant: 'dev', mode: 'manual', dryRun: false });
  });

  it('retry adds retry=true', () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeRetry();
    expect(new URL(sources[0].url, 'http://localhost').searchParams.get('retry')).toBe('true');
  });

  it('done: Partial badge, retry shown, run log and ledger saved, evidence scan, rail moves', async () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    const s = sources[0];
    s.emit({ type: 'execution_start' });
    s.emit({ type: 'task_start', taskId: 't1', label: 'Limit access', engine: 'mgraph', controls: ['AC.L2-3.1.1'] });
    s.emit({ type: 'sub_command', taskId: 't1', subId: 'grp', index: 1, total: 1, engine: 'mgraph', command: 'New-MgGroup -x' });
    s.emit({ type: 'sub_command_stream', taskId: 't1', subId: 'grp', phase: 'set_command', exitCode: 0, command: 'New-MgGroup -x' });
    s.emit({ type: 'sub_command_result', taskId: 't1', subId: 'grp', status: 'fail', message: 'denied' });
    s.emit({ type: 'task_result', taskId: 't1', status: 'fail' });
    s.emit({ type: 'summary', total: 2, pass: 1, fail: 1, skip: 0, accomplished: 0, reportJson: 'C:/ces-fixture/execution-report-1.json' });
    reply('POST', '/api/save-run-log', { ok: true, path: 'C:/ces-fixture/logs/run-log-1.json' });
    s.emit({ type: 'done' });
    await flush();
    await flush();

    const ex = useExecuteStore.getState();
    expect(ex).toMatchObject({ running: false, retryVisible: true, badge: { text: 'Partial (1 failed)', cls: 'status-partial' } });
    expect(s.closed).toBe(true);
    expect(activeExecSource()).toBeNull();
    expect(calls.map(signature)).toEqual([
      'POST /api/save-run-log {log}',
      'GET /api/evidence-scan ?tenant',
      'POST /api/save-run-log {log,filename,isResourceLedger}',
    ]);
    expect(calls[2].body).toMatchObject({ filename: 'resource-ledger-unknown.json', isResourceLedger: true });
    const c = useConsoleStore.getState();
    expect(c.errorLog?.filter((e) => e.status === 'fail')).toHaveLength(1);
    expect(c.items.some((i) => i.kind === 'banner' && !i.success)).toBe(true);
    expect(c.items.some((i) => i.kind === 'log' && i.message === 'Run log saved: C:/ces-fixture/logs/run-log-1.json')).toBe(true);
    expect(c.resultsHidden).toBe(false);
    const steps = useWorkflowStore.getState().steps;
    expect(steps.execute).toBe('done');
    expect(steps.evidence).toBe('ready');
    expect(steps.assess).toBe('ready');
  });

  it('a clean done reads Complete and hides Retry', () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    sources[0].emit({ type: 'summary', total: 1, pass: 1, fail: 0, skip: 0 });
    sources[0].emit({ type: 'done' });
    expect(useExecuteStore.getState()).toMatchObject({ badge: { text: 'Complete' }, retryVisible: false });
  });

  it('halt closes the stream, then posts /api/abort', async () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    const s = sources[0];
    await haltExecution();
    expect(s.closed).toBe(true);
    expect(calls.map(signature)[0]).toBe('POST /api/abort');
    // W8-SPAW intended difference: legacy reads "Error" after Halt; the SPA reads "Halted".
    expect(useExecuteStore.getState()).toMatchObject({ running: false, badge: { text: 'Halted', cls: 'status-error' } });
    expect(useConsoleStore.getState().status?.text).toBe('Execution halted by operator');
    expect(useWorkflowStore.getState().steps.execute).toBe('failed');
  });

  it('a stream execution_halted also reads Halted (W8-SPAW)', () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    sources[0].emit({ type: 'execution_halted' });
    expect(useExecuteStore.getState()).toMatchObject({ running: false, badge: { text: 'Halted', cls: 'status-error' } });
    expect(useWorkflowStore.getState().steps.execute).toBe('failed');
  });

  it('a lost stream is an error', () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    sources[0].onerror?.({});
    expect(useConsoleStore.getState().status?.text).toBe('Connection to execution stream lost.');
    expect(useExecuteStore.getState().running).toBe(false);
  });

  it('approvals post the legacy bodies and remove the row on ok', async () => {
    devReady();
    useTranslateStore.getState().setOutputPath(EP);
    executeFromMatrix();
    const s = sources[0];
    s.emit({ type: 'task_start', taskId: 't1', label: 'x' });
    s.emit({ type: 'sub_command', taskId: 't1', subId: 'a', index: 1, total: 1, command: 'Get-X' });
    s.emit({ type: 'sub_command_approve_request', taskId: 't1', subId: 'a' });
    s.emit({ type: 'task_approve_request', taskId: 't1' });
    s.emit({ type: 'layer_approve_request', layer: 2, taskCount: 5 });
    await approveRow({ scope: 'sub', taskId: 't1', subId: 'a' }, 'accomplish');
    await approveRow({ scope: 'task', taskId: 't1' }, 'approve');
    await approveRow({ scope: 'layer', layer: 2 }, 'skip');
    expect(calls.map((c) => c.body)).toEqual([
      { taskId: 't1', subId: 'a', decision: 'accomplish' },
      { taskId: 't1', decision: 'approve' },
      { layer: 2, decision: 'skip' },
    ]);
    const c = useConsoleStore.getState();
    expect(c.subs['t1::a'].approval).toBeNull();
    expect(c.steps.t1.approval).toBeNull();
    expect(c.items.some((i) => i.kind === 'layer')).toBe(false);
  });

  it('a refused approval keeps the row and says why', async () => {
    reply('POST', '/api/approve', { ok: false, error: 'No pending approval for: t9' }, 404);
    await approveRow({ scope: 'task', taskId: 't9' }, 'approve');
    expect(useConsoleStore.getState().status?.text).toBe('Approval failed: No pending approval for: t9');
  });
});

describe('dev quick run (PC-14)', () => {
  it('translates without the toggles, then executes on Dry Run in the chosen mode', async () => {
    devReady();
    useExecuteStore.getState().setTarget('tenant');
    reply('POST', '/api/translate', { success: true, planId: 'p', totalTasks: 2, planDataPaths: { output: EP, variables: 'C:/ces-fixture/vars.json' } });
    reply('GET', '/api/validate-file', { ok: true, exists: true });
    await doTranslateAndExecute('manual');
    expect(calls.map(signature)).toEqual(['POST /api/translate {missionPlan,manifest,tenant}', 'GET /api/validate-file ?path']);
    const url = new URL(sources[0].url, 'http://localhost');
    expect(url.searchParams.get('mode')).toBe('manual');
    expect(url.searchParams.get('dryRun')).toBe('true');
    expect(useTranslateStore.getState().variablesPath).toBe('C:/ces-fixture/vars.json');
    expect(useExecuteStore.getState().quick.manual).toEqual({ label: 'Translate & Execute (Manual)', busy: false });
  });
});

describe('Save Log (PC-08)', () => {
  it('without a run says there is nothing to save', async () => {
    expect(await saveRunLog()).toBeNull();
    expect(useConsoleStore.getState().saveMessage).toEqual({ text: 'No execution data to save', tone: 'warn' });
    expect(calls).toEqual([]);
  });
});
