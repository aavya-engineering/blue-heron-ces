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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { SCREEN_ROUTES, createTestRouter } from './router';
import { NO_TENANT_LABEL } from './App';
import { setFetcher } from './api';
import type { Fetcher, HealthStatus } from './api';
import { useWorkflowStore } from './store';
import { SPA_SCREEN_PATHS } from '../e2e/parity/selectors';
import { resetStores } from './screens/tenant/testUtils';

function health(simulatorActive: boolean): HealthStatus {
  return {
    status: 'ok',
    registries: { m365: true, infra: true, merged: true },
    evidenceCollector: { autostart: 'not_checked' },
    ui: { mode: 'legacy', spaPath: '/app/', spaBuilt: true },
    simulator: { active: simulatorActive, serverUrl: simulatorActive ? 'http://127.0.0.1:4390' : null },
    timestamp: '2026-10-29T00:00:00.000Z',
  };
}

let requested: string[] = [];
let restore: Fetcher | null = null;

function useHealth(simulatorActive: boolean) {
  restore = setFetcher(async (url) => {
    requested.push(url);
    return new Response(JSON.stringify(health(simulatorActive)), { status: 200 });
  });
}

function renderAt(path: string) {
  const router = createTestRouter(path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  requested = [];
  // W8-SPAW: every store starts fresh, so each test behaves the same alone or in the file
  // (the tenant screen's page-load bootstrap runs once per store lifetime).
  resetStores();
});

afterEach(() => {
  cleanup();
  if (restore) setFetcher(restore);
  restore = null;
});

describe('SPA shell', () => {
  it('renders the kit shell with the legacy ids and redirects / to the tenant screen', async () => {
    useHealth(false);
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Tenant' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tenant');
    expect(document.getElementById('header')).not.toBeNull();
    expect(document.getElementById('ces-theme-toggle')).not.toBeNull();
    for (let i = 0; i < 6; i++) expect(document.getElementById(`railNode${i}`)).not.toBeNull();
  });

  it('reads /health once and shows a live banner when the simulator is off', async () => {
    useHealth(false);
    renderAt('/tenant');
    const banner = document.getElementById('tenantBanner')!;
    // The shell's own request is /health; the tenant screen's legacy page-load requests
    // (cmmc-controls, tenants) are PC-02's and are left out here (SPA1 Open item 2).
    await waitFor(() => expect(requested).toContain('/api/tenants'));
    await waitFor(() => expect(banner).toHaveAttribute('data-simulator', 'false'));
    expect(requested.filter((u) => u === '/health')).toEqual(['/health']);
    expect(banner).toHaveAttribute('data-simulator', 'false');
    expect(banner).toHaveTextContent(NO_TENANT_LABEL);
    expect(banner).toHaveTextContent('Live tenant');
  });

  it('shows the simulator banner when /health reports simulator.active', async () => {
    useHealth(true);
    renderAt('/tenant');
    await waitFor(() => expect(document.getElementById('tenantBanner')).toHaveAttribute('data-simulator', 'true'));
    expect(document.getElementById('tenantBanner')).toHaveTextContent('Simulator');
  });

  it('locks translate, execute, evidence; unlocked steps navigate; unlocking follows the store', async () => {
    useHealth(false);
    const user = userEvent.setup();
    const router = renderAt('/tenant');
    for (const i of [3, 4, 5]) expect(document.getElementById(`railNode${i}`)).toBeDisabled();
    await user.click(document.getElementById('railNode2')!);
    expect(router.state.location.pathname).toBe('/assess');
    expect(screen.getByRole('heading', { name: 'Assess' })).toBeInTheDocument();

    useWorkflowStore.getState().completeStep('assess');
    await waitFor(() => expect(document.getElementById('railNode3')).not.toBeDisabled());
    await user.click(document.getElementById('railNode3')!);
    expect(router.state.location.pathname).toBe('/translate');
  });

  it('offers the dev quick run outside the cards while translate is locked (DEF-1, legacy L4625-4631)', async () => {
    useHealth(false);
    renderAt('/configure');
    await waitFor(() => expect(document.querySelector('[data-screen="configure"]')).not.toBeNull());
    expect(document.getElementById('devQuickRunWrap')).toBeNull();
    act(() => useWorkflowStore.getState().selectTenant('dev'));
    expect(document.getElementById('railNode3')).toBeDisabled();
    expect(document.querySelectorAll('#btnQuickExecAuto')).toHaveLength(1);
    expect(document.getElementById('btnQuickExecAuto')).toHaveTextContent('Translate & Execute (Auto)');
    expect(document.getElementById('btnQuickExecManual')).toHaveTextContent('Translate & Execute (Manual)');
    expect(document.getElementById('devQuickRunWrap')!.closest('.workflow-card')).toBeNull();
  });

  it('the dev quick run is not on the screens for legacy separate pages (variables, registry)', async () => {
    useHealth(false);
    for (const path of ['variables', 'registry']) {
      renderAt(`/${path}`);
      await waitFor(() => expect(document.querySelector(`[data-screen="${path}"]`)).not.toBeNull());
      act(() => useWorkflowStore.getState().selectTenant('dev'));
      expect(document.getElementById('devQuickRunWrap'), path).toBeNull();
      cleanup();
    }
  });

  it('serves every screen route; the pop-out renders without the shell', async () => {
    useHealth(false);
    for (const { path, inShell } of SCREEN_ROUTES) {
      renderAt(`/${path}`);
      await waitFor(() => expect(document.querySelector(`[data-screen="${path}"]`)).not.toBeNull());
      expect(document.getElementById('header') !== null, path).toBe(inShell);
      cleanup();
    }
  });

  it('unknown paths fall back to the tenant screen', async () => {
    useHealth(false);
    const router = renderAt('/no-such-screen');
    expect(await screen.findByRole('heading', { name: 'Tenant' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tenant');
  });

  it('screen paths match the parity selectors list', () => {
    expect(SCREEN_ROUTES.map((r) => r.path)).toEqual([...SPA_SCREEN_PATHS]);
  });
});
