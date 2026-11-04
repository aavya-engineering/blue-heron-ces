// EvidenceOps driver steps (PLAN.md section 3, rows 17-21) on EO's SPA at /app/. Selectors and order copied from the
// module's own watched spec, ces-eo\ui\e2e\v124-watched-eo.spec.ts (lines cited per step). Steps 17 to 21 stay on one
// SPA page: the access screen keeps the tokens in the page's memory only, so a reload would drop them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotDrivable, requireOnScreen, shot, clickAndSave, writeFacts, textOf, browserUrl } from './common.mjs';

const tab = (raw, name) => raw.getByRole('tab', { name, exact: true });

async function onSpa(ctx) {
  if (!ctx.state.eoSpaReady) {
    throw new NotDrivable('the EO access screen was not completed in this session (run step 17 first)', 'walkthrough step order');
  }
}

/** Step 17: Tenant and access: tenant, tokens, mint the uploader token (v124:78-91). */
export async function eoAccess(ctx) {
  const { cfg, raw } = ctx;
  await raw.goto(`${browserUrl(ctx, 'eo')}/app/access`, { waitUntil: 'domcontentloaded' });
  await requireOnScreen(raw, '#tenantSelect', 'EO access screen tenant list', 60_000, 'ces-eo ui/src/screens/access/index.tsx');
  await ctx.caption('EvidenceOps, Tenant and access: pick the tenant and enter the tokens (masked)');
  if (cfg.tokens.eo) await raw.fill('#serviceToken', cfg.tokens.eo);
  await raw.locator(`#tenantSelect option[value="${cfg.tenantSlug}"]`).waitFor({ state: 'attached', timeout: 60_000 });
  await raw.locator('#tenantSelect').selectOption(cfg.tenantSlug);
  await raw.fill('#operatorToken', cfg.tokens.eoOperator);
  await ctx.caption('Mint a short-lived uploader token for the named uploader (fictional)');
  await requireOnScreen(raw, '#mintUploaderBtn', 'uploader token mint', 15_000, 'ces-eo ui/src/screens/access/index.tsx');
  await raw.fill('#uploaderUpn', cfg.eoPeople.uploaderUpn);
  await raw.click('#mintUploaderBtn');
  await raw.getByText(/Uploader token minted for/).first().waitFor({ state: 'visible', timeout: 30_000 });
  ctx.state.eoSpaReady = true;
  await shot(ctx, 'eo-access-01-tokens.png');
  writeFacts(ctx, 'eo-access.json', { tenant: cfg.tenantSlug, serviceTokenEntered: Boolean(cfg.tokens.eo), uploaderTokenMinted: true });
  return { ok: true };
}

/** Step 18: SSP: generate, then download the DOCX (v124:101-107). */
export async function eoSsp(ctx) {
  const { raw } = ctx;
  await onSpa(ctx);
  await ctx.caption('SSP: generate the System Security Plan from the current assessment');
  await tab(raw, 'SSP').click();
  await requireOnScreen(raw, '#sspGenerateBtn', 'SSP generate button', 15_000, 'ces-eo ui/src/screens/ssp');
  await raw.click('#sspGenerateBtn');
  await raw.getByText(/SSP generated/).first().waitFor({ state: 'visible', timeout: 120_000 });
  await shot(ctx, 'eo-ssp-01-generated.png');
  await ctx.caption('Download the DOCX: the document an assessor reads');
  const docx = await clickAndSave(ctx, '#sspExportDocxBtn', 120_000);
  writeFacts(ctx, 'eo-ssp.json', { docx: path.basename(docx), bytes: fs.statSync(docx).size });
  return { ok: true };
}

