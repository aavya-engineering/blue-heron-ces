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
import { parseRoles } from '.';

let eo: ReturnType<typeof fakeEo>;
let population: { roles: string[]; source: string } | null;

beforeEach(() => {
  resetSession('s1-mach');
  population = { roles: ['Systems Administrator'], source: 'interview' };
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/personnel/s1-mach/role-population': () => ({ body: { tenantSlug: 's1-mach', population } }),
    'PUT /api/personnel/s1-mach/role-population': (c) => {
      const roles = (c.body as { roles: string[] }).roles;
      population = roles.length ? { roles, source: 'operator' } : null;
      return { body: { tenantSlug: 's1-mach', population } };
    },
    'GET /api/personnel': [{ id: 'p1', displayName: 'Pat One', email: 'p1@x.test', role: 'ISSO', screeningState: 'cleared' }],
    'GET /api/personnel/p1/training': { state: { completions: [{ courseId: 'c1', completedDate: '2026-10-01' }] }, requiredCourses: ['c1', 'c2'] },
    'GET /api/training/catalog': { courses: [{ id: 'c1', title: 'Awareness' }, { id: 'c2', title: 'Insider threat', refresh_cycle_days: 365 }] },
    'POST /api/personnel/p1/training/complete': { ok: true },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Training: AT.L2-3.2.2 role population (LOG-FIN-26b route) and course records', () => {
  it('reads the population in force and saves the edited list with PUT { roles }', async () => {
    renderAt('/training');
    expect(await screen.findByText('In force: 1 role(s) (source: interview).')).toBeInTheDocument();
    const box = screen.getByLabelText('Roles (one per line)') as HTMLTextAreaElement;
    expect(box.value).toBe('Systems Administrator');
    await userEvent.clear(box);
    await userEvent.type(box, 'ISSO{enter}  ISSM {enter}ISSO{enter}{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save population' }));
    expect(await screen.findByText('Saved 2 role(s).')).toBeInTheDocument();
    const put = eo.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/api/personnel/s1-mach/role-population');
    expect(put.body).toEqual({ roles: ['ISSO', 'ISSM'] });
    expect(screen.getByText('In force: 2 role(s) (source: operator).')).toBeInTheDocument();
  });

  it('an empty list clears the operator list', async () => {
    renderAt('/training');
    await screen.findByText('In force: 1 role(s) (source: interview).');
    await userEvent.clear(screen.getByLabelText('Roles (one per line)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save population' }));
    expect(await screen.findByText('Cleared the operator list.')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.method === 'PUT')!.body).toEqual({ roles: [] });
  });

  it('shows a person\'s courses and marks one complete with an expiry from the refresh cycle', async () => {
    renderAt('/training');
    await userEvent.selectOptions(await screen.findByLabelText('Person'), await screen.findByRole('option', { name: 'Pat One (ISSO)' }));
    expect(await screen.findByRole('cell', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Assigned' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark Insider threat complete' }));
    await waitFor(() => expect(eo.calls.some((c) => c.path === '/api/personnel/p1/training/complete')).toBe(true));
    const body = eo.calls.find((c) => c.path === '/api/personnel/p1/training/complete')!.body as Record<string, string>;
    expect(body.courseId).toBe('c2');
    expect(body.completedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parseRoles trims, drops blanks and duplicates', () => {
    expect(parseRoles(' a \r\n\nb\na\n')).toEqual(['a', 'b']);
  });
});
