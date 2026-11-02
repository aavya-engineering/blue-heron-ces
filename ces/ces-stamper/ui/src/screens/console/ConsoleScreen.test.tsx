// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Console screen (right column): tabs, terminal transcript, forced verbose, Save Log,
// row order (plain rows, then execute rows), and axe.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { resetRunLog, useConsoleStore } from '../../store/console';
import { handleExecEvent, resetExecution, runExecute, setExecEventSourceFactory, useExecuteStore } from '../../store/execute';
import type { ExecEventSourceFactory } from '../../store/execute';
import { useTranslateStore } from '../../store/translate';
import { seriousAxe } from '../console/axe-helper';
import { splitLeadingLogs } from './ConsolePanel';
import ConsoleScreen from './index';

let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;

beforeEach(() => {
  restoreFetch = setFetcher(async () => new Response(JSON.stringify({ ok: true, path: 'C:/ces-fixture/logs/run-log-2.json' }), { status: 200 }));
  restoreSource = setExecEventSourceFactory(() => ({ onmessage: null, onerror: null, close() {} }));
  resetExecution();
  resetRunLog();
  useWorkflowStore.getState().reset();
});

afterEach(() => {
  cleanup();
  if (restoreFetch) setFetcher(restoreFetch);
  if (restoreSource) setExecEventSourceFactory(restoreSource);
});

function start() {
  act(() => {
    useWorkflowStore.getState().selectTenant('dev');
    useTranslateStore.getState().setOutputPath('C:/ces-fixture/plans/ep.json');
    runExecute('auto');
  });
}

const failing = [
  { type: 'task_start', taskId: 't1', label: 'Create group', engine: 'mgraph' },
  { type: 'sub_command', taskId: 't1', subId: 'grp', index: 1, total: 1, engine: 'mgraph', command: 'New-MgGroup -x' },
  { type: 'sub_command_stream', taskId: 't1', subId: 'grp', phase: 'set_command', command: 'New-MgGroup -x', stdout: 'Forbidden', exitCode: 1 },
  { type: 'sub_command_result', taskId: 't1', subId: 'grp', status: 'fail', label: 'Create group', message: 'denied' },
];

describe('Console screen', () => {
  it('Save Log without a run says so', async () => {
    render(<ConsoleScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Save Log' }));
    expect(document.querySelector('#rlogSaveMsg')).toHaveTextContent('No execution data to save');
  });

  it('the Terminal tab shows the flushed failure and forces verbose during a run', async () => {
    render(<ConsoleScreen />);
    start();
    act(() => failing.forEach((e) => handleExecEvent(e)));
    await userEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(document.querySelector('#taskList')).not.toBeVisible();
    const term = document.querySelector('#terminalList') as HTMLElement;
    expect(term).toBeVisible();
    expect(term).toHaveTextContent('FAIL');
    expect(term).toHaveTextContent('New-MgGroup -x');
    expect(useExecuteStore.getState().verbose).toBe(true);
    expect(document.querySelector('#termVerboseHint')).toHaveTextContent('(verbose forced)');
  });

  it('Save Log after a run posts it and shows the path', async () => {
    render(<ConsoleScreen />);
    start();
    act(() => failing.forEach((e) => handleExecEvent(e)));
    await userEvent.click(screen.getByRole('button', { name: 'Save Log' }));
    await waitFor(() => expect(document.querySelector('#rlogSaveMsg')).toHaveTextContent('Saved: C:/ces-fixture/logs/run-log-2.json'));
  });

  it('keeps plain rows before the first execute row in the kit ConsoleView', () => {
    act(() => {
      useConsoleStore.getState().appendLog('Connecting...');
      useConsoleStore.getState().appendLog('Connected', 'success');
    });
    const { leading, rest } = splitLeadingLogs(useConsoleStore.getState().items);
    expect(leading.map((e) => e.message)).toEqual(['Connecting...', 'Connected']);
    expect(rest).toEqual([]);
    render(<ConsoleScreen />);
    expect(document.querySelectorAll('#taskList .connection-log-row')).toHaveLength(2);
    expect(document.querySelector('#taskList .connection-log-row .log-icon.success')).not.toBeNull();
  });

  it('has no serious or critical axe findings with both tabs', async () => {
    const { container } = render(<ConsoleScreen />);
    start();
    act(() => failing.forEach((e) => handleExecEvent(e)));
    act(() => handleExecEvent({ type: 'summary', total: 1, pass: 0, fail: 1, skip: 0 }));
    act(() => handleExecEvent({ type: 'done' }));
    expect(await seriousAxe(container)).toEqual([]);
    await userEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(await seriousAxe(container)).toEqual([]);
  });
});
