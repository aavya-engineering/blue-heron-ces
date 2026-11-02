// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Registry editor screen (PC-13): the kit editor wired to the legacy requests. Fictional data only.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RegistryScreen, { REGISTRY_TITLE } from '.';
import { useRegistryStore } from '../../store/registry';
import { useWorkflowStore } from '../../store/workflow';
import { useTenantStore } from '../../store/tenant';
import { useConfigureStore } from '../../store/configure';
import { FIXTURE_REGISTRY, FIXTURE_TENANT, mockApi } from '../../store/spa3-mock-api';
import type { MockApi } from '../../store/spa3-mock-api';

let api: MockApi | null = null;

const routes = {
  'GET /api/registry/m365': { body: { entries: FIXTURE_REGISTRY.map((e) => ({ ...e })) } },
  'GET /api/registry/infra': { body: { entries: [] } },
  'POST /api/registry/resolve': { body: { resolved: 'Get-MgPolicy -Domain ridgeline.example', unresolved: ['tenantId'] } },
  'PUT /api/registry/m365/ac-ca-baseline': (call: { body: unknown }) => ({ body: { success: true, entry: call.body } }),
};

function renderScreen(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RegistryScreen />
    </MemoryRouter>,
  );
}

const byId = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  useRegistryStore.getState().reset();
  useWorkflowStore.getState().reset();
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe('Registry editor screen (PC-13)', () => {
  it('loads m365, runs the variable check for the shown entry, shows the legacy status', async () => {
    api = mockApi(routes);
    renderScreen(`/registry?tenant=${FIXTURE_TENANT}&type=m365`);
    await waitFor(() => expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2'));
    await waitFor(() => expect(byId('varStatusText')).toHaveTextContent('Missing: tenantId'));
    expect(api.signatures()).toEqual(['GET /api/registry/m365', 'POST /api/registry/resolve']);
    expect(document.title).toBe(REGISTRY_TITLE);
  });

  it("opens on the tenant and type in the URL SPA1's Configure launcher passes (W8-SPAW)", async () => {
    api = mockApi(routes);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    useTenantStore.setState({ slug: FIXTURE_TENANT });
    useWorkflowStore.getState().selectTenant('dev');
    useConfigureStore.getState().launchRegistry();
    const url = String(open.mock.calls[0]![0]);
    open.mockRestore();
    expect(url).toBe(`/app/registry?tenant=${FIXTURE_TENANT}&type=m365`);
    renderScreen(url.replace(/^\/app/, ''));
    await waitFor(() => expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2'));
    // The variable check runs for the URL's tenant (dev, the workflow store's, would skip it).
    await waitFor(() => expect(api!.signatures()).toEqual(['GET /api/registry/m365', 'POST /api/registry/resolve']));
    useTenantStore.getState().reset();
  });

  it('dev: no variable check', async () => {
    api = mockApi(routes);
    renderScreen('/registry?tenant=dev');
    await waitFor(() => expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2'));
    expect(api.signatures()).toEqual(['GET /api/registry/m365']);
    expect(document.getElementById('varStatusIndicator')).toBeNull();
  });

  it('?type=infra loads the infra registry', async () => {
    api = mockApi(routes);
    renderScreen('/registry?type=infra');
    await waitFor(() => expect(api!.signatures()).toEqual(['GET /api/registry/infra']));
  });

  it('saves with PUT /api/registry/m365/:entryId and stays on the entry', async () => {
    api = mockApi(routes);
    const user = userEvent.setup();
    renderScreen(`/registry?tenant=${FIXTURE_TENANT}`);
    await waitFor(() => expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2'));
    const label = byId('reg_label') as HTMLInputElement;
    await user.clear(label);
    await user.type(label, 'Conditional Access baseline v2');
    await user.click(byId('regSaveBtn'));
    expect(await screen.findByText('Entry saved successfully')).toBeInTheDocument();
    const put = api.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/api/registry/m365/ac-ca-baseline');
    expect(put.body).toMatchObject({ entry_id: 'ac-ca-baseline', label: 'Conditional Access baseline v2', engine: 'mgraph' });
    expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2');
    await user.click(byId('regNextBtn'));
    await user.click(byId('regPrevBtn'));
    expect(byId('reg_label')).toHaveValue('Conditional Access baseline v2');
  });
});
