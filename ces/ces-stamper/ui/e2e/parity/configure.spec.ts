// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-04 (Configure, card 1), PLAN §5: path hints, the file picker and cleanup, path persistence,
// Scan Variables and Bring to Baseline. Legacy (/) and SPA (/app/configure) run the same steps;
// ordered API requests (AD-4) and visible outcomes on the legacy ids must be equal. Runs once,
// from the react project. Watchable (PLAN §8b): headed and paced unless CES_UI_HEADLESS=1.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { STAMPER_SELECTORS } from './selectors';
import { FICTIONAL_SLUG, at, expandCard, runOnBoth, textOf } from './cards.fixture';


test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
});

const both = runOnBoth('configure');

const PICKER_FILES = [
  { name: 'manual-mission-plan_ridgeline_20261028.json', path: 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan_ridgeline_20261028.json', size: 20480, modified: '2026-10-28T10:00:00.000Z' },
  { name: 'manual-mission-plan_ridgeline_20261020.json', path: 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan_ridgeline_20261020.json', size: 10240, modified: '2026-10-20T10:00:00.000Z' },
];

async function serveBrowse(p: Page) {
  await p.route(at('/api/browse'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, dir: 'C:\\plan-data\\ridgeline\\plans', files: PICKER_FILES }) }),
  );
  await p.route(at('/api/browse-cleanup'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, deleted: 1, kept: PICKER_FILES[0]!.name }) }),
  );
}

const pathState = async (p: Page) => ({
  mp: await p.inputValue(STAMPER_SELECTORS.missionPlanPath),
  tm: await p.inputValue(STAMPER_SELECTORS.manifestPath),
  mpHint: await textOf(p, '#configMissionPlanPath_hint'),
  tmHint: await textOf(p, '#configManifestPath_hint'),
  mpTitle: await p.getAttribute(STAMPER_SELECTORS.missionPlanPath, 'title'),
});

