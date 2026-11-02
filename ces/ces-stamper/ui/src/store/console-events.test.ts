// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2 unit tests: the execute stream to console rows, terminal blocks, ledger rows, run log
// and grid counts (PC-08 "same rows per event", PC-09 ledger rows). Fictional data only.

import { describe, expect, it } from 'vitest';
import {
  RunLogBuilder,
  classifyResourceFromEvent,
  extractResourcePath,
  gridActionCell,
  gridStepCell,
  inferResourceType,
  initialConsoleState,
  jsonErrorMessage,
  reduceExecEvent,
  stdoutContainsData,
} from './console-events';
import type { ConsoleState, ExecEvent, ReduceContext } from './console-events';

const NOW = new Date(2026, 9, 29, 9, 5, 7);
const quiet: ReduceContext = { now: NOW, verbose: false, logPanel: true };
const loud: ReduceContext = { now: NOW, verbose: true, logPanel: true };

function run(events: ExecEvent[], ctx: ReduceContext = quiet): ConsoleState {
  return events.reduce((s, e) => reduceExecEvent(s, e, ctx), initialConsoleState());
}

const T1 = 'step_task_AC.L2-3.1.1_fx01_aa';
const T2 = 'step_task_AC.L2-3.1.2_fx01_bb';

const start = (taskId: string, extra: Partial<ExecEvent> = {}): ExecEvent => ({
  type: 'task_start',
  taskId,
  label: 'Limit system access',
  engine: 'mgraph',
  directive: 'automated',
  subCommandCount: 1,
  controls: ['AC.L2-3.1.1'],
  layer: 2,
  ...extra,
});
const sub = (taskId: string, subId: string): ExecEvent => ({
  type: 'sub_command',
  taskId,
  subId,
  label: 'Create group',
  index: 1,
  total: 1,
  engine: 'mgraph',
  command: "New-MgGroup -DisplayName 'Ridgeline Ops'",
});

