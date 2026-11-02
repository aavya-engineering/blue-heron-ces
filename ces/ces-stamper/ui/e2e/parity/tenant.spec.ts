// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-02 (Tenant, card 0) and PC-03 (Missing prerequisites), PLAN §5. Each test drives the legacy
// console (/) and the SPA (/app/tenant) the same way and compares the ordered API requests
// (AD-4: method, path, query keys, body keys) and the visible outcomes on the legacy ids. The
// comparisons run once, from the react project. Watchable (PLAN §8b): headed with pacing unless
// CES_UI_HEADLESS=1; video and trace always on.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { RecordedRequest } from './harness';
import { STAMPER_SELECTORS } from './selectors';
import type { ParityProject } from './selectors';
import {
  BLOCKED_CONNECT,
  CLEAN_CONNECT,
  FICTIONAL_SLUG,
  cardUrl,
  expandCard,
  hasClass,
  openCard,
  rememberTenant,
  runOnBoth,
  selectTenant,
  textOf,
} from './cards.fixture';


const PROJECTS: readonly ParityProject[] = ['legacy', 'react'];
const both = runOnBoth('tenant');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
});

const options = (p: Page) =>
  p.$$eval(`${STAMPER_SELECTORS.tenantSelect} option`, (els) => els.map((o) => `${(o as HTMLOptionElement).value}=${o.textContent}`));

test.describe('PC-02 tenant (card 0)', () => {
  test('page load: same requests; dev shows the fixture set and hides the gate', async ({ page }) => {
    const loads: Record<ParityProject, RecordedRequest[]> = { legacy: [], react: [] };
    for (const project of PROJECTS) {
      const p = await page.context().newPage();
      await rememberTenant(p, 'dev');
      const rec = recordApiRequests(p);
      await openCard(p, project, 'tenant');
      await caption(p, `PC-02 ${project}: page load on dev`);
      rec.stop();
      loads[project] = rec.requests;
      expect(await p.locator(STAMPER_SELECTORS.connectionGate).isVisible()).toBe(false);
      expect(await p.locator('#fixtureSetWrap').isVisible()).toBe(true);
      expect(await textOf(p, '#cardStatus0')).toBe('Pending');
      await p.close();
    }
    writeRecording(test.info().outputPath('parity-tenant-load-legacy.json'), loads.legacy);
    writeRecording(test.info().outputPath('parity-tenant-load-react.json'), loads.react);
    const result = compareRecordings(loads.legacy, loads.react, { spaOnly: ['GET /health'] });
    test.info().annotations.push({ type: 'parity tenant-load', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
  });

  test('tenant list and fixture set read the same', async ({ page }) => {
    await both(page, 'tenant-list', {}, async (p) => {
      await p.selectOption('#fixtureSet', 'synthetic');
      return { options: await options(p), fixture: await p.inputValue('#fixtureSet'), selected: await p.inputValue(STAMPER_SELECTORS.tenantSelect) };
    });
  });

  test('selecting a tenant: same requests, gate shown, Disallow active', async ({ page }) => {
    await both(page, 'tenant-select', { fictional: {} }, async (p) => {
      await selectTenant(p, FICTIONAL_SLUG);
      return {
        gate: await p.locator(STAMPER_SELECTORS.connectionGate).isVisible(),
        fixture: await p.locator('#fixtureSetWrap').isVisible(),
        disallowActive: await hasClass(p, '#gateDisallowBtn', 'gate-active-disallow'),
        label: await p.locator('#tenantConfigLabel').isVisible(),
        badge: await textOf(p, '#cardStatus0'),
        stored: await p.evaluate(() => window.localStorage.getItem('stamper_lastTenant')),
      };
    });
  });

  test('connection gate: Allow connects (tenant-connected), Disallow disconnects', async ({ page }) => {
    await both(page, 'tenant-connect', { slug: FICTIONAL_SLUG, fictional: { connect: CLEAN_CONNECT } }, async (p) => {
      await p.click(STAMPER_SELECTORS.gateAllow);
      await expect.poll(() => hasClass(p, STAMPER_SELECTORS.card(0), 'tenant-connected')).toBe(true);
      const connected = {
        label: await textOf(p, '#tenantConfigLabel'),
        labelTitle: await p.getAttribute('#tenantConfigLabel', 'title'),
        status: await textOf(p, '#statusBar'),
        errorRows: await p.locator(STAMPER_SELECTORS.connectErrorRows).count(),
        log: await p.$$eval('#taskList .connection-log-row .log-msg', (els) => els.map((e) => (e.textContent ?? '').trim())),
      };
      await p.click('#gateDisallowBtn');
      return {
        connected,
        afterDisallow: {
          connected: await hasClass(p, STAMPER_SELECTORS.card(0), 'tenant-connected'),
          label: await p.locator('#tenantConfigLabel').isVisible(),
        },
      };
    });
  });

  test('add tenant: empty and invalid JSON are refused; a refused save posts { json }', async ({ page }) => {
    await both(page, 'tenant-add', {}, async (p) => {
      await p.route((url) => url.pathname === '/api/tenants', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'client.slug is required' }) })
          : route.continue(),
      );
      await p.click('button[title="Add a new tenant config"]');
      const shown = await p.locator('#addTenantPanel').isVisible();
      await p.click('#addTenantPanel >> text=Save Tenant');
      const empty = await textOf(p, '#statusBar');
      await p.fill('#tenantJsonInput', '{ not json');
      await p.click('#addTenantPanel >> text=Save Tenant');
      const invalid = (await textOf(p, '#statusBar')).startsWith('Invalid JSON:');
      await p.fill('#tenantJsonInput', JSON.stringify({ client: { name: 'Larkspur Avionics' } }));
      await p.click('#addTenantPanel >> text=Save Tenant');
      await expect.poll(() => textOf(p, '#statusBar')).toBe('Save failed: client.slug is required');
      await p.click('#addTenantPanel >> text=Cancel');
      return { shown, empty, invalid, hiddenAfterCancel: !(await p.locator('#addTenantPanel').isVisible()) };
    });
  });

  test('preflight needs a tenant (dev)', async ({ page }) => {
    await both(page, 'tenant-preflight-dev', {}, async (p) => {
      await p.click('#btnPreflight');
      return { status: await textOf(p, '#statusBar'), button: await textOf(p, '#btnPreflight') };
    });
  });
});

