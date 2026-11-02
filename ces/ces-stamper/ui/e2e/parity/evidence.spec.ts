// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-10 Evidence (legacy card 5), PLAN §5: stats, families, modal (overlay), viewer; routes
// /api/evidence-scan and /api/evidence-content. Each outcome test runs under both projects
// (legacy at /, react at /app/); the request comparison and the real-data comparison drive both
// consoles from the react project only. Watchable (PLAN §8b): headed and paced unless
// CES_UI_HEADLESS=1; video and trace always on.

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import { STAMPER_SELECTORS } from './selectors';
import type { ParityProject } from './selectors';
import { FIXTURE_EVIDENCE_REPLY, FIXTURE_SCAN, expandLegacyEvidenceCard, mockApi, openLegacyOnDev } from './spa3-fixtures';


const PC10_ROUTES = ['/api/evidence-scan', '/api/evidence-content'];
const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');

/** Per-console selectors where the markup differs (legacy divs with onclick; SPA buttons). */
const SEL = {
  legacy: {
    familyHeader: (abbr: string) => `.ev-family[data-family-abbrev="${abbr}"] .ev-family-header`,
    fileOpen: (entryId: string) => `.ev-file-row[data-entry-id="${entryId}"]`,
  },
  react: {
    // The family header only: control rows are also aria-expanded buttons inside the family.
    familyHeader: (abbr: string) => `[data-family-abbrev="${abbr}"] button.spa-ev-family-header`,
    fileOpen: (entryId: string) => `[data-entry-id="${entryId}"] .spa-ev-file-open`,
  },
} as const;

async function openEvidence(page: Page, project: ParityProject): Promise<void> {
  if (project === 'legacy') {
    await openLegacyOnDev(page);
    await expandLegacyEvidenceCard(page);
  } else {
    await page.goto('/app/evidence?tenant=dev');
  }
  await caption(page, `PC-10 (${project}): Evidence card`);
}

/**
 * Scans and waits for the result. Legacy doEvidenceScan ends with setCardState('workflowCard5',
 * 'done'), which collapses the card (index.html L10882, L4791), so the legacy card is expanded
 * again as the demo driver would; the SPA screen has no collapse (D-7).
 */
async function scan(page: Page): Promise<void> {
  const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/evidence-scan');
  await page.locator('#btnEvidenceScan').click();
  await reply;
  await expect(page.locator('#cardStatus5')).not.toHaveText(/Scanning/i);
  await expandLegacyEvidenceCard(page);
}

