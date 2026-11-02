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
import { BASE_ROUTES, fakeEo, renderAt, resetSession } from '../../testUtils';

const run = (done: number) => ({
  personnelName: 'Pat One', slaStatus: 'green', triggerTime: '2026-10-31T00:00:00.000Z', currentStepIndex: done,
  steps: [
    { id: 's1', label: 'Disable account', completed: done > 0, ...(done > 0 ? { attestor: 'IT Lead', completedAt: '2026-10-31T01:00:00.000Z' } : {}) },
    { id: 's2', label: 'Recover equipment', completed: done > 1 },
  ],
});

let eo: ReturnType<typeof fakeEo>;
let stepsDone = 0;

beforeEach(() => {
  resetSession('s1-mach');
  stepsDone = 0;
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/personnel': [{ id: 'p1', displayName: 'Pat One', email: 'p1@x.test', role: 'ISSO', screeningState: 'cleared' }],
    'GET /api/personnel/p1/offboarding': { status: 404, body: { error: 'no run' } },
    'POST /api/personnel/p1/offboarding': () => ({ status: 201, body: run(0) }),
    'PUT /api/personnel/p1/offboarding/step/s1': () => { stepsDone = 1; return { body: run(1) }; },
    'PUT /api/personnel/p1/offboarding/step/s2': () => { stepsDone = 2; return { body: run(2) }; },
    'POST /api/personnel/p1/offboarding/complete': { ok: true },
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Offboarding (PS.L2-3.9.2)', () => {
  it('starts a run on 404, attests each step by name, then finalizes with a named sign-off', async () => {
    renderAt('/offboarding');
    await userEvent.selectOptions(await screen.findByLabelText('Person'), await screen.findByRole('option', { name: 'Pat One (cleared)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open or start offboarding' }));
    expect(await screen.findByText('Offboarding: Pat One')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete step' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Attestor name (who performed this action)'), 'IT Lead');
    await userEvent.click(screen.getByRole('button', { name: 'Complete step' }));
    expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/offboarding/step/s1')!.body).toEqual({ attestor: 'IT Lead' });
    await userEvent.type(screen.getByLabelText('Attestor name (who performed this action)'), 'Facilities');
    await userEvent.click(screen.getByRole('button', { name: 'Complete step' }));
    expect(await screen.findByText(/All steps completed/)).toBeInTheDocument();
    expect(stepsDone).toBe(2);
    await userEvent.type(screen.getByLabelText('Final sign-off attestor'), 'Authorizing Official');
    await userEvent.click(screen.getByRole('button', { name: 'Finalize offboarding' }));
    expect(await screen.findByText('Offboarding finalized.')).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/personnel/p1/offboarding/complete')!.body).toEqual({ attestor: 'Authorizing Official' });
    expect(eo.calls.every((c) => c.query.tenant === undefined || c.query.tenant === 's1-mach')).toBe(true);
  });
});
