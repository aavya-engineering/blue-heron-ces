// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-33: the three SPA follow-ups from LOG-W8-SPAW Open items 3-5.
//   (1) one active-stream slot for connect, assess, baseline, preflight and execute (legacy one
//       `activeEventSource`);
//   (2) one verbose flag behind #verboseAssess and #verboseExecute (legacy syncVerbose);
//   (3) card 3 reads Pending, not Locked, once Translate is ready (legacy L5042 and L7610).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeExecSource, executeFromMatrix, setExecEventSourceFactory, useExecuteStore } from './execute';
import type { ExecEventSource, ExecEventSourceFactory } from './execute';
import { closeActiveStream, hasActiveStream, openActiveStream } from './tenant';
import { useAssessStore } from './assess';
import { useTranslateStore } from './translate';
import { useWorkflowStore } from './workflow';
import { useConsoleStore } from './console';
import { changeTenant } from '../screens/tenant/flow';
import { CMMC_STATUS, TENANT_CONFIG, flush, installHarness, on, resetStores } from '../screens/tenant/testUtils';
import type { Harness } from '../screens/tenant/testUtils';

class FakeExecSource implements ExecEventSource {
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

const EP = 'C:/ces-fixture/plan-data/dev/plans/executable-plan-x.json';
let h: Harness | null = null;
let execSources: FakeExecSource[] = [];
let restoreExec: ExecEventSourceFactory | null = null;

beforeEach(() => {
  resetStores();
  execSources = [];
  restoreExec = setExecEventSourceFactory((url) => {
    const s = new FakeExecSource(url);
    execSources.push(s);
    return s;
  });
});

afterEach(() => {
  closeActiveStream();
  h?.restore();
  h = null;
  if (restoreExec) setExecEventSourceFactory(restoreExec);
});

function startDevExecute(): FakeExecSource {
  useWorkflowStore.getState().selectTenant('dev');
  useTranslateStore.getState().setOutputPath(EP);
  executeFromMatrix();
  const s = execSources.at(-1);
  expect(s).toBeDefined();
  return s!;
}

describe('FIN-33 (1): one active stream', () => {
  it('a connect/assess/baseline/preflight stream closes a running execute, which then reads Halted', () => {
    h = installHarness([]);
    const exec = startDevExecute();
    expect(activeExecSource()).toBe(exec);
    expect(hasActiveStream()).toBe(true);
    expect(useExecuteStore.getState().running).toBe(true);

    // What assess, baseline, connect and preflight do before opening their stream.
    closeActiveStream();
    const other = openActiveStream('/api/assess?tenant=dev', () => undefined, () => undefined);

    expect(exec.closed).toBe(true);
    expect(activeExecSource()).toBeNull();
    expect(hasActiveStream()).toBe(true);
    expect(useExecuteStore.getState().running).toBe(false);
    expect(useExecuteStore.getState().badge).toEqual({ text: 'Halted', cls: 'status-error' });
    expect(useConsoleStore.getState().status?.text).toBe('Execution stream closed: another operation started.');
    expect(useWorkflowStore.getState().steps.execute).toBe('failed');
    expect(h.streams[0]).toBe(other);
  });

  it('an execute closes an open assess stream (legacy doExecute L7854), with no preempt side effect', () => {
    h = installHarness([]);
    const assess = openActiveStream('/api/assess?tenant=dev', () => undefined, () => undefined) as unknown as { closed: boolean };
    const exec = startDevExecute();
    expect(assess.closed).toBe(true);
    expect(activeExecSource()).toBe(exec);
    expect(useExecuteStore.getState().badge.text).toBe('Executing...');
  });

  it("the execute stream's own done closes only its own stream", () => {
    h = installHarness([]);
    const exec = startDevExecute();
    exec.emit({ type: 'done' });
    expect(exec.closed).toBe(true);
    expect(activeExecSource()).toBeNull();
    expect(hasActiveStream()).toBe(false);
  });

  it('a stream closed by its own owner does not run the preempt path', () => {
    h = installHarness([]);
    const first = openActiveStream('/api/connect?tenant=x', () => undefined, () => undefined) as unknown as { closed: boolean };
    closeActiveStream();
    expect(first.closed).toBe(true);
    expect(useConsoleStore.getState().status).toBeNull();
    expect(hasActiveStream()).toBe(false);
  });
});

describe('FIN-33 (2): one verbose flag', () => {
  it('keeps the legacy start state: Assess box checked, flag off, Execute box off', () => {
    expect(useAssessStore.getState().verboseChecked).toBe(true);
    expect(useAssessStore.getState().verboseMode).toBe(false);
    expect(useExecuteStore.getState().verbose).toBe(false);
  });

  it('#verboseAssess drives #verboseExecute and the other way round', () => {
    useAssessStore.getState().setVerbose(true);
    expect(useExecuteStore.getState().verbose).toBe(true);
    expect(useAssessStore.getState().verboseMode).toBe(true);

    useExecuteStore.getState().setVerbose(false);
    expect(useAssessStore.getState().verboseChecked).toBe(false);
    expect(useAssessStore.getState().verboseMode).toBe(false);

    useExecuteStore.getState().setVerbose(true);
    expect(useAssessStore.getState()).toMatchObject({ verboseChecked: true, verboseMode: true });
  });

  it('the Terminal-tab force (verbose on during an execute) ticks the Assess box too', () => {
    useAssessStore.getState().setVerbose(false);
    useConsoleStore.getState().setTab('terminal');
    startDevExecute();
    expect(useExecuteStore.getState().verbose).toBe(true);
    expect(useAssessStore.getState()).toMatchObject({ verboseChecked: true, verboseMode: true });
    expect(useConsoleStore.getState().verboseForced).toBe(true);
  });
});

describe('FIN-33 (3): card 3 badge once Translate is ready', () => {
  const base = [
    on('GET', '/api/tenants/ridgeline', { ok: true, config: TENANT_CONFIG }),
    on('GET', '/api/last-translate', { ok: false }),
    on('POST', '/api/save-run-log', { ok: true, path: 'C:\\runs\\assess.json' }),
  ];

  it('cached assess state: Pending, not Locked (legacy L5042)', async () => {
    h = installHarness([
      ...base,
      on('GET', '/api/assess-state', { accomplishedIds: ['ac-001'], cmmcStatus: CMMC_STATUS, timestamp: '2026-10-28T00:00:00.000Z' }),
    ]);
    await changeTenant('ridgeline');
    expect(useWorkflowStore.getState().steps.translate).toBe('ready');
    expect(useTranslateStore.getState().badge).toEqual({ text: 'Pending', cls: 'status-default' });
  });

  it('no cached state: card 3 stays Locked', async () => {
    h = installHarness(base);
    await changeTenant('ridgeline');
    expect(useTranslateStore.getState().badge).toEqual({ text: 'Locked', cls: 'status-locked' });
  });

  it('assess_done: Pending (legacy L7610)', async () => {
    h = installHarness(base);
    await changeTenant('ridgeline');
    useAssessStore.getState().doAssess();
    h.streams[0]!.emit({ type: 'assess_done' });
    await flush();
    expect(useTranslateStore.getState().badge).toEqual({ text: 'Pending', cls: 'status-default' });
  });
});
