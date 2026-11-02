// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Assess screen (card 2) in the app router: cached grid, family table, tile drill-down into
// the CMMC editor with filters, an assess run into #taskList, and axe.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STAMPER_SELECTORS } from '../../../e2e/parity/selectors';
import { LAST_TENANT_KEY } from '../../store/tenant';
import { useAssessStore } from '../../store/assess';
import { SCREEN_ROUTES_FIXTURE, consoleMessages, installHarness, renderAt, resetStores, seriousAxe } from '../tenant/testUtils';
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

describe('Assess screen (card 2)', () => {
  it('shows the cached grid and family table, and a tile opens the editor with filters', async () => {
    const user = userEvent.setup();
    renderAt('/assess');
    await waitFor(() => expect(document.getElementById('cardStatus2')).toHaveTextContent('Assessed'));
    expect(document.querySelector(STAMPER_SELECTORS.assess)).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Assess' })).toBeInTheDocument();
    // collapsed after a cached Assessed state, as legacy setCardState('done')
    await user.click(screen.getByRole('button', { name: 'Expand Assess card' }));
    expect(document.getElementById('cmmc_val_satisfied_automated')).toHaveTextContent('2');
    expect(document.getElementById('cmmc_pct_satisfied_automated')).toHaveTextContent('2%');
    expect(document.getElementById('cmmc_summary_total')).toHaveTextContent('7');
    expect(document.getElementById('cmmc_summary_sprs')).toHaveTextContent('--');
    expect(document.getElementById('cmmc_val_not_satisfied_sprs')).toHaveTextContent('9');
    expect(document.querySelectorAll('#cmmcFamilyTable tr[data-family]')).toHaveLength(2);

    await user.click(document.getElementById('cmmc_cell_not_satisfied_automated')!);
    await waitFor(() => expect(document.getElementById('cmmcEditorOverlay')).not.toBeNull());
    expect(document.getElementById('edFilterCount')).toHaveTextContent('2 of 7 controls (Automated, Not Satisfied / Not Verified)');
    await user.type(document.getElementById('edFilterSearch')!, 'multifactor');
    expect(document.getElementById('edFilterCount')).toHaveTextContent('1 of 7 controls (Automated, Not Satisfied / Not Verified)');
    expect(document.getElementById('ctrl-IA-L2-3-5-3')).not.toBeNull();
    expect(await seriousAxe(document.body)).toEqual([]);
    await user.keyboard('{Escape}');
    expect(document.getElementById('cmmcEditorOverlay')).toBeNull();
  });

  it('Assess runs the stream, writes rows into #taskList and reaches Assessed', async () => {
    const user = userEvent.setup();
    useAssessStore.setState({ collapsed: false });
    renderAt('/assess');
    await waitFor(() => expect(document.getElementById('cardStatus2')).toHaveTextContent('Assessed'));
    await user.click(screen.getByRole('button', { name: 'Expand Assess card' }));
    await user.click(document.querySelector(STAMPER_SELECTORS.assess)!);
    expect(document.getElementById('cardStatus2')).toHaveTextContent('Assessing...');
    const stream = h.streams.at(-1)!;
    act(() => {
      stream.emit({ type: 'assess_start', totalEntries: 1 });
      stream.emit({ type: 'assess_check', entryId: 'ac-001', label: 'Conditional access', found: true, status: 'exists', cmmc_controls: ['AC.L2-3.1.1'], entryIndex: 1, reason: 'Policy present' });
      stream.emit({ type: 'assess_done' });
    });
    expect(document.querySelector('#taskList #assess-entry-ac-001')).not.toBeNull();
    expect(document.getElementById('assessCounter')).toHaveTextContent('1');
    expect(document.getElementById('cardStatus2')).toHaveTextContent('Assessed');
    expect(consoleMessages().at(-1)).toBe('Assessment complete.');
  });
});
