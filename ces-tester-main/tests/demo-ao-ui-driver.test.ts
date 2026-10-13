// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { AO_SELECTORS, createAoUiDriver, driveAoUi, runAoUiFlow } from '../src/demo/ao-ui-driver.js';
import { HEADLESS_MODE } from '../src/demo/watch-mode.js';
import type { AoUiDriveContext, AoUiDriver } from '../src/demo/ao-leg.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';

const CTX: AoUiDriveContext = {
  baseUrl: 'http://127.0.0.1:3001',
  slug: 'demo-dib-small',
  commandId: 'A-18',
  watch: HEADLESS_MODE,
};

/**
 * Models the sibling behaviour that makes ordering load-bearing (ces-ao FX-AO7):
 * `openCommandForm()` resets the live toggle on every open; the tenant is an
 * explicit `#tenantSelect` choice with NO default (empty until picked), and the
 * execute route echoes the UI's `ao-ui-<uuid>` correlationId.
 */
const UI_CORRELATION_ID = 'ao-ui-11111111-2222-4333-8444-555555555555';
function aoPage(): FakeUiPage {
  const page = new FakeUiPage({
    texts: {
      [AO_SELECTORS.statusBadge]: 'SUCCESS',
      [AO_SELECTORS.outcomeBadge]: 'automated_success',
    },
    values: { [AO_SELECTORS.tenantSelect]: '' },
    responses: {
      '/api/execute/A-18': {
        status: 'success',
        evidence: { outcome: 'automated_success' },
        correlationId: UI_CORRELATION_ID,
      },
    },
  });
  page.state.onClick[AO_SELECTORS.searchResult('A-18')] = () => {
    // openCommandForm() — every open resets the toggle to dry-run (the tenant select is kept).
    page.state.values[AO_SELECTORS.liveToggle] = '';
    page.state.visible.add(AO_SELECTORS.commandForm);
  };
  page.state.onClick[AO_SELECTORS.execute] = () => {
    page.state.visible.add(AO_SELECTORS.resultPanel);
    page.state.visible.add(AO_SELECTORS.evidenceSection);
  };
  return page;
}

describe('runAoUiFlow ordering (the M0 rule)', () => {
  it('opens the form, waits for the tenant option, selects the slug, flips the toggle, THEN executes', async () => {
    const page = aoPage();
    await runAoUiFlow(page, CTX);

    const opened = page.indexOf(`click ${AO_SELECTORS.searchResult('A-18')}`);
    const optionReady = page.indexOf(`wait ${AO_SELECTORS.tenantOption('demo-dib-small')}`);
    const selected = page.indexOf(`select ${AO_SELECTORS.tenantSelect}=demo-dib-small`);
    const toggled = page.indexOf(`check ${AO_SELECTORS.liveToggle}`);
    const executed = page.indexOf(`click ${AO_SELECTORS.execute}`);
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(optionReady).toBeGreaterThan(opened);
    expect(selected).toBeGreaterThan(optionReady);
    expect(toggled).toBeGreaterThan(selected);
    expect(executed).toBeGreaterThan(toggled);
  });

  it('never touches the removed #liveTenantInput (FX-AO7 deleted it)', async () => {
    const page = aoPage();
    await runAoUiFlow(page, CTX);
    expect(page.actions.some((a) => a.includes('#liveTenantInput'))).toBe(false);
  });

  it('never reopens the command form after arming (a reopen wipes the arming)', async () => {
    const page = aoPage();
    await runAoUiFlow(page, CTX);
    const opens = page.actions.filter((a) => a === `click ${AO_SELECTORS.searchResult('A-18')}`);
    expect(opens).toHaveLength(1);
  });

  it('REFUSES to execute when the slug did not stick (AO has no default tenant)', async () => {
    // The selection never lands, so the read-back is still '' — the UI would
    // block client-side and never call /api/execute; the driver must not wait on it.
    class WipingPage extends FakeUiPage {
      override async selectOption(selector: string, value: string): Promise<void> {
        this.actions.push(`select ${selector}=${value}`);
        if (selector !== AO_SELECTORS.tenantSelect) this.state.values[selector] = value;
      }
    }
    const base = aoPage();
    const page = new WipingPage(base.state);
    await expect(runAoUiFlow(page, CTX)).rejects.toThrow(/did not stick on "demo-dib-small"/);
    expect(page.indexOf(`click ${AO_SELECTORS.execute}`)).toBe(-1);
  });

  it('scopes the search-result selector to #searchResults (strict-mode clash with the tree)', () => {
    expect(AO_SELECTORS.searchResult('A-18')).toBe(
      '#searchResults .search-result-item[onclick="openCommandForm(\'A-18\')"]',
    );
  });

  it('interpolates the command id rather than hardcoding A-18', async () => {
    const page = aoPage();
    page.state.onClick[AO_SELECTORS.searchResult('A-02')] = page.state.onClick[AO_SELECTORS.searchResult('A-18')];
    page.state.responses['/api/execute/A-02'] = { status: 'success' };
    const result = await runAoUiFlow(page, { ...CTX, commandId: 'A-02' });
    expect(page.actions).toContain('awaitResponse /api/execute/A-02');
    expect(result.executeResponse).toEqual({ status: 'success' });
  });
});

