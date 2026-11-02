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
import { BASE_ROUTES, fakeEo, renderAt, resetSession } from '../../testUtils';
import { useSession } from '../../store/session';

const SNAP = '11111111-2222-4333-8444-555555555555';
const SSP_ID = '99999999-2222-4333-8444-555555555555';
const stream = [
  { type: 'assess_start', tenant: 's1-mach' },
  { type: 'assess_check', checked: 1, total: 2, entryId: 'E1', label: 'MFA', status: 'exists' },
  { type: 'assess_check', checked: 2, total: 2, entryId: 'E2', label: 'Audit', status: 'missing' },
  { type: 'assess_summary', sprs_score: 92, controls_met: 100, controls_not_met: 10, controls_partial: 0, controls_not_assessed: 0, snapshotId: SNAP },
  { type: 'assess_done' },
].map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');

let eo: ReturnType<typeof fakeEo>;
beforeEach(() => {
  resetSession('s1-mach');
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/assess': { text: stream, headers: { 'content-type': 'text/event-stream' } },
    'GET /api/assessment': { snapshotId: SNAP, generatedAt: '2026-10-31T00:00:00.000Z', sprs_score: 92, controls: [{ control_id: 'AC.L2-3.1.1', family: 'AC', status: 'met' }] },
    'POST /api/ssp/generate': { sspId: SSP_ID, systemName: 'S1 system', generatedAt: '2026-10-31T00:00:00.000Z', controlImplementations: [{ control_id: 'AC.L2-3.1.1', family: 'AC', status: 'met', implementationNarrative: 'n' }] },
    'GET /api/ssp/export/99999999-2222-4333-8444-555555555555': { text: 'DOCXBYTES', headers: { 'content-disposition': 'attachment; filename="SSP-x-2026-10-31.docx"' } },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Assess, then SSP and DOCX', () => {
  it('streams /api/assess?tenant= with fetch, logs each frame and keeps the snapshot id', async () => {
    useSession.getState().setServiceToken('svc');
    renderAt('/assess');
    await userEvent.click(await screen.findByRole('button', { name: 'Run assessment' }));
    expect(await screen.findByText(/Evidence assessment complete. SPRS: 92 \| MET: 100 \| NOT MET: 10/)).toBeInTheDocument();
    expect(screen.getByText(/\[EXISTS\] E1/)).toBeInTheDocument();
    expect(screen.getByText(/\[MISSING\] E2/)).toBeInTheDocument();
    expect(useSession.getState().lastSnapshotId).toBe(SNAP);
    const call = eo.calls.find((c) => c.path === '/api/assess')!;
    expect(call.query).toEqual({ tenant: 's1-mach' });
    expect(call.headers.authorization).toBe('Bearer svc');
    await waitFor(() => expect(document.querySelector('#metricSprs')!.textContent).toBe('92'));
  });

  it('generates the SSP from the snapshot and downloads the DOCX through the tenant-scoped export route', async () => {
    renderAt('/ssp');
    const gen = await screen.findByRole('button', { name: 'Generate SSP' });
    await waitFor(() => expect(gen).toBeEnabled());
    await userEvent.click(gen);
    expect(await screen.findByText('SSP generated (1 controls).')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/ssp/generate')!.body).toEqual({ tenantSlug: 's1-mach', assessmentId: SNAP });
    await userEvent.click(screen.getByRole('button', { name: 'Download DOCX (assessor deliverable)' }));
    expect(await screen.findByText('Downloaded SSP-x-2026-10-31.docx.')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path.startsWith('/api/ssp/export/'))!.query).toEqual({ tenant: 's1-mach' });
  });
});
