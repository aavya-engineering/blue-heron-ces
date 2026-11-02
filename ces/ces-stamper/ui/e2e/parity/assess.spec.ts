// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PC-05 (Assess, card 2), PLAN §5: grid counts and drill-down equal, the gap plan, CMMC editor
// filters and its export. Legacy (/) and SPA (/app/assess) run the same steps; ordered API
// requests (AD-4) and visible outcomes on the legacy ids must be equal. Canned events come from
// the fictional tenant; CES_PARITY_TENANT=<slug> adds a live assess on that tenant (S1 under
// `stamper gui --stacksim`). Runs once, from the react project. Watchable (PLAN §8b).

import * as fs from 'node:fs';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { STAMPER_SELECTORS } from './selectors';
import type { ParityProject } from './selectors';
import {
  FICTIONAL_CMMC_STATUS,
  FICTIONAL_GAP_PLAN,
  FICTIONAL_SLUG,
  expandCard,
  readEditor,
  readFamilyTable,
  readGrid,
  runOnBoth,
  textOf,
} from './cards.fixture';


test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react', 'drives both consoles; runs once');
});

const both = runOnBoth('assess');

const CACHED = { accomplishedIds: ['ac-001'], cmmcStatus: FICTIONAL_CMMC_STATUS, timestamp: '2026-10-28T09:00:00.000Z' };
const PLAN_LESS = { ...CACHED, cmmcStatus: { ...FICTIONAL_CMMC_STATUS, hasDirectives: false, sprsByCategory: undefined } };

const ASSESS_EVENTS = [
  { type: 'connection_log', phase: 'config_loaded', tenant: FICTIONAL_SLUG, message: 'Config loaded for ridgeline' },
  { type: 'connection_log', phase: 'connected', tenant: FICTIONAL_SLUG, message: 'Connected to ridgeline' },
  { type: 'assess_start', totalEntries: 3, evidencePath: 'C:\\evidence\\ridgeline' },
  { type: 'assess_phase', phase: 'live', count: 3 },
  {
    type: 'assess_check', entryId: 'ac-001', label: 'Conditional access baseline', engine: 'mgraph', found: true, status: 'exists', entryIndex: 1,
    cmmc_controls: ['AC.L2-3.1.1'], command: 'Get-MgIdentityConditionalAccessPolicy', reason: 'Policy present',
    registry: { idempotency: 'idempotent', set_command_template: 'New-MgIdentityConditionalAccessPolicy' },
  },
  { type: 'assess_check', entryId: 'ia-001', label: 'MFA for all users', engine: 'mgraph', found: false, status: 'missing', entryIndex: 2, cmmc_controls: ['IA.L2-3.5.3'], reason: 'No MFA policy' },
  { type: 'assess_check', entryId: 'cm-001', label: 'Baseline documentation', engine: 'manual_gate', found: false, status: 'no_query', entryIndex: 3, cmmc_controls: ['CM.L2-3.4.1'] },
  { type: 'assess_summary', accomplished: 1, pending: 2 },
  { type: 'cmmc_status', ...FICTIONAL_CMMC_STATUS },
  { type: 'assess_done' },
];

/** Family table OK/Prov/Gap cell: legacy puts onclick on the td, the SPA a button inside it. */
async function clickFamilyCell(p: Page, row: number, col: number) {
  const cell = p.locator('#cmmcFamilyTable tr').nth(row).locator('td').nth(col);
  const button = cell.locator('button');
  if (await button.count()) await button.click();
  else await cell.click();
}

async function gridOutcome(p: Page, project: ParityProject) {
  return { grid: await readGrid(p, project), families: await readFamilyTable(p), badge: await textOf(p, STAMPER_SELECTORS.cardStatus2) };
}

