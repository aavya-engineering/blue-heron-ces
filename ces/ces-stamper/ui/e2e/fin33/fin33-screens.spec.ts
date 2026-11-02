// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-33 (FINISH-PLAN.md §3.4): the Configure, Variables and Registry screens driven on a REAL
// Stamper GUI with a simulated tenant (S2 s2-eng, S3 s3-def, mp muster-partial, or S1), watched.
//
// Two parts:
//  A. READ-ONLY drive (safe inside the V73 window: it writes nothing, so the UI run's plan, failed
//     set and changed objects still equal the headless twin):
//       Configure: a non-M365-only posture lists every recurring baseline item OFF, priced, with
//       "Opt in (DP-1)" disabled until the operator and the exact entry id are typed. Nothing is
//       clicked, so no DP-1 is recorded and no baseline runs.
//       Variables: the tenant's config loads, the FD-13 note says the manifest wins, Save stays
//       disabled, the plan-variables tab opens. No save.
//       Registry: the M365 registry loads, next/previous and search work, the infra registry
//       loads. No save.
//     Assertion: no PUT, DELETE, /api/baseline or /api/baseline/cost-ack request was made.
//  B. Bring to Baseline with the cost gate (UNCOMPARED; never inside the V73 window). Opt-in:
//       CES_FIN33_BASELINE=1  run Bring to Baseline with NO DP-1: every recurring item is refused
//                             ("not built"), free items build (fail closed, CG-6).
//       CES_FIN33_DP=1        also give DP-1 for the first item, type its DP-2, run again: that
//                             item reads "recurring cost confirmed". Sim tenants only (FD-1):
//                             NOTE this rests on CES_PARITY_TENANT naming a kind:'sim' tenant. The
//                             spec can only refuse `dev`, and the baseline route does not enforce
//                             FD-1 (LOG-FIN-15 open item 2), as with the V115 spec.
//
// Written in PH-3, NOT run there. Opt-in only; never part of a default parity round:
//   CES_FIN33=1                enable
//   CES_PARITY_TENANT=<slug>   a kind:'sim' tenant (`stamper gui --stacksim`), never `dev`
//   CES_PARITY_MP / CES_PARITY_TM   the plan inputs (spa2-flow planPaths)
// React project only (the cost panel and the FD-13 note are SPA-only).

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { caption, recordApiRequests, writeRecording } from '../parity/harness';
import type { RecordedRequest } from '../parity/harness';
import { PARITY_TENANT, openCard, prepareToTranslate } from '../parity/spa2-flow';

const T = PARITY_TENANT;
const OPERATOR = 'fin33-tester';
const BASELINE_TIMEOUT = 900_000;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react', 'FIN-33 drives the SPA');
  test.skip(process.env['CES_FIN33'] !== '1', 'FIN-33 is opt-in (CES_FIN33=1)');
  test.skip(T === 'dev', 'FIN-33 needs a kind:sim tenant, not dev');
});

/** Requests that would make the drive a write (and so break V73's equality with the twin). */
function writes(requests: RecordedRequest[]): string[] {
  return requests
    .filter(
      (r) =>
        r.method === 'PUT' ||
        r.method === 'DELETE' ||
        r.path === '/api/baseline' ||
        r.path === '/api/baseline/cost-ack' ||
        r.path === '/api/cost-gate/ack',
    )
    .map((r) => `${r.method} ${r.path}`);
}

async function configureReadOnly(page: Page): Promise<void> {
  await caption(page, `FIN-33: Configure, recurring baseline items are off (${T})`);
  await openCard(page, 'react', 1);
  const items = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/baseline/cost-items');
  await page.selectOption('#baselinePostureSelect', 'm365_foundation');
  await items;
  const panel = page.locator('#baselineCostPanel');
  await expect(panel).toBeVisible();
  const rows = panel.locator('.baseline-cost-item');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const entryId = (await row.getAttribute('data-entry-id')) ?? '';
    expect(entryId.startsWith('baseline.'), `baseline entry id ${entryId}`).toBe(true);
    await expect(row).toContainText('a month');
    await expect(row).toContainText('price date');
    // A harness tenant has no DP-1, so every item is off and its opt-in is locked.
    await expect(row).toContainText('Off (no DP-1).');
    const optIn = row.getByRole('button', { name: 'Opt in (DP-1)' });
    await expect(optIn).toBeDisabled();
  }
  // The opt-in unlocks only on the operator plus the exact entry id; nothing is clicked.
  const first = rows.first();
  const firstId = (await first.getAttribute('data-entry-id')) ?? '';
  const optIn = first.getByRole('button', { name: 'Opt in (DP-1)' });
  await page.fill('#baselineOperator', OPERATOR);
  await first.locator('input[type="text"]').fill(`${firstId}x`);
  await expect(optIn).toBeDisabled();
  await first.locator('input[type="text"]').fill(firstId);
  const priced = !(await first.innerText()).includes('about unknown');
  if (priced) await expect(optIn).toBeEnabled();
  await first.locator('input[type="text"]').fill('');
  await expect(page.locator('#btnBaseline')).toBeEnabled();
  // Leave the screen as the run found it.
  await page.selectOption('#baselinePostureSelect', 'm365_only');
  await expect(panel).toBeHidden();
}