/** Step 19: upload a fictional document for one control, as the uploader (v124:110-117). */
export async function eoUpload(ctx) {
  const { cfg, raw } = ctx;
  await onSpa(ctx);
  const control = cfg.eoPeople.controlId;
  const file = path.join(ctx.workDir, 'walkthrough-upload.txt');
  fs.writeFileSync(file, `CES walkthrough upload through the EO console. SIMULATED CUSTOMER (FICTIONAL). Tenant ${cfg.tenantSlug}, control ${control}.\n`);
  await ctx.caption(`Upload: a fictional document for ${control}, as the uploader`);
  await tab(raw, 'Upload').click();
  await requireOnScreen(raw, '#ecUploadFile', 'upload form', 15_000, 'ces-eo ui/src/screens/upload');
  await raw.fill('#ecUploadControlIds', control);
  await raw.fill('#ecUploadRole', 'compliance_officer');
  await raw.setInputFiles('#ecUploadFile', file);
  await raw.click('#ecUploadBtn');
  const status = raw.locator('#ecUploadStatus');
  const deadline = Date.now() + 60_000;
  let text = '';
  while (Date.now() < deadline) {
    text = await textOf(raw, '#ecUploadStatus');
    if (text.includes(`by ${cfg.eoPeople.uploaderUpn}`)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await status.scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(ctx, 'eo-upload-01-status.png');
  const uploaded = text.includes(`by ${cfg.eoPeople.uploaderUpn}`);
  writeFacts(ctx, 'eo-upload.json', { control, uploaded, statusShownOnScreen: uploaded ? 'stored, by the named uploader' : text.slice(0, 300) });
  if (!uploaded) return { ok: false, error: `the upload status never named the uploader (last: ${JSON.stringify(text.slice(0, 200))})` };
  return { ok: true };
}

/** Step 20: review: a token for the uploader is refused on screen, then another person records met (v124:120-146). */
export async function eoReview(ctx) {
  const { cfg, raw } = ctx;
  await onSpa(ctx);
  const { controlId: control, objectiveId: objective, uploaderUpn, reviewerUpn } = cfg.eoPeople;
  const pickUpload = async () => {
    await raw.locator('#reviewControl').selectOption(control);
    await raw.getByRole('row').filter({ hasText: uploaderUpn }).last().getByRole('radio').check();
    await raw.locator('#reviewObjective').selectOption(objective);
  };
  await ctx.caption('Review rule: nobody reviews their own upload. Mint an approver token for the uploader first');
  await tab(raw, 'Tenant and access').click();
  await requireOnScreen(raw, '#mintApproverBtn', 'approver token mint', 15_000, 'ces-eo ui/src/screens/access/index.tsx');
  await raw.fill('#approverUpn', uploaderUpn);
  await raw.click('#mintApproverBtn');
  await raw.getByText(/Approver token minted for/).first().waitFor({ state: 'visible', timeout: 30_000 });
  await tab(raw, 'Review').click();
  await requireOnScreen(raw, '#reviewControl', 'review form', 15_000, 'ces-eo ui/src/screens/review');
  await pickUpload();
  const block = await textOf(raw, '#reviewBlock');
  const selfRefused = block.includes('Another person must review it') && (await raw.locator('#reviewSubmitBtn').isDisabled());
  await shot(ctx, 'eo-review-01-self-refused.png');
  await ctx.caption('Refused on screen. Now the reviewer, a different person, gets the approver token');
  await tab(raw, 'Tenant and access').click();
  await raw.fill('#approverUpn', reviewerUpn);
  await raw.click('#mintApproverBtn');
  await raw.getByText(new RegExp(`Approver token minted for ${reviewerUpn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first().waitFor({ state: 'visible', timeout: 30_000 });
  await tab(raw, 'Review').click();
  await pickUpload();
  await raw.locator('#reviewVerdict').selectOption('met');
  await ctx.caption(`The reviewer records "met" for ${objective}`);
  await raw.click('#reviewSubmitBtn');
  const deadline = Date.now() + 60_000;
  let status = '';
  while (Date.now() < deadline) {
    status = await textOf(raw, '#reviewStatus');
    if (status.includes('Review recorded')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await shot(ctx, 'eo-review-02-recorded.png');
  const recorded = status.includes('Review recorded');
  writeFacts(ctx, 'eo-review.json', { control, objective, selfReviewRefused: selfRefused, reviewRecorded: recorded });
  if (!selfRefused) return { ok: false, error: 'the self-review was not refused on screen (GD-b rule)' };
  if (!recorded) return { ok: false, error: `the review was not recorded (last: ${JSON.stringify(status.slice(0, 200))})` };
  return { ok: true };
}

/** Step 21: assess again so the review counts, then the assessor view (v124:149-157). */
export async function eoAssessor(ctx) {
  const { cfg, raw } = ctx;
  await onSpa(ctx);
  const control = cfg.eoPeople.controlId;
  await ctx.caption('Assess again so the review counts');
  await tab(raw, 'Assess').click();
  await requireOnScreen(raw, '#assessBtn', 'assess button', 15_000, 'ces-eo ui/src/screens/assess');
  const before = await raw.getByText(/Evidence assessment complete\. SPRS:/).count();
  await raw.click('#assessBtn');
  const deadline = Date.now() + 300_000;
  while ((await raw.getByText(/Evidence assessment complete\. SPRS:/).count()) <= before && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if ((await raw.getByText(/Evidence assessment complete\. SPRS:/).count()) <= before) {
    return { ok: false, error: 'the assessment did not complete within 5 minutes' };
  }
  const sprs = await textOf(raw, '#metricSprs');
  await shot(ctx, 'eo-assessor-01-assessed.png');
  await ctx.caption('Assessor view: what an assessor sees for each control');
  await tab(raw, 'Assessor view').click();
  await requireOnScreen(raw, '#assessorControls', 'assessor control table', 30_000, 'ces-eo ui/src/screens/assessor');
  const rowText = await textOf(raw, `#assessorControls tr:has-text("${control}")`);
  const row = raw.locator('#assessorControls tr', { hasText: control }).first();
  await row.scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(ctx, 'eo-assessor-02-view.png');
  writeFacts(ctx, 'eo-assessor.json', { control, sprsAfterReview: sprs, assessorRow: rowText.replace(/\s+/g, ' ').slice(0, 400) });
  if (!rowText.includes(control)) return { ok: false, error: `the assessor view has no row for ${control}` };
  return { ok: true };
}
