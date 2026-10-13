// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// EU-1: prime_and_subs full happy path
// (a) StatusPayload export triggers download (after completing the tabbed assessment)
// (b) After rollup JSON import: RAG table renders ≥1 row with sub name visible
// (c) Pending-subs CSV export triggers download; content contains the imported sub name
// Note: roster CSV import UI is not in the Phase-0 SPA; assertions adapted to use
//       the StaticRollup JSON-payload import which is the actual Phase-0 UI surface.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { fillProfileAndBegin, answerAllAndFinish } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('EU-1: prime_and_subs full happy path', async ({ page }) => {
  // Capture console errors for debugging
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  await fillProfileAndBegin(page, { kind: 'prime_and_subs', name: 'Test Sub Co' });
  await answerAllAndFinish(page, 'yes');

  if (consoleErrors.length > 0) {
    console.log('Browser console errors:', consoleErrors);
  }

  // (a) StatusPayload export triggers download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export StatusPayload/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/status-payload/);

  // Navigate to Rollup view
  await page.locator('[data-testid="rollup-nav"]').click();
  await page.waitForSelector('h2:has-text("Subcontractor Rollup")', { timeout: 5000 });

  // (b) Import a fixture StatusPayload JSON — RAG table renders ≥1 row
  const fixturePath = resolve(__dirname, 'fixtures/sample-payload.json');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  await page.waitForSelector('tbody tr', { timeout: 5000 });
  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeGreaterThanOrEqual(1);

  // Verify sub name visible (from fixture: "Acme Defense LLC")
  await expect(page.locator('tbody')).toContainText('Acme Defense LLC');

  // (c) Pending-subs CSV export triggers download; content contains the imported sub name
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export Pending Subs CSV/ }).click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/pending-subs/);

  const stream = await csvDownload.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const csvContent = Buffer.concat(chunks).toString('utf-8');
  expect(csvContent).toContain('Acme Defense LLC');
});
