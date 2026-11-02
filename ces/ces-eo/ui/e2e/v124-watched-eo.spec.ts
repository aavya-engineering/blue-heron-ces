// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// V124 (FINISH-PLAN.md §1.3): the watched EO UI run equals the twin. Through EO's kit UI only:
// assess, SSP and DOCX, an upload through the UI with a minted uploader token, a review through
// the UI by a different person that credits the control as the API path does, a self-review the
// screen refuses, and the assessor view. Written by FIN-31; run by FIN-35 (agent H3), not here.
//
// Inputs (environment, set by the run harness on a simulator tenant only):
//   EO_URL                    EO base URL (run-scoped instance)
//   EO_UI_TENANT              tenant slug, e.g. s1-mach
//   EO_UI_SERVICE_TOKEN       CES_EO_AUTH_TOKEN of that EO, if set
//   EO_UI_OPERATOR_TOKEN      a BHD operator token (the dev fallback is loopback and sim only)
//   EO_UI_UPLOADER_UPN        the uploader's UPN (from the scenario's review plan)
//   EO_UI_REVIEWER_UPN        the reviewer's UPN (another person)
//   EO_UI_CONTROL             a non-stack control id, e.g. PE.L2-3.10.2
//   EO_UI_OBJECTIVE           one of its objective ids
//   EO_UI_FILE                path of the fictional document to upload
//   EO_UI_EVIDENCE_OUT        where to write the run record (JSON) for the V124 judge

import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const env = (k: string, required = true): string => {
  const v = process.env[k] ?? '';
  if (required && !v) throw new Error(`V124: ${k} is not set (the run harness sets it)`);
  return v;
};

async function caption(page: Page, text: string) {
  if (process.env.CES_UI_HEADLESS === '1') return;
  await page.evaluate((value) => {
    let el = document.getElementById('ces-watch-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ces-watch-caption';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:60vw;padding:8px 12px;pointer-events:none;font:600 14px/1.4 sans-serif;background:CanvasText;color:Canvas;border-radius:4px';
      document.body.appendChild(el);
    }
    el.textContent = value;
  }, text);
}

// PH12-UI: soft, so an axe finding is recorded (record.axe) and fails the test at its end without hiding the
// upload, review and assessor steps behind it.
async function noSeriousAxe(page: Page, screen: string, axe: Array<{ screen: string; serious: string[] }>) {
  const r = await new AxeBuilder({ page }).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  axe.push({ screen, serious });
  expect.soft(serious, `axe serious/critical findings on ${screen}`).toEqual([]);
}