test.describe('PC-03 missing prerequisites', () => {
  test('same list; installing a module gives the same outcome', async ({ page }) => {
    const install = [
      { type: 'install_progress', module: 'ExchangeOnlineManagement', message: 'Installing ExchangeOnlineManagement...' },
      { type: 'install_done', module: 'ExchangeOnlineManagement', success: true },
    ];
    await both(page, 'prereqs', { slug: FICTIONAL_SLUG, fictional: { connect: BLOCKED_CONNECT, install } }, async (p) => {
      await p.click(STAMPER_SELECTORS.gateAllow);
      await p.waitForSelector('#taskList .prereq-panel');
      const panel = async () =>
        p.$$eval('#taskList .prereq-panel', (panels) => {
          const root = panels[0]!;
          const rows = Array.from(root.querySelectorAll('[class*="prereq-row"], .ck-prereq-row'));
          return rows.map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim());
        });
      const before = {
        error: await hasClass(p, STAMPER_SELECTORS.card(0), 'tenant-error'),
        status: await textOf(p, '#statusBar'),
        errorRows: await p.locator(STAMPER_SELECTORS.connectErrorRows).count(),
        installAll: await p.locator('#taskList .prereq-panel button', { hasText: 'Install All Modules' }).count(),
        rowCount: (await panel()).length,
      };
      await p.locator('#taskList .prereq-panel button', { hasText: /^Install$/ }).first().click();
      const installed = p.locator('#taskList .prereq-panel button', { hasText: /^Installed$/ });
      await expect.poll(() => installed.count()).toBe(1);
      return {
        before,
        after: await panel(),
        lastLog: await p.$$eval('#taskList .connection-log-row .log-msg', (els) => (els.at(-1)?.textContent ?? '').trim()),
      };
    });
  });
});

test('SPA card screens load at their own URLs (no legacy requests missing)', async ({ page }) => {
  for (const screen of ['tenant', 'configure', 'assess'] as const) {
    await rememberTenant(page, 'dev');
    await page.goto(cardUrl('react', screen));
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    await expandCard(page, ['tenant', 'configure', 'assess'].indexOf(screen));
  }
});
