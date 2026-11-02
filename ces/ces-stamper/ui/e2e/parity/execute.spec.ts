// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-07 Execute (card 4): SSE /api/execute, /api/approve, /api/abort. Modes and targets,
// per-task approval, retry, halt, control-result counts. PC-14 dev quick run: auto and manual
// both complete. FG-4 (founder: fix) makes two outcomes differ on purpose, asserted per
// console: the target select after `dev`, and the badge of a run with failures.
// Watchable: headed and paced unless CES_UI_HEADLESS=1; video and trace always.

import { expect, test } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { RecordedRequest } from './harness';
import { STAMPER_SELECTORS as S } from './selectors';
import type { ParityProject } from './selectors';
import {
  FLOW_TIMEOUT,
  PARITY_TENANT,
  awaitTerminal,
  gridValues,
  openCard,
  prepareToTranslate,
  projectOf,
  startExecute,
  summaryTable,
  translate,
} from './spa2-flow';

test.setTimeout(FLOW_TIMEOUT);

const PC07_ROUTES = ['/api/execute', '/api/approve', '/api/abort'];
const DRY = PARITY_TENANT === 'dev' ? 'dryrun' : 'tenant';

interface RunRecord {
  badge: string;
  summary: Record<string, string>;
  grid: Record<string, string>;
  requests: RecordedRequest[];
}

async function runOn(
  page: Page,
  project: ParityProject,
  request: APIRequestContext,
  mode: 'auto' | 'manual' | 'batch',
  approveAll: boolean,
): Promise<RunRecord> {
  await prepareToTranslate(page, project, request);
  await translate(page, project);
  const rec = recordApiRequests(page);
  await startExecute(page, project, { mode, target: DRY });
  const badge = await awaitTerminal(page, approveAll);
  rec.stop();
  return { badge, summary: await summaryTable(page), grid: await gridValues(page), requests: rec.requests };
}

/** Legacy writes "Complete" whatever the summary says; the SPA follows the summary (FG-4 fix 2). */
function expectBadge(project: ParityProject, badge: string, summary: Record<string, string>) {
  const fail = Number(summary['Fail'] ?? 0);
  const passed = Number(summary['Pass (Stamper)'] ?? 0) + Number(summary['Accomplished (Operator)'] ?? 0);
  if (project === 'legacy' || fail === 0) {
    expect(badge).toMatch(/^Complete$/);
    return;
  }
  expect(badge).toBe(passed === 0 ? `Failed (${fail} failed)` : `Partial (${fail} failed)`);
}

