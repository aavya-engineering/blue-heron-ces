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
import { BASE_ROUTES, fakeEo, fakeToken, renderAt, resetSession } from '../../testUtils';
import { useSession } from '../../store/session';

const UPLOADER = 'uploader.ui@s1.example.test';
let eo: ReturnType<typeof fakeEo>;
let ingest: { status: number; body: unknown };

beforeEach(() => {
  resetSession('s1-mach');
  ingest = { status: 201, body: { itemId: 'ec-item-9', uploadedBy: { upn: UPLOADER } } };
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/ec/health': { status: 'ok', mode: 'capture_only' },
    'GET /api/ec/runs': [],
    'GET /api/ec/findings': [],
    'POST /api/ec/ingest': () => ingest,
  });
});
afterEach(() => { cleanup(); eo.restore(); });

async function fill() {
  await userEvent.type(document.querySelector('#ecUploadControlIds') as HTMLInputElement, 'PE.L2-3.10.2');
  await userEvent.type(document.querySelector('#ecUploadRole') as HTMLInputElement, 'facility_manager');
  await userEvent.type(document.querySelector('#ecUploadFormId') as HTMLInputElement, 'EVF-PE-01');
  await userEvent.type(document.querySelector('#ecUploadEmxIds') as HTMLInputElement, 'EMX-1,EMX-2');
  await userEvent.upload(document.querySelector('#ecUploadFile') as HTMLInputElement, new File(['visitor log'], 'visitors.pdf', { type: 'application/pdf' }));
}

describe('Upload (records the uploader)', () => {
  it('posts the legacy multipart fields with the uploader token as x-ces-principal and names the recorded uploader', async () => {
    const token = fakeToken({ upn: UPLOADER, sub: `uploader:${UPLOADER}`, exp: Math.floor(Date.now() / 1000) + 3600 });
    useSession.getState().setUploaderToken(token);
    renderAt('/upload');
    expect(await screen.findByText(`Uploading as ${UPLOADER}.`)).toBeInTheDocument();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText(`Uploaded (ec-item-9) by ${UPLOADER}`)).toBeInTheDocument();
    const call = eo.calls.find((c) => c.method === 'POST' && c.path === '/api/ec/ingest')!;
    expect(call.headers['x-ces-principal']).toBe(token);
    expect(call.headers['content-type']).toBeUndefined(); // the browser sets the multipart boundary
    const form = call.body as FormData;
    expect(Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'))).toEqual({
      tenantSlug: 's1-mach', controlIds: 'PE.L2-3.10.2', source: 'manual_upload', submittedByRole: 'facility_manager', form_id: 'EVF-PE-01', emx_ids: 'EMX-1,EMX-2',
    });
    expect((form.get('file') as File).name).toBe('visitors.pdf');
  });

  it('without a token it warns first, sends no principal, and says a review cannot credit the upload', async () => {
    ingest = { status: 201, body: { itemId: 'ec-item-10', uploadedBy: null } };
    renderAt('/upload');
    expect(await screen.findByText(/No uploader token: EC will record no uploader/)).toBeInTheDocument();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText(/with no uploader recorded: a review cannot credit this upload/)).toBeInTheDocument();
    const call = eo.calls.find((c) => c.path === '/api/ec/ingest')!;
    expect(call.headers['x-ces-principal']).toBeUndefined();
  });

  it('labels EC\'s 401 as a refused uploader token, and checks required fields locally', async () => {
    useSession.getState().setUploaderToken(fakeToken({ upn: UPLOADER }));
    ingest = { status: 401, body: { error: 'unauthorized', reason: 'bad_signature' } };
    renderAt('/upload');
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(screen.getByText('Control ID(s), role and a file are all required')).toBeInTheDocument();
    expect(eo.calls.some((c) => c.path === '/api/ec/ingest')).toBe(false);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(screen.getByText(/the uploader token was refused/)).toBeInTheDocument());
  });
});
