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
import { BASE_ROUTES, fakeEo, renderAt, resetSession, seriousAxe } from '../../testUtils';
import { courseStatus } from '.';

let eo: ReturnType<typeof fakeEo>;
let catalog: { version: string; courses: Array<Record<string, unknown>> };

beforeEach(() => {
  resetSession('s1-mach');
  catalog = { version: '1', courses: [{ id: 'c1', title: 'Awareness', provider: 'KnowBe4', duration: '30min' }, { id: 'c2', title: 'Insider threat', refresh_cycle_days: 365 }] };
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/personnel/s1-mach/role-population': { tenantSlug: 's1-mach', population: null },
    'GET /api/personnel': [{ id: 'p1', displayName: 'Pat One', email: 'p1@x.test', role: 'ISSO', screeningState: 'cleared' }],
    'GET /api/personnel/p1/training': { state: { completions: [{ courseId: 'c1', completedDate: '2026-10-01', certificateArtifactId: 'cert1' }] }, requiredCourses: ['c1', 'c2'] },
    'GET /api/training/catalog': () => ({ body: catalog }),
    'PUT /api/training/catalog': (c) => { catalog = c.body as typeof catalog; return { body: { ok: true } }; },
    'POST /api/personnel/p1/training/assign': { ok: true },
    'POST /api/personnel/p1/training/email': { emailText: 'Hello Pat One, please complete: Awareness, Insider threat' },
    'POST /api/personnel/p1/training/certificate': { id: 'cert2', type: 'training-certificate', filename: 'cert.pdf' },
    'GET /api/personnel/p1/attachments/cert1': { text: 'PDF' },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

async function openPat() {
  renderAt('/training');
  await userEvent.selectOptions(await screen.findByLabelText('Person'), await screen.findByRole('option', { name: 'Pat One (ISSO)' }));
  await screen.findByRole('cell', { name: 'Completed' });
}

describe('Training (FIN-31b legacy parity)', () => {
  it('assigns the ticked courses with POST { courseIds }', async () => {
    await openPat();
    await userEvent.click(screen.getByRole('button', { name: 'Assign training' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Awareness/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign selected' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/training/assign')).toBe(true));
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/training/assign')!.body).toEqual({ courseIds: ['c2'] });
  });

  it('FD-6: the email is generated and shown as simulated; no send route exists or is called', async () => {
    await openPat();
    await userEvent.click(screen.getByRole('button', { name: 'Generate email' }));
    expect(await screen.findByDisplayValue('Hello Pat One, please complete: Awareness, Insider threat')).toBeInTheDocument();
    expect(screen.getByText(/Simulated outbox \(FD-6\): EO sends no email/)).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/training/email')!.body).toEqual({ courseIds: ['c1', 'c2'] });
    expect(eo.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/personnel/p1/training/email']);
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('uploads a certificate with the course id, and downloads one through fetch', async () => {
    await openPat();
    const input = screen.getByLabelText('Certificate for Insider threat') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'cert.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload certificate for Insider threat' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/training/certificate')).toBe(true));
    const form = eo.calls.find((c) => c.path === '/api/personnel/p1/training/certificate')!.body as FormData;
    expect(form.get('courseId')).toBe('c2');
    await userEvent.click(screen.getByRole('button', { name: 'Download certificate for Awareness' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/attachments/cert1')).toBe(true));
  });

  it('catalog: add writes the whole catalog back with the new course; delete confirms then removes it', async () => {
    renderAt('/training');
    await screen.findByRole('cell', { name: 'KnowBe4' });
    await userEvent.click(screen.getByRole('button', { name: 'Add course' }));
    await userEvent.type(document.querySelector('#newCourseId') as HTMLInputElement, 'cui-101');
    await userEvent.type(document.querySelector('#newCourseTitle') as HTMLInputElement, 'CUI handling');
    await userEvent.type(document.querySelector('#newCourseProvider') as HTMLInputElement, 'In-house');
    await userEvent.type(document.querySelector('#newCourseDuration') as HTMLInputElement, '45min');
    await userEvent.type(document.querySelector('#newCourseControls') as HTMLInputElement, 'AT.L2-3.2.1, AT.L2-3.2.2');
    expect(await seriousAxe(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Save course' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/training/catalog')).toBe(true));
    const put = eo.calls.find((c) => c.method === 'PUT')!.body as typeof catalog;
    expect(put.version).toBe('1');
    expect(put.courses.map((c) => c.id)).toEqual(['c1', 'c2', 'cui-101']);
    expect(put.courses[2]).toMatchObject({ title: 'CUI handling', required_for_roles: ['all_users'], targetRoles: ['all_users'], satisfies_controls: ['AT.L2-3.2.1', 'AT.L2-3.2.2'], refresh_cycle_days: 365 });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete course Awareness' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(eo.calls.filter((c) => c.method === 'PUT').length).toBe(2));
    expect((eo.calls.filter((c) => c.method === 'PUT')[1].body as typeof catalog).courses.map((c) => c.id)).toEqual(['c2', 'cui-101']);
  });

  it('courseStatus follows legacy', () => {
    expect(courseStatus({ expiryDate: '2000-01-01' }, true)).toBe('Overdue');
    expect(courseStatus(undefined, true)).toBe('Assigned');
    expect(courseStatus(undefined, false)).toBe('Not Started');
  });
});