test.describe('PC-07 execute', () => {
  test('automatic run: same requests, summary and grid; badge per FG-4', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const legacy = await runOn(page, 'legacy', request, 'auto', false);
    const react = await runOn(page, 'react', request, 'auto', false);
    writeRecording(testInfo.outputPath('parity-execute-auto.json'), { legacy, react });
    const result = compareRecordings(legacy.requests, react.requests, { routes: PC07_ROUTES });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
    expect(react.summary).toEqual(legacy.summary);
    expect(react.grid).toEqual(legacy.grid);
    expectBadge('legacy', legacy.badge, legacy.summary);
    expectBadge('react', react.badge, react.summary);
    testInfo.annotations.push({ type: 'FG-4 intended difference', description: `legacy "${legacy.badge}" vs SPA "${react.badge}"` });
  });

  test('incremental run with approvals: the same approve bodies, then completion', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const legacy = await runOn(page, 'legacy', request, 'manual', true);
    const react = await runOn(page, 'react', request, 'manual', true);
    writeRecording(testInfo.outputPath('parity-execute-manual.json'), { legacy, react });
    const result = compareRecordings(legacy.requests, react.requests, { routes: PC07_ROUTES });
    expect(result.differences).toEqual([]);
    expect(react.requests.some((r) => r.path === '/api/approve')).toBe(true);
    expect(react.summary).toEqual(legacy.summary);
  });

  test('halt closes the stream and posts /api/abort', async ({ page, request }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await prepareToTranslate(page, project, request);
    await translate(page, project);
    const rec = recordApiRequests(page);
    await startExecute(page, project, { mode: 'manual', target: DRY });
    await caption(page, `PC-07 ${project}: Halt`);
    await page.click(S.executeHalt);
    // W8-SPAW intended difference (founder-side ruling, behaviour clarity, not scoring):
    // legacy reads "Error" after Halt, the SPA reads "Halted". Both match the demo driver's
    // terminal pattern /complete|failed|error|halted/i.
    await expect(page.locator(S.cardStatus4)).toHaveText(project === 'legacy' ? 'Error' : 'Halted');
    await expect(page.locator(S.executeHalt)).toBeHidden();
    rec.stop();
    const sigs = rec.requests.map((r) => `${r.method} ${r.path}`);
    expect(sigs).toContain('POST /api/abort');
    expect(sigs.indexOf('GET /api/execute')).toBeLessThan(sigs.indexOf('POST /api/abort'));
  });

  test('retry re-runs skipped and failed tasks with retry=true', async ({ page, request }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await prepareToTranslate(page, project, request);
    await translate(page, project);
    await startExecute(page, project, { mode: 'auto', target: DRY });
    await awaitTerminal(page);
    const retry = page.locator('#btnRetry');
    test.skip(!(await retry.isVisible()), 'this run had no failed or skipped task');
    const execute = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/execute', { timeout: 60_000 });
    await caption(page, `PC-07 ${project}: Retry Skipped/Failed`);
    await retry.click();
    expect(new URL((await execute).url()).searchParams.get('retry')).toBe('true');
    await awaitTerminal(page);
  });

  test('FG-4: the target follows the tenant in the SPA (legacy stays on Dry Run)', async ({ page, request }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    const tenants = ((await (await request.get('/api/tenants')).json()) as Array<{ slug: string }>).filter((t) => t.slug !== 'dev');
    test.skip(tenants.length === 0, 'needs a non-dev tenant record');
    await page.goto(project === 'legacy' ? '/' : '/app/');
    await page.waitForSelector(S.tenantOption('dev'), { state: 'attached' });
    await openCard(page, project, 0);
    await page.selectOption(S.tenantSelect, 'dev');
    await page.selectOption(S.tenantSelect, tenants[0].slug);
    if (project === 'react') {
      // Card 4 is its own screen; read the select there without unlocking the rail.
      await page.evaluate(() => {
        window.history.pushState({}, '', '/app/execute');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    } else {
      await openCard(page, project, 4);
    }
    await caption(page, `FG-4 ${project}: target after dev -> ${tenants[0].slug}`);
    await expect(page.locator(S.execTarget)).toHaveValue(project === 'legacy' ? 'dryrun' : 'tenant');
    testInfo.annotations.push({ type: 'FG-4 intended difference', description: 'legacy keeps Dry Run (REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN); SPA restores Tenant' });
  });
});

test.describe('PC-14 dev quick run', () => {
  for (const mode of ['auto', 'manual'] as const) {
    test(`Translate & Execute (${mode}) completes`, async ({ page, request }, testInfo) => {
      test.skip(PARITY_TENANT !== 'dev', 'the quick run exists for the dev tenant only');
      const project = projectOf(testInfo.project.name);
      await prepareToTranslate(page, project, request, { assess: false });
      // The quick run sits outside the cards on both consoles (legacy L4625; SPA shell, DEF-1 in
      // LOG-W8-PIS3): card 3 stays locked on dev until the quick run starts translating.
      const rec = recordApiRequests(page);
      await caption(page, `PC-14 ${project}: Translate & Execute (${mode})`);
      await page.click(mode === 'auto' ? '#btnQuickExecAuto' : '#btnQuickExecManual');
      if (project === 'react') {
        // The click marks translate running (legacy setRailState('translate','running')), which unlocks its rail node.
        await openCard(page, project, 3);
        await expect(page.locator(S.cardStatus3)).toHaveText(/translated/i, { timeout: 120_000 });
        await openCard(page, project, 4);
      }
      const badge = await awaitTerminal(page, mode === 'manual');
      rec.stop();
      expect(badge).toMatch(/complete|partial|failed/i);
      const execute = rec.requests.find((r) => r.path === '/api/execute');
      expect(execute?.queryKeys).toEqual(['dryRun', 'mode', 'plan', 'tenant', 'uploadToBlob', 'verbose']);
      const translateReq = rec.requests.find((r) => r.path === '/api/translate');
      // The quick run sends the paths and tenant only, never the card-3 toggles (legacy L7759).
      expect(translateReq?.bodyKeys).toEqual(expect.arrayContaining(['manifest', 'missionPlan', 'tenant']));
      expect(translateReq?.bodyKeys).not.toContain('gapsOnly');
      expect(translateReq?.bodyKeys).not.toContain('automatedOnly');
    });
  }
});
