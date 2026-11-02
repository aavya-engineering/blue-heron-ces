// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-33, founder ruling FD-13: the Variables screen says that the Tenant Manifest wins and the
// saved plan variables fill gaps only (at execute). Shown for an editable tenant, not for dev.
// The note adds no request. Fictional data only.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VariablesScreen, { PRECEDENCE_NOTE } from '.';
import { useVariablesStore } from '../../store/variables';
import { useWorkflowStore } from '../../store/workflow';
import { FIXTURE_CONFIG, FIXTURE_TENANT, FIXTURE_VARIABLES, mockApi } from '../../store/spa3-mock-api';
import type { MockApi } from '../../store/spa3-mock-api';
import { seriousAxe } from '../tenant/testUtils';

const T = FIXTURE_TENANT;
let api: MockApi | null = null;

const routes = {
  'GET /api/resolvable-variables': { body: { ok: true, variables: ['kvName'] } },
  [`GET /api/tenants/${T}`]: { body: { ok: true, slug: T, path: 'C:\\fixture\\tenants\\ridgeline-fixture.json', config: FIXTURE_CONFIG } },
  [`GET /api/tenants/${T}/variables`]: { body: { ok: true, variables: FIXTURE_VARIABLES } },
};

function renderScreen(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VariablesScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVariablesStore.getState().reset();
  useWorkflowStore.getState().reset();
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe('FD-13 precedence note (FIN-33)', () => {
  it('says the manifest wins and the editor fills gaps only (assess and execute)', () => {
    expect(PRECEDENCE_NOTE).toMatch(/Tenant Manifest .* always win/);
    expect(PRECEDENCE_NOTE).toMatch(/only fills gaps: assess and execute use it where no other value is set/);
    expect(PRECEDENCE_NOTE).toMatch(/translation does not read it/);
  });

  it('is shown for a tenant, with no extra request', async () => {
    api = mockApi(routes);
    const { container } = renderScreen(`/variables?tenant=${T}`);
    await waitFor(() => expect(document.getElementById('pathHint')).toHaveTextContent('ridgeline-fixture.json'));
    const note = document.getElementById('variablesPrecedenceNote');
    expect(note).toHaveTextContent(PRECEDENCE_NOTE);
    expect(note).toHaveAttribute('role', 'note');
    expect(api.signatures()).toEqual(['GET /api/resolvable-variables', `GET /api/tenants/${T}`, `GET /api/tenants/${T}/variables`]);
    expect(await seriousAxe(container)).toEqual([]);
  });

  it('is not shown for dev', async () => {
    api = mockApi({});
    renderScreen('/variables?tenant=dev');
    expect(await screen.findByText('No tenant selected.')).toBeInTheDocument();
    expect(document.getElementById('variablesPrecedenceNote')).toBeNull();
  });
});
