// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Unified variables screen (PC-12): the kit editor wired to the legacy requests. Fictional data only.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import VariablesScreen from '.';
import { useVariablesStore } from '../../store/variables';
import { useWorkflowStore } from '../../store/workflow';
import { useTenantStore } from '../../store/tenant';
import { useConfigureStore } from '../../store/configure';
import { FIXTURE_CONFIG, FIXTURE_TENANT, FIXTURE_VARIABLES, mockApi } from '../../store/spa3-mock-api';
import type { MockApi } from '../../store/spa3-mock-api';

const T = FIXTURE_TENANT;
let api: MockApi | null = null;

const routes = {
  'GET /api/resolvable-variables': { body: { ok: true, variables: ['kvName'] } },
  [`GET /api/tenants/${T}`]: { body: { ok: true, slug: T, path: 'C:\\fixture\\tenants\\ridgeline-fixture.json', config: FIXTURE_CONFIG } },
  [`GET /api/tenants/${T}/variables`]: { body: { ok: true, variables: FIXTURE_VARIABLES } },
  [`PUT /api/tenants/${T}/variables`]: { body: { ok: true } },
  'POST /api/resolve-variable': { body: { ok: true, resolved: { kvName: 'kv-ridgeline' } } },
  'GET /api/tenants-browse': { body: { ok: true, files: [{ name: 'ridgeline-west.json', path: 'C:\\fixture\\tenants\\ridgeline-west.json' }] } },
};

function renderScreen(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VariablesScreen />
    </MemoryRouter>,
  );
}

const byId = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  useVariablesStore.getState().reset();
  useWorkflowStore.getState().reset();
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe('Variables screen (PC-12)', () => {
  it('shows "No tenant selected." and makes no request for dev', async () => {
    api = mockApi({});
    renderScreen('/variables?tenant=dev');
    expect(await screen.findByText('No tenant selected.')).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });

  it('loads the tenant from ?tenant= with the legacy request order and title', async () => {
    api = mockApi(routes);
    renderScreen(`/variables?tenant=${T}`);
    await waitFor(() => expect(byId('pathHint')).toHaveTextContent('ridgeline-fixture.json'));
    expect(api.signatures()).toEqual(['GET /api/resolvable-variables', `GET /api/tenants/${T}`, `GET /api/tenants/${T}/variables`]);
    expect(byId('tenantName')).toHaveTextContent(T);
    expect(document.title).toBe(`Variables — ${T}`);
  });

  it("opens on the tenant in the URL SPA1's Configure launcher passes (W8-SPAW)", async () => {
    api = mockApi(routes);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    useTenantStore.setState({ slug: T });
    useWorkflowStore.getState().selectTenant('dev');
    useConfigureStore.getState().launchVariables();
    const url = String(open.mock.calls[0]![0]);
    open.mockRestore();
    expect(url).toBe(`/app/variables?tenant=${T}`);
    renderScreen(url.replace(/^\/app/, ''));
    await waitFor(() => expect(byId('pathHint')).toHaveTextContent('ridgeline-fixture.json'));
    expect(api.signatures()).toEqual(['GET /api/resolvable-variables', `GET /api/tenants/${T}`, `GET /api/tenants/${T}/variables`]);
    useTenantStore.getState().reset();
  });

  it('falls back to the workflow store tenant', async () => {
    api = mockApi(routes);
    useWorkflowStore.getState().selectTenant(T);
    renderScreen('/variables');
    await waitFor(() => expect(api!.signatures()).toContain(`GET /api/tenants/${T}/variables`));
  });

  it('resolves a variable, then saves the Variables tab with PUT {variables}', async () => {
    api = mockApi(routes);
    const user = userEvent.setup();
    renderScreen(`/variables?tenant=${T}`);
    await waitFor(() => expect(byId('pathHint')).toHaveTextContent('ridgeline-fixture.json'));
    await user.click(byId('variablesTab'));
    const resolveBtn = await waitFor(() => {
      const el = document.querySelector('[data-var="kvName"]')?.parentElement?.querySelector('button');
      if (!el) throw new Error('resolve button not rendered');
      return el;
    });
    await user.click(resolveBtn);
    await waitFor(() => expect(document.querySelector('input[data-var="kvName"]')).toHaveValue('kv-ridgeline'));
    expect(api.signatures()).toContain('POST /api/resolve-variable');
    await user.click(byId('variablesSaveBtn'));
    await waitFor(() => expect(api!.signatures()).toContain(`PUT /api/tenants/${T}/variables`));
    const put = api.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ variables: { domain: 'ridgeline.example', kvName: 'kv-ridgeline', retentionDays: 90 } });
    expect(await screen.findByText('Variables saved')).toBeInTheDocument();
  });

  it('Load opens the file picker from GET /api/tenants-browse', async () => {
    api = mockApi(routes);
    const user = userEvent.setup();
    renderScreen(`/variables?tenant=${T}`);
    await waitFor(() => expect(byId('pathHint')).toHaveTextContent('ridgeline-fixture.json'));
    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByRole('group', { name: 'Available configs' })).toBeInTheDocument();
    expect(byId('loadConfigSelect')).toHaveValue('C:\\fixture\\tenants\\ridgeline-west.json');
    await user.click(byId('loadConfigCancel'));
    expect(document.getElementById('loadConfigPicker')).toBeNull();
  });
});
