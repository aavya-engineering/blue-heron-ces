// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-3: Resume after mid-interview reload
// Assertion: After answering 3 questions and reloading, the session resumes with
// all 3 answers restored (Dexie persistence — facts upserted on each answer;
// App.tsx on-mount check restores the in-progress session into the assessment view).
import { test, expect } from '@playwright/test';
import { fillProfileAndBegin, clusterTabs } from './helpers';

test('EU-3: resume after mid-interview reload — 3 recorded answers restored', async ({ page }) => {
  await page.goto('/');

  await fillProfileAndBegin(page, { kind: 'prime_and_subs', name: 'Resume Corp' });

  // Answer exactly 3 questions on the first cluster tab
  const yesRadios = page.locator('.question-card input[type="radio"][value="yes"]');
  for (let i = 0; i < 3; i++) {
    await yesRadios.nth(i).check();
  }
  await expect(page.getByTestId('progress-note')).toHaveText(/^3 of \d+ answered$/);

  // Reload the page
  await page.reload();

  // The in-progress session is restored (Dexie persists across reload) with all
  // 3 answers intact — progress note shows 3 answered again...
  await expect(page.getByTestId('progress-note')).toHaveText(/^3 of \d+ answered$/, {
    timeout: 10000,
  });

  // ...and the first cluster tab still shows the 3 selected radios.
  await clusterTabs(page).first().click();
  await expect(
    page.locator('.question-card input[type="radio"][value="yes"]:checked')
  ).toHaveCount(3);
});