describe('runAoUiFlow reporting', () => {
  it('returns the two badges that genuinely render plus the execute body', async () => {
    const page = aoPage();
    const result = await runAoUiFlow(page, CTX);
    expect(result.statusBadge).toBe('SUCCESS');
    expect(result.outcomeBadge).toBe('automated_success');
    expect(result.executeResponse).toEqual({
      status: 'success',
      evidence: { outcome: 'automated_success' },
      correlationId: UI_CORRELATION_ID,
    });
  });

  it("reports the UI's correlationId from the route echo (REQ-AO-GUI-NO-CORRELATION-ID)", async () => {
    const page = aoPage();
    const result = await runAoUiFlow(page, CTX);
    expect(result.correlationId).toBe(UI_CORRELATION_ID);
  });

  it('falls back to the result panel line when the response carries no echo', async () => {
    const page = aoPage();
    page.state.responses['/api/execute/A-18'] = { status: 'success' };
    page.state.texts[AO_SELECTORS.correlationLine] = `correlationId: ${UI_CORRELATION_ID}`;
    const result = await runAoUiFlow(page, CTX);
    expect(result.correlationId).toBe(UI_CORRELATION_ID);
  });

  it('records a non-SUCCESS badge instead of hanging (Tier-3 pending approval)', async () => {
    const page = aoPage();
    page.state.texts[AO_SELECTORS.statusBadge] = 'PENDING APPROVAL';
    page.state.onClick[AO_SELECTORS.execute] = () => {
      page.state.visible.add(AO_SELECTORS.resultPanel); // evidence section stays hidden
    };
    const result = await runAoUiFlow(page, CTX);
    expect(result.statusBadge).toBe('PENDING APPROVAL');
    expect(result.outcomeBadge).toBeUndefined();
  });

  it('arms the response wait before clicking EXECUTE', async () => {
    const page = aoPage();
    await runAoUiFlow(page, CTX);
    expect(page.indexOf('awaitResponse /api/execute/A-18')).toBeLessThan(page.indexOf(`click ${AO_SELECTORS.execute}`));
  });

  it('captures screenshots only when a directory is configured', async () => {
    const bare = aoPage();
    const bareResult = await runAoUiFlow(bare, CTX);
    expect(bareResult.screenshots).toEqual([]);

    const shooting = aoPage();
    const result = await runAoUiFlow(shooting, CTX, { screenshotDir: 'C:\\runs\\ao' });
    expect(result.screenshots).toHaveLength(3);
  });
});

describe('AoUiDriver conformance', () => {
  it('exports functions assignable to ao-leg.ts\'s injected driver contract', () => {
    const injected: AoUiDriver = driveAoUi;
    const built: AoUiDriver = createAoUiDriver({ screenshotDir: 'C:\\runs\\ao' });
    expect(typeof injected).toBe('function');
    expect(typeof built).toBe('function');
  });
});
