// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the smaller parity items: the optional live connect, the timeline, the control matrix,
// the SSP family detail, and the Policy Store.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BASE_ROUTES, fakeEo, renderAt, resetSession, seriousAxe } from '../testUtils';
import { useSession } from '../store/session';
import { connectFrameState } from './access';
import { recentEvents } from './assess/TimelineCard';
import { sprsImpact } from './assess/ControlMatrix';

const sse = (...frames: object[]) => ({ text: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''), headers: { 'content-type': 'text/event-stream' } });

let eo: ReturnType<typeof fakeEo>;
let timeline: { events: Array<Record<string, string>> };
beforeEach(() => {
  resetSession('s1-mach');
  timeline = { events: [{ type: 'assessment', title: 'Assessment run', date: '2026-10-01', detail: 'SPRS 92' }] };
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/connect': sse(
      { type: 'connection_log', phase: 'config_loaded', message: 'Tenant config loaded: s1-mach', tenant: 's1-mach' },
      { type: 'connection_log', phase: 'connecting_graph', message: 'Connecting to Microsoft Graph...', tenant: 's1-mach' },
      { type: 'connection_log', phase: 'connected_graph', message: 'Graph session connected', tenant: 's1-mach' },
      { type: 'connection_log', phase: 'done', message: 'Connection check complete', tenant: 's1-mach' },
    ),
    'GET /api/assessment': { snapshotId: 'snap1', generatedAt: '2026-10-31', sprs_score: 92, controls: [
      { control_id: 'AC.L2-3.1.1', nist_ref: '3.1.1', practice: 'Limit system access to authorized users', status: 'met', classification: 'automated' },
      { control_id: 'AC.L2-3.1.2', nist_ref: '3.1.2', practice: 'Limit system access to the types of transactions', status: 'not_met', classification: 'automated' },
      { control_id: 'PE.L2-3.10.1', nist_ref: '3.10.1', practice: 'Limit physical access', status: 'not_met', classification: 'nonstack' },
    ] },
    'GET /api/sprs/weights': [{ nist_ref: '3.1.1', weight: 5 }, { nist_ref: '3.1.2', weight: 5 }, { nist_ref: '3.10.1', weight: 5 }],
    'GET /api/timeline': () => ({ body: timeline }),
    'POST /api/timeline/events': (c) => { const b = c.body as Record<string, string>; timeline = { events: [...timeline.events, b] }; return { body: b }; },
    'GET /api/ssp/latest': { sspId: 'ssp1', systemName: 'Sim Machining CUI enclave', generatedAt: '2026-10-31', version: '1',
      hostingModel: { model: 'GCC High', environment: 'cloud' }, authorizationBoundary: { description: 'M365 tenant' }, systemComponents: { sections: [1, 2] }, sourceArtifacts: [],
      controlImplementations: [{ control_id: 'AC.L2-3.1.1', family: 'AC', status: 'met', weight: 5, practice: 'Limit system access', implementationNarrative: 'Conditional access', technologyUsed: ['Entra ID'], responsibleRole: 'IT admin' }] },
    'GET /api/policies': [{ template_id: 'POL-AC', title: 'Access Control Policy', domain: 'AC', completeness: 80, loadedAt: '2026-10-31T00:00:00Z', markdown: '# Access Control\nAll access is reviewed.', nist_controls: ['3.1.1'] }],
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('FIN-31b parity items', () => {
  it('optional connect: reads /api/connect with fetch (bearer-safe) and marks the tenant connected', async () => {
    renderAt('/access');
    await userEvent.click(await screen.findByRole('button', { name: 'Connect (optional)' }));
    await waitFor(() => expect(useSession.getState().connection).toBe('connected'));
    expect(document.querySelector('#connectionStatus')!.textContent).toBe('s1-mach — connected');
    expect(eo.calls.find((c) => c.path === '/api/connect')!.query).toEqual({ tenant: 's1-mach' });
    expect(screen.getByText('Graph session connected')).toBeInTheDocument();
    expect(connectFrameState({ type: 'connection_log', phase: 'error_graph', message: 'x' })).toEqual({ state: 'error', text: 'Graph connection failed' });
    useSession.getState().setTenant('s2-eng');
    expect(useSession.getState().connection).toBe('idle');
  });

  it('assess: the control matrix filters a family by MET / NOT MET and shows the SPRS impact', async () => {
    renderAt('/assess');
    const table = await screen.findByRole('table', { name: 'Control compliance matrix by family' });
    await waitFor(() => expect(within(table).getAllByText('-5').length).toBe(2));
    expect(within(table).getAllByText('NON-STACK').length).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Access Control: show only NOT MET (1)' }));
    expect(table.querySelector('tr[data-control="AC.L2-3.1.1"]')).toBeNull();
    expect(table.querySelector('tr[data-control="AC.L2-3.1.2"]')).not.toBeNull();
    expect(table.querySelector('tr[data-control="PE.L2-3.10.1"]')).not.toBeNull();
    expect(sprsImpact('met', 5)).toBe('0');
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('assess: the timeline lists events and adds a custom one', async () => {
    renderAt('/assess');
    expect(await screen.findByText('Assessment run')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Event title'), 'C3PAO kickoff');
    await userEvent.type(screen.getByLabelText('Event date'), '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'POST' && c.path === '/api/timeline/events')).toBe(true));
    expect(eo.calls.find((c) => c.method === 'POST')!.body).toEqual({ title: 'C3PAO kickoff', date: '2026-12-01', type: 'custom' });
    expect(await screen.findByText('C3PAO kickoff')).toBeInTheDocument();
    expect(recentEvents(Array.from({ length: 25 }, (_, i) => ({ type: 'custom', title: String(i), date: '2026-01-01' }))).map((e) => e.title).slice(0, 2)).toEqual(['24', '23']);
  });

  it('SSP: family names and the control detail (practice, weight, technology, role) and the system overview', async () => {
    renderAt('/ssp');
    await userEvent.click(await screen.findByRole('button', { name: 'Load latest' }));
    expect(await screen.findByText('AC — Access Control (1 controls)')).toBeInTheDocument();
    expect(screen.getByText('wt:5')).toBeInTheDocument();
    expect(screen.getByText('Tech: Entra ID')).toBeInTheDocument();
    expect(screen.getByText('Role: IT admin')).toBeInTheDocument();
    expect(screen.getByText('GCC High (cloud)')).toBeInTheDocument();
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('Policy Store: lists imported policies and opens the text', async () => {
    renderAt('/policies');
    expect(await screen.findByRole('cell', { name: 'Access Control Policy' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '80%' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Read Access Control Policy' }));
    expect(await screen.findByText(/All access is reviewed/)).toBeInTheDocument();
    expect(await seriousAxe(document.body)).toEqual([]);
  });
});
