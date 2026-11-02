// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence screen (legacy card 5, PC-10): stats, families, search, overlay, verdict badge, pop-out
// trigger, empty state. Fictional fixture data only.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import EvidenceScreen from '.';
import { useEvidenceStore } from '../../store/evidence';
import { useWorkflowStore } from '../../store/workflow';
import { resetPopoutState } from '../../store/popout';
import { FIXTURE_EVIDENCE, FIXTURE_SCAN, FIXTURE_TENANT, mockApi } from '../../store/spa3-mock-api';
import type { MockApi } from '../../store/spa3-mock-api';

let api: MockApi | null = null;

function renderScreen(path = `/evidence?tenant=${FIXTURE_TENANT}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EvidenceScreen />
    </MemoryRouter>,
  );
}

const byId = (id: string) => document.getElementById(id)!;

async function seriousViolations(root: Element) {
  // jsdom cannot compute colour contrast; that rule runs in the browser.
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

beforeEach(() => {
  useEvidenceStore.getState().reset();
  useWorkflowStore.getState().reset();
  resetPopoutState();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.restoreAllMocks();
});

describe('Evidence screen (PC-10)', () => {
  it('starts with the legacy ids, dashes and a Ready badge; no request before Scan', () => {
    api = mockApi({});
    renderScreen();
    expect(byId('workflowCard5')).toHaveAttribute('data-screen', 'evidence');
    expect(byId('cardStatus5')).toHaveTextContent('Ready');
    for (const id of ['evStatControls', 'evStatWithEvidence', 'evStatMissing', 'evStatCoverage']) expect(byId(id)).toHaveTextContent('--');
    expect(byId('evidenceEmptyState')).not.toBeVisible();
    expect(api.calls).toEqual([]);
  });

  it('Scan fills stats, families (collapsed, sorted), the coverage badge; rows open the overlay', async () => {
    api = mockApi({
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: { isJson: true, content: '{}', structured: FIXTURE_EVIDENCE } },
    });
    const user = userEvent.setup();
    renderScreen();
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(byId('cardStatus5')).toHaveTextContent('33% Coverage'));
    expect(byId('evStatControls')).toHaveTextContent('3');
    expect(byId('evStatWithEvidence')).toHaveAttribute('data-tone', 'green');
    expect(byId('evStatMissing')).toHaveTextContent('2');
    expect(byId('evStatMissing')).toHaveAttribute('data-tone', 'red');
    expect(byId('evStatCoverage')).toHaveTextContent('33%');
    expect(byId('evStatCoverage')).toHaveAttribute('data-tone', 'amber');
    expect(byId('workflowCard5')).toHaveAttribute('data-card-state', 'done');
    expect(useWorkflowStore.getState().steps.evidence).toBe('done');

    const families = document.querySelectorAll('[data-family-abbrev]');
    expect(Array.from(families).map((f) => f.getAttribute('data-family-abbrev'))).toEqual(['AC', 'AU']);
    expect(families[0]).toHaveAttribute('data-collapsed', 'true');
    const acHeader = screen.getByRole('button', { name: /AC Access Control/ });
    expect(acHeader).toHaveTextContent('1/2');
    await user.click(acHeader);
    expect(acHeader).toHaveAttribute('aria-expanded', 'true');
    expect(window.sessionStorage.getItem('evidenceExpandedFamilies')).toBe('["AC"]');
    const controls = families[0]!.querySelectorAll('[data-control-id]');
    expect(Array.from(controls).map((c) => c.getAttribute('data-control-id'))).toEqual(['AC.L2-3.1.1', 'AC.L2-3.1.5']);

    await user.click(controls[0]!);
    const row = document.querySelector('[data-entry-id="ac-ca-baseline"]')!;
    expect(row).toHaveTextContent('NO VERDICT');
    expect(row).toHaveTextContent('2KB · 2h ago');
    expect(document.querySelector('[data-entry-id="ac-least-priv-roles"]')).toHaveAttribute('data-missing', 'true');

    await user.click(screen.getByRole('button', { name: /Conditional Access baseline.*NO VERDICT/ }));
    const overlay = await waitFor(() => byId('evidenceViewerOverlay'));
    expect(overlay).toBeVisible();
    expect(byId('evidenceViewerTitle')).toHaveTextContent('ac-ca-baseline — Conditional Access baseline');
    expect(api.calls.at(-1)).toMatchObject({ path: '/api/evidence-content', query: { tenant: FIXTURE_TENANT, entryId: 'ac-ca-baseline' } });
    expect(row).toHaveTextContent('SAT');
    expect(await seriousViolations(document.body)).toEqual([]);

    await user.keyboard('{Escape}');
    expect(document.getElementById('evidenceViewerOverlay')).toBeNull();
  });

  it('search filters by control id and hides families with no match', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { body: FIXTURE_SCAN } });
    const user = userEvent.setup();
    renderScreen();
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(document.querySelectorAll('[data-family-abbrev]')).toHaveLength(2));
    await user.type(byId('evidenceSearch'), 'au.l2');
    expect(Array.from(document.querySelectorAll('[data-family-abbrev]')).map((f) => f.getAttribute('data-family-abbrev'))).toEqual(['AU']);
  });

  it('shows the legacy empty state when no control has evidence', async () => {
    const empty = { ...FIXTURE_SCAN, summary: { ...FIXTURE_SCAN.summary, controlsWithEvidence: 0, coveragePct: 0 } };
    api = mockApi({ 'GET /api/evidence-scan': { body: empty } });
    const user = userEvent.setup();
    renderScreen();
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(byId('evidenceEmptyState')).toBeVisible());
    expect(byId('evidenceEmptyState')).toHaveTextContent('No evidence files found. Run Execute to generate evidence.');
    expect(byId('evidenceFamilies')).not.toBeVisible();
  });

  it('a failed scan shows the badge Error and the legacy message', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { status: 500, body: { error: 'Registry not loaded' } } });
    const user = userEvent.setup();
    renderScreen('/evidence?tenant=dev');
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(byId('cardStatus5')).toHaveTextContent('Error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Evidence scan failed: Registry not loaded');
  });

  it('the pop-out button fetches evidence then opens the legacy window name', async () => {
    api = mockApi({
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: { isJson: true, content: '{}', structured: FIXTURE_EVIDENCE } },
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    renderScreen();
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(document.querySelectorAll('[data-family-abbrev]')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: /AC Access Control/ }));
    await user.click(document.querySelector('[data-control-id="AC.L2-3.1.1"]')!);
    await user.click(byId('evPopout-ac-ca-baseline'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('/app/popout', 'stamper-evidence-popout', 'width=900,height=700'));
    expect(api.signatures()).toEqual(['GET /api/evidence-scan', 'GET /api/evidence-content']);
  });

  it('is axe-clean after a scan with a family open', async () => {
    api = mockApi({ 'GET /api/evidence-scan': { body: FIXTURE_SCAN } });
    const user = userEvent.setup();
    const { container } = renderScreen();
    await user.click(byId('btnEvidenceScan'));
    await waitFor(() => expect(document.querySelectorAll('[data-family-abbrev]')).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: /AC Access Control/ }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});
