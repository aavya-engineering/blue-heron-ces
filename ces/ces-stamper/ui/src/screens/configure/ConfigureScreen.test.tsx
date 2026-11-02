// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Configure screen (card 1) in the app router: path fields, hints, persistence, and axe.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAMPER_SELECTORS } from '../../../e2e/parity/selectors';
import { LAST_TENANT_KEY } from '../../store/tenant';
import { SCREEN_ROUTES_FIXTURE, installHarness, on, renderAt, resetStores, seriousAxe } from '../tenant/testUtils';
import type { Harness } from '../tenant/testUtils';

let h: Harness;

beforeEach(() => {
  resetStores();
  window.localStorage.setItem(LAST_TENANT_KEY, 'ridgeline');
  h = installHarness(SCREEN_ROUTES_FIXTURE);
});
afterEach(() => {
  cleanup();
  h.restore();
});

describe('Configure screen (card 1)', () => {
  it('shows the paths from last-translate with hints and persists edits', async () => {
    const user = userEvent.setup();
    renderAt('/configure');
    const mp = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(STAMPER_SELECTORS.missionPlanPath)!;
      expect(el.value).toBe('C:\\plans\\manual-mission-plan-ridgeline.json');
      return el;
    });
    expect(document.getElementById('configMissionPlanPath_hint')).toHaveTextContent('manual-mission-plan-ridgeline.json');
    expect(screen.getByRole('heading', { name: 'Configure' })).toBeInTheDocument();
    h.calls.length = 0;
    await user.type(document.querySelector(STAMPER_SELECTORS.manifestPath)!, 'x');
    await waitFor(() => expect(h.calls.map((c) => c.method)).toEqual(['GET', 'PUT']));
    expect(mp).toHaveAttribute('title', 'C:\\plans\\manual-mission-plan-ridgeline.json');
    expect(document.getElementById('btnBaseline')).toBeDisabled();
    expect(await seriousAxe(document.querySelector('[data-screen="configure"]')!)).toEqual([]);
  });

  it('FIN-15: a costed posture lists its recurring items off, with DP-1 and DP-2 fields', async () => {
    h.restore();
    h = installHarness([
      ...SCREEN_ROUTES_FIXTURE,
      on('GET', '/api/baseline/cost-items', {
        tenant: 'ridgeline', posture: 'm365_foundation', price_date: '2026-10-31',
        items: [
          { entry_id: 'baseline.StorageAccount', resourceType: 'StorageAccount', label: 'Bring to Baseline: storage', cost_key: 'k', estimate: '$0.5-$2', estimate_basis: 'LRS', price_date: '2026-10-31', standard_alternative: [], acked: true, expected_dp2: 'baseline.StorageAccount $0.5-$2' },
          { entry_id: 'baseline.KeyVault', resourceType: 'KeyVault', label: 'Bring to Baseline: vault', cost_key: 'k2', estimate: '$0-$0.5', estimate_basis: 'ops', price_date: '2026-10-31', standard_alternative: [], acked: false, expected_dp2: 'baseline.KeyVault $0-$0.5' },
        ],
      }),
    ]);
    const user = userEvent.setup();
    renderAt('/configure');
    await user.selectOptions(document.getElementById('baselinePostureSelect')!, 'm365_foundation');
    await waitFor(() => expect(document.querySelectorAll('.baseline-cost-item')).toHaveLength(2));
    expect(screen.getByText(/DP-2 for this run: type baseline\.StorageAccount \$0\.5-\$2/)).toBeInTheDocument();
    const optIn = screen.getByRole('button', { name: 'Opt in (DP-1)' });
    expect(optIn).toBeDisabled();
    await user.type(document.getElementById('baselineOperator')!, 'op-1');
    await user.type(document.getElementById('baselineDp1_KeyVault')!, 'baseline.KeyVault');
    expect(optIn).toBeEnabled();
    expect(await seriousAxe(document.getElementById('baselineCostPanel')!)).toEqual([]);
  });
});
