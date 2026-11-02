// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-16 (COST-GATE-SPEC §3.4; V115): the translate screen's DP-1 list. Recurring items are shown
// unticked with their price; ticking one asks for the typed entry id and the operator; the opt-in
// posts /api/cost-gate/ack and the list reloads ticked. Hidden (no request) for `dev`.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import { resetExecution, setExecEventSourceFactory } from '../../store/execute';
import type { ExecEventSourceFactory } from '../../store/execute';
import { seriousAxe } from '../console/axe-helper';
import { CostOptInList } from './index';

const ENTRY = 'SC.L2-3.13.10.key-vault';
let calls: Array<{ method: string; url: string; body: unknown }> = [];
let acked = false;
let restoreFetch: Fetcher | null = null;
let restoreSource: ExecEventSourceFactory | null = null;

function items() {
  return {
    tenant: 'sim-s1',
    price_date: '2026-10-31',
    items: [
      {
        entry_id: ENTRY, label: 'Customer Key Vault', kind: 'registry_entry', control_ids: ['SC.L2-3.13.10'], cost_key: 'kv.standard',
        estimate: '$4.56', estimate_month_low: 4.56, estimate_month_high: 4.56, estimate_basis: '1 vault, per-use operations',
        price_date: '2026-10-31', standard_alternative: ['SC.L2-3.13.10.key-escrow'], last_resort: false, acked,
        ...(acked ? { operator: 'op-1' } : {}),
      },
      { entry_id: 'AZ-X', label: 'Unpriced', kind: 'registry_entry', acked: false, unavailable: 'DP-1 refused: AZ-X has no price (cost_key none)' },
    ],
  };
}

beforeEach(() => {
  calls = [];
  acked = false;
  restoreFetch = setFetcher(async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/cost-gate/items')) return new Response(JSON.stringify(items()), { status: 200 });
    if (url.startsWith('/api/cost-gate/ack')) {
      if ((body as { typed?: string }).typed !== ENTRY) {
        return new Response(JSON.stringify({ error: `DP-1 refused: typed text does not match the entry id ${ENTRY}` }), { status: 400 });
      }
      acked = true;
      return new Response(JSON.stringify({ ok: true, estimate: '$4.56', price_date: '2026-10-31' }), { status: 200 });
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

describe('Translate DP-1 opt-in list (FIN-16)', () => {
  it('is hidden and makes no request for dev or no tenant', () => {
    const { container } = render(<CostOptInList />);
    expect(container.querySelector('#costOptInList')).toBeNull();
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    expect(container.querySelector('#costOptInList')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('lists recurring items unticked with their price, and refuses a wrong typed id', async () => {
    act(() => useWorkflowStore.getState().selectTenant('sim-s1'));
    const { container } = render(<CostOptInList />);
    await waitFor(() => expect(container.querySelector(`[data-cost-entry="${ENTRY}"]`)).not.toBeNull());
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/cost-gate/items?tenant=sim-s1' });
    const row = container.querySelector(`[data-cost-entry="${ENTRY}"]`) as HTMLElement;
    const box = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(row).toHaveTextContent('about $4.56 a month (1 vault, per-use operations; price date 2026-10-31)');
    expect(row).toHaveTextContent('free alternative: SC.L2-3.13.10.key-escrow');
    expect(container.querySelector('summary')).toHaveTextContent('0 of 2 opted in; price date 2026-10-31');
    const unpriced = container.querySelector('[data-cost-entry="AZ-X"] input') as HTMLInputElement;
    expect(unpriced).toBeDisabled();

    await userEvent.click(box);
    const form = container.querySelector(`[data-cost-ack-form="${ENTRY}"]`) as HTMLElement;
    expect(form).not.toBeNull();
    const [typedInput, operatorInput] = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
    await userEvent.type(typedInput, 'yes');
    await userEvent.type(operatorInput, 'op-1');
    await userEvent.click(form.querySelector('button.btn-primary') as HTMLButtonElement);
    await waitFor(() => expect(form.querySelector('[role="alert"]')).toHaveTextContent('does not match the entry id'));
    expect(acked).toBe(false);
  });

  it('records DP-1 with the typed entry id and the operator, then reloads ticked', async () => {
    act(() => useWorkflowStore.getState().selectTenant('sim-s1'));
    const { container } = render(<CostOptInList />);
    await waitFor(() => expect(container.querySelector(`[data-cost-entry="${ENTRY}"]`)).not.toBeNull());
    await userEvent.click(container.querySelector(`[data-cost-entry="${ENTRY}"] input[type="checkbox"]`) as HTMLInputElement);
    const form = container.querySelector(`[data-cost-ack-form="${ENTRY}"]`) as HTMLElement;
    const [typedInput, operatorInput] = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
    await userEvent.type(typedInput, ENTRY);
    await userEvent.type(operatorInput, 'op-1');
    await userEvent.click(form.querySelector('button.btn-primary') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector('#costOptInNotice')).toHaveTextContent('Translate again'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toMatchObject({ url: '/api/cost-gate/ack', body: { tenant: 'sim-s1', entryId: ENTRY, typed: ENTRY, operator: 'op-1' } });
    await waitFor(() => expect((container.querySelector(`[data-cost-entry="${ENTRY}"] input[type="checkbox"]`) as HTMLInputElement).checked).toBe(true));
    expect(container.querySelector(`[data-cost-entry="${ENTRY}"]`)).toHaveTextContent('opted in by op-1');
  });

  it('has no serious or critical axe findings', async () => {
    act(() => useWorkflowStore.getState().selectTenant('sim-s1'));
    const { container } = render(<CostOptInList />);
    await waitFor(() => expect(container.querySelector(`[data-cost-entry="${ENTRY}"]`)).not.toBeNull());
    (container.querySelector('#costOptInList') as HTMLDetailsElement).open = true;
    await userEvent.click(container.querySelector(`[data-cost-entry="${ENTRY}"] input[type="checkbox"]`) as HTMLInputElement);
    expect(await seriousAxe(container)).toEqual([]);
  });
});
