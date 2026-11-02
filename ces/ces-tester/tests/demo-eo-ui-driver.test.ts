// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { EO_SELECTORS, EO_ASSESS_DONE_TEXT, runEoUiFlow, type EoUiDriveContext } from '../src/demo/eo-ui-driver.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';

/** FX-TE5 — the fake EO answers per-control detail ONLY for `?tenant=<tenant>` (ces-eo FX-EO8). */
function eoPage(tenant = 'demo-dib-small'): FakeUiPage {
  const page = new FakeUiPage({
    texts: {
      [EO_SELECTORS.connectStatus]: 'Not connected',
      [EO_SELECTORS.assessStatus]: 'Select a tenant to begin.',
    },
    json: {
      [`/api/controls/IA.L2-3.5.3?tenant=${tenant}`]: { control_id: 'IA.L2-3.5.3', status: 'met', nist_ref: '3.5.3' },
    },
  });
  page.state.onClick[EO_SELECTORS.connect] = () => {
    page.state.texts[EO_SELECTORS.connectStatus] = 'demo-dib-small — connected';
  };
  page.state.onClick[EO_SELECTORS.assess] = () => {
    page.state.texts[EO_SELECTORS.assessStatus] = EO_ASSESS_DONE_TEXT;
  };
  return page;
}

function ctx(overrides: Partial<EoUiDriveContext> = {}): EoUiDriveContext {
  return { baseUrl: 'http://127.0.0.1:4002', slug: 'demo-dib-small', ...overrides };
}

describe('runEoUiFlow', () => {
  it('selects the tenant, connects, then assesses — in that order', async () => {
    const page = eoPage();
    const result = await runEoUiFlow(page, ctx());

    const selected = page.indexOf(`select ${EO_SELECTORS.tenantSelect}=demo-dib-small`);
    const connected = page.indexOf(`click ${EO_SELECTORS.connect}`);
    const assessed = page.indexOf(`click ${EO_SELECTORS.assess}`);
    expect(selected).toBeGreaterThanOrEqual(0);
    expect(connected).toBeGreaterThan(selected);
    expect(assessed).toBeGreaterThan(connected);
    expect(result).toMatchObject({ connected: true, assessed: true, assessStatus: EO_ASSESS_DONE_TEXT });
  });

  it('does not mistake "Connecting to ..." for a connected state', async () => {
    const page = eoPage();
    page.state.onClick[EO_SELECTORS.connect] = () => {
      page.state.texts[EO_SELECTORS.connectStatus] = 'Connecting to demo-dib-small...';
    };
    const result = await runEoUiFlow(page, ctx({ connectTimeoutMs: 30 }));
    expect(result.connected).toBe(false);
    expect(result.assessed).toBe(true); // Connect is optional — the assess is the signal
  });

  it('reports a connect failure but still runs the assess', async () => {
    const page = eoPage();
    page.state.onClick[EO_SELECTORS.connect] = () => {
      page.state.texts[EO_SELECTORS.connectStatus] = 'Graph connection failed';
    };
    const result = await runEoUiFlow(page, ctx());
    expect(result.connected).toBe(false);
    expect(result.connectError).toMatch(/failure state/);
    expect(result.connectStatus).toBe('Graph connection failed');
    expect(page.indexOf(`click ${EO_SELECTORS.assess}`)).toBeGreaterThan(0);
  });

  it('fails honestly when the assess never completes', async () => {
    const page = eoPage();
    page.state.onClick[EO_SELECTORS.assess] = () => {
      page.state.texts[EO_SELECTORS.assessStatus] = 'Checking 12/110: MFA';
    };
    await expect(runEoUiFlow(page, ctx({ assessTimeoutMs: 30 }))).rejects.toThrow(/timed out/);
  });

  it('fails honestly when the assess reports an error', async () => {
    const page = eoPage();
    page.state.onClick[EO_SELECTORS.assess] = () => {
      page.state.texts[EO_SELECTORS.assessStatus] = 'Assessment failed: no live signal';
    };
    await expect(runEoUiFlow(page, ctx())).rejects.toThrow(/failure state/);
  });

  it('reads per-control detail over GET /api/controls, never /api/assess', async () => {
    const page = eoPage();
    const result = await runEoUiFlow(page, ctx({ controlIds: ['IA.L2-3.5.3'] }));
    expect(result.controls).toEqual([{ controlId: 'IA.L2-3.5.3', status: 'met', nistRef: '3.5.3' }]);
    expect(page.actions.some((a) => a.startsWith('getJson') && a.includes('/api/assess'))).toBe(false);
  });

  it('FX-TE5: reads per-control detail for the driven tenant, never a default', async () => {
    const page = eoPage('acme-dib-large');
    const result = await runEoUiFlow(page, ctx({ slug: 'acme-dib-large', controlIds: ['IA.L2-3.5.3'] }));
    expect(result.controls).toEqual([{ controlId: 'IA.L2-3.5.3', status: 'met', nistRef: '3.5.3' }]);
    expect(page.actions).toContain('getJson /api/controls/IA.L2-3.5.3?tenant=acme-dib-large');
  });

  it('FX-TE5: a control read for another tenant (or none) gets nothing back', async () => {
    const page = eoPage('demo-dib-small');
    const result = await runEoUiFlow(page, ctx({ slug: 'acme-dib-large', controlIds: ['IA.L2-3.5.3'] }));
    expect(result.controls).toEqual([]);
    expect(page.actions.some((a) => a === 'getJson /api/controls/IA.L2-3.5.3')).toBe(false);
  });

  it('omits controls that do not come back in the expected shape', async () => {
    const page = eoPage();
    page.state.json['/api/controls/IA.L2-3.5.3?tenant=demo-dib-small'] = { nonsense: true };
    const result = await runEoUiFlow(page, ctx({ controlIds: ['IA.L2-3.5.3'] }));
    expect(result.controls).toEqual([]);
  });
});
