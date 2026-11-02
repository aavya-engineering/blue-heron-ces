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
import { NO_FILTERS, filterAndSort, reviewStatus, snapshotDiff, summarize } from './riskModel';

const E1 = { id: 'e1', threatEvent: 'Phishing', vulnerability: { description: 'No MFA' }, likelihood: 'high', impact: 'high', compositeRisk: 'high', treatmentStatus: 'recommended', source: { type: 'secure_score', controlName: 'MFA', score: 2 } };
const E2 = { id: 'e2', threatEvent: 'Flood', vulnerability: { description: 'Basement servers' }, treatmentStatus: 'recommended', source: { type: 'manual' } };
const SNAP_2025 = { snapshotId: 's25', assessmentYear: 2025, signedOffBy: 'AO One', signedOffDate: '2025-06-01', registerSnapshot: { entries: [E1, E2] } };
const SNAP_2026 = { snapshotId: 's26', assessmentYear: 2026, signedOffBy: 'AO One', signedOffDate: '2026-06-01', registerSnapshot: { entries: [{ ...E1, compositeRisk: 'moderate', treatmentStatus: 'in_progress' }, { id: 'e3', threatEvent: 'Insider', vulnerability: { description: 'x' } }] } };

let eo: ReturnType<typeof fakeEo>;
let review: Record<string, unknown> | null;
beforeEach(() => {
  resetSession('s1-mach');
  review = null;
  eo = fakeEo({
    ...BASE_ROUTES,
    'GET /api/risk-assessment/register': { entries: [E1, E2], nextReviewDue: '2099-01-01', lastFullReviewDate: '2025-06-01' },
    'GET /api/risk-assessment/config': {
      scopeStatement: 'All CUI systems', frequencyMonths: 12, methodology: 'nist_sp_800_30_rev1',
      threatCatalog: { adversarial: [{ source: 'Nation state', events: ['APT intrusion'] }], non_adversarial: [] },
      vulnerabilitySources: { defender_for_cloud: { enabled: true, severity_threshold: 'high' }, microsoft_secure_score: { enabled: true } },
      authorizingOfficial: { displayName: 'AO One', upn: 'ao@x.test', role: 'CEO' },
    },
    'PUT /api/risk-assessment/config': (c) => ({ body: c.body }),
    'GET /api/risk-assessment/register/entries/e1': E1,
    'PUT /api/risk-assessment/register/entries/e1': (c) => ({ body: { ...E1, ...(c.body as object) } }),
    'DELETE /api/risk-assessment/register/entries/e1': { status: 204, text: '' },
    'POST /api/risk-assessment/ingest': { timestamp: '2026-10-31T10:00:00Z', totalNew: 2, totalUpdated: 1, totalErrors: 0, results: [{ source: 'secure_score', new: 2, updated: 1, skipped: 0, errors: [] }] },
    'GET /api/risk-assessment/ingestion-runs': [{ timestamp: '2026-10-30T10:00:00Z', totalNew: 1, totalUpdated: 0, totalErrors: 0, trigger: 'manual' }],
    'GET /api/risk-assessment/annual-review/state': () => (review ? { body: review } : { status: 404, body: { error: 'No annual review in progress' } }),
    'POST /api/risk-assessment/annual-review/start': (c) => { review = { currentStep: 1, startedAt: 'now', startedBy: (c.body as { startedBy: string }).startedBy, stepData: {} }; return { status: 201, body: review }; },
    'PUT /api/risk-assessment/annual-review/step/1': (c) => { review = { ...review!, currentStep: 2, stepData: { 1: c.body } }; return { body: review }; },
    'DELETE /api/risk-assessment/annual-review/state': { ok: true },
    'POST /api/risk-assessment/annual-review/one-click': { success: true, snapshot: SNAP_2026, summary: { totalEntries: 2, ingested: { new: 0, updated: 0, errors: 0 }, scored: 1, nextReviewDue: '2027-10-31' } },
    'GET /api/risk-assessment/snapshots': [{ year: 2026, snapshotId: 's26', signedOffDate: '2026-06-01' }, { year: 2025, snapshotId: 's25', signedOffDate: '2025-06-01' }],
    'GET /api/risk-assessment/snapshots/2025': SNAP_2025,
    'GET /api/risk-assessment/snapshots/2026': SNAP_2026,
  });
});
afterEach(() => { cleanup(); eo.restore(); });