test.describe('PC-05 assess (card 2)', () => {
  test('cached state: same grid counts, family table and badge (directive grid)', async ({ page }) => {
    await both(page, 'assess-cached', { slug: FICTIONAL_SLUG, fictional: { assessState: CACHED } }, async (p, project) => {
      await expandCard(p, 2);
      return gridOutcome(p, project);
    });
  });

  test('cached state, plan-less: the SPA grid shows the legacy plan-less counts', async ({ page }) => {
    await both(page, 'assess-planless', { slug: FICTIONAL_SLUG, fictional: { assessState: PLAN_LESS } }, async (p, project) => {
      await expandCard(p, 2);
      const g = await readGrid(p, project);
      return { cells: Object.fromEntries(Object.entries(g).filter(([k]) => !k.startsWith('summary.'))) };
    });
  });

  test('drill-down: every tile opens the editor on the same controls', async ({ page }) => {
    const tiles = ['satisfied', 'provisional', 'not_satisfied'].flatMap((r) => ['automated', 'excluded', 'nonstack', 'total'].map((c) => [r, c] as const));
    await both(page, 'assess-drilldown', { slug: FICTIONAL_SLUG, fictional: { assessState: CACHED } }, async (p, project) => {
      await expandCard(p, 2);
      const seen: Record<string, unknown> = {};
      for (const [row, col] of tiles) {
        const legacyRow = row === 'satisfied' ? 'sat' : row === 'provisional' ? 'prov' : 'unsat';
        const directive = project === 'react' || (await p.locator('#cmmcDirectiveGrid').isVisible());
        await p.click(directive ? `#cmmc_cell_${row}_${col}` : `#cell_${col}_${legacyRow}`);
        seen[`${row}.${col}`] = await readEditor(p);
        await p.click('#cmmcEditorOverlay .cmmc-editor-close');
      }
      return seen;
    });
  });

  test('family table cells open the editor on the family', async ({ page }) => {
    await both(page, 'assess-family', { slug: FICTIONAL_SLUG, fictional: { assessState: CACHED } }, async (p) => {
      await expandCard(p, 2);
      await clickFamilyCell(p, 1, 2);
      const ac = await readEditor(p);
      const nav = await p.$$eval('#cmmcEditorNav .cmmc-nav-item', (els) => els.map((e) => `${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}|${e.classList.contains('active')}`));
      return { ac, nav };
    });
  });

  test('CMMC editor filters: status, type, search and family nav give the same lists', async ({ page }) => {
    await both(page, 'assess-editor-filters', { slug: FICTIONAL_SLUG, fictional: { assessState: CACHED } }, async (p) => {
      await expandCard(p, 2);
      await p.click('#cmmc_cell_satisfied_total');
      await p.waitForSelector('#cmmcEditorOverlay.visible');
      // The legacy filter selects keep their values between opens; start from "all".
      await p.selectOption('#edFilterStatus', '');
      await p.selectOption('#edFilterImplType', '');
      await p.fill('#edFilterSearch', '');
      const seen: Record<string, unknown> = { tile: await readEditor(p) };
      await p.click('#cmmcEditorOverlay .cmmc-editor-close');
      await clickFamilyCell(p, 1, 4);
      seen['familyGap'] = await readEditor(p);
      await p.locator('#cmmcEditorNav .cmmc-nav-item').first().click();
      seen['allFamilies'] = await readEditor(p);
      await p.selectOption('#edFilterStatus', 'PARTIAL');
      seen['partial'] = await readEditor(p);
      await p.selectOption('#edFilterStatus', '');
      await p.selectOption('#edFilterImplType', 'Automated');
      seen['automatedType'] = await readEditor(p);
      await p.selectOption('#edFilterImplType', '');
      await p.fill('#edFilterSearch', '3.1');
      seen['search'] = await readEditor(p);
      seen['dashboard'] = await p.$$eval('#cmmcEditorDashboard .cmmc-dash-tile', (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
      return seen;
    });
  });

  test('CMMC editor export: same JSON (exported_at aside)', async ({ page }) => {
    await both(page, 'assess-export', { slug: FICTIONAL_SLUG, fictional: { assessState: CACHED } }, async (p) => {
      await expandCard(p, 2);
      await p.click('#cmmc_cell_not_satisfied_total');
      await p.waitForSelector('#cmmcEditorOverlay.visible');
      const download = p.waitForEvent('download');
      await p.locator('#cmmcEditorOverlay button', { hasText: 'Export' }).click();
      const file = await download;
      const body = JSON.parse(fs.readFileSync((await file.path())!, 'utf-8'));
      delete body.exported_at;
      return { name: file.suggestedFilename(), body };
    });
  });

  test('assess run: same stream query, rows, counter, grid and Assessed badge', async ({ page }) => {
    await both(page, 'assess-run', { slug: FICTIONAL_SLUG, fictional: { assess: ASSESS_EVENTS } }, async (p, project) => {
      await expandCard(p, 2);
      await p.click(STAMPER_SELECTORS.assess);
      await expect.poll(() => textOf(p, STAMPER_SELECTORS.cardStatus2)).toBe('Assessed');
      await p.waitForLoadState('networkidle');
      await expandCard(p, 2);
      return {
        ...(await gridOutcome(p, project)),
        counter: await textOf(p, '#assessCounter'),
        rows: await p.$$eval('#taskList .assess-entry-row', (els) => els.map((e) => `${e.id}|${Array.from(e.classList).filter((c) => c !== 'expanded').sort().join(' ')}`)),
        log: await p.$$eval('#taskList .connection-log-row .log-msg', (els) => els.map((e) => (e.textContent ?? '').trim())),
        status: await textOf(p, '#statusBar'),
        halt: await p.locator('#btnAssessHalt').isVisible(),
      };
    });
  });

  test('a tile after an assess uses the tracked rows (execution banner)', async ({ page }) => {
    await both(page, 'assess-run-drilldown', { slug: FICTIONAL_SLUG, fictional: { assess: ASSESS_EVENTS } }, async (p) => {
      await expandCard(p, 2);
      await p.click(STAMPER_SELECTORS.assess);
      await expect.poll(() => textOf(p, STAMPER_SELECTORS.cardStatus2)).toBe('Assessed');
      await expandCard(p, 2);
      await p.click('#cmmc_cell_satisfied_total');
      return { editor: await readEditor(p), banner: await textOf(p, '#cmmcEditorBanner') };
    });
  });

  test('compute gaps: same plan summary and controls; dev is refused', async ({ page }) => {
    await both(page, 'assess-gaps', { slug: FICTIONAL_SLUG, fictional: { gaps: { success: true, plan: FICTIONAL_GAP_PLAN } } }, async (p) => {
      await expandCard(p, 2);
      await p.click('#btnComputeGaps');
      await p.waitForSelector('#gapPlanSection:visible');
      return {
        count: await textOf(p, '#gapPlanCount'),
        summary: (await textOf(p, '#gapPlanSummary')).replace(/\s+/g, ' '),
        controls: (await textOf(p, '#gapPlanControls')).replace(/\s+/g, ' '),
        status: await textOf(p, '#statusBar'),
        button: await textOf(p, '#btnComputeGaps'),
      };
    });
    await both(page, 'assess-gaps-dev', {}, async (p) => {
      await expandCard(p, 2);
      await p.click('#btnComputeGaps');
      await p.click(STAMPER_SELECTORS.assess);
      return { status: await textOf(p, '#statusBar') };
    });
  });

  test('live tenant (CES_PARITY_TENANT): same assess requests and grid counts', async ({ page }) => {
    const slug = process.env['CES_PARITY_TENANT'];
    test.skip(!slug, 'set CES_PARITY_TENANT (S1 under stamper gui --stacksim) for the live run');
    test.setTimeout(30 * 60_000);
    await both(page, `assess-live-${slug}`, { slug }, async (p, project) => {
      await expandCard(p, 2);
      await p.click(STAMPER_SELECTORS.assess);
      await expect.poll(() => textOf(p, STAMPER_SELECTORS.cardStatus2), { timeout: 25 * 60_000 }).toMatch(/Assessed|Error/);
      await p.waitForLoadState('networkidle');
      await expandCard(p, 2);
      return { ...(await gridOutcome(p, project)), counter: await textOf(p, '#assessCounter') };
    });
  });
});
