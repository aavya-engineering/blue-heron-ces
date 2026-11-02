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
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BASE_ROUTES, fakeEo, renderAt, resetSession, seriousAxe } from '../../testUtils';
import { filterPeople, readinessText } from '.';
import { stateUpdates } from './PersonPanels';
import { evidenceRequestText } from './ScreeningPanel';

const PEOPLE = [
  {
    id: 'p1', displayName: 'Pat One', email: 'p1@x.test', role: 'ISSO', screeningState: 'cleared', lastScreenedDate: '2026-01-02T00:00:00Z',
    lifecycleEvents: [{ timestamp: '2026-01-01', event: 'created' }],
    evidenceArtifacts: [{ id: 'a1', type: 'id-verification', filename: 'id.pdf', contentHash: 'abcdef0123456789abcdef', metadata: { screeningElement: 1 } }],
  },
  { id: 'p2', displayName: 'Sam Two', email: 'p2@x.test', role: 'Engineer', screeningState: 'unscreened' },
];
const ELEMENTS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ elementNumber: n, status: n <= 2 ? 'completed' : n === 3 ? 'in_progress' : 'not_started', data: n === 1 ? { documentNumber: 'D-1' } : null }));
const DEFS = [
  { elementNumber: 1, title: 'Identity Verification', fields: [{ name: 'documentType', label: 'Document Type', type: 'select', options: ['passport', 'other'] }, { name: 'documentNumber', label: 'Document Number', type: 'text' }] },
  { elementNumber: 4, title: 'Direct-Knowledge Attestation', hasTemplate: true, fields: [{ name: 'signedText', label: 'Signed Text', type: 'textarea' }, { name: 'yearsKnown', label: 'Years Known', type: 'number' }] },
];

