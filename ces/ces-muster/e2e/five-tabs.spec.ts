// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M1 gate — five-tab shell rail. Navigates all nav-tab-* buttons and asserts
// the corresponding view renders. Situation reuses the existing assessment
// view (tab-profile), never a separate extraction.
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillProfileAndBegin } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// W4-MU2 (MU-02): "Run Discovery" now starts a real sim discovery job on
// muster-api. This spec intercepts that API in the browser (page.route) and
// answers with a readiness-result the REAL executor produced against stacksim
// (`mu discovery --sim`, 2026-09-27) — no server needed, nothing leaves the
// machine, and the rows are a real run's, not the old canned fixture.
const SIM_RESULT = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'sim-discovery-result.json'), 'utf8')
);

test('shell rail — all nav-tab-* buttons navigate to their view', async ({ page }) => {
  await page.goto('/');

  // Help
  await page.getByTestId('nav-tab-help').click();
  await expect(page.getByTestId('help-view')).toBeVisible();

  // Situation — reuses the assessment view (tab-profile rail)
  await page.getByTestId('nav-tab-situation').click();
  await expect(page.getByTestId('tab-profile')).toBeVisible();

  // Discovery — offer screen by default
  await page.getByTestId('nav-tab-discovery').click();
  await expect(page.getByTestId('discovery-offer')).toBeVisible();

  // Readiness
  await page.getByTestId('nav-tab-readiness').click();
  await expect(page.getByTestId('readiness-tab')).toBeVisible();

  // Default boot view remains assessment — reload and confirm
  await page.goto('/');
  await expect(page.getByTestId('tab-profile')).toBeVisible();
});

// Critic defect fix (rev 2) — the discovery-seeded pruning path must be
// reachable by a real user click-through, not just by driver tests. This
// spec drives the actual product: nav-tab-discovery -> discovery-run-btn ->
// sub-tab summary -> discovery-continue-btn -> Situation/assessment, then
// begins the interview and asserts the resulting total question count is
// strictly less than the manual (Skip to Manual) branch's count for an
// identical starting profile (no services selected in either case).
test('discovery branch — Run Discovery then Continue prunes fewer questions than Skip to Manual', async ({
  browser,
}) => {
  // Each branch runs in its own fresh browser context (separate IndexedDB +
  // localStorage) so the manual branch's in-progress session can never be
  // resumed into the discovery branch's page, or vice versa.
  const manualContext = await browser.newContext();
  const manualPage = await manualContext.newPage();
  await manualPage.goto('/');
  await fillProfileAndBegin(manualPage, { kind: 'individual_contractor', name: 'Manual Branch Co' });
  const manualTotalText = await manualPage.getByTestId('progress-note').textContent();
  const manualTotal = Number(manualTotalText?.match(/of (\d+) answered/)?.[1]);
  expect(Number.isFinite(manualTotal)).toBe(true);
  await manualContext.close();

  // Discovery branch: run discovery, continue into the interview.
  const discoveryContext = await browser.newContext();
  const discoveryPage = await discoveryContext.newPage();
  await discoveryPage.route('**/api/discovery/run', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job_id: 'e2e-run', status: 'running' }) });
  });
  await discoveryPage.route('**/api/discovery/run/e2e-run', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'done', envelope: SIM_RESULT }),
    });
  });
  await discoveryPage.goto('/');

  await discoveryPage.getByTestId('nav-tab-discovery').click();
  await expect(discoveryPage.getByTestId('discovery-offer')).toBeVisible();
  await discoveryPage.getByTestId('discovery-run-btn').click();
  await expect(discoveryPage.getByTestId('discovery-sub-tab')).toBeVisible();
  await expect(discoveryPage.getByTestId('discovery-summary')).toBeVisible();

  await discoveryPage.getByTestId('discovery-continue-btn').click();
  // GO-2 M1: continuing now passes through the boundary confirm/correct step
  // (rung 1 — correction, not creation). Leave the drafts unconfirmed (they
  // still prune, never score) and continue to the interview.
  await expect(discoveryPage.getByTestId('boundary-confirm-panel')).toBeVisible();
  await discoveryPage.getByTestId('boundary-continue-btn').click();
  // Continuing lands back on the Situation/assessment view (tab-profile).
  await expect(discoveryPage.getByTestId('tab-profile')).toBeVisible();

  await fillProfileAndBegin(discoveryPage, { kind: 'individual_contractor', name: 'Discovery Branch Co' });
  const discoveryTotalText = await discoveryPage.getByTestId('progress-note').textContent();
  const discoveryTotal = Number(discoveryTotalText?.match(/of (\d+) answered/)?.[1]);
  expect(Number.isFinite(discoveryTotal)).toBe(true);
  await discoveryContext.close();

  // The user-visible pruning delta: strictly fewer questions after a real
  // Run Discovery -> Continue click-through than the manual branch.
  expect(discoveryTotal).toBeLessThan(manualTotal);
});
