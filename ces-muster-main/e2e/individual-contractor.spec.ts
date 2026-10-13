// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-2: individual_contractor variant
// Assertions:
// - [data-testid="roster-section"] absent throughout the flow
// - rollup nav link absent (data-testid="rollup-nav")
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin } from './helpers';

test('EU-2: individual_contractor variant — roster-section and rollup-nav absent', async ({ page }) => {
  await page.goto('/');

  // Before the engagement exists, no rollup nav
  await expect(page.getByTestId('tab-profile')).toBeVisible();
  await expect(page.locator('[data-testid="rollup-nav"]')).toHaveCount(0);

  // Begin an individual_contractor assessment (creates the engagement)
  await fillProfileAndBegin(page, { kind: 'individual_contractor', name: 'Solo LLC' });

  // rollup nav link must remain absent for individual_contractor
  await expect(page.locator('[data-testid="rollup-nav"]')).toHaveCount(0);

  // roster-section should never be visible (it lives in the rollup view,
  // which is unreachable for individual_contractor)
  await expect(page.locator('[data-testid="roster-section"]')).toHaveCount(0);
});
