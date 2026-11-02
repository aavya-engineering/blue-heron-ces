// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30 (written, not run by the slice): the AO kit console against a real AO server. It checks
// the shell, the command list from the real registry, DRY RUN then APPLY (APPLY locked until the
// dry run of this request returns), the two-person controls hidden while the switch is off, an
// evidence row with objectives, and axe (serious / critical findings). It never clicks APPLY: the
// watched apply against the simulator is FIN-35's EU-AO step (V123).

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function seriousAxe(page: import('@playwright/test').Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

test('AO console on the kit: shell, list, dry run then apply guard, two-person hidden, evidence row', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#header')).toContainText('Blue Heron Defense — AdminOps');
  await expect(page.getByTestId('cmd-A-02')).toBeVisible();
  await expect(page.getByTestId('search-results')).toContainText(/Start typing to search \d+ commands/);
  await expect(page.getByTestId('approvals-open')).toHaveCount(0);
  expect(await seriousAxe(page)).toEqual([]);

  const sel = page.getByTestId('tenant-select').first();
  const simValues = await sel
    .locator('option')
    .evaluateAll((opts) => (opts as HTMLOptionElement[]).filter((o) => o.value && o.text.endsWith('(sim)')).map((o) => o.value));
  test.skip(simValues.length === 0, 'no sim tenant registered under CES_TENANT_ROOT');
  await sel.selectOption(simValues[0]);

  await page.getByTestId('cmd-B-09').click();
  await expect(page.getByTestId('form-title')).toHaveAttribute('data-command-id', 'B-09');
  await expect(page.getByTestId('apply')).toBeDisabled();
  await expect(page.getByTestId('approval-id')).toHaveCount(0);

  await page.getByTestId('dry-run').click();
  await expect(page.getByTestId('result-panel')).not.toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('result-panel')).toHaveAttribute('data-correlation-id', /^ao-ui-/);
  await expect(page.getByTestId('apply')).toBeEnabled();
  await expect(page.getByTestId('evidence-row-1')).toHaveAttribute('data-mode', 'dry_run');
  // B-09's registry objectives are AC.L1-3.1.20[e] and [f] (AO-1).
  await expect(page.getByTestId('evidence-objectives-1')).toContainText('AC.L1-3.1.20');
  expect(await seriousAxe(page)).toEqual([]);
});
