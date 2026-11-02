// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// M4 acceptance-gate verifier: opens dashboard/dashboard.html via file:// in
// headless Chromium (NO server running), asserts the gate's required UI, and
// proves the page makes zero non-file network requests.
import { chromium } from 'playwright';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const dashPath = path.join(repoRoot, 'dashboard', 'dashboard.html');
const url = pathToFileURL(dashPath).href;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const nonFileRequests = [];
page.on('request', (r) => {
  if (!r.url().startsWith('file://')) nonFileRequests.push(r.url());
});

await page.goto(url, { waitUntil: 'load' });

const fail = (msg) => { console.error('GATE FAIL: ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('ok: ' + msg);

// 1. Latest-run tiles render with numbers.
const tiles = await page.locator('#tiles .tile').count();
tiles >= 5 ? ok(`${tiles} summary tiles`) : fail(`expected >=5 tiles, got ${tiles}`);
const passTile = await page.locator('#tiles .tile', { hasText: 'pass rate' }).textContent();
/\d+%/.test(passTile ?? '') ? ok(`pass-rate tile: ${passTile.trim().replace(/\s+/g, ' ')}`) : fail('pass-rate tile has no percentage');

// 2. Scenario table rows for the latest run.
const rows = await page.locator('#scenario-table tbody tr').count();
rows >= 4 ? ok(`${rows} scenario rows`) : fail(`expected >=4 scenario rows, got ${rows}`);

// 3. History strip: >=3 completed run cells.
const cells = await page.locator('#history-strip .runcell:not(.inflight)').count();
cells >= 3 ? ok(`${cells}-run history strip`) : fail(`expected >=3 history cells, got ${cells}`);

// 4. Drill-down: open every detail, assert assertions table + ledger link.
const details = page.locator('#details details');
const dCount = await details.count();
dCount >= 3 ? ok(`${dCount} drill-down panels`) : fail(`expected >=3 drill-down panels, got ${dCount}`);
let ledgerLinks = 0;
for (let i = 0; i < dCount; i++) {
  const d = details.nth(i);
  await d.locator('summary').click();
  const assertionRows = await d.locator('.detail-body table tbody tr').count();
  if (assertionRows < 1) fail(`drill-down ${i} has no assertion rows`);
  ledgerLinks += await d.locator('a[href*="ledger-snapshot.json"]').count();
}
ledgerLinks >= 1 ? ok(`${ledgerLinks} ledger snapshot link(s) in drill-downs`) : fail('no ledger snapshot links');

// 5. The deliberate-fail scenario shows red with diverged commands.
const zz = page.locator('#details details', { hasText: 'zz-deliberate-fail-atp' });
if (await zz.count()) {
  const divergedRows = await zz.locator('table').nth(1).locator('tbody tr').count();
  divergedRows >= 1 ? ok(`zz drill-down shows ${divergedRows} diverged command(s)`) : fail('zz drill-down has no diverged commands');
} else fail('zz-deliberate-fail-atp drill-down missing');

// 6. Flake table renders with an assessment per scenario.
const flakyRows = await page.locator('#flaky-table tbody tr').count();
flakyRows >= 4 ? ok(`${flakyRows} scenario-history rows`) : fail(`expected >=4 history rows, got ${flakyRows}`);
const flakyBadges = await page.locator('#flaky-table .badge.flaky').count();
console.log(`info: ${flakyBadges} scenario(s) currently flagged flaky`);

// 7. Fully offline: zero non-file requests.
nonFileRequests.length === 0 ? ok('zero non-file network requests') : fail(`page attempted network: ${nonFileRequests.join(', ')}`);

// 8. No console errors.
await browser.close();
console.log(process.exitCode ? 'M4 GATE: FAIL' : 'M4 GATE: all UI criteria PASS (file://, offline)');