test.describe('PC-10 evidence card', () => {
  test('fixture scan: stats, families, control rows, overlay, verdict badge', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await mockApi(page, {
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: FIXTURE_EVIDENCE_REPLY },
    });
    await openEvidence(page, project);
    await expect(page.locator(STAMPER_SELECTORS.card(5))).toBeVisible();
    await scan(page);
    await caption(page, `PC-10 (${project}): stats and families`);

    await expect(page.locator('#evStatControls')).toHaveText('3');
    await expect(page.locator('#evStatWithEvidence')).toHaveText('1');
    await expect(page.locator('#evStatMissing')).toHaveText('2');
    await expect(page.locator('#evStatCoverage')).toHaveText('33%');
    await expect(page.locator('#cardStatus5')).toHaveText('33% Coverage');
    await expect(page.locator('[data-family-abbrev]')).toHaveCount(2);
    expect(await page.locator('[data-family-abbrev]').evaluateAll((els) => els.map((e) => e.getAttribute('data-family-abbrev')))).toEqual([
      'AC',
      'AU',
    ]);

    await page.locator(SEL[project].familyHeader('AC')).click();
    await expect(page.locator(SEL[project].familyHeader('AC'))).toContainText('1/2');
    const controlIds = await page
      .locator('[data-family-abbrev="AC"] [data-control-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-control-id')));
    expect(controlIds).toEqual(['AC.L2-3.1.1', 'AC.L2-3.1.5']);

    await page.locator('[data-control-id="AC.L2-3.1.1"]').click();
    const row = page.locator('[data-entry-id="ac-ca-baseline"]');
    await expect(row).toContainText('NO VERDICT');
    await expect(row).toContainText('2KB · 2h ago');

    await caption(page, `PC-10 (${project}): open the evidence overlay`);
    await page.locator(SEL[project].fileOpen('ac-ca-baseline')).click();
    await expect(page.locator('#evidenceViewerOverlay')).toBeVisible();
    await expect(page.locator('#evidenceViewerTitle')).toContainText('Conditional Access baseline');
    await expect(page.locator('#evidenceViewerBody')).toContainText('AC.L2-3.1.1');
    await page.keyboard.press('Escape');
    await expect(page.locator('#evidenceViewerOverlay')).toBeHidden();
    await expect(row).toContainText('SAT');
    await expect(row).not.toContainText('NO VERDICT');
  });

  test('search by control id hides families with no match', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    await mockApi(page, { 'GET /api/evidence-scan': { body: FIXTURE_SCAN } });
    await openEvidence(page, project);
    await scan(page);
    await caption(page, `PC-10 (${project}): search "au.l2"`);
    // Legacy filters on keyup, so type key by key.
    await page.locator('#evidenceSearch').pressSequentially('au.l2');
    await expect(page.locator('[data-family-abbrev]:visible')).toHaveCount(1);
    await expect(page.locator('[data-family-abbrev]:visible')).toHaveAttribute('data-family-abbrev', 'AU');
  });

  test('empty state when no control has evidence', async ({ page }, testInfo) => {
    const project = projectOf(testInfo.project.name);
    const empty = { ...FIXTURE_SCAN, summary: { ...FIXTURE_SCAN.summary, controlsWithEvidence: 0, coveragePct: 0 } };
    await mockApi(page, { 'GET /api/evidence-scan': { body: empty } });
    await openEvidence(page, project);
    await scan(page);
    await expect(page.locator('#evidenceEmptyState')).toBeVisible();
    await expect(page.locator('#evidenceEmptyState')).toHaveText('No evidence files found. Run Execute to generate evidence.');
    await expect(page.locator('#evStatCoverage')).toHaveText('0%');
  });

  test('parity: same ordered requests for scan then open (AD-4)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'records both consoles; runs once');
    const handlers = {
      'GET /api/evidence-scan': { body: FIXTURE_SCAN },
      'GET /api/evidence-content': { body: FIXTURE_EVIDENCE_REPLY },
    };
    await mockApi(page, handlers);
    // Both consoles keep expanded families in sessionStorage under the same key (legacy L10910,
    // L10986; SPA store/evidence.ts EXPANDED_FAMILIES_KEY). This test drives both on one page, so
    // each console starts as on a fresh tab: no family expanded.
    await page.addInitScript(() => {
      try {
        window.sessionStorage.removeItem('evidenceExpandedFamilies');
      } catch {
        /* storage unavailable */
      }
    });
    const recordings = {} as Record<ParityProject, ReturnType<typeof recordApiRequests>>;
    for (const project of ['legacy', 'react'] as const) {
      await openEvidence(page, project);
      recordings[project] = recordApiRequests(page);
      await caption(page, `PC-10 parity: recording ${project}`);
      await scan(page);
      await page.locator(SEL[project].familyHeader('AC')).click();
      await page.locator('[data-control-id="AC.L2-3.1.1"]').click();
      const content = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/evidence-content');
      await page.locator(SEL[project].fileOpen('ac-ca-baseline')).click();
      await content;
      await expect(page.locator('#evidenceViewerOverlay')).toBeVisible();
      recordings[project].stop();
    }
    writeRecording(testInfo.outputPath('parity-evidence-legacy.json'), recordings.legacy.requests);
    writeRecording(testInfo.outputPath('parity-evidence-react.json'), recordings.react.requests);
    const result = compareRecordings(recordings.legacy.requests, recordings.react.requests, { routes: PC10_ROUTES });
    testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
    expect(result.differences).toEqual([]);
    expect(result.react).toEqual(['GET /api/evidence-scan ?tenant', 'GET /api/evidence-content ?entryId&tenant']);
  });

  test('real dev evidence store: both consoles show the same stats', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
    const stats: Record<string, string[]> = {};
    for (const project of ['legacy', 'react'] as const) {
      await openEvidence(page, project);
      await caption(page, `PC-10 (${project}): scan the real dev evidence store`);
      await scan(page);
      await expect(page.locator('#evStatControls')).not.toHaveText('--');
      // textContent, not innerText: the SPA badge is upper-cased by CSS (AD-4 compares text, not pixels).
      stats[project] = await Promise.all(
        ['#evStatControls', '#evStatWithEvidence', '#evStatMissing', '#evStatCoverage', '#cardStatus5'].map(
          async (s) => ((await page.locator(s).textContent()) ?? '').trim(),
        ),
      );
      stats[`${project}-families`] = await page
        .locator('[data-family-abbrev]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-family-abbrev') ?? ''));
    }
    testInfo.annotations.push({ type: 'stats', description: JSON.stringify(stats) });
    expect(stats.react).toEqual(stats.legacy);
    expect(stats['react-families']).toEqual(stats['legacy-families']);
  });
});
