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
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BASE_ROUTES, fakeEo, fakeToken, renderAt, resetSession } from '../../testUtils';
import { useSession } from '../../store/session';

const UPLOADER = 'uploader.ui@s1.example.test';
const REVIEWER = 'reviewer.ui@s1.example.test';
let eo: ReturnType<typeof fakeEo>;
let issuerConfigured = true;

beforeEach(() => {
  resetSession();
  issuerConfigured = true;
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/uploader-tokens/config': () => ({ body: { issuerConfigured, operatorAuth: 'dev-hs256', defaultTtlSeconds: 3600, maxTtlSeconds: 28800 } }),
    'POST /api/uploader-tokens': (c) => ({ status: 201, body: { token: fakeToken({ upn: (c.body as { uploaderUpn: string }).uploaderUpn }), mintId: 'm-up', uploaderUpn: UPLOADER, expiresAt: '2026-10-31T20:00:00.000Z', operatorAuth: 'dev-hs256-unverified' } }),
    'POST /api/approver-tokens': () => ({ status: 403, body: { error: 'self_mint', detail: 'an operator may not mint an approver token for themselves' } }),
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Tenant and access (FIN-12 open item 2: the uploader token)', () => {
  it('lists tenants and sets the session tenant', async () => {
    renderAt('/access');
    const option = await screen.findByRole('option', { name: 'Sim Machining (s1-mach)' });
    await userEvent.selectOptions(document.querySelector('#tenantSelect') as HTMLSelectElement, option);
    expect(useSession.getState().tenant).toBe('s1-mach');
  });

  it('an operator mints an uploader token for a named uploader; it is held for uploads and summarised', async () => {
    resetSession('s1-mach');
    renderAt('/access');
    const mint = await screen.findByRole('button', { name: 'Mint uploader token' });
    expect(mint).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Operator sign-in'), 'operator-session-1');
    await userEvent.type(screen.getByLabelText('Uploader (UPN)'), UPLOADER);
    await userEvent.click(mint);
    expect(await screen.findByText(/Uploader token minted for uploader.ui@s1.example.test/)).toBeInTheDocument();
    const call = eo.calls.find((c) => c.method === 'POST' && c.path === '/api/uploader-tokens')!;
    expect(call.query).toEqual({ tenant: 's1-mach' });
    expect(call.headers['x-ces-principal']).toBe('operator-session-1');
    expect(call.body).toEqual({ uploaderUpn: UPLOADER });
    expect(useSession.getState().uploaderToken).not.toBe('');
    expect(screen.getByTestId('uploader-token-summary').textContent).toContain(UPLOADER);
    // The operator token goes to the issuers only, never to other routes.
    expect(eo.calls.filter((c) => c.headers['x-ces-principal'] === 'operator-session-1').map((c) => c.path)).toEqual(['/api/uploader-tokens']);
  });

  it('shows an issuer refusal, and warns when EO cannot mint uploader tokens', async () => {
    issuerConfigured = false;
    resetSession('s1-mach');
    renderAt('/access');
    expect(await screen.findByText(/cannot mint uploader tokens: CES_EC_PRINCIPAL_SECRET is not set/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Operator sign-in'), 'op');
    await userEvent.type(screen.getByLabelText('Reviewer (UPN)'), REVIEWER);
    await userEvent.click(screen.getByRole('button', { name: 'Mint approver token' }));
    expect(await screen.findByText(/self_mint: an operator may not mint an approver token for themselves \(HTTP 403\)/)).toBeInTheDocument();
    expect(useSession.getState().approverToken).toBe('');
  });
});
