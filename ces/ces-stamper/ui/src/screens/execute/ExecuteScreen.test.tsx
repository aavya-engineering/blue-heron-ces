// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Execute screen (card 4 + right column): demo-driver ids, Halt while running,
// approvals, report links, the progress grid, the ledger drawer and its export, and axe.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { resetRunLog } from '../../store/console';
import { resetExecution, setExecEventSourceFactory, useExecuteStore } from '../../store/execute';
import type { ExecEventSource, ExecEventSourceFactory } from '../../store/execute';
import { useTranslateStore } from '../../store/translate';
import { STAMPER_SELECTORS } from '../../../e2e/parity/selectors';
import { seriousAxe } from '../console/axe-helper';
import ExecuteScreen from './index';

let bodies: unknown[] = [];
let source: (ExecEventSource & { closed: boolean }) | null = null;
let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;

const emit = (event: object) => act(() => source?.onmessage?.({ data: JSON.stringify(event) }));

beforeEach(() => {
  bodies = [];
  restoreFetch = setFetcher(async (_url, init) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  restoreSource = setExecEventSourceFactory(() => {
    source = { onmessage: null, onerror: null, closed: false, close() { this.closed = true; } };
    return source;
  });
  resetExecution();
  resetRunLog();
  useWorkflowStore.getState().reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  source = null;
  if (restoreFetch) setFetcher(restoreFetch);
  if (restoreSource) setExecEventSourceFactory(restoreSource);
  vi.restoreAllMocks();
});

function startRun(container: HTMLElement) {
  act(() => {
    useWorkflowStore.getState().selectTenant('dev');
    useTranslateStore.getState().setOutputPath('C:/ces-fixture/plans/ep.json');
  });
  act(() => (container.querySelector(STAMPER_SELECTORS.execute) as HTMLButtonElement).click());
}

describe('Execute screen', () => {
  it('keeps the demo driver ids and the legacy options', () => {
    const { container } = render(<ExecuteScreen />);
    expect(container.querySelector(STAMPER_SELECTORS.card(4))?.classList.contains('card-collapsed')).toBe(false);
    expect(container.querySelector(STAMPER_SELECTORS.cardStatus4)).toHaveTextContent('Locked');
    const mode = container.querySelector(STAMPER_SELECTORS.execMode) as HTMLSelectElement;
    expect(Array.from(mode.options).map((o) => [o.value, o.text])).toEqual([
      ['manual', 'Incremental'],
      ['batch', 'Batch'],
      ['auto', 'Automatic'],
    ]);
    expect(mode.value).toBe('auto');
    const target = container.querySelector(STAMPER_SELECTORS.execTarget) as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.value)).toEqual(['dryrun', 'tenant']);
    expect(container.querySelector(STAMPER_SELECTORS.execute)).toBeEnabled();
    expect(container.querySelector(STAMPER_SELECTORS.executeHalt)).toBeNull();
    expect(container.querySelector('#taskList')).not.toBeNull();
    expect(container.querySelector('#terminalList')).not.toBeNull();
  });

  it('FG-4: the target select reads Tenant again after dev, and sticks when set', async () => {
    const { container } = render(<ExecuteScreen />);
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    const target = container.querySelector(STAMPER_SELECTORS.execTarget) as HTMLSelectElement;
    expect(target.value).toBe('dryrun');
    act(() => useWorkflowStore.getState().selectTenant('ridgeline-machining'));
    expect(target.value).toBe('tenant');
    await userEvent.selectOptions(target, 'dryrun');
    await userEvent.selectOptions(target, 'tenant');
    expect(target.value).toBe('tenant');
  });

  it('shows Halt while running; Halt posts /api/abort', async () => {
    const { container } = render(<ExecuteScreen />);
    startRun(container);
    expect(container.querySelector(STAMPER_SELECTORS.cardStatus4)).toHaveTextContent('Executing...');
    expect(container.querySelector(STAMPER_SELECTORS.execute)).toBeDisabled();
    const halt = container.querySelector(STAMPER_SELECTORS.executeHalt) as HTMLButtonElement;
    expect(halt).not.toBeNull();
    await userEvent.click(halt);
    await waitFor(() => expect(container.querySelector(STAMPER_SELECTORS.cardStatus4)).toHaveTextContent('Halted'));
    expect(source?.closed).toBe(true);
    expect(container.querySelector(STAMPER_SELECTORS.executeHalt)).toBeNull();
  });

  it('renders step rows, an approval row and the report links of a partial run', async () => {
    const { container } = render(<ExecuteScreen />);
    startRun(container);
    emit({ type: 'log', message: 'Engine ready' });
    emit({ type: 'execution_scope', stepsTotal: 1, actionsTotal: 1 });
    emit({ type: 'task_start', taskId: 'step_task_AC.L2-3.1.1_fx', label: 'Limit access', engine: 'mgraph', subCommandCount: 1, layer: 1 });
    emit({ type: 'sub_command', taskId: 'step_task_AC.L2-3.1.1_fx', subId: 'grp', index: 1, total: 1, engine: 'mgraph', command: 'New-MgGroup -x' });
    emit({ type: 'sub_command_approve_request', taskId: 'step_task_AC.L2-3.1.1_fx', subId: 'grp' });
    expect(container.querySelector('#step-row-step_task_AC-L2-3-1-1_fx')).not.toBeNull();
    expect(container.querySelector('#step-status-step_task_AC-L2-3-1-1_fx')).toHaveTextContent('WAITING');
    const row = container.querySelector('#sub-approval-step_task_AC-L2-3-1-1_fx-grp') as HTMLElement;
    expect(row).not.toBeNull();
    await userEvent.click(row.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector('#sub-approval-step_task_AC-L2-3-1-1_fx-grp')).toBeNull());
    expect(bodies).toContainEqual({ taskId: 'step_task_AC.L2-3.1.1_fx', subId: 'grp', decision: 'approve' });

    emit({ type: 'sub_command_result', taskId: 'step_task_AC.L2-3.1.1_fx', subId: 'grp', status: 'fail', message: 'denied' });
    emit({ type: 'task_result', taskId: 'step_task_AC.L2-3.1.1_fx', status: 'fail' });
    emit({ type: 'summary', total: 2, pass: 1, fail: 1, skip: 0, reportJson: 'C:/ces-fixture/execution-report-1.json', reportMd: 'C:/ces-fixture/execution-report-1.md' });
    emit({ type: 'done' });
    expect(container.querySelector(STAMPER_SELECTORS.cardStatus4)).toHaveTextContent('Partial (1 failed)');
    expect(Array.from(container.querySelectorAll(STAMPER_SELECTORS.reportLinks)).map((a) => a.textContent)).toEqual([
      'C:/ces-fixture/execution-report-1.json',
      'C:/ces-fixture/execution-report-1.md',
    ]);
    expect(container.querySelector('#btnRetry')).not.toBeNull();
    expect(container.querySelector('#val_l03_fail')).toHaveTextContent('1');
    expect(container.querySelector('#executeCounter')).toHaveTextContent('1/1 steps \u00B7 1/1 actions');
    expect(container.querySelector('#taskList .connection-log-row .log-msg')).toHaveTextContent('Engine ready');
    expect(container.querySelector('#errorLogPanel')).not.toBeNull();
  });

  it('opens the resource ledger and exports the filtered rows', async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:fixture';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(window, 'prompt').mockReturnValue('Avery Quill');
    const { container } = render(<ExecuteScreen />);
    startRun(container);
    emit({ type: 'execution_start' });
    emit({ type: 'task_start', taskId: 't1', label: 'x' });
    emit({ type: 'sub_command_stream', taskId: 't1', subId: 'grp', phase: 'set_command', exitCode: 0, command: 'New-MgGroup -x' });
    const button = container.querySelector('#resourcesFloatBtn') as HTMLButtonElement;
    expect(container.querySelector('#resourceBadge')).toHaveTextContent('1');
    await userEvent.click(button);
    expect(container.querySelector('#resourceLedgerPanel')).not.toBeNull();
    expect(container.querySelector('#ledgerCount')).toHaveTextContent('1 / 1 resources');
    await userEvent.click(container.querySelector('[data-format="csv"]') as HTMLButtonElement);
    await waitFor(() => expect(created).toHaveLength(1));
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });
    expect(text.split('\n')[0]).toBe('Category,Type,Path,Step,Cmdlet,Timestamp');
    expect(window.sessionStorage.getItem('stamper_resourceTracker_operator')).toBe('Avery Quill');
  });

  it('has no serious or critical axe findings, idle and mid-run', async () => {
    const { container } = render(<ExecuteScreen />);
    expect(await seriousAxe(container)).toEqual([]);
    startRun(container);
    emit({ type: 'task_start', taskId: 't1', label: 'x', engine: 'mgraph' });
    emit({ type: 'sub_command', taskId: 't1', subId: 'a', index: 1, total: 1, engine: 'mgraph', command: 'Get-X' });
    emit({ type: 'sub_command_approve_request', taskId: 't1', subId: 'a' });
    emit({ type: 'layer_approve_request', layer: 1, taskCount: 2 });
    expect(useExecuteStore.getState().running).toBe(true);
    expect(await seriousAxe(container)).toEqual([]);
  });
});
