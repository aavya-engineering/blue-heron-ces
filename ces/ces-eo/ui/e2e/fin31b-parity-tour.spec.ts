// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: a READ-ONLY watched tour of the legacy-parity screens (Evidence Explorer, Policy Store,
// Personnel inner tabs, Risk inner tabs, the control matrix and timeline). It writes nothing and
// never presses Connect (connect changes which live signals EO reads). Opt-in: it runs only when
// EO_UI_PARITY_TOUR=1, so the V124 run (same testDir) is unaffected. Written, not run, by FIN-31b.
//
// Inputs: EO_URL (via playwright.config.ts), EO_UI_TENANT, EO_UI_SERVICE_TOKEN (if EO enforces it).

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function noSeriousAxe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

test.skip(process.env.EO_UI_PARITY_TOUR !== '1', 'opt-in: set EO_UI_PARITY_TOUR=1');

test('FIN-31b: read-only tour of the parity screens', async ({ page }) => {
  const tenant = process.env.EO_UI_TENANT ?? '';
  expect(tenant, 'EO_UI_TENANT').not.toBe('');
  await page.goto('access');
  if (process.env.EO_UI_SERVICE_TOKEN) await page.fill('#serviceToken', process.env.EO_UI_SERVICE_TOKEN);
  await page.locator('#tenantSelect').selectOption(tenant);

  const tab = (name: string) => page.getByRole('tab', { name, exact: true });

  await tab('Assess').click();
  await expect(page.locator('#eo-matrix-card')).toBeVisible();
  await expect(page.locator('#eo-timeline-card')).toBeVisible();
  await noSeriousAxe(page);

  await tab('Evidence Explorer').click();
  await expect(page.locator('#evidenceConnectionBanner')).toBeVisible();
  await noSeriousAxe(page);

  await tab('Personnel').click();
  for (const inner of ['Ledger', 'Policy', 'Setup']) {
    await tab(inner).click();
    await noSeriousAxe(page);
  }

  await tab('Risk').click();
  for (const inner of ['Current register', 'History', 'Setup']) {
    await tab(inner).click();
    await noSeriousAxe(page);
  }

  await tab('Policy Store').click();
  await expect(page.locator('#policyStoreTable')).toBeVisible();
  await noSeriousAxe(page);
});
