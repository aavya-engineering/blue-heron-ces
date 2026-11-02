// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-4: Export with no session (negative)
// Assertion: Export button absent before interview completion
// The Export StatusPayload button only renders on the ResultScreen, which is only shown
// after a completed interview. Neither the profile tab nor mid-interview shows it.
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin } from './helpers';

test('EU-4: export button absent/disabled before interview completion', async ({ page }) => {
  await page.goto('/');

  // On initial load (assessment profile tab), no export button should be present
  await expect(page.getByTestId('tab-profile')).toBeVisible();
  await expect(page.locator('button', { hasText: /Export StatusPayload/i })).toHaveCount(0);

  // Mid-interview (session in progress, questions unanswered) — still no export button
  await fillProfileAndBegin(page, { kind: 'prime_and_subs', name: 'No Session Corp' });
  await expect(page.locator('button', { hasText: /Export StatusPayload/i })).toHaveCount(0);

  // Finish is gated until every question is answered
  await expect(page.getByTestId('finish-interview')).toBeDisabled();
});
