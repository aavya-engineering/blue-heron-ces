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
import { SCREEN_ROUTES } from './router';
import { NO_TENANT_LABEL } from './App';
import { BASE_ROUTES, fakeEo, renderAt, resetSession, seriousAxe } from './testUtils';

let eo: ReturnType<typeof fakeEo>;
beforeEach(() => { resetSession(); eo = fakeEo(BASE_ROUTES); });
afterEach(() => { cleanup(); eo.restore(); });

describe('EO shell (modelled on Stamper\'s console)', () => {
  it('header reads "CES Blue Heron Defense — EvidenceOps"; banner shows the simulator from /api/ui/info', async () => {
    renderAt('/');
    expect(document.querySelector('#header')!.textContent).toContain('CES');
    expect(document.querySelector('.header-company')!.textContent).toBe('Blue Heron Defense — EvidenceOps');
    await waitFor(() => expect(document.querySelector('#tenantBanner')!.getAttribute('data-simulator')).toBe('true'));
    expect(screen.getByText(NO_TENANT_LABEL)).toBeInTheDocument();
  });

  it('has one tab per screen, in order, with no Evidence Collector screen (FD-10)', () => {
    renderAt('/access');
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(SCREEN_ROUTES.map((r) => r.label));
    expect(tabs.join(' ')).not.toMatch(/Evidence Collector/);
    expect(SCREEN_ROUTES.map((r) => r.path)).toEqual(
      ['access', 'assess', 'ssp', 'sprs', 'poam', 'evidence', 'package', 'personnel', 'training', 'risk', 'policies', 'offboarding', 'upload', 'review', 'assessor']);
  });

  it('a tab click navigates; an unknown path falls back to Tenant and access', async () => {
    const { router } = renderAt('/nowhere');
    await waitFor(() => expect(router.state.location.pathname).toBe('/access'));
    await userEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(router.state.location.pathname).toBe('/review');
    expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true');
  });

  it('tenant-scoped screens ask for a tenant first', () => {
    renderAt('/sprs');
    expect(screen.getByText(/Select a tenant first/)).toBeInTheDocument();
  });

  it('every screen renders with no serious or critical axe finding (no tenant and with a tenant)', async () => {
    for (const tenant of [null, 's1-mach']) {
      for (const r of SCREEN_ROUTES) {
        resetSession(tenant);
        const { container, unmount } = renderAt(`/${r.path}`);
        await waitFor(() => expect(container.querySelector('#eo-screen-panel')).not.toBeNull());
        expect([r.path, tenant, await seriousAxe(container)]).toEqual([r.path, tenant, []]);
        unmount();
      }
    }
  });

  it('sends the service token as Authorization once entered (tokens gate access)', async () => {
    renderAt('/access');
    await userEvent.type(document.querySelector('#serviceToken') as HTMLInputElement, 'svc-token-1');
    await waitFor(() => expect(eo.calls.some((c) => c.headers.authorization === 'Bearer svc-token-1')).toBe(true));
  });
});