describe('Risk (FIN-31b legacy parity)', () => {
  it('header, ingestion with its report and run history, chips and the summary', async () => {
    renderAt('/risk');
    expect(await screen.findByText('All CUI systems')).toBeInTheDocument();
    expect(screen.getByText('NIST SP 800-30 Rev. 1')).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Phishing' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run ingestion' }));
    expect(await screen.findByText(/new: 2 \| updated: 1 \| errors: 0/)).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/risk-assessment/ingest')!.method).toBe('POST');
    await userEvent.click(screen.getByRole('button', { name: 'Needs scoring' }));
    expect(screen.queryByRole('cell', { name: 'Phishing' })).toBeNull();
    expect(screen.getByRole('cell', { name: 'Flood' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'By risk level' })).getByText('unscored').nextSibling).toHaveTextContent('1');
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('the entry editor saves treatment fields, marks mitigated, and deletes after a confirm', async () => {
    renderAt('/risk');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Phishing' }));
    await screen.findByText(/Control: MFA \(Score: 2\)/);
    await userEvent.type(document.querySelector('#riskTreatmentRef') as HTMLInputElement, 'POAM-7');
    await userEvent.click(screen.getByRole('button', { name: 'Mark mitigated' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/risk-assessment/register/entries/e1')).toBe(true));
    expect(eo.calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ treatmentStatus: 'mitigated', treatmentReference: 'POAM-7', compositeRisk: 'high', treatmentRecommendation: 'mitigate' });
    expect(await seriousAxe(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete this risk entry' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'DELETE' && c.path === '/api/risk-assessment/register/entries/e1')).toBe(true));
  });

  it('annual review: starts one on 404, step 1 needs the scope confirmation, Next saves the step', async () => {
    renderAt('/risk');
    await userEvent.click(await screen.findByRole('button', { name: 'Begin annual review' }));
    await screen.findByRole('region', { name: 'Step 1: scope confirmation' });
    expect(eo.calls.find((c) => c.path === '/api/risk-assessment/annual-review/start')!.body).toEqual({ startedBy: 'Authorizing Official' });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Confirm the scope statement before proceeding.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm the scope statement/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('region', { name: 'Step 2: threat catalog review' });
    expect(eo.calls.find((c) => c.path === '/api/risk-assessment/annual-review/step/1')!.body).toEqual({ scopeText: 'All CUI systems', scopeConfirmed: true });
    expect(await seriousAxe(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard all review progress' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'DELETE' && c.path === '/api/risk-assessment/annual-review/state')).toBe(true));
  });

  it('one-click review names the signer (the AO from setup by default)', async () => {
    renderAt('/risk');
    await screen.findByRole('cell', { name: 'Phishing' });
    await userEvent.click(screen.getByText('Complete the annual review in one step'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete annual review' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Complete annual review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run it: ingest, score and snapshot' }));
    expect(await screen.findByText(/Annual review complete — 2 entries reviewed, 1 auto-scored/)).toBeInTheDocument();
    expect(eo.calls.find((c) => c.path === '/api/risk-assessment/annual-review/one-click')!.body).toEqual({ reviewedBy: 'AO One', signedOffBy: 'AO One' });
  });

  it('history: lists snapshots with signer and counts, views one, compares two', async () => {
    renderAt('/risk');
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('VH 0 · H 1 · M 0 · L 0 · VL 0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View snapshot 2025' }));
    expect(await screen.findByRole('region', { name: 'Snapshot 2025' })).toHaveTextContent('Basement servers');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare 2025' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Compare 2026' }));
    await userEvent.click(screen.getByRole('button', { name: 'Compare selected' }));
    const cmp = await screen.findByRole('region', { name: 'Compare 2025 vs 2026' });
    expect(cmp).toHaveTextContent('Added (1 entries)');
    expect(cmp).toHaveTextContent('Retired (1 entries)');
    expect(cmp).toHaveTextContent('Re-scored (1 entries)');
    expect(cmp).toHaveTextContent('Treatment changed (1 entries)');
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('setup saves each section as a partial config, and edits the threat catalog', async () => {
    renderAt('/risk');
    await userEvent.click(await screen.findByRole('tab', { name: 'Setup' }));
    await waitFor(() => expect((document.querySelector('#riskScopeStatementInput') as HTMLTextAreaElement).value).toBe('All CUI systems'));
    await userEvent.click(screen.getByRole('button', { name: 'Save frequency' }));
    await waitFor(() => expect(eo.calls.some((c) => c.method === 'PUT' && c.path === '/api/risk-assessment/config')).toBe(true));
    expect(eo.calls.filter((c) => c.method === 'PUT')[0].body).toEqual({ frequencyMonths: 12 });
    await userEvent.type(screen.getByLabelText('New adversarial threat source'), 'Criminal group');
    await userEvent.click(screen.getByRole('button', { name: 'Add adversarial threats source' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save catalog' }));
    await waitFor(() => expect(eo.calls.filter((c) => c.method === 'PUT').length).toBe(2));
    expect(eo.calls.filter((c) => c.method === 'PUT')[1].body).toEqual({ threatCatalog: { adversarial: [{ source: 'Nation state', events: ['APT intrusion'] }, { source: 'Criminal group', events: [] }], non_adversarial: [] } });
    await userEvent.click(screen.getByRole('button', { name: 'Save sources' }));
    await waitFor(() => expect(eo.calls.filter((c) => c.method === 'PUT').length).toBe(3));
    expect(eo.calls.filter((c) => c.method === 'PUT')[2].body).toEqual({ vulnerabilitySources: {
      defender_for_cloud: { enabled: true, severity_threshold: 'high' }, microsoft_secure_score: { enabled: true },
      plan_output_not_met: { enabled: false }, sentinel_incidents: { enabled: false } } });
    expect(await seriousAxe(document.body)).toEqual([]);
  });

  it('riskModel: filter/sort, summary, review status and snapshot diff', () => {
    expect(filterAndSort([E2, E1] as never, NO_FILTERS, 'compositeRisk', false).map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(filterAndSort([E1, E2] as never, { ...NO_FILTERS, source: ['manual'] }, 'threatEvent', true).map((e) => e.id)).toEqual(['e2']);
    expect(summarize([E1, E2] as never).byLevel).toMatchObject({ high: 1, unscored: 1 });
    expect(reviewStatus('2000-01-01')).toBe('Overdue');
    const d = snapshotDiff(SNAP_2025 as never, SNAP_2026 as never);
    expect([d.added.map((e) => e.id), d.retired.map((e) => e.id), d.rescored[0].to, d.treatment[0].to]).toEqual([['e3'], ['e2'], 'moderate', 'in_progress']);
  });
});
