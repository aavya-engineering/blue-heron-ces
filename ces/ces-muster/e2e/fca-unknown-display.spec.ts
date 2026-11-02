// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-6: "I'm not sure" → FCA disclaimer visible; score = 0 when all answers are unknown
// Assertion: FCA disclaimer text present in result screen; score = 0 when all answers unknown
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin, answerAllAndFinish } from './helpers';

test('EU-6: all unknown answers → FCA disclaimer visible and score is 0%', async ({ page }) => {
  await page.goto('/');

  await fillProfileAndBegin(page, { kind: 'individual_contractor', name: 'Unknown Corp' });
  await answerAllAndFinish(page, 'unknown');

  // FCA disclaimer text must be present
  await expect(page.locator('[data-testid="disclaimer-text"]')).toBeVisible();
  const disclaimerText = await page.locator('[data-testid="disclaimer-text"]').textContent();
  expect(disclaimerText).toMatch(/self-assessed indicator/i);

  // Score should be 0% (all unknowns → conservative score = 0)
  const scoreEl = page.locator('[data-testid="conservative-score"]');
  await expect(scoreEl).toBeVisible();
  const scoreText = await scoreEl.textContent();
  expect(scoreText).toMatch(/^0%/);
});
