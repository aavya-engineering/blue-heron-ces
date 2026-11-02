// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-16 / V115 (FINISH-PLAN.md §1.3; COST-GATE-SPEC §3.4-§3.5; founder ruling FD-1): the Stamper
// GUI's double positive on a SIMULATED tenant, watched on screen.
//   1. Translate screen: the recurring item is listed UNTICKED with its price.
//   2. Without DP-1 (the plan-time opt-in) the translated plan leaves it out (cost_gated_off),
//      so the run cannot start the cost.
//   3. DP-1 typed in the list (entry id + operator), translate again: the item is in the plan.
//   4. Execute (Incremental, tenant): the DP-2 dialog shows the price; the exact text
//      `<entry id> <monthly cost>` is typed; the server accepts it (scripted answers count only
//      on a kind:'sim' tenant, FD-1) and the item runs. Both confirmations are evidence
//      (`<tenant>/cost-gate-evidence/*-dp1.json` and `*-dp2.json`, outcome accepted).
//
// Written in PH-1, NOT run there. Opt-in only; it never runs in a default parity round:
//   CES_V115=1                 enable
//   CES_PARITY_TENANT=<slug>   a kind:'sim' tenant (`stamper gui --stacksim`), never `dev`
//   CES_PARITY_MP / CES_PARITY_TM   the plan inputs (spa2-flow planPaths)
//   CES_V115_ENTRY             the recurring entry to opt in (default SC.L2-3.13.10.key-vault; pick
//                              a scenario whose plan runs its SET, e.g. s2-eng, not S1's exists path)
//   CES_V115_TENANT_DIR        optional: the tenant's plan-data folder, to check the evidence files
// React project only (the legacy console has no cost gate UI).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { caption } from '../parity/harness';
import { PARITY_TENANT, TERMINAL_BADGE, prepareToTranslate, startExecute, translate } from '../parity/spa2-flow';
import { STAMPER_SELECTORS as S } from '../parity/selectors';

const ENTRY = process.env['CES_V115_ENTRY'] || 'SC.L2-3.13.10.key-vault';
const OPERATOR = 'v115-tester';
const TENANT_DIR = process.env['CES_V115_TENANT_DIR'];
const RUN_TIMEOUT = 1_500_000;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react', 'the cost gate UI is SPA-only');
  test.skip(process.env['CES_V115'] !== '1', 'V115 is opt-in (CES_V115=1)');
  test.skip(PARITY_TENANT === 'dev', 'V115 needs a kind:sim tenant, not dev');
});

const rowSel = `[data-cost-entry="${ENTRY}"]`;

function readPlan(reply: Record<string, any>): Record<string, any> {
  const out = reply?.planDataPaths?.output as string | undefined;
  expect(out, 'translate reply carries the executable plan path').toBeTruthy();
  return JSON.parse(fs.readFileSync(out as string, 'utf-8')) as Record<string, any>;
}

function planSubIds(plan: Record<string, any>): string[] {
  const ids: string[] = [];
  for (const t of plan.execution_graph ?? []) for (const s of t.action?.args?._sub_commands ?? []) ids.push(String(s.id));
  return ids;
}

function costRecords(suffix: 'dp1' | 'dp2'): any[] {
  if (!TENANT_DIR) return [];
  const dir = path.join(TENANT_DIR, 'cost-gate-evidence');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(`-${suffix}.json`))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')))
    .filter((r) => r?.metadata?.entryId === ENTRY);
}

async function openOptInList(page: Page): Promise<void> {
  const list = page.locator('#costOptInList');
  await expect(list).toBeVisible();
  if (!(await list.evaluate((el) => (el as HTMLDetailsElement).open))) await list.locator('summary').click();
  await expect(page.locator(rowSel)).toBeVisible();
}

