// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-16 (COST-GATE-SPEC §3.5 GUI; V115): the execute screen's DP-2 dialog. While a run is open
// on a non-dev tenant it polls GET /api/cost-gate/pending, shows the price and the exact text to
// type, and answers with POST /api/approve { gateType: 'cost', entryId, typed, operator, ... }.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { resetExecution, setExecEventSourceFactory, useExecuteStore } from '../../store/execute';
import type { ExecEventSourceFactory } from '../../store/execute';
import { seriousAxe } from '../console/axe-helper';
import { CostDp2Dialog } from './index';

const ENTRY = 'SC.L2-3.13.10.key-vault';
const EXPECTED = `${ENTRY} $4.56`;
const PROMPT = {
  entryId: ENTRY, label: 'Customer Key Vault', controlIds: ['SC.L2-3.13.10'], costKey: 'kv.standard', estimate: '$4.56',
  estimateBasis: '1 vault, per-use operations', priceDate: '2026-10-31', standardAlternative: ['SC.L2-3.13.10.key-escrow'],
  expected: EXPECTED, gateKey: `cost::${ENTRY}`, requestedAt: '2026-10-31T12:00:00.000Z',
};

let calls: Array<{ method: string; url: string; body: any }> = [];
let pending: object[] = [];
let approveReply: { status: number; body: object } = { status: 200, body: { ok: true, outcome: 'accepted' } };
let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;

beforeEach(() => {
  calls = [];
  pending = [PROMPT];
  approveReply = { status: 200, body: { ok: true, outcome: 'accepted' } };
  restoreFetch = setFetcher(async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith('/api/cost-gate/pending')) return new Response(JSON.stringify({ pending }), { status: 200 });
    if (url.startsWith('/api/approve')) {
      if (approveReply.status === 200) pending = [];
      return new Response(JSON.stringify(approveReply.body), { status: approveReply.status });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

function openRun(tenant: string) {
  act(() => {
    useWorkflowStore.getState().selectTenant(tenant);
    useExecuteStore.setState({ running: true });
  });
}

describe('Execute DP-2 dialog (FIN-16)', () => {
  it('does not poll when no run is open, or for dev', async () => {
    const { container } = render(<CostDp2Dialog />);
    act(() => useWorkflowStore.getState().selectTenant('sim-s1'));
    openRun('dev');
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('#costDp2Dialog')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('shows the price and the exact text; Start posts gateType cost with typed and operator', async () => {
    const { container } = render(<CostDp2Dialog />);
    openRun('sim-s1');
    await waitFor(() => expect(container.querySelector('#costDp2Dialog')).not.toBeNull());
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/cost-gate/pending' });
    expect(container.querySelector('#costDp2Dialog')).toHaveAttribute('role', 'dialog');
    expect(container.querySelector('#costDp2Estimate')).toHaveTextContent('about $4.56 a month (1 vault, per-use operations; price date 2026-10-31)');
    expect(container.querySelector('#costDp2Expected')).toHaveTextContent(EXPECTED);
    expect(container.querySelector('#costDp2Dialog')).toHaveTextContent('SC.L2-3.13.10.key-escrow');
    await userEvent.type(container.querySelector('#costDp2Typed') as HTMLInputElement, EXPECTED);
    await userEvent.type(container.querySelector('#costDp2Operator') as HTMLInputElement, 'op-1');
    await userEvent.click(container.querySelector('#costDp2Confirm') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector('#costDp2Dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/approve');
    expect(post?.body).toEqual({ gateType: 'cost', entryId: ENTRY, decision: 'approve', typed: EXPECTED, operator: 'op-1', tenant: 'sim-s1', automated: false });
  });

  it('Refuse posts a skip without typed text', async () => {
    const { container } = render(<CostDp2Dialog />);
    openRun('sim-s1');
    await waitFor(() => expect(container.querySelector('#costDp2Dialog')).not.toBeNull());
    await userEvent.click(container.querySelector('#costDp2Refuse') as HTMLButtonElement);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ gateType: 'cost', entryId: ENTRY, decision: 'skip', tenant: 'sim-s1', automated: false });
  });

  it('a 400 (no name) keeps the dialog open with the server message', async () => {
    approveReply = { status: 400, body: { ok: false, error: 'operator is required for a cost gate' } };
    const { container } = render(<CostDp2Dialog />);
    openRun('sim-s1');
    await waitFor(() => expect(container.querySelector('#costDp2Dialog')).not.toBeNull());
    await userEvent.type(container.querySelector('#costDp2Typed') as HTMLInputElement, EXPECTED);
    await userEvent.click(container.querySelector('#costDp2Confirm') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector('#costDp2Dialog [role="alert"]')).toHaveTextContent('operator is required'));
    expect(container.querySelector('#costDp2Dialog')).not.toBeNull();
  });

  it('has no serious or critical axe findings', async () => {
    const { container } = render(<CostDp2Dialog />);
    openRun('sim-s1');
    await waitFor(() => expect(container.querySelector('#costDp2Dialog')).not.toBeNull());
    expect(await seriousAxe(container)).toEqual([]);
  });
});
