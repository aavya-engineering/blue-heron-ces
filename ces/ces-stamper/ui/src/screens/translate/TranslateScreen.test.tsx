// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2: Translate screen (card 3, dev quick run): demo-driver selectors, lock state,
// the translate click, and axe (no serious or critical findings; AD-4).

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { resetExecution, setExecEventSourceFactory } from '../../store/execute';
import type { ExecEventSourceFactory } from '../../store/execute';
import { useTranslateStore } from '../../store/translate';
import { STAMPER_SELECTORS } from '../../../e2e/parity/selectors';
import { seriousAxe } from '../console/axe-helper';
import TranslateScreen, { DevQuickRun } from './index';

let calls: string[] = [];
let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;

beforeEach(() => {
  calls = [];
  restoreFetch = setFetcher(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    const body = url.startsWith('/api/translate')
      ? { success: true, planId: 'p', totalTasks: 1, planDataPaths: { output: 'C:/ces-fixture/plans/ep.json' } }
      : { ok: true, exists: true };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  restoreSource = setExecEventSourceFactory(() => ({ onmessage: null, onerror: null, close() {} }));
  resetExecution();
  useWorkflowStore.getState().reset();
});

afterEach(() => {
  cleanup();
  if (restoreFetch) setFetcher(restoreFetch);
  if (restoreSource) setExecEventSourceFactory(restoreSource);
});

describe('Translate screen', () => {
  it('keeps the demo driver selectors and starts locked', () => {
    const { container } = render(<TranslateScreen />);
    const card = container.querySelector(STAMPER_SELECTORS.card(3));
    expect(card).not.toBeNull();
    expect(card?.classList.contains('card-collapsed')).toBe(false);
    expect(card?.classList.contains('card-locked')).toBe(true);
    expect(container.querySelector(STAMPER_SELECTORS.cardStatus3)).toHaveTextContent('Locked');
    const button = container.querySelector(STAMPER_SELECTORS.translate);
    expect(button).not.toBeNull();
    expect(button).toBeDisabled();
    expect(typeof (button as unknown as { doTranslate?: unknown }).doTranslate).toBe('function');
    expect(container.querySelector('#outputPath')).toHaveAttribute('readonly');
  });

  it('translates when unlocked and shows the result', async () => {
    const { container } = render(<TranslateScreen />);
    act(() => {
      useWorkflowStore.getState().selectTenant('dev');
      useWorkflowStore.getState().completeStep('assess');
      useTranslateStore.getState().setPlanInputs({ missionPlan: 'C:/ces-fixture/mp.json', manifest: 'C:/ces-fixture/tm.json' });
    });
    const button = container.querySelector(STAMPER_SELECTORS.translate) as HTMLButtonElement;
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(container.querySelector(STAMPER_SELECTORS.cardStatus3)).toHaveTextContent('Translated'));
    expect(calls).toEqual(['POST /api/translate', 'GET /api/validate-file']);
    expect(container.querySelector('#outputPath')).toHaveValue('C:/ces-fixture/plans/ep.json');
    expect(container.querySelector('#statusBar')).toHaveTextContent('Translated: p \u2014 1 tasks');
  });

  it('Gaps Only and Automated Only disable each other', async () => {
    render(<TranslateScreen />);
    const gaps = screen.getByLabelText('Gaps Only');
    const auto = screen.getByLabelText('Automated Only');
    expect(auto).toBeChecked();
    expect(gaps).toBeDisabled();
    await userEvent.click(auto);
    expect(gaps).toBeEnabled();
    await userEvent.click(gaps);
    expect(auto).toBeDisabled();
  });

  it('leaves the dev quick run to the shell (outside the cards, W8-SPA4)', () => {
    const { container } = render(<TranslateScreen />);
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    expect(container.querySelector('#devQuickRunWrap')).toBeNull();
  });

  it('DevQuickRun shows for the dev tenant only', () => {
    const { container } = render(<DevQuickRun />);
    expect(container.querySelector('#devQuickRunWrap')).toBeNull();
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    expect(container.querySelector('#btnQuickExecAuto')).toHaveTextContent('Translate & Execute (Auto)');
    expect(container.querySelector('#btnQuickExecManual')).toHaveTextContent('Translate & Execute (Manual)');
  });

  it('has no serious or critical axe findings', async () => {
    const { container } = render(<TranslateScreen />);
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    expect(await seriousAxe(container)).toEqual([]);
  });
});