describe('ledger classification (legacy L5472-5594)', () => {
  it('infers resource types from cmdlets and -ResourceType', () => {
    expect(inferResourceType('New-MgGroup -DisplayName x')).toBe('MgGroup');
    expect(inferResourceType("Get-AzResource -ResourceType 'Microsoft.KeyVault/vaults'")).toBe('vaults');
    expect(inferResourceType('whoami')).toBe('whoami');
    expect(inferResourceType(undefined)).toBe('Unknown');
  });

  it('prefers the sub id, then -Identity/-Name/-DisplayName/-ResourceName, then the task id', () => {
    expect(extractResourcePath('New-MgGroup', 'grp-ops', 't')).toBe('grp-ops');
    expect(extractResourcePath("Set-Mailbox -Identity 'ops@ridgeline.example'", 'default', 't')).toBe('ops@ridgeline.example');
    expect(extractResourcePath('Get-X', '', 't9')).toBe('t9');
    expect(extractResourcePath(undefined, 's', 't9')).toBe('t9');
  });

  it('recognises data in stdout as legacy does', () => {
    expect(stdoutContainsData('[{"id":1}]')).toBe(true);
    expect(stdoutContainsData('{}')).toBe(false);
    expect(stdoutContainsData('Error: not found')).toBe(false);
    expect(stdoutContainsData('line one\nline two')).toBe(true);
    expect(stdoutContainsData('short')).toBe(false);
  });

  it('classifies discovered and created resources', () => {
    expect(classifyResourceFromEvent({ type: 'sub_command_stream', phase: 'idempotent_skip', command: 'Get-MgGroup' })).toBe('discovered');
    expect(classifyResourceFromEvent({ type: 'sub_command_stream', phase: 'get_command', exitCode: 0, command: 'Get-MgGroup', stdout: '[{"id":"g"}]' })).toBe(
      'discovered',
    );
    expect(
      classifyResourceFromEvent({
        type: 'sub_command_stream',
        phase: 'capture_resolved',
        command: 'Get-MgGroup',
        captures: { groupId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      }),
    ).toBe('discovered');
    expect(classifyResourceFromEvent({ type: 'sub_command_stream', phase: 'set_command', exitCode: 0, command: 'New-MgGroup -x' })).toBe('created');
    expect(classifyResourceFromEvent({ type: 'sub_command_stream', phase: 'set_command', exitCode: 1, command: 'New-MgGroup -x' })).toBeNull();
    expect(classifyResourceFromEvent({ type: 'sub_command_stream', phase: 'stdout_chunk', stdout: 'x' })).toBeNull();
  });

  it('adds ledger rows in the legacy key order and clears them on execution_start', () => {
    const s = run([
      start(T1),
      sub(T1, 'grp-ops'),
      { type: 'sub_command_stream', taskId: T1, subId: 'grp-ops', phase: 'set_command', exitCode: 0, command: "New-MgGroup -DisplayName 'Ridgeline Ops'" },
    ]);
    expect(s.ledger).toHaveLength(1);
    expect(Object.keys(s.ledger[0])).toEqual(['category', 'type', 'path', 'step', 'timestamp', 'cmdlet']);
    expect(s.ledger[0]).toMatchObject({ category: 'created', type: 'MgGroup', path: 'grp-ops', step: T1, timestamp: NOW.toISOString() });
    expect(reduceExecEvent(s, { type: 'execution_start' }, quiet).ledger).toEqual([]);
  });
});

describe('console rows (legacy handleEvent L8193-9347)', () => {
  it('log events become info rows with HH:MM:SS time', () => {
    const s = run([{ type: 'log', message: 'Engine ready' }]);
    expect(s.items).toEqual([{ kind: 'log', key: 'log-1', time: '09:05:07', level: 'info', message: 'Engine ready' }]);
  });

  it('task_start makes one RUNNING step row; duplicates are ignored', () => {
    const s = run([start(T1), start(T1)]);
    expect(s.items.filter((i) => i.kind === 'step')).toHaveLength(1);
    expect(s.steps[T1]).toMatchObject({ status: { cls: 'running', text: 'RUNNING' }, countLabel: '(1 cmds)', expanded: true });
    expect(s.status).toEqual({ text: 'Executing...', tone: 'info' });
  });

  it('collapses the previous step when the next starts (not verbose)', () => {
    const s = run([start(T1), start(T2)]);
    expect(s.steps[T1].expanded).toBe(false);
    expect(s.steps[T2].expanded).toBe(true);
    const v = run([start(T1), start(T2)], loud);
    expect(v.steps[T1].expanded).toBe(true);
  });

  it('sub rows, results and verdict badges', () => {
    const s = run([
      start(T1),
      sub(T1, 'grp-ops'),
      { type: 'sub_command_result', taskId: T1, subId: 'grp-ops', status: 'pass', outcome: 'automated_success' },
      { type: 'task_result', taskId: T1, status: 'pass' },
    ]);
    const row = s.subs[`${T1}::grp-ops`];
    expect(row).toMatchObject({ tagIndex: '1/1', command: "New-MgGroup -DisplayName 'Ridgeline Ops'", status: { cls: 'pass', text: '\u2713' } });
    expect(row.verdict).toEqual({ cls: 'verdict-pass', text: 'PASS' });
    expect(row.vlp?.verdicts).toEqual([{ badgeCls: 'verdict-pass', label: 'SAT (automated)' }]);
    expect(s.steps[T1].status).toEqual({ cls: 'pass', text: 'PASS' });
    expect(s.steps[T1].expanded).toBe(false);
  });

  it('manual gates show the flag, then MANUAL_GATE', () => {
    const s = run([
      start(T1, { engine: 'manual_gate' }),
      sub(T1, 'gate'),
      { type: 'sub_command_result', taskId: T1, subId: 'gate', status: 'pass' },
      { type: 'task_result', taskId: T1, status: 'pass' },
    ]);
    expect(s.subs[`${T1}::gate`].status).toEqual({ cls: 'manual_gate', text: '\u2690' });
    expect(s.steps[T1].status).toEqual({ cls: 'manual_gate', text: 'MANUAL_GATE' });
  });

  it('maps every task status the way legacy does', () => {
    const statuses: Array<[string, string]> = [
      ['fail', 'FAIL'],
      ['excluded', 'EXCLUDED'],
      ['document-absence', 'ABSENT'],
      ['document-prohibition', 'PROHIBITED'],
      ['inherit-fedramp', 'INHERITED'],
      ['nonstack', 'NON-STACK'],
      ['skip', 'SKIP'],
      ['accomplished', 'PASS'],
    ];
    for (const [status, text] of statuses) {
      expect(run([start(T1), { type: 'task_result', taskId: T1, status }]).steps[T1].status.text).toBe(text);
    }
  });

  it('approval requests mark rows WAITING with the legacy body targets', () => {
    let s = run([start(T1), sub(T1, 'grp-ops'), { type: 'sub_command_approve_request', taskId: T1, subId: 'grp-ops', preCheck: { alreadyApplied: true } }]);
    expect(s.subs[`${T1}::grp-ops`]).toMatchObject({ awaiting: true, approval: { preCheck: { alreadyApplied: true } } });
    expect(s.steps[T1].status).toEqual({ cls: 'waiting', text: 'WAITING' });
    s = reduceExecEvent(s, { type: 'task_approve_request', taskId: T1, idempotency: 'safe' }, quiet);
    expect(s.steps[T1].approval).toEqual({ idempotency: 'safe' });
    s = reduceExecEvent(s, { type: 'task_approve_request', taskId: 'orphan' }, quiet);
    s = reduceExecEvent(s, { type: 'layer_approve_request', layer: 3, taskCount: 4 }, quiet);
    expect(s.items.slice(-2).map((i) => i.kind)).toEqual(['task-approval', 'layer']);
  });

  it('downstream impact on failure keeps the step open', () => {
    const s = run([
      start(T1),
      { type: 'task_result', taskId: T1, status: 'fail', downstreamImpact: [{ taskId: T2, variables: ['groupId'] }] },
    ]);
    expect(s.steps[T1].impact).toBe(`\u26A0 Affects 1 downstream task: ${T2} (groupId)`);
    expect(s.steps[T1].expanded).toBe(true);
  });

  it('verbose-only stream lines appear only when verbose was on', () => {
    const stream: ExecEvent = { type: 'sub_command_stream', taskId: T1, subId: 'grp-ops', phase: 'get_command', command: 'Get-MgGroup', stdout: 'x', durationMs: 12 };
    expect(run([start(T1), sub(T1, 'grp-ops'), stream]).subs[`${T1}::grp-ops`].lines).toEqual([]);
    const lines = run([start(T1), sub(T1, 'grp-ops'), stream], loud).subs[`${T1}::grp-ops`].lines;
    expect(lines).toEqual([
      { kind: 'stream', badgeCls: 'precheck', badge: 'PRE-CHECK', command: 'Get-MgGroup', durationMs: 12, stdout: 'x', stderr: '', verboseOnly: true },
    ]);
  });

  it('accomplished_query lines are always shown', () => {
    const s = run([
      start(T1),
      sub(T1, 'grp-ops'),
      { type: 'accomplished_query', taskId: T1, subId: 'grp-ops', command: 'Get-MgGroup', captures: { groupId: 'g-1' } },
    ]);
    expect(s.subs[`${T1}::grp-ops`].lines.map((l) => l.kind)).toEqual(['note', 'captures']);
  });

  it('summary, control results and the counter', () => {
    const s = run([
      { type: 'execution_scope', stepsTotal: 2, actionsTotal: 3 },
      start(T1),
      sub(T1, 'grp-ops'),
      { type: 'task_result', taskId: T1, status: 'pass' },
      { type: 'summary', total: 2, pass: 1, fail: 1, skip: 0, accomplished: 0, reportJson: 'C:/runs/execution-report-x.json' },
      { type: 'execution_results_manifest', data: { results: [{ controlId: 'AC.L2-3.1.1', directive: 'automated', verdict: 'SAT', outcome: 'automated_success' }] } },
    ]);
    expect(s.counter.text).toBe('1/2 steps \u00B7 1/3 actions');
    expect(s.summary).toEqual({ total: 2, pass: 1, accomplished: 0, fail: 1, skip: 0, reportJson: 'C:/runs/execution-report-x.json' });
    expect(s.controlResults).toEqual([{ controlId: 'AC.L2-3.1.1', directive: 'automated', verdict: 'SAT', outcome: 'automated_success' }]);
  });
});

describe('card-4 grid (legacy L5174-5283)', () => {
  it('counts steps per layer group and actions with skip/accomplished in the pass row', () => {
    const s = run([
      start(T1, { layer: 2 }),
      start(T2, { layer: 8 }),
      sub(T1, 'a'),
      { type: 'sub_command_result', taskId: T1, subId: 'a', status: 'skip' },
      { type: 'sub_command_result', taskId: T2, subId: 'b', status: 'fail' },
      { type: 'task_result', taskId: T1, status: 'accomplished' },
      { type: 'task_result', taskId: T2, status: 'document-absence' },
    ]);
    expect(s.grid.visible).toBe(true);
    expect(gridStepCell(s.grid, 'l03', 'pass')).toBe(1);
    expect(gridStepCell(s.grid, 'l8', 'excluded')).toBe(1);
    expect(gridStepCell(s.grid, 'total', 'pass')).toBe(1);
    expect(gridActionCell(s.grid, 'pass')).toBe(1);
    expect(gridActionCell(s.grid, 'fail')).toBe(1);
  });
});

describe('terminal (legacy L8423-8526, L8797-8829)', () => {
  const fail: ExecEvent[] = [
    start(T1),
    sub(T1, 'grp-ops'),
    { type: 'sub_command_stream', taskId: T1, subId: 'grp-ops', phase: 'set_command', command: 'New-MgGroup', stdout: '', exitCode: 1 },
    { type: 'sub_command_stream', taskId: T1, subId: 'grp-ops', phase: 'stdout_chunk', stdout: '{"error":{"code":"Forbidden","message":"Denied"}}' },
  ];

  it('discards buffered I/O on success', () => {
    const s = run([...fail.slice(0, 3), { type: 'sub_command_result', taskId: T1, subId: 'grp-ops', status: 'pass' }]);
    expect(s.terminal).toEqual([]);
    expect(s.termBuffers).toEqual({});
  });

  it('flushes the buffer with separator and FAIL verdict on failure', () => {
    const s = run([...fail, { type: 'sub_command_result', taskId: T1, subId: 'grp-ops', status: 'fail', label: 'Create group' }]);
    expect(s.terminal.map((b) => b.kind)).toEqual(['separator', 'action', 'line', 'verdict']);
    expect(s.terminal[0]).toEqual({ kind: 'separator', time: '09:05:07', id: 'grp-ops', label: 'Create group' });
    expect(s.terminal[2]).toMatchObject({ kind: 'line', phase: 'set', label: 'SET', stdout: '{"error":{"code":"Forbidden","message":"Denied"}}' });
  });

  it('adds "Task failed" when only the header was buffered', () => {
    const s = run([start(T1), sub(T1, 'x'), { type: 'sub_command_result', taskId: T1, subId: 'x', status: 'fail', message: 'boom' }]);
    expect(s.terminal.map((b) => b.kind)).toEqual(['separator', 'action', 'error', 'verdict']);
  });

  it('pulls Graph and OData error messages out of JSON stdout', () => {
    expect(jsonErrorMessage('{"error":{"code":"Forbidden","message":"Denied"}}')).toBe('Forbidden: Denied');
    expect(jsonErrorMessage('{"odata.error":{"message":{"value":"Nope"}}}')).toBe('Nope');
    expect(jsonErrorMessage('plain')).toBeNull();
  });
});

describe('run log (legacy accumulateRunLog L5304-5414)', () => {
  it('builds entries, streams, statuses and the summary', () => {
    const b = new RunLogBuilder({ startedAt: 'x', planPath: 'p.json', tenant: 'dev', mode: 'auto', dryRun: true });
    const events: ExecEvent[] = [
      start(T1),
      sub(T1, 'grp-ops'),
      { type: 'sub_command_stream', taskId: T1, subId: 'grp-ops', phase: 'set_command', command: 'New-MgGroup', stdout: 'ok', exitCode: 0 },
      { type: 'sub_command_result', taskId: T1, subId: 'grp-ops', status: 'fail', message: 'denied', outcome: 'failed_no_remediation' },
      start(T2),
      { type: 'task_result', taskId: T2, status: 'skip', message: 'n/a' },
      { type: 'summary', total: 2, pass: 0, fail: 1, skip: 1 },
    ];
    for (const e of events) b.accumulate(e, NOW);
    expect(b.log.consoleLog).toHaveLength(events.length);
    expect(b.log.entries).toHaveLength(2);
    expect(b.log.entries[0]).toMatchObject({ subId: 'grp-ops', status: 'fail', message: 'denied', outcome: 'failed_no_remediation', layer: 2 });
    expect(b.log.entries[0].streams[0]).toMatchObject({ phase: 'set_command', stdout: 'ok', evidenceFile: null, captures: null });
    expect(b.log.entries[1]).toMatchObject({ subId: '(task)', status: 'skip', message: 'n/a' });
    expect(b.log.summary).toEqual({ total: 2, pass: 0, fail: 1, skip: 1, accomplished: 0 });
    expect(b.log.finishedAt).toBe(NOW.toISOString());
  });
});
