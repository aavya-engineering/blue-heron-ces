// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BASE_ROUTES, fakeEo, renderAt, resetSession, seriousAxe } from '../../testUtils';
import { filterItems } from '.';

const ITEMS = [
  { id: 'stamper:AC-1', source: 'stamper', title: 'Conditional access baseline', controlIds: ['AC.L2-3.1.1'], timestamp: '', verdict: 'SAT', path: 'AC-1', requiresConnection: false },
  { id: 'signal:identitySignals', source: 'signal', title: 'Identity signals', controlIds: ['IA.L2-3.5.3'], timestamp: '', path: 'identitySignals', requiresConnection: true },
  { id: 'local:risk', source: 'local', title: 'Risk register', controlIds: [], timestamp: '', path: 'risk-register', requiresConnection: false },
  { id: 'adminops:1', source: 'adminops', title: 'AdminOps run', controlIds: ['CM.L2-3.4.1'], timestamp: '', path: 'ao:1', requiresConnection: false },
];
const STRUCTURED = {
  content: {
    complianceVerdict: 'SAT', outcome: 'compliant', verdictRationale: 'Policy present',
    metadata: { controlIds: ['AC.L2-3.1.1'], timestamp: '2026-10-31T10:00:00Z', sha256Hash: 'ffee', commandExecuted: 'Get-MgPolicy' },
    registryEntry: { label: 'CA baseline', entry_id: 'AC-1', engine: 'graph' },
  },
  metadata: { sha256: 'ffee', size: 1200 },
};

let eo: ReturnType<typeof fakeEo>;
let connectionState = 'disconnected';
beforeEach(() => {
  resetSession('s1-mach');
  connectionState = 'disconnected';
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/evidence-explorer/index': () => ({ body: { items: ITEMS, connectionState } }),
    'GET /api/evidence-explorer/item': (c) => (c.query.source === 'stamper' ? { body: STRUCTURED } : { body: { content: { entries: [] }, metadata: { timestamp: '2026-10-01' } } }),
    'GET /api/evidence-explorer/verify': { verified: true, expected: 'ffee', actual: 'ffee' },
    'POST /api/evidence-explorer/signal': { signalResults: [{ id: 'x', value: 1 }], timestamp: '2026-10-31T10:00:00Z' },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Evidence Explorer (FIN-31b)', () => {
  it('lists the index with source chips (incl. adminops) and filters by chip and search', async () => {
    renderAt('/evidence');
    expect(await screen.findByRole('button', { name: /Conditional access baseline/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'adminops' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'signal' }));
    expect(screen.queryByRole('button', { name: /Conditional access baseline/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'signal' }));
    await userEvent.type(screen.getByLabelText('Search by title or control ID'), 'cm.l2');
    expect(screen.getByRole('button', { name: /AdminOps run/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Risk register/ })).toBeNull();
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('opens a Stamper item as structured evidence and verifies its SHA-256', async () => {
    renderAt('/evidence');
    await userEvent.click(await screen.findByRole('button', { name: /Conditional access baseline/ }));
    expect(await screen.findByText('Policy present')).toBeInTheDocument();
    expect(screen.getByText('Get-MgPolicy')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/evidence-explorer/item')!.query).toEqual({ tenant: 's1-mach', source: 'stamper', path: 'AC-1' });
    await userEvent.click(screen.getByRole('button', { name: 'Verify SHA-256' }));
    expect(await screen.findByText(/VERIFIED/)).toBeInTheDocument();
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('a signal item needs this tenant connected (per the index); when connected it reads the live signal', async () => {
    renderAt('/evidence');
    await userEvent.click(await screen.findByRole('button', { name: /Identity signals/ }));
    expect(await screen.findByText(/needs a live tenant connection/)).toBeInTheDocument();
    expect(eo.calls.some((c) => c.path === '/api/evidence-explorer/signal')).toBe(false);
    connectionState = 'connected';
    await userEvent.click(screen.getByRole('button', { name: 'Refresh index' }));
    await screen.findByText(/^Connected: blob artifacts/);
    await userEvent.click(screen.getByRole('button', { name: /Identity signals/ }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/evidence-explorer/signal')).toBe(true));
    expect(eo.calls.find((c) => c.path === '/api/evidence-explorer/signal')!.body).toEqual({ tenant: 's1-mach', signalId: 'identitySignals' });
    expect(await screen.findByText(/1 result\(s\)/)).toBeInTheDocument();
  });

  it('filterItems', () => {
    expect(filterItems(ITEMS, ['local'], '').map((i) => i.id)).toEqual(['local:risk']);
    expect(filterItems(ITEMS, [], 'ac.l2-3.1.1').map((i) => i.id)).toEqual(['stamper:AC-1']);
  });
});