async function variablesReadOnly(page: Page): Promise<void> {
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/tenants/${T}/variables`);
  await page.goto(`/app/variables?tenant=${encodeURIComponent(T)}`);
  await loaded;
  await caption(page, `FIN-33: Variables, the Tenant Manifest wins (FD-13) (${T})`);
  await expect(page.locator('#tenantName')).toHaveText(T);
  await expect(page.locator('#pathHint')).not.toHaveText('');
  await expect(page.locator('#variablesPrecedenceNote')).toContainText('Tenant Manifest');
  await expect(page.locator('#configSaveBtn')).toBeDisabled();
  await page.locator('[data-tab="variables"]').click();
  await expect(page.locator('#variablesSaveBtn')).toBeVisible();
}

async function registryReadOnly(page: Page): Promise<void> {
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/registry/m365');
  await page.goto(`/app/registry?tenant=${encodeURIComponent(T)}&type=m365`);
  await loaded;
  await caption(page, `FIN-33: Registry, M365 entries (${T})`);
  const counter = page.locator('#registryEntryCounter');
  await expect(counter).toHaveText(/^Entry 1 of \d+$/);
  const total = Number(/of (\d+)/.exec(await counter.innerText())?.[1] ?? '0');
  expect(total).toBeGreaterThan(1);
  const firstId = await page.locator('#reg_entry_id').inputValue();
  expect(firstId).not.toBe('');
  await page.locator('#regNextBtn').click();
  await expect(counter).toHaveText(`Entry 2 of ${total}`);
  await page.locator('#regPrevBtn').click();
  await expect(page.locator('#reg_entry_id')).toHaveValue(firstId);
  await caption(page, `FIN-33: Registry, search "${firstId}"`);
  await page.locator('#searchInput').fill(firstId);
  await expect(page.locator('#searchResultsCount')).toHaveText(/^\d+ of \d+$/);
  await page.locator('#searchInput').fill('');
  await caption(page, 'FIN-33: Registry, Azure (infra) entries');
  const infra = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/registry/infra');
  await page.locator('#regToggleInfra').click();
  await infra;
  await expect(counter).toHaveText(/of \d+$/);
}

test.describe('FIN-33 screens on a simulated tenant', () => {
  test.setTimeout(1_200_000);

  test('A: Configure (cost panel), Variables and Registry, read-only', async ({ page, context, request }, testInfo) => {
    const rec = recordApiRequests(page);
    await prepareToTranslate(page, 'react', request, { assess: false });
    await configureReadOnly(page);
    rec.stop();

    const vars = await context.newPage();
    const recVars = recordApiRequests(vars);
    await variablesReadOnly(vars);
    recVars.stop();

    const reg = await context.newPage();
    const recReg = recordApiRequests(reg);
    await registryReadOnly(reg);
    recReg.stop();

    const all = [...rec.requests, ...recVars.requests, ...recReg.requests];
    writeRecording(testInfo.outputPath('fin33-readonly-requests.json'), all);
    expect(writes(all)).toEqual([]);
  });

  test('B: Bring to Baseline refuses every recurring item without DP-1 (uncompared)', async ({ page, request }) => {
    test.skip(process.env['CES_FIN33_BASELINE'] !== '1', 'baseline run is opt-in (CES_FIN33_BASELINE=1)');
    await prepareToTranslate(page, 'react', request, { assess: false });
    await openCard(page, 'react', 1);
    await page.selectOption('#baselinePostureSelect', 'm365_foundation');
    await expect(page.locator('#baselineCostPanel .baseline-cost-item').first()).toBeVisible();
    await caption(page, `FIN-33: Bring to Baseline with no DP-1 (${T})`);
    await page.click('#btnBaseline');
    await expect(page.locator('#baselineStatus')).toHaveText(/^(Complete|Error):/, { timeout: BASELINE_TIMEOUT });
    await expect(page.locator('#taskList')).toContainText('not built');
  });

  test('B: DP-1 then DP-2 confirms one recurring item (uncompared, sim only)', async ({ page, request }) => {
    test.skip(process.env['CES_FIN33_BASELINE'] !== '1' || process.env['CES_FIN33_DP'] !== '1', 'DP chain is opt-in (CES_FIN33_BASELINE=1 and CES_FIN33_DP=1)');
    await prepareToTranslate(page, 'react', request, { assess: false });
    await openCard(page, 'react', 1);
    await page.selectOption('#baselinePostureSelect', 'm365_foundation');
    const first = page.locator('#baselineCostPanel .baseline-cost-item').first();
    await expect(first).toBeVisible();
    const entryId = (await first.getAttribute('data-entry-id')) ?? '';
    await page.fill('#baselineOperator', OPERATOR);
    if ((await first.innerText()).includes('Off (no DP-1).')) {
      await caption(page, `FIN-33: DP-1 for ${entryId}`);
      await first.locator('input[type="text"]').fill(entryId);
      const ack = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/baseline/cost-ack');
      await first.getByRole('button', { name: 'Opt in (DP-1)' }).click();
      await ack;
      await expect(first).toContainText('DP-1 given.');
    }
    const label = await first.locator('label').innerText();
    const expected = /DP-2 for this run: type (.+)$/.exec(label.trim())?.[1] ?? '';
    expect(expected, 'the DP-2 label shows the exact text').not.toBe('');
    await caption(page, `FIN-33: DP-2 "${expected}"`);
    await first.locator('input[type="text"]').fill(expected);
    await page.click('#btnBaseline');
    await expect(page.locator('#baselineStatus')).toHaveText(/^(Complete|Error):/, { timeout: BASELINE_TIMEOUT });
    await expect(page.locator('#taskList')).toContainText('recurring cost confirmed');
  });
});
