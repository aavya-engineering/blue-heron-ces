// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant screen (card 0) in the app router: legacy and demo-driver ids, the page-load requests,
// gate and connect, the prerequisites panel, the card toggle, and axe. W8-SPAW adds Install All
// (module rows only) and the one console shared with cards 3 and 4.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAMPER_SELECTORS } from '../../../e2e/parity/selectors';
import { LAST_TENANT_KEY } from '../../store/tenant';
import { useExecuteStore } from '../../store/execute';
import { SCREEN_ROUTES_FIXTURE, installHarness, renderAt, resetStores, seriousAxe } from '../tenant/testUtils';
import type { Harness } from '../tenant/testUtils';

let h: Harness;

beforeEach(() => {
  resetStores();
  window.localStorage.setItem(LAST_TENANT_KEY, 'ridgeline');
  h = installHarness(SCREEN_ROUTES_FIXTURE);
});
afterEach(() => {
  cleanup();
  h.restore();
});

describe('Tenant screen (card 0)', () => {
  it('keeps the legacy and demo-driver ids and makes the legacy page-load requests', async () => {
    renderAt('/tenant');
    await waitFor(() => expect(document.querySelector(STAMPER_SELECTORS.tenantOption('ridgeline'))).not.toBeNull());
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    expect(screen.getByRole('heading', { name: 'Tenant' })).toBeInTheDocument();
    for (const sel of [STAMPER_SELECTORS.card(0), STAMPER_SELECTORS.tenantSelect, STAMPER_SELECTORS.connectionGate, STAMPER_SELECTORS.gateAllow, '#cardStatus0', '#btnPreflight', '#statusBar', '#taskList']) {
      expect(document.querySelector(sel), sel).not.toBeNull();
    }
    expect(document.querySelector(`${STAMPER_SELECTORS.card(0)} .workflow-card-header`)).not.toBeNull();
    expect(document.querySelector(STAMPER_SELECTORS.connectionGate)).toBeVisible();
    expect(document.querySelector('#fixtureSetWrap')).not.toBeVisible();
    expect(screen.getByRole('option', { name: 'Ridgeline Machining (gcchigh)' })).toBeInTheDocument();
    const api = h.lines().filter((l) => !l.endsWith('/health'));
    expect(api).toEqual([
      'GET /api/cmmc-controls',
      'GET /api/tenants',
      'GET /api/last-translate?tenant=ridgeline',
      'GET /api/tenants/ridgeline',
      'GET /api/tenants/ridgeline/variables',
      'GET /api/assess-state?tenant=ridgeline',
    ]);
  });

  it('Allow connects; a clean done adds tenant-connected to #workflowCard0', async () => {
    const user = userEvent.setup();
    renderAt('/tenant');
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    await user.click(document.querySelector(STAMPER_SELECTORS.gateAllow)!);
    const stream = h.streams[0]!;
    expect(stream.url).toBe('/api/connect?tenant=ridgeline');
    expect(document.querySelector(STAMPER_SELECTORS.card(0))).toHaveClass('tenant-connecting');
    act(() => {
      stream.emit({ type: 'connection_log', phase: 'connected_graph', message: 'Graph connected' });
      stream.emit({ type: 'connection_log', phase: 'done', tenant: 'ridgeline' });
    });
    expect(document.querySelector(STAMPER_SELECTORS.card(0))).toHaveClass('tenant-connected');
    expect(document.querySelectorAll(STAMPER_SELECTORS.connectErrorRows)).toHaveLength(0);
    expect(document.getElementById('tenantConfigLabel')).toHaveTextContent('ridgeline');
    expect(document.getElementById('gateAllowBtn')).toHaveClass('gate-active-allow');
  });

  it('shows the Missing Prerequisites panel in the console, and error rows the driver counts', async () => {
    const user = userEvent.setup();
    renderAt('/tenant');
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    await user.click(document.querySelector(STAMPER_SELECTORS.gateAllow)!);
    act(() => {
      h.streams[0]!.emit({ type: 'prereq_check', module: 'ExchangeOnlineManagement', installed: false, required: true });
      h.streams[0]!.emit({ type: 'prereq_blocked', message: 'Missing modules', missing: ['ExchangeOnlineManagement', 'MicrosoftTeams'] });
    });
    expect(document.querySelectorAll(STAMPER_SELECTORS.connectErrorRows)).toHaveLength(2);
    expect(document.querySelector('#taskList .prereq-panel')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Install All/ })).toBeInTheDocument();
    expect(document.querySelector(STAMPER_SELECTORS.card(0))).toHaveClass('tenant-error');
  });

  it('Install All installs module rows only, never the certificate row (intended difference)', async () => {
    const user = userEvent.setup();
    renderAt('/tenant');
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    await user.click(document.querySelector(STAMPER_SELECTORS.gateAllow)!);
    act(() => {
      h.streams[0]!.emit({
        type: 'prereq_blocked',
        message: 'Missing prerequisites',
        missing: ['ExchangeOnlineManagement', 'MicrosoftTeams'],
        cert_missing: true,
        cert_path: 'C:\\certs\\ridgeline.pfx',
        thumbprint: 'ABCDEF0123456789',
      });
    });
    await user.click(screen.getByRole('button', { name: /Install All/ }));
    await waitFor(() => expect(h.streams).toHaveLength(2));
    expect(h.streams[1]!.url).toBe('/api/prereqs/install?module=ExchangeOnlineManagement');
    act(() => h.streams[1]!.emit({ type: 'install_done', success: true }));
    await waitFor(() => expect(h.streams).toHaveLength(3));
    expect(h.streams[2]!.url).toBe('/api/prereqs/install?module=MicrosoftTeams');
    act(() => h.streams[2]!.emit({ type: 'install_done', success: true }));
    await waitFor(() => expect(document.querySelector('#taskList')).toHaveTextContent('MicrosoftTeams installed successfully'));
    // Legacy also opens /api/prereqs/install?module=Certificate (...) here (L6614-6621); the SPA does not.
    expect(h.streams.map((s) => s.url).filter((u) => u.includes('Certificate'))).toEqual([]);
    expect(h.streams).toHaveLength(3);
  });

  it('cards 0-4 share one console, status bar and connection gate (W8-SPAW)', async () => {
    const user = userEvent.setup();
    const router = renderAt('/tenant');
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    await user.click(document.querySelector(STAMPER_SELECTORS.gateAllow)!);
    act(() => {
      h.streams[0]!.emit({ type: 'connection_log', phase: 'connected_graph', message: 'Graph connected' });
      h.streams[0]!.emit({ type: 'connection_log', phase: 'done', tenant: 'ridgeline' });
    });
    expect(useExecuteStore.getState().connected).toBe(true);
    await act(() => router.navigate('/execute'));
    await waitFor(() => expect(document.querySelector(STAMPER_SELECTORS.card(4))).not.toBeNull());
    expect(document.querySelectorAll('#statusBar')).toHaveLength(1);
    expect(document.querySelectorAll('#taskList')).toHaveLength(1);
    expect(document.getElementById('statusBar')).toHaveTextContent('Connected to tenant');
    expect(document.querySelector('#taskList')).toHaveTextContent('Graph connected');
    expect(document.querySelector('#taskList')).toHaveTextContent('Tenant connection complete — all sessions active');
  });

  it('the header toggles card-collapsed, as the driver expects', async () => {
    const user = userEvent.setup();
    renderAt('/tenant');
    const card = await waitFor(() => document.querySelector(STAMPER_SELECTORS.card(0))!);
    expect(card).not.toHaveClass('card-collapsed');
    await user.click(card.querySelector('.workflow-card-header')!);
    expect(card).toHaveClass('card-collapsed');
    await user.click(screen.getByRole('button', { name: 'Expand Tenant card' }));
    expect(card).not.toHaveClass('card-collapsed');
  });

  it('opens the add-tenant panel and has no serious axe findings', async () => {
    const user = userEvent.setup();
    renderAt('/tenant');
    await waitFor(() => expect(h.lines()).toContain('GET /api/assess-state?tenant=ridgeline'));
    await user.click(screen.getByRole('button', { name: 'Add a new tenant config' }));
    expect(document.getElementById('tenantJsonInput')).toHaveFocus();
    expect(await seriousAxe(document.querySelector('[data-screen="tenant"]')!)).toEqual([]);
  });
});
