// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-5: Malformed roster CSV (negative)
// Assertion: Error banner visible; no sub rows rendered after malformed file import
// Note: The Phase-0 SPA uses StaticRollup which accepts JSON payload files, not CSV.
// A malformed JSON file triggers the "invalid JSON" error path in StaticRollup.
// This test uploads a malformed JSON file and verifies the error banner appears.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { fillProfileAndBegin } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('EU-5: malformed file import — error banner visible, no RAG rows rendered', async ({ page }) => {
  await page.goto('/');

  // Rollup nav requires a prime_and_subs engagement — begin one
  await fillProfileAndBegin(page, { kind: 'prime_and_subs', name: 'Malformed Corp' });

  await page.locator('[data-testid="rollup-nav"]').click();
  await page.waitForSelector('h2:has-text("Subcontractor Rollup")', { timeout: 5000 });

  // Upload a malformed JSON file
  const malformedPath = resolve(__dirname, 'fixtures/malformed.json');
  await page.locator('input[type="file"]').setInputFiles(malformedPath);

  // Error banner/message should be visible
  await expect(page.locator('ul', { hasText: /invalid JSON/i })).toBeVisible({ timeout: 5000 });

  // No sub rows rendered in the RAG table
  await expect(page.locator('tbody tr')).toHaveCount(0);
});