let eo: ReturnType<typeof fakeEo>;
beforeEach(() => {
  resetSession('s1-mach');
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/personnel': PEOPLE,
    'GET /api/personnel/readiness': { cleared: 1, total: 2, expiringSoon: 0, unscreened: 1, ps_3_9_1: 'not_met' },
    'GET /api/personnel/config': { reviewCycleYears: 3, docRetentionYears: 6 },
    'PUT /api/personnel/config': (c) => ({ body: c.body }),
    'GET /api/personnel/p1/training': { status: { completed: 1, total: 2, overdue: 0 }, state: { completions: [] }, requiredCourses: [] },
    'GET /api/personnel/p2/training': { status: { completed: 0, total: 2, overdue: 1 }, state: { completions: [] }, requiredCourses: [] },
    'GET /api/personnel/p1/screening/readiness': { elementsComplete: [1, 2], elementsIncomplete: [3, 4, 5, 6, 7], packageComplete: false },
    'GET /api/personnel/p2/screening/readiness': { elementsComplete: [], elementsIncomplete: [1, 2, 3, 4, 5, 6, 7], packageComplete: false },
    'GET /api/training/catalog': { courses: [] },
    'PUT /api/personnel/p1': (c) => ({ body: { ...PEOPLE[0], ...(c.body as object) } }),
    'DELETE /api/personnel/p2/record': { ok: true },
    'POST /api/personnel/p1/attachments': { id: 'a2', type: 'other', filename: 'f.pdf' },
    'GET /api/personnel/p1/attachments/a1': { text: 'PDF', headers: { 'content-disposition': 'attachment; filename="id.pdf"' } },
    'GET /api/screening/definitions': DEFS,
    'GET /api/personnel/p1/screening': { personnelId: 'p1', elements: ELEMENTS },
    'PUT /api/personnel/p1/screening/1': { ok: true },
    'PUT /api/personnel/p1/screening/4': { ok: true },
    'GET /api/personnel/p1/screening/template/4': { elementNumber: 4, templateText: 'I attest that Pat One...' },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Personnel (FIN-31b legacy parity)', () => {
  it('shows the PS readiness banner, metrics, and per-person screening x/7 and training columns', async () => {
    renderAt('/personnel');
    expect(await screen.findByText('PS.L2-3.9.1: NOT MET — 1 unscreened. 1 of 2 cleared.')).toBeInTheDocument();
    expect(document.querySelector('#personnelCleared')!.textContent).toBe('1');
    expect(await screen.findByRole('button', { name: 'Screening elements for Pat One' })).toHaveTextContent('2/7');
    expect(await screen.findByRole('button', { name: 'Training for Sam Two' })).toHaveTextContent('0/2 (overdue)');
    expect(screen.getByRole('button', { name: 'Attachments for Pat One' })).toHaveTextContent('1');
  });

  it('edit sends only the changed fields, and "cleared" stamps the dates from the configured review cycle', async () => {
    renderAt('/personnel');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Pat One' }));
    const role = document.querySelector('#editPersonRole') as HTMLInputElement;
    await userEvent.clear(role);
    await userEvent.type(role, 'ISSM');
    await userEvent.selectOptions(document.querySelector('#editPersonState') as HTMLSelectElement, 'expired');
    expect(screen.getByText(/State will change from "cleared" to "expired"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/personnel/p1')).toBe(true));
    expect(eo.calls.find((c) => c.method === 'PUT' && c.path === '/api/personnel/p1')!.body).toEqual({ role: 'ISSM', screeningState: 'expired' });
    const u = stateUpdates('cleared', 3, new Date('2026-01-01T00:00:00Z'));
    expect(u.screeningState).toBe('cleared');
    expect(String(u.nextReviewDate)).toMatch(/^2029-01-01/);
  });

  it('delete is a two-step confirm and calls the permanent-delete route', async () => {
    renderAt('/personnel');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Sam Two' }));
    expect(eo.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'DELETE' && c.path === '/api/personnel/p2/record' && c.query.tenant === 's1-mach')).toBe(true));
  });

  it('attachments: lists, downloads through fetch (bearer-safe), and uploads with the type', async () => {
    renderAt('/personnel');
    await userEvent.click(await screen.findByRole('button', { name: 'Attachments for Pat One' }));
    expect(screen.getByText('SHA-256: abcdef0123456789...')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download id.pdf' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/attachments/a1')).toBe(true));
    await userEvent.upload(document.querySelector('#attachmentFileInput') as HTMLInputElement, new File(['x'], 'f.pdf', { type: 'application/pdf' }));
    await userEvent.selectOptions(document.querySelector('#attachmentTypeSelect') as HTMLSelectElement, 'cui-acknowledgment');
    await userEvent.click(document.querySelector('#attachmentUploadBtn') as HTMLButtonElement);
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'POST' && c.path === '/api/personnel/p1/attachments')).toBe(true));
    const form = eo.calls.find((c) => c.method === 'POST' && c.path === '/api/personnel/p1/attachments')!.body as FormData;
    expect(form.get('type')).toBe('cui-acknowledgment');
    expect(form.get('uploadedBy')).toBe('user');
    expect((form.get('file') as File).name).toBe('f.pdf');
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('screening accordion: 7 elements, AO sign-off locked until 1-6 complete, fields from the definitions, draft save body', async () => {
    renderAt('/personnel');
    await userEvent.click(await screen.findByRole('button', { name: 'Screening elements for Pat One' }));
    const panel = await screen.findByRole('region', { name: 'Screening: Pat One' });
    await waitFor(() => expect(panel.querySelectorAll('details[data-element]').length).toBe(7));
    expect(within(panel).getByText('Complete elements 1-6 to unlock the AO sign-off.')).toBeInTheDocument();
    expect((document.querySelector('#se_1_documentNumber') as HTMLInputElement).value).toBe('D-1');
    await userEvent.selectOptions(document.querySelector('#se_1_documentType') as HTMLSelectElement, 'passport');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft of element 1' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/personnel/p1/screening/1')).toBe(true));
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/screening/1')!.body).toEqual({ status: 'in_progress', data: { documentType: 'passport', documentNumber: 'D-1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Load template text for element 4' }));
    await waitFor(() => expect((document.querySelector('#se_4_signedText') as HTMLTextAreaElement).value).toBe('I attest that Pat One...'));
    await userEvent.click(screen.getByRole('button', { name: 'Mark element 4 complete' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/screening/4')).toBe(true));
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/screening/4')!.body).toEqual({ status: 'completed', data: { signedText: 'I attest that Pat One...', yearsKnown: 0 } });
    await userEvent.click(screen.getByRole('button', { name: 'Request evidence' }));
    expect((document.querySelector('#evidenceRequestBody') as HTMLTextAreaElement).value).toContain('Element 6: CUI Acknowledgment');
    expect(screen.getByText(/EO sends no email \(FD-6\)/)).toBeInTheDocument();
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('setup saves the personnel configuration', async () => {
    renderAt('/personnel');
    await userEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    await waitFor(() => expect((document.querySelector('#pConfigReviewCycle') as HTMLInputElement).value).toBe('3'));
    await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/personnel/config')).toBe(true));
    expect((eo.calls.find((c) => c.method === 'PUT' && c.path === '/api/personnel/config')!.body as Record<string, unknown>).reviewCycleYears).toBe(3);
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('filters and banner text follow legacy', () => {
    const ppl = PEOPLE.map((p) => ({ ...p })) as never[];
    const tr = { p1: { completed: 1, total: 2, overdue: 0 }, p2: { completed: 0, total: 2, overdue: 1 } };
    expect(filterPeople(ppl, 'all', 'overdue', tr).map((p: { id: string }) => p.id)).toEqual(['p2']);
    expect(filterPeople(ppl, 'all', 'partial', tr).map((p: { id: string }) => p.id)).toEqual(['p1']);
    expect(readinessText({ cleared: 2, total: 2, expiringSoon: 0, unscreened: 0, ps_3_9_1: 'met', ps_3_9_2: 'met', screening_evidence_complete: true }).text)
      .toBe('PS.L2-3.9.1: MET — All 2 active personnel are cleared. PS.L2-3.9.2: MET | Screening Evidence: Complete');
    expect(evidenceRequestText('Pat One').subject).toBe('Personnel Screening — Evidence Request — Pat One');
  });
});
