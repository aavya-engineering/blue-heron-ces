// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-00 (bundle) and PC-01 (shell), PLAN §5. Runs under both Playwright projects (legacy at /,
// react at /app/; playwright.config.ts). Tests that compare the two consoles drive both URLs
// from the react project only, so each comparison runs once. Watchable (PLAN §8b): headed with
// pacing unless CES_UI_HEADLESS=1; video and trace always on.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import {
  blockExternalRequests,
  caption,
  compareRecordings,
  recordApiRequests,
  scanBundleForExternalUrls,
  writeRecording,
} from './harness';
import { SHELL_SELECTORS, SPA_SCREEN_PATHS, railNodeInState, spaScreen } from './selectors';
import type { ParityProject, RailState } from './selectors';

/** The SPA build output (AD-2): ces-stamper/public/app/. */
const SPA_DIST = fileURLToPath(new URL('../../../public/app/', import.meta.url));

/**
 * Hosts the shared stylesheet /ces-ui.css (legacy static root, not the SPA bundle) asks for:
 * its Google Fonts @import. Blocked in PC-00; the screens still load on fallback fonts.
 */
const SHARED_STYLESHEET_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/** The rail as both consoles serve it before any tenant is chosen (legacy markup L4070-4095). */
const INITIAL_RAIL: readonly RailState[] = ['ready', 'ready', 'ready', 'locked', 'locked', 'locked'];

const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');

async function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('ces-theme'));
}

/**
 * Holds GET /api/tenants until `release()`. The SPA selects the restored tenant (or dev) as soon
 * as the list arrives, which readies evidence (legacy L6214, SPA flow.ts:60); holding the list
 * keeps the pre-tenant rail on screen while it is asserted (W8-PIS: the PC-01 race).
 */
async function holdTenantList(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route((url) => url.pathname === '/api/tenants', async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test.describe('PC-00 bundle', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'PC-00 checks the SPA bundle only');
  });

  test('no external URL in public/app', async () => {
    expect(
      fs.existsSync(path.join(SPA_DIST, 'index.html')),
      `SPA build missing at ${SPA_DIST}: run npm run build -w ces-stamper-ui`,
    ).toBe(true);
    const hits = scanBundleForExternalUrls(SPA_DIST);
    expect(hits).toEqual([]);
  });

  test('every screen loads with only localhost reachable', async ({ page, context }, testInfo) => {
    const attempted = await blockExternalRequests(context);
    for (const id of SPA_SCREEN_PATHS) {
      await page.goto(id);
      await caption(page, `PC-00: /app/${id} with only localhost reachable`);
      await expect(page.locator(spaScreen(id))).toBeVisible();
      if (id !== 'popout') await expect(page.locator(SHELL_SELECTORS.header)).toBeVisible();
    }
    const hosts = Array.from(new Set(attempted.map((u) => new URL(u).hostname))).sort();
    testInfo.annotations.push({ type: 'external requests blocked', description: hosts.join(', ') || 'none' });
    for (const host of hosts) expect(SHARED_STYLESHEET_HOSTS, `unexpected external host ${host}`).toContain(host);
  });
});