test.describe('PC-04 configure (card 1)', () => {
  test('dev: typed paths show the same hints and are not persisted', async ({ page }) => {
    await both(page, 'configure-hints-dev', {}, async (p) => {
      await p.fill(STAMPER_SELECTORS.missionPlanPath, 'plan-data\\dev\\plans\\manual-mission-plan-dev.json');
      await p.fill(STAMPER_SELECTORS.manifestPath, 'plan-data/dev/plans/tenant-manifest-dev.json');
      return pathState(p);
    });
  });

  test('tenant: each fill GETs the tenant config and PUTs it back (same order, same keys)', async ({ page }) => {
    const out = await both(page, 'configure-persist', { slug: FICTIONAL_SLUG, fictional: {} }, async (p) => {
      await p.fill(STAMPER_SELECTORS.missionPlanPath, 'C:\\plan-data\\ridgeline\\plans\\manual-mission-plan_ridgeline_20261028.json');
      await p.fill(STAMPER_SELECTORS.manifestPath, 'C:\\plan-data\\ridgeline\\plans\\tenant-manifest_ridgeline_20261028.json');
      await p.waitForLoadState('networkidle');
      return pathState(p);
    });
    expect(out.react.requests.filter((r) => r.method === 'PUT').map((r) => r.bodyKeys)).toEqual([['json'], ['json']]);
  });

  test('file picker: same list, same pick, same persistence; × closes', async ({ page }) => {
    await both(page, 'configure-picker', { slug: FICTIONAL_SLUG, fictional: {}, before: serveBrowse }, async (p) => {
      await p.click('button[title="Browse Mission Plans"]');
      await p.waitForSelector('#filePickerOverlay.active .file-picker-item');
      const list = {
        title: await textOf(p, '.file-picker-header > span'),
        dir: await textOf(p, '#filePickerDir'),
        names: await p.$$eval('#filePickerList .fp-name', (els) => els.map((e) => (e.textContent ?? '').trim())),
        meta: await p.$$eval('#filePickerList .fp-meta', (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())),
      };
      await p.locator('#filePickerList .file-picker-item').nth(1).click();
      const closed = !(await p.locator('#filePickerOverlay.active').count());
      await p.click('button[title="Browse Tenant Manifests"]');
      await p.waitForSelector('#filePickerOverlay.active');
      await p.click('#filePickerOverlay.active .file-picker-header button');
      return {
        list,
        closed,
        closedByX: !(await p.locator('#filePickerOverlay.active').count()),
        stored: await p.evaluate(() => window.localStorage.getItem('stamper_configMissionPlanPath')),
        ...(await pathState(p)),
      };
    });
  });

  test('cleanup: preview, confirm, DELETE; a dismissed confirm sends no DELETE', async ({ page }) => {
    await both(page, 'configure-cleanup', { slug: FICTIONAL_SLUG, fictional: {}, before: serveBrowse }, async (p) => {
      const dialogs: string[] = [];
      let accept = false;
      p.on('dialog', (d) => {
        dialogs.push(d.message());
        void (accept ? d.accept() : d.dismiss());
      });
      await p.click('button[title="Delete all but most recent Mission Plan"]');
      await expect.poll(() => dialogs.length).toBe(1);
      accept = true;
      await p.click('button[title="Delete all but most recent Mission Plan"]');
      await expect.poll(() => dialogs.length).toBe(2);
      await p.waitForLoadState('networkidle');
      return { dialogs };
    });
  });

  test('scan variables needs a tenant; Bring to Baseline is disabled until connected', async ({ page }) => {
    await both(page, 'configure-dev-guards', {}, async (p) => {
      await p.locator('#workflowCard1 button', { hasText: 'Scan Variables' }).click();
      return { status: await textOf(p, '#statusBar'), baselineDisabled: await p.locator('#btnBaseline').isDisabled() };
    });
  });

  test('Bring to Baseline: same stream query, same status line and log', async ({ page }) => {
    const baseline = [
      { type: 'connection_log', phase: 'connected', message: 'Connected to Azure' },
      { type: 'discovery_progress', resourceType: 'KeyVault', resourceName: 'kv-ridgeline', exists: true, durationMs: 15 },
      { type: 'discovery_progress', resourceType: 'StorageAccount', resourceName: 'stridgeline', exists: false },
      { type: 'gap_summary', total: 2, existing: 1, missing: 1, byResourceType: { StorageAccount: 1 } },
      { type: 'execution_progress', phase: 'create', resourceName: 'stridgeline', resourceType: 'StorageAccount', exitCode: 0, stdout: 'created' },
      { type: 'baseline_complete', duration: 4200, succeeded: 1, failed: 0, skipped: 0 },
    ];
    const connect = [{ type: 'connection_log', phase: 'done', tenant: FICTIONAL_SLUG }];
    await both(page, 'configure-baseline', { slug: FICTIONAL_SLUG, fictional: { baseline, connect } }, async (p, project) => {
      // Connect first (Tenant card): legacy has it on the same page; the SPA opens its tenant screen.
      if (project === 'react') await p.click('#railNode0');
      await expandCard(p, 0);
      await p.click(STAMPER_SELECTORS.gateAllow);
      await expect.poll(async () => ((await p.getAttribute(STAMPER_SELECTORS.card(0), 'class')) ?? '').includes('tenant-connected')).toBe(true);
      if (project === 'react') await p.click('#railNode1');
      await p.selectOption('#baselinePostureSelect', 'm365_foundation');
      await p.click('#btnBaseline');
      await expect.poll(() => textOf(p, '#baselineStatus')).toBe('Complete: 1 succeeded, 0 failed, 0 skipped (4.2s)');
      return {
        status: await textOf(p, '#statusBar'),
        halt: await p.locator('#btnBaselineHalt').isVisible(),
        log: await p.$$eval('#taskList .connection-log-row .log-msg', (els) => els.map((e) => (e.textContent ?? '').trim())),
      };
    });
  });
});
