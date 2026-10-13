// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M0 gate (a) + (c): the Plan surface, driven as the
// muster-show-mp act drives it — navigate, generate, open, scroll bottom, scroll
// top, download — and the judged fact is the generated mission-plan file on
// disk, never the DOM. Also asserts gate (c): no SPRS string anywhere in the
// Plan tab DOM (score disclosure).
//
// Deep contract parity lives in the node test (planParity.test.ts); here the
// download is checked lightly for the core keys and non-empty control_directives.
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { fillProfileAndBegin, answerAllAndFinish } from './helpers';

test('muster-show-mp: navigate → generate → open MP → scroll bottom/top → download', async ({
  page,
}) => {
  await page.goto('/');

  // Reach a readiness result: a full interview answered 'no' yields not-met
  // requirements -> gaps -> control dispositions -> a non-empty mission plan.
  await fillProfileAndBegin(page, { kind: 'individual_contractor', name: 'Plan Beat Co' });
  await answerAllAndFinish(page, 'no');

  // Navigate to the Plan surface (enabled once a readiness result exists).
  await page.getByTestId('nav-tab-plan').click();
  await expect(page.getByTestId('plan-tab')).toBeVisible();

  // Generate the output documents.
  await page.getByTestId('plan-generate-btn').click();
  await expect(page.getByTestId('plan-doc-list')).toBeVisible({ timeout: 15000 });

  // The in-scope M0 documents are listed; the Infrastructure Manifest is ABSENT
  // (no TCP yet -> null), not stubbed.
  await expect(page.getByTestId('plan-doc-mission-plan')).toBeVisible();
  await expect(page.getByTestId('plan-doc-tenant-manifest')).toBeVisible();
  await expect(page.getByTestId('plan-doc-si-baseline')).toBeVisible();
  await expect(page.getByTestId('plan-doc-infra-manifest')).toHaveCount(0);

  // Open the mission plan and scroll to the bottom, then the top.
  await page.getByTestId('plan-open-mission-plan').click();
  await expect(page.getByTestId('mission-plan-view')).toBeVisible();
  await page.getByTestId('mission-plan-row-last').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mission-plan-row-last')).toBeVisible();
  await page.getByTestId('mission-plan-row-first').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('mission-plan-row-first')).toBeVisible();

  // Download the mission plan through the shared download seam and judge the
  // FILE, not the DOM.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('plan-download-mission-plan').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^manual-mission-plan-.*\.json$/);

  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const plan = JSON.parse(fs.readFileSync(filePath as string, 'utf8'));

  // Core contract: the shape Planner's own output carries (see planParity.test.ts).
  expect(plan.ces).toBeTruthy();
  expect(plan.outputs?.human_readable_mission_plan).toBeTruthy();
  const directives = plan.outputs.human_readable_mission_plan.control_directives;
  expect(Array.isArray(directives)).toBe(true);
  expect(directives.length).toBeGreaterThan(0);
  expect(typeof directives[0].control_id).toBe('string');
  expect(typeof directives[0].directive).toBe('string');
  // MS-R4 (ad151b6): the generator stamps the engagement identity as ces.cesId.
  // (This line used to assert the pre-MS-R4 Planner parity — cesId absent.)
  expect(typeof plan.ces.cesId).toBe('string');
  expect(plan.ces.cesId.length).toBeGreaterThan(0);

  // Gate (c): no SPRS anywhere in the Plan tab DOM.
  const planDom = await page.getByTestId('plan-tab').innerText();
  expect(planDom).not.toMatch(/SPRS/i);
});