/** Runs to the terminal badge: types DP-2 into the dialog when it opens, approves the other gates. */
async function runWithDp2(page: Page): Promise<{ dp2Seen: boolean; outcome?: string; estimateText?: string }> {
  const badge = page.locator(S.cardStatus4);
  const dialog = page.locator('#costDp2Dialog');
  const approve = page.locator('.approval-btns button:has-text("Approve"), .sub-approval-btns button:has-text("Approve")').first();
  const deadline = Date.now() + RUN_TIMEOUT;
  let dp2Seen = false;
  let outcome: string | undefined;
  let estimateText: string | undefined;
  while (Date.now() < deadline) {
    const text = (await badge.textContent()) ?? '';
    if (TERMINAL_BADGE.test(text) && !/executing|retrying/i.test(text)) break;
    if (await dialog.isVisible().catch(() => false)) {
      dp2Seen = true;
      await expect(dialog).toHaveAttribute('data-entry-id', ENTRY);
      estimateText = (await page.locator('#costDp2Estimate').textContent()) ?? '';
      expect(estimateText).toMatch(/about \$[\d.,-]+(-\$[\d.,]+)? a month/);
      const expected = ((await page.locator('#costDp2Expected').textContent()) ?? '').trim();
      expect(expected.startsWith(`${ENTRY} $`)).toBe(true);
      await caption(page, `DP-2: typing "${expected}"`);
      await page.fill('#costDp2Typed', expected);
      await page.fill('#costDp2Operator', OPERATOR);
      const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/approve' && r.request().method() === 'POST');
      await page.click('#costDp2Confirm');
      const body = (await (await reply).json()) as { outcome?: string };
      outcome = body.outcome;
      continue;
    }
    if (await approve.isVisible().catch(() => false)) {
      await approve.click().catch(() => undefined);
      continue;
    }
    await page.waitForTimeout(1_000);
  }
  return { dp2Seen, outcome, estimateText };
}

test.describe('V115: Stamper GUI DP-1 and DP-2 on a simulated tenant', () => {
  test.setTimeout(2_700_000);

  test('unticked with its price; refused without DP-1; runs with DP-1 + typed DP-2; both evidenced', async ({ page, request }) => {
    await prepareToTranslate(page, 'react', request);

    await caption(page, 'Translate: recurring costs are listed unticked with their price');
    await page.click('#railNode3');
    await openOptInList(page);
    const row = page.locator(rowSel);
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(row).toContainText(/about \$[\d.]+.* a month/);
    await expect(row).toContainText('price date');

    await caption(page, 'Without DP-1 the plan leaves the item out (cost_gated_off)');
    const before = readPlan(await translate(page, 'react'));
    const gatedOff = (before.variables?._cost_gate?.gated_off ?? []) as Array<{ entry_id: string; reason?: string }>;
    expect(gatedOff.map((g) => g.entry_id)).toContain(ENTRY);
    expect(gatedOff.find((g) => g.entry_id === ENTRY)?.reason).toBe('cost_gated_off');
    expect(planSubIds(before)).not.toContain(ENTRY);

    await caption(page, 'DP-1: type the entry id and the operator');
    await openOptInList(page);
    await row.locator('input[type="checkbox"]').check();
    const form = page.locator(`[data-cost-ack-form="${ENTRY}"]`);
    await expect(form).toBeVisible();
    await form.locator('input').nth(0).fill(ENTRY);
    await form.locator('input').nth(1).fill(OPERATOR);
    await form.locator('button:has-text("Confirm opt-in")').click();
    await expect(page.locator('#costOptInNotice')).toContainText('Translate again');
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();

    await caption(page, 'Translate again: the opted-in item is in the plan');
    const after = readPlan(await translate(page, 'react'));
    expect(planSubIds(after)).toContain(ENTRY);
    expect(((after.variables?._cost_gate?.gated_off ?? []) as Array<{ entry_id: string }>).map((g) => g.entry_id)).not.toContain(ENTRY);

    await startExecute(page, 'react', { mode: 'manual', target: 'tenant' });
    const run = await runWithDp2(page);
    expect(run.dp2Seen, 'the DP-2 dialog opened for the recurring item').toBe(true);
    expect(run.outcome, 'the typed DP-2 was accepted (sim tenant)').toBe('accepted');

    if (TENANT_DIR) {
      expect(costRecords('dp1').some((r) => r.outcome === 'accepted' && r.metadata.operator === OPERATOR)).toBe(true);
      const dp2 = costRecords('dp2').filter((r) => r.outcome === 'accepted');
      expect(dp2.length).toBeGreaterThan(0);
      expect(dp2[dp2.length - 1].metadata).toMatchObject({ gate: 'cost', dp: 2, operator: OPERATOR });
    }
  });
});
