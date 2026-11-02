// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-08 Console, Terminal, Results, Error Log: the same rows per event (counted by meaning,
// since the kit's class names differ) and /api/save-run-log. PC-09 Resource Ledger: filters,
// counts, and exports equal byte for byte once the per-run timestamps (and the hash over them)
// are masked. Watchable: headed and paced unless CES_UI_HEADLESS=1; video and trace always.

import * as fs from 'node:fs';
import { expect, test } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { ParityProject } from './selectors';
import {
  FLOW_TIMEOUT,
  PARITY_TENANT,
  awaitTerminal,
  consoleCounts,
  normaliseTimestamps,
  prepareToTranslate,
  startExecute,
  stepStatuses,
  translate,
} from './spa2-flow';

test.setTimeout(FLOW_TIMEOUT);

const OPERATOR = 'Avery Quill';
const TARGET = PARITY_TENANT === 'dev' ? 'dryrun' : 'tenant';

const answering = new WeakSet<Page>();

async function completedRun(page: Page, project: ParityProject, request: APIRequestContext) {
  if (!answering.has(page)) {
    answering.add(page);
    page.on('dialog', (d) => void d.accept(OPERATOR).catch(() => undefined)); // the ledger's operator prompt
  }
  await prepareToTranslate(page, project, request);
  await translate(page, project);
  const rec = recordApiRequests(page);
  await startExecute(page, project, { mode: 'auto', target: TARGET });
  const badge = await awaitTerminal(page);
  await page.waitForTimeout(2_000); // run-log and ledger saves follow `done`
  rec.stop();
  return { badge, requests: rec.requests };
}

async function showTerminal(page: Page) {
  await page.click('[data-tab="terminal"]');
}

async function exportLedger(page: Page, format: 'md' | 'json' | 'csv', project: ParityProject): Promise<string> {
  const button =
    project === 'legacy'
      ? page.locator(`#resourceLedgerPanel button[onclick*="'${format}'"]`)
      : page.locator(`#resourceLedgerPanel [data-format="${format}"]`);
  const download = page.waitForEvent('download');
  await button.click();
  const file = await (await download).path();
  return fs.readFileSync(file, 'utf8');
}

test.describe('PC-08 console, terminal, results, error log', () => {
  test('same rows per event and the same saves', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const out: Record<string, unknown> = {};
    for (const project of ['legacy', 'react'] as const) {
      const run = await completedRun(page, project, request);
      await caption(page, `PC-08 ${project}: counting rows`);
      const statuses = await stepStatuses(page);
      await showTerminal(page);
      out[project] = { ...run, statuses, counts: await consoleCounts(page, project) };
    }
    writeRecording(testInfo.outputPath('parity-console.json'), out);
    const legacy = out['legacy'] as { statuses: string[]; counts: Record<string, number>; requests: never[] };
    const react = out['react'] as typeof legacy;
    expect(react.statuses).toEqual(legacy.statuses);
    expect(react.counts).toEqual(legacy.counts);
    const result = compareRecordings(legacy.requests, react.requests, { routes: ['/api/save-run-log'] });
    expect(result.differences).toEqual([]);
  });

  test('Save Log posts the run log and shows where it went', async ({ page, request }, testInfo) => {
    const project = testInfo.project.name === 'legacy' ? 'legacy' : 'react';
    await completedRun(page, project, request);
    const save = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/save-run-log');
    await caption(page, `PC-08 ${project}: Save Log`);
    await page.click('button:has-text("Save Log")');
    expect(Object.keys(JSON.parse((await save).postData() ?? '{}'))).toEqual(['log']);
    await expect(page.locator('#rlogSaveMsg')).toHaveText(/^Saved: /);
  });
});

test.describe('PC-09 resource ledger', () => {
  test('filters, counts and exports match', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const out: Record<string, Record<string, string>> = {};
    for (const project of ['legacy', 'react'] as const) {
      await completedRun(page, project, request);
      const button = page.locator('#resourcesFloatBtn');
      test.skip(!(await button.isVisible()), 'this run discovered and created no resources (try CES_PARITY_TENANT=s1-mach)');
      await caption(page, `PC-09 ${project}: resource ledger`);
      await button.click();
      const total = ((await page.locator('#ledgerCount').textContent()) ?? '').trim();
      await page.uncheck('#filterDiscovered');
      const createdOnly = ((await page.locator('#ledgerCount').textContent()) ?? '').trim();
      await page.check('#filterDiscovered');
      out[project] = {
        total,
        createdOnly,
        md: normaliseTimestamps(await exportLedger(page, 'md', project)),
        json: normaliseTimestamps(await exportLedger(page, 'json', project)),
        csv: normaliseTimestamps(await exportLedger(page, 'csv', project)),
      };
    }
    writeRecording(testInfo.outputPath('parity-ledger.json'), out);
    expect(out['react']).toEqual(out['legacy']);
  });
});
