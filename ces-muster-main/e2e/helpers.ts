// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Shared drivers for the single-page tabbed assessment.
import { type Page } from '@playwright/test';

export interface ProfileOptions {
  kind?: 'individual_contractor' | 'prime_and_subs';
  name: string;
  onPremOt?: 'yes' | 'no' | 'unsure';
}

/**
 * Fill the Profile tab (engagement kind, org name, on-prem/OT) and click
 * Begin Interview. Resolves when the first cluster tab's questions render.
 */
export async function fillProfileAndBegin(page: Page, opts: ProfileOptions): Promise<void> {
  const kind = opts.kind ?? 'individual_contractor';
  await page.locator(`input[type="radio"][name="engagement_kind"][value="${kind}"]`).check();
  await page.locator('input[placeholder="Acme Defense LLC"]').fill(opts.name);
  await page
    .locator(`input[type="radio"][name="on_prem_ot"][value="${opts.onPremOt ?? 'no'}"]`)
    .check();
  await page.getByTestId('begin-interview').click();
  await page.locator('.question-card').first().waitFor({ state: 'visible', timeout: 10000 });
}

/** Cluster tabs (everything in the tab rail except Profile). */
export function clusterTabs(page: Page) {
  return page.locator('[data-testid^="tab-"]:not([data-testid="tab-profile"])');
}

/**
 * Visit every cluster tab and select the given option for every question,
 * then click Finish & Score and wait for the result screen.
 */
export async function answerAllAndFinish(
  page: Page,
  value: 'yes' | 'no' | 'unknown'
): Promise<void> {
  const tabs = clusterTabs(page);
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    const radios = page.locator(`.question-card input[type="radio"][value="${value}"]`);
    const radioCount = await radios.count();
    for (let j = 0; j < radioCount; j++) {
      await radios.nth(j).check();
    }
    // G-MUSTER-PLAN-3 M1 (F8): the Plan Inputs cluster has enum options (not
    // yes/no/unknown). Sweep any question card left without a checked radio and
    // pick its first option, so the helper is option-agnostic.
    const cards = page.locator('.question-card');
    const cardCount = await cards.count();
    for (let c = 0; c < cardCount; c++) {
      const card = cards.nth(c);
      if ((await card.locator('input[type="radio"]:checked').count()) === 0) {
        const first = card.locator('input[type="radio"]').first();
        if ((await first.count()) > 0) await first.check();
      }
    }
  }
  await page.getByTestId('finish-interview').click();
  await page.waitForSelector('h2:has-text("Readiness Posture Result")', { timeout: 25000 });
}
