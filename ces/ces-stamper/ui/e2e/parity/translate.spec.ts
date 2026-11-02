// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-06 Translate (card 3): /api/translate, /api/last-translate, /api/validate(-file).
// Same request signatures around the Translate click, and the same executable-plan
// projection: projectExecutablePlan() from Stamper's build (the V72 function, W8-STX), applied
// to the EP each console wrote. Watchable (PLAN §8b): headed and paced unless CES_UI_HEADLESS=1;
// video and trace always.

import * as fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { RecordedRequest } from './harness';
import { FLOW_TIMEOUT, prepareToTranslate, projectOf, translate } from './spa2-flow';

test.setTimeout(FLOW_TIMEOUT);

const PC06_ROUTES = ['/api/translate', '/api/last-translate', '/api/validate', '/api/validate-file'];

/** Stamper's built translateForTenant module (O3 builds dist; W8-STX exports the projection). */
const PROJECTION_MODULE = fileURLToPath(new URL('../../../dist/translators/translateForTenant.js', import.meta.url));

async function projectEp(epPath: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(PROJECTION_MODULE).href)) as { projectExecutablePlan: (plan: unknown) => unknown };
  return mod.projectExecutablePlan(JSON.parse(fs.readFileSync(epPath, 'utf8')));
}

async function translateOn(page: Page, project: 'legacy' | 'react', request: Parameters<typeof prepareToTranslate>[2]) {
  await prepareToTranslate(page, project, request);
  const rec = recordApiRequests(page);
  const reply = await translate(page, project);
  await page.waitForTimeout(1_000); // the EP validation follows the reply
  rec.stop();
  return { reply, requests: rec.requests as RecordedRequest[] };
}

test.describe('PC-06 translate', () => {
  test('same requests and the same EP projection on both consoles', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    expect(fs.existsSync(PROJECTION_MODULE), `build Stamper first (O3): ${PROJECTION_MODULE}`).toBe(true);

    const legacy = await translateOn(page, 'legacy', request);
    const react = await translateOn(page, 'react', request);
    writeRecording(testInfo.outputPath('parity-translate-legacy.json'), legacy);
    writeRecording(testInfo.outputPath('parity-translate-react.json'), react);

    const result = compareRecordings(legacy.requests, react.requests, { routes: PC06_ROUTES });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);

    expect(legacy.reply.success).toBe(true);
    expect(react.reply.success).toBe(true);
    expect(react.reply.totalTasks).toBe(legacy.reply.totalTasks);
    expect(react.reply.directiveCounts).toEqual(legacy.reply.directiveCounts);

    await caption(page, 'PC-06: comparing the executable-plan projections');
    const [left, right] = await Promise.all([projectEp(legacy.reply.planDataPaths.output), projectEp(react.reply.planDataPaths.output)]);
    expect(right).toEqual(left);
  });

  test('card 3 is locked until Assess, then shows Translated', async ({ page, request }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await page.goto(project === 'legacy' ? '/' : '/app/');
    await caption(page, `PC-06 ${project}: card 3 starts locked`);
    if (project === 'react') await expect(page.locator('#railNode3')).toBeDisabled();
    else await expect(page.locator('#workflowCard3')).toHaveClass(/card-locked/);
    await prepareToTranslate(page, project, request);
    const reply = await translate(page, project);
    expect(reply.success).toBe(true);
    await expect(page.locator('#outputPath')).toHaveValue(String(reply.planDataPaths.output));
  });
});