test('V124: watched EO run through the kit UI', async ({ page }) => {
  const tenant = env('EO_UI_TENANT');
  const control = env('EO_UI_CONTROL');
  const objective = env('EO_UI_OBJECTIVE');
  const axe: Array<{ screen: string; serious: string[] }> = [];
  const record: Record<string, unknown> = { check: 'V124', tenant, control, objective, startedAt: new Date().toISOString(), axe };
  // PH12-UI: where the run stopped. EO_UI_EVIDENCE_OUT (the judged record) is still written only on success; the
  // progress file beside it (<name>.progress.json) is written on every exit, naming the last stage and the error.
  const out = env('EO_UI_EVIDENCE_OUT', false);
  let stage = 'open';
  const progress = (extra: Record<string, unknown>) => {
    if (!out) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out.replace(/\.json$/i, '') + '.progress.json', JSON.stringify({ ...record, stage, ...extra }, null, 2));
  };
  try {
    await page.goto('access');
    await expect(page.locator('.header-company')).toHaveText('Blue Heron Defense — EvidenceOps');
    stage = 'access';
    await caption(page, 'Tenant and access: select the tenant, enter the service and operator tokens');
    if (env('EO_UI_SERVICE_TOKEN', false)) await page.fill('#serviceToken', env('EO_UI_SERVICE_TOKEN', false));
    await page.locator('#tenantSelect').selectOption(tenant);
    await page.fill('#operatorToken', env('EO_UI_OPERATOR_TOKEN'));
    await noSeriousAxe(page, 'access', axe);

    stage = 'mint-uploader';
    await caption(page, 'Mint an uploader token for the named uploader (FIN-12 open item 2)');
    await page.fill('#uploaderUpn', env('EO_UI_UPLOADER_UPN'));
    await page.click('#mintUploaderBtn');
    await expect(page.getByText(/Uploader token minted for/)).toBeVisible();

    stage = 'assess';
    await caption(page, 'Assess: run the evidence assessment');
    await page.getByRole('tab', { name: 'Assess', exact: true }).click();
    await page.click('#assessBtn');
    await expect(page.getByText(/Evidence assessment complete\. SPRS:/)).toBeVisible({ timeout: 300_000 });
    record.sprsAfterAssess = await page.locator('#metricSprs').textContent();

    stage = 'ssp-docx';
    await caption(page, 'SSP: generate, then download the DOCX (the assessor deliverable)');
    await page.getByRole('tab', { name: 'SSP', exact: true }).click();
    await page.click('#sspGenerateBtn');
    await expect(page.getByText(/SSP generated/)).toBeVisible({ timeout: 120_000 });
    const docx = page.waitForEvent('download');
    await page.click('#sspExportDocxBtn');
    record.docx = (await docx).suggestedFilename();

    stage = 'upload';
    await caption(page, `Upload: a fictional document for ${control}, as the uploader`);
    await page.getByRole('tab', { name: 'Upload', exact: true }).click();
    await page.fill('#ecUploadControlIds', control);
    await page.fill('#ecUploadRole', 'compliance_officer');
    await page.setInputFiles('#ecUploadFile', path.resolve(env('EO_UI_FILE')));
    await page.click('#ecUploadBtn');
    await expect(page.locator('#ecUploadStatus')).toContainText(`by ${env('EO_UI_UPLOADER_UPN')}`);
    record.upload = await page.locator('#ecUploadStatus').textContent();

    stage = 'review-self-refused';
    await caption(page, 'Review: a token for the uploader is refused on screen (GD-b)');
    await page.getByRole('tab', { name: 'Tenant and access', exact: true }).click();
    await page.fill('#approverUpn', env('EO_UI_UPLOADER_UPN'));
    await page.click('#mintApproverBtn');
    await expect(page.getByText(/Approver token minted for/)).toBeVisible();
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.locator('#reviewControl').selectOption(control);
    const uploaded = page.getByRole('row').filter({ hasText: env('EO_UI_UPLOADER_UPN') }).last();
    await uploaded.getByRole('radio').check();
    await page.locator('#reviewObjective').selectOption(objective);
    await expect(page.locator('#reviewBlock')).toContainText('Another person must review it (GD-b)');
    await expect(page.locator('#reviewSubmitBtn')).toBeDisabled();

    stage = 'review';
    await caption(page, 'Review: the reviewer (another person) records met');
    await page.getByRole('tab', { name: 'Tenant and access', exact: true }).click();
    await page.fill('#approverUpn', env('EO_UI_REVIEWER_UPN'));
    await page.click('#mintApproverBtn');
    await expect(page.getByText(new RegExp(`Approver token minted for ${env('EO_UI_REVIEWER_UPN').replace(/\./g, '\\.')}`))).toBeVisible();
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.locator('#reviewControl').selectOption(control);
    await page.getByRole('row').filter({ hasText: env('EO_UI_UPLOADER_UPN') }).last().getByRole('radio').check();
    await page.locator('#reviewObjective').selectOption(objective);
    await page.locator('#reviewVerdict').selectOption('met');
    await page.click('#reviewSubmitBtn');
    await expect(page.locator('#reviewStatus')).toContainText('Review recorded');
    record.review = await page.locator('#reviewStatus').textContent();
    await noSeriousAxe(page, 'review', axe);

    stage = 'reassess-assessor';
    await caption(page, 'Assess again so the review counts, then the assessor view');
    await page.getByRole('tab', { name: 'Assess', exact: true }).click();
    await page.click('#assessBtn');
    await expect(page.getByText(/Evidence assessment complete\. SPRS:/).last()).toBeVisible({ timeout: 300_000 });
    record.sprsAfterReview = await page.locator('#metricSprs').textContent();
    await page.getByRole('tab', { name: 'Assessor view', exact: true }).click();
    await expect(page.locator('#assessorControls')).toContainText(control);
    record.assessorRow = await page.locator('#assessorControls tr', { hasText: control }).first().textContent();
    await noSeriousAxe(page, 'assessor', axe);

    record.finishedAt = new Date().toISOString();
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(record, null, 2));
    }
    stage = 'done';
  } catch (e) {
    progress({ failed: true, error: (e instanceof Error ? e.message : String(e)).slice(0, 4000) });
    throw e;
  }
  progress({ failed: false, axe_failed: axe.some((a) => a.serious.length > 0) });
});
