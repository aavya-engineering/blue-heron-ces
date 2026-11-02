// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-11 Evidence pop-out, PLAN §5: same window name and content; route /api/evidence-content.
// Legacy opener: index.html openEvidencePopout (L11073), which no control calls, so the legacy
// side is driven through that global function. SPA opener: the pop-out button on an evidence
// row. Watchable (PLAN §8b): headed and paced unless CES_UI_HEADLESS=1; video and trace on.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { ParityProject } from './selectors';
import { FIXTURE_EVIDENCE, FIXTURE_EVIDENCE_REPLY, FIXTURE_SCAN, mockApi, openLegacyOnDev } from './spa3-fixtures';


const WINDOW_NAME = 'stamper-evidence-popout';
const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');

/** Text of the pop-out's legacy ids, for the content comparison. */
const CONTENT_IDS = ['evidenceTitle', 'cmmcControls', 'verdictBadge', 'outcomeLabel', 'outcomeRationale', 'verdictRationale'];

async function listenForOpenerMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __popoutMessages: string[] };
    w.__popoutMessages = [];
    window.addEventListener('message', (e) => {
      const type = (e.data as { type?: string } | null)?.type;
      if (type) w.__popoutMessages.push(type);
    });
  });
}

const openerMessages = (page: Page) =>
  page.evaluate(() => (window as unknown as { __popoutMessages: string[] }).__popoutMessages);

/** Opens the pop-out the way each console does and returns it. */
async function openPopout(page: Page, project: ParityProject): Promise<Page> {
  const popup = page.waitForEvent('popup');
  if (project === 'legacy') {
    await openLegacyOnDev(page);
    await listenForOpenerMessages(page);
    await caption(page, 'PC-11 (legacy): openEvidencePopout(…, "ac-ca-baseline")');
    await page.evaluate(() =>
      (window as unknown as { openEvidencePopout: (p: string, id: string) => Promise<void> }).openEvidencePopout(
        'mgraph/ac-ca-baseline.txt',
        'ac-ca-baseline',
      ),
    );
  } else {
    await page.goto('/app/evidence?tenant=dev');
    await listenForOpenerMessages(page);
    await page.locator('#btnEvidenceScan').click();
    await page.locator('[data-family-abbrev="AC"] button.spa-ev-family-header').click();
    await page.locator('[data-control-id="AC.L2-3.1.1"]').click();
    await caption(page, 'PC-11 (react): pop out the evidence row');
    await page.locator('#evPopout-ac-ca-baseline').click();
  }
  const win = await popup;
  await win.waitForLoadState('load');
  return win;
}

async function contentOf(win: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of CONTENT_IDS) {
    const el = win.locator(`#${id}`);
    // textContent, not innerText: legacy upper-cases #outcomeLabel by CSS, the kit capitalises it (AD-4: text, not pixels).
    out[id] = (await el.count()) > 0 ? ((await el.textContent()) ?? '').trim() : '(absent)';
  }
  return out;
}

test.describe('PC-11 evidence pop-out', () => {
  test('window name, title, OK posts evidence_ok and closes', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await mockApi(page, {
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: FIXTURE_EVIDENCE_REPLY },
    });
    const win = await openPopout(page, project);
    expect(await win.evaluate(() => window.name)).toBe(WINDOW_NAME);
    await expect(win).toHaveTitle('CES — Evidence Review');
    await expect(win.locator('#okButton')).toBeVisible();
    await expect(win.locator('#ces-theme-toggle')).toBeVisible();
    if (project === 'react') {
      // The ready handshake delivers the data after the React page mounts.
      await expect(win.locator('#evidenceTitle')).toHaveText('ac-ca-baseline — Conditional Access baseline');
    } else {
      // Legacy posts while the new window may still be about:blank; record what it rendered.
      testInfo.annotations.push({ type: 'legacy pop-out title', description: await win.locator('#evidenceTitle').innerText() });
    }
    await caption(page, `PC-11 (${project}): OK`);
    const closed = win.waitForEvent('close');
    await win.locator('#okButton').click();
    await closed;
    await expect.poll(() => openerMessages(page)).toContain('evidence_ok');
    expect((await openerMessages(page)).filter((t) => t === 'evidence_closed')).toEqual([]);
  });

  test('content: both pop-out pages render the same evidence the same way', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both pop-out pages; runs once');
    // Drives each page as its opener would once it has loaded (legacy: popout.onload branch).
    const content: Record<string, Record<string, string>> = {};
    for (const [project, url] of [
      ['legacy', '/evidence-popout.html'],
      ['react', '/app/popout'],
    ] as const) {
      await page.goto('/');
      const popup = page.waitForEvent('popup');
      await page.evaluate(
        ({ target, name }) => {
          window.open(target, name, 'width=900,height=700');
        },
        { target: url, name: WINDOW_NAME },
      );
      const win = await popup;
      await win.waitForLoadState('load');
      await win.locator('#okButton').waitFor();
      await caption(win, `PC-11 content (${project})`);
      await page.evaluate(
        ({ name, evidence }) => {
          const w = window.open('', name);
          w?.postMessage({ type: 'evidence_data', evidence }, '*');
        },
        { name: WINDOW_NAME, evidence: FIXTURE_EVIDENCE },
      );
      await expect(win.locator('#evidenceTitle')).toHaveText('ac-ca-baseline — Conditional Access baseline');
      content[project] = await contentOf(win);
      await win.close();
    }
    testInfo.annotations.push({ type: 'content', description: JSON.stringify(content) });
    expect(content.react).toEqual(content.legacy);
  });

  test('parity: the opener makes the same evidence-content request (AD-4)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'records both consoles; runs once');
    await mockApi(page, {
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: FIXTURE_EVIDENCE_REPLY },
    });
    const recs: Record<string, ReturnType<typeof recordApiRequests>> = {};
    for (const project of ['legacy', 'react'] as const) {
      recs[project] = recordApiRequests(page);
      const win = await openPopout(page, project);
      recs[project]!.stop();
      await win.close();
    }
    writeRecording(testInfo.outputPath('parity-popout-legacy.json'), recs.legacy!.requests);
    writeRecording(testInfo.outputPath('parity-popout-react.json'), recs.react!.requests);
    const result = compareRecordings(recs.legacy!.requests, recs.react!.requests, { routes: ['/api/evidence-content'] });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
    expect(result.react).toEqual(['GET /api/evidence-content ?entryId&tenant']);
  });
});