test.describe('PC-01 shell', () => {
  test('theme persists across legacy and SPA (localStorage "ces-theme")', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');

    await page.goto('/');
    await page.evaluate(() => window.localStorage.removeItem('ces-theme'));
    await page.reload();
    await caption(page, 'PC-01: legacy console, no stored theme: dark');
    expect(await htmlTheme(page)).toBe('dark');

    await page.click(SHELL_SELECTORS.themeToggle);
    await caption(page, 'PC-01: legacy toggle to light');
    expect(await htmlTheme(page)).toBeNull();
    expect(await storedTheme(page)).toBe('light');

    await page.goto('/app/');
    await caption(page, 'PC-01: SPA opens in light');
    await expect(page.locator(SHELL_SELECTORS.themeToggle)).toBeVisible();
    expect(await htmlTheme(page)).toBeNull();

    await page.click(SHELL_SELECTORS.themeToggle);
    await caption(page, 'PC-01: SPA toggle to dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await storedTheme(page)).toBe('dark');

    await page.goto('/');
    await caption(page, 'PC-01: legacy console opens in dark');
    expect(await htmlTheme(page)).toBe('dark');

    // Any other stored value means light in both (ces-theme-toggle.js contract).
    await page.evaluate(() => window.localStorage.setItem('ces-theme', 'sepia'));
    await page.goto('/');
    await caption(page, 'PC-01: odd stored value: legacy light');
    expect(await htmlTheme(page)).toBeNull();
    await page.goto('/app/');
    await caption(page, 'PC-01: odd stored value: SPA light');
    await expect(page.locator(SHELL_SELECTORS.themeToggle)).toBeVisible();
    expect(await htmlTheme(page)).toBeNull();
  });

  test('rail starts with translate, execute and evidence locked', async ({ page, browser, baseURL }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    if (project === 'legacy') {
      // The served markup, before the page script picks a tenant (it restores the last
      // tenant or "dev" on load, which moves the rail). The SPA's fresh store is the same.
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      const legacy = await context.newPage();
      await legacy.goto('./');
      for (let i = 0; i < INITIAL_RAIL.length; i++) {
        await expect(legacy.locator(railNodeInState('legacy', i, INITIAL_RAIL[i]))).toHaveCount(1);
      }
      await context.close();
      return;
    }
    const release = await holdTenantList(page);
    try {
      await page.goto('./');
      await caption(page, 'PC-01: SPA rail, no tenant chosen');
      for (let i = 0; i < INITIAL_RAIL.length; i++) {
        await expect(page.locator(railNodeInState('react', i, INITIAL_RAIL[i]))).toHaveCount(1);
      }
    } finally {
      release();
    }
  });

  test('locked steps cannot be opened; unlocked steps navigate (SPA)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'legacy rail nodes are not interactive');
    const release = await holdTenantList(page);
    try {
      await page.goto('./');
      for (const i of [3, 4, 5]) await expect(page.locator(SHELL_SELECTORS.railNode(i))).toBeDisabled();
    } finally {
      release();
    }
    await caption(page, 'PC-01: open Configure from the rail');
    await page.click(SHELL_SELECTORS.railNode(1));
    await expect(page).toHaveURL(/\/app\/configure$/);
    await expect(page.locator(spaScreen('configure'))).toBeVisible();
    await caption(page, 'PC-01: open Assess from the rail');
    await page.click(SHELL_SELECTORS.railNode(2));
    await expect(page).toHaveURL(/\/app\/assess$/);
  });

  test('simulator banner follows /health simulator.active (SPA)', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'the legacy console has no tenant banner');
    const health = await (await request.get('/health')).json();
    expect(typeof health.simulator?.active).toBe('boolean');
    await page.goto('./');
    await caption(page, `PC-01: simulator banner (simulator.active = ${health.simulator.active})`);
    const banner = page.locator(SHELL_SELECTORS.tenantBanner);
    await expect(banner).toHaveAttribute('data-simulator', String(health.simulator.active));
    await expect(banner).toContainText(health.simulator.active ? 'Simulator' : 'Live tenant');
  });

  test('parity: shell requests on /health (AD-4)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'records both consoles; runs once');

    const legacyRec = recordApiRequests(page);
    const tenants = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tenants');
    await page.goto('/');
    await caption(page, 'PC-01 parity: recording the legacy console');
    await tenants;
    await page.waitForLoadState('load');
    await page.waitForTimeout(1_000);
    legacyRec.stop();

    const reactRec = recordApiRequests(page);
    const health = page.waitForResponse((r) => new URL(r.url()).pathname === '/health');
    await page.goto('/app/');
    await caption(page, 'PC-01 parity: recording the SPA');
    await health;
    await page.waitForTimeout(1_000);
    reactRec.stop();

    writeRecording(testInfo.outputPath('parity-shell-legacy.json'), legacyRec.requests);
    writeRecording(testInfo.outputPath('parity-shell-react.json'), reactRec.requests);

    // The shell's own route is /health. The legacy page never calls it; the SPA reads it once
    // for the banner and the switch fields, a declared SPA-only request.
    const result = compareRecordings(legacyRec.requests, reactRec.requests, {
      routes: ['/health'],
      spaOnly: ['GET /health'],
    });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
    expect(reactRec.requests.filter((r) => r.path === '/health')).toHaveLength(1);
  });
});
