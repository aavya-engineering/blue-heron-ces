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
import { BASE_ROUTES, fakeEo, fakeToken, renderAt, resetSession, seriousAxe } from '../../testUtils';
import { useSession } from '../../store/session';
import { blockReason } from '.';

const CONTROL = 'PE.L2-3.10.2';
const UPLOADER = 'uploader.ui@s1.example.test';
const REVIEWER = 'reviewer.ui@s1.example.test';
const HASH = 'c'.repeat(64);
const exp = () => Math.floor(Date.now() / 1000) + 900;
const items = [
  { itemId: 'ec-1', filename: 'visitors.pdf', sha256: HASH, controlIds: [CONTROL], source: 'manual_upload', collectedAt: '2026-10-31T00:00:00.000Z', uploadedBy: { upn: UPLOADER } },
  { itemId: 'ec-2', filename: 'anon.pdf', sha256: 'd'.repeat(64), controlIds: [CONTROL], source: 'manual_upload', collectedAt: '2026-10-31T00:00:00.000Z', uploadedBy: null },
];

let eo: ReturnType<typeof fakeEo>;
let postReply: { status: number; body: unknown };

beforeEach(() => {
  resetSession('s1-mach');
  postReply = {
    status: 201,
    body: { reviewId: 'rv-1', controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: HASH, verdict: 'met', reviewer: { upn: REVIEWER }, uploader: { upn: UPLOADER }, reviewedAt: '2026-10-31T02:00:00.000Z', supersedes: ['rv-0'] },
  };
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/review-queue/controls': { controls: [{ controlId: 'AT.L2-3.2.1', objectiveIds: ['AT.L2-3.2.1[a]'] }, { controlId: CONTROL, objectiveIds: [`${CONTROL}[a]`, `${CONTROL}[b]`] }] },
    'GET /api/review-queue': { tenant: 's1-mach', controlId: CONTROL, nonStack: true, objectiveIds: [`${CONTROL}[a]`, `${CONTROL}[b]`], items, reviews: [] },
    'POST /api/reviews': () => postReply,
  });
});
afterEach(() => { cleanup(); eo.restore(); });

async function choose(item = 'Review visitors.pdf') {
  renderAt('/review');
  await screen.findByRole('option', { name: CONTROL });
  await userEvent.selectOptions(screen.getByLabelText('Control (non-stack set)'), CONTROL);
  await userEvent.click(await screen.findByRole('radio', { name: item }));
  await userEvent.selectOptions(screen.getByLabelText('Objective'), `${CONTROL}[a]`);
}

describe('Review screen (GD-b)', () => {
  it('records a review with the approver token as x-ces-principal and the chosen upload\'s hash', async () => {
    const token = fakeToken({ upn: REVIEWER, roles: ['ao-approver'], exp: exp() });
    useSession.getState().setApproverToken(token);
    await choose();
    expect(screen.getByText(`Reviewer (approver token): ${REVIEWER}`)).toBeInTheDocument();
    expect(screen.getByText(`Uploader (recorded by EC): ${UPLOADER}`)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Notes (optional)'), 'log matches badge list');
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));
    expect(await screen.findByText(/Review recorded \(rv-1\).*It replaces 1 earlier review/)).toBeInTheDocument();
    const call = eo.calls.find((c) => c.method === 'POST' && c.path === '/api/reviews')!;
    expect(call.headers['x-ces-principal']).toBe(token);
    expect(call.body).toEqual({ tenant: 's1-mach', controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: HASH, verdict: 'met', notes: 'log matches badge list' });
    expect(eo.calls.find((c) => c.path === '/api/review-queue')!.query).toEqual({ tenant: 's1-mach', controlId: CONTROL });
  });

  it('will not submit when the approver token names the uploader (case-insensitive)', async () => {
    useSession.getState().setApproverToken(fakeToken({ upn: UPLOADER.toUpperCase(), exp: exp() }));
    await choose();
    expect(screen.getByText(/who uploaded this document. Another person must review it \(GD-b\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record review' })).toBeDisabled();
    expect(eo.calls.some((c) => c.method === 'POST' && c.path === '/api/reviews')).toBe(false);
  });

  it('will not submit an upload with no recorded uploader, or without a token', async () => {
    await choose('Review anon.pdf');
    expect(screen.getByText(/An approver token is required/)).toBeInTheDocument();
    useSession.getState().setApproverToken(fakeToken({ upn: REVIEWER, exp: exp() }));
    await waitFor(() => expect(screen.getByText(/has no recorded uploader, so no review can credit it/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Record review' })).toBeDisabled();
  });

  it('shows EO\'s own refusal (403 reviewer_is_uploader) when the token does not carry a readable UPN', async () => {
    useSession.getState().setApproverToken('opaque-token-the-ui-cannot-read');
    postReply = { status: 403, body: { error: 'reviewer_is_uploader', detail: 'a reviewer may not review an artifact they uploaded' } };
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));
    expect(await screen.findByText(/Refused: a reviewer may not review an artifact they uploaded \(GD-b\). \(HTTP 403\)/)).toBeInTheDocument();
  });

  it('blockReason covers each gate', () => {
    const item = items[0] as never;
    const t = fakeToken({ upn: REVIEWER, exp: exp() });
    expect(blockReason(null, REVIEWER, 'o', t)).toMatch(/Choose an upload/);
    expect(blockReason(item, REVIEWER, '', t)).toMatch(/Choose the objective/);
    expect(blockReason(item, REVIEWER, 'o', ' ')).toMatch(/approver token is required/);
    expect(blockReason(item, REVIEWER, 'o', fakeToken({ upn: REVIEWER, exp: 1 }))).toMatch(/expired/);
    expect(blockReason(items[1] as never, REVIEWER, 'o', t)).toMatch(/no recorded uploader/);
    expect(blockReason(item, UPLOADER, 'o', t)).toMatch(/GD-b/);
    expect(blockReason(item, REVIEWER, 'o', t)).toBeNull();
  });

  it('has no serious axe finding with the queue open', async () => {
    useSession.getState().setApproverToken(fakeToken({ upn: REVIEWER, exp: exp() }));
    await choose();
    expect(await seriousAxe(document.body)).toEqual([]);
  });
});
