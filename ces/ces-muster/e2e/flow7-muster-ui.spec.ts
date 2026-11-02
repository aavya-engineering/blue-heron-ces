// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FLOW-7 (FIN-32, V125, V130): the watched Muster UI run. A person's path through Muster on a
// simulator customer, driven on screen (headed, paced, captioned; video and trace kept):
//   sign in → Discovery through muster-api → boundary confirm (corrected to the customer's own
//   answers) → Situation profile + manifest → every interview answer TYPED from
//   interview-answers.json → Finish → result exports → Readiness (download) → Plan:
//   compile through muster-api (org content file attached) → CUI Boundary download →
//   Send to Stamper through muster-api → quick session, rollup import, exports.
// It writes <MUSTER_FLOW7_OUT>/flow7-run.json: typed / kept-from-discovery / not-shown answers,
// the downloads, and the push result, for H3's V125 judge (twin = the API compile and push).
//
// Live muster-api, sim tenant, no interception. Opt-in: set MUSTER_FLOW7=1 (otherwise skipped).
// Environment (no credentials or paths are written in this file):
//   MUSTER_FLOW7_SLUG          simulator customer slug (s1-mach, s2-eng, s3-def)
//   MUSTER_FLOW7_CUSTOMER_DIR  <PKG>\customers\<slug> (interview-answers.json, org-content.json)
//   MUSTER_FLOW7_API           muster-api base for the SPA, e.g. http://127.0.0.1:5101/api
//   MUSTER_FLOW7_EMAIL / _PASSWORD  an operator the harness seeded on ces.db (seed.ts)
//   MUSTER_FLOW7_OUT           folder for the run record, downloads, video and trace
//   MUSTER_FLOW7_BASE_URL      the SPA (default: the config's preview server)
//   MUSTER_FLOW7_PACE_MS       slowMo per action (default 250); MUSTER_FLOW7_HEADLESS=1 only on request
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, type Page, type Download } from '@playwright/test';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`FLOW-7: ${k} is not set`);
  return v;
};
const ENABLED = process.env.MUSTER_FLOW7 === '1';

test.skip(!ENABLED, 'FLOW-7 runs only with MUSTER_FLOW7=1 against a live muster-api and simulator');
test.use({
  headless: process.env.MUSTER_FLOW7_HEADLESS === '1',
  launchOptions: { slowMo: Number(process.env.MUSTER_FLOW7_PACE_MS ?? 250) },
  video: 'on',
  trace: 'on',
  acceptDownloads: true,
  ...(process.env.MUSTER_FLOW7_BASE_URL ? { baseURL: process.env.MUSTER_FLOW7_BASE_URL } : {}),
});

interface AnswerRow {
  question_id: string;
  answer: string;
}

// PH12-UI: what a failed run reached. The afterEach hook writes <MUSTER_FLOW7_OUT>/flow7-progress.json on every exit:
// the last caption shown, the partial record and the error. flow7-run.json (the judged record) is unchanged.
let lastCaption = 'start';
let partial: unknown = null;
test.afterEach(async ({}, testInfo) => {
  const outDir = process.env.MUSTER_FLOW7_OUT;
  if (!ENABLED || !outDir) return;
  fs.mkdirSync(outDir, { recursive: true });
  const progress = { status: testInfo.status, last_caption: lastCaption, error: testInfo.error?.message?.slice(0, 4000) ?? null, record: partial };
  fs.writeFileSync(path.join(outDir, 'flow7-progress.json'), JSON.stringify(progress, null, 2));
});

/** On-screen caption for the person watching (and the video). */
async function caption(page: Page, text: string): Promise<void> {
  lastCaption = text;
  await page.evaluate((t) => {
    let el = document.getElementById('flow7-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flow7-caption';
      el.setAttribute('role', 'status');
      el.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:99999;max-width:60vw;padding:8px 12px;' +
        'font:600 14px/1.4 system-ui,sans-serif;background:#0d1526;color:#fff;border:1px solid #fff;';
      document.body.appendChild(el);
    }
    el.textContent = `FLOW-7 · ${t}`;
  }, text);
}

async function saveDownload(dl: Download, outDir: string, record: string[]): Promise<string> {
  const file = path.join(outDir, 'downloads', dl.suggestedFilename());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await dl.saveAs(file);
  record.push(path.basename(file));
  return file;
}

async function clickAndSave(page: Page, testId: string, outDir: string, record: string[]): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return saveDownload(dl, outDir, record);
}

/** Type one answer into its card: a radio value or a typed input (committed on Enter). */
async function typeAnswer(page: Page, a: AnswerRow): Promise<'typed' | 'kept-discovery'> {
  const card = page.locator(`[data-question-id="${a.question_id}"]`);
  const prov = await card.getAttribute('data-provenance');
  // A decisive discovery answer stays (the headless merge keeps it too: answersImport.ts).
  if (prov && prov !== 'operator_interview') return 'kept-discovery';
  const radio = card.locator(`input[type="radio"][value="${a.answer.replace(/"/g, '\\"')}"]`);
  if ((await radio.count()) > 0) {
    await radio.check();
    return 'typed';
  }
  const input = card.getByTestId(`plan-input-${a.question_id}`);
  await input.fill(a.answer);
  await input.press('Enter');
  await expect(card.getByTestId(`plan-input-error-${a.question_id}`)).toHaveCount(0);
  return 'typed';
}

test('FLOW-7: Muster UI run, answers typed from the answers file, compile and push through muster-api', async ({ page }) => {
  test.setTimeout(45 * 60_000);
  const slug = env('MUSTER_FLOW7_SLUG');
  const customerDir = env('MUSTER_FLOW7_CUSTOMER_DIR');
  const outDir = env('MUSTER_FLOW7_OUT');
  fs.mkdirSync(outDir, { recursive: true });
  const answers = JSON.parse(fs.readFileSync(path.join(customerDir, 'interview-answers.json'), 'utf8')) as AnswerRow[];
  const orgContentPath = path.join(customerDir, 'org-content.json');
  const org = JSON.parse(fs.readFileSync(orgContentPath, 'utf8')) as {
    profile?: { org_name?: string; uei?: string; cage?: string; engagement_kind?: string; covers_m365?: string; on_prem_ot?: string; employee_count?: number; has_ssp?: string };
  };
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  const record = {
    schema: 'muster-flow7/run@1',
    slug,
    started_at: new Date().toISOString(),
    typed: [] as string[],
    kept_discovery: [] as string[],
    not_shown: [] as string[],
    defaulted: [] as string[],
    boundary: [] as Array<{ question_id: string; decision: string }>,
    downloads: [] as string[],
    compile_summary: null as string | null,
    pushed: null as string | null,
    axe: [] as Array<{ screen: string; violations: number }>,
  };
  partial = record;

  // The SPA calls the live muster-api (musterApi.ts: localStorage 'muster-api-url' wins).
  await page.addInitScript((api) => localStorage.setItem('muster-api-url', api), env('MUSTER_FLOW7_API'));
  await page.goto('/');
  await expect(page.locator('header#header .header-company')).toHaveText('Blue Heron Defense — Muster');

  // ── Discovery through muster-api ────────────────────────────────────────
  await page.getByTestId('nav-tab-discovery').click();
  await caption(page, 'Sign in to muster-api (operator on ces.db)');
  await page.getByTestId('muster-signin-email').fill(env('MUSTER_FLOW7_EMAIL'));
  await page.getByTestId('muster-signin-password').fill(env('MUSTER_FLOW7_PASSWORD'));
  await page.getByTestId('muster-signin-btn').click();
  await expect(page.getByTestId('muster-signin-state')).toBeVisible();
  await caption(page, `Discovery through POST /api/discovery/run (${slug}, read-only)`);
  await page.getByTestId('discovery-tenant-slug').fill(slug);
  await page.getByTestId('discovery-run-btn').click();
  await expect(page.getByTestId('discovery-sub-tab')).toBeVisible({ timeout: 8 * 60_000 });
  await page.getByTestId('discovery-continue-btn').click();

  // ── Boundary confirm: correct each draft to the customer's own answer ──
  await caption(page, 'Confirm the CUI boundary drafted from discovery');
  await expect(page.getByTestId('boundary-confirm-panel')).toBeVisible();
  await page.getByTestId('boundary-confirmer-name').fill('FLOW-7 operator (simulated)');
  for (const draft of await page.locator('[data-testid^="boundary-draft-"]').all()) {
    const id = ((await draft.getAttribute('data-testid')) ?? '').replace('boundary-draft-', '');
    const want = byId.get(id)?.answer;
    const option = want ? page.getByTestId(`boundary-correct-${id}-${want}`) : null;
    if (want) {
      await page.getByTestId(`boundary-correct-${id}`).click();
      if (option && (await option.count()) > 0) {
        await option.click();
        record.boundary.push({ question_id: id, decision: `correct:${want}` });
        continue;
      }
    }
    await page.getByTestId(`boundary-confirm-${id}`).click();
    record.boundary.push({ question_id: id, decision: 'confirm' });
  }
  await clickAndSave(page, 'boundary-download-record', outDir, record.downloads);
  await page.getByTestId('boundary-continue-btn').click();

  // ── Situation: profile, services, manifest ──────────────────────────────
  await caption(page, 'Situation: the organisation profile and the session manifest');
  const p = org.profile ?? {};
  await page.locator(`input[type="radio"][name="engagement_kind"][value="${p.engagement_kind ?? 'individual_contractor'}"]`).check();
  await page.locator('input[placeholder="Acme Defense LLC"]').fill(p.org_name ?? slug);
  if (p.uei) await page.locator('input[placeholder="12-char UEI"]').fill(p.uei);
  if (p.cage) await page.locator('input[placeholder="5-char CAGE"]').fill(p.cage);
  if (p.covers_m365) await page.locator(`input[type="radio"][name="covers_m365"][value="${p.covers_m365}"]`).check();
  await page.locator(`input[type="radio"][name="on_prem_ot"][value="${p.on_prem_ot ?? 'no'}"]`).check();
  if (p.has_ssp) await page.locator(`input[type="radio"][name="has_ssp"][value="${p.has_ssp}"]`).check();
  // The runner's default stack tiles (plan-from-discovery.ts MX_STACKS default).
  for (const s of ['m365_e5_gcc', 'microsoft_intune', 'microsoft_sentinel']) await page.getByTestId(`service-${s}`).check();
  await page.getByTestId('rm-tenant-slug').fill(slug);
  await page.getByTestId('rm-tenant-kind').selectOption('sim');
  await page.getByTestId('rm-operator-name').fill('FLOW-7 operator (simulated)');
  await page.getByTestId('begin-interview').click();
  await page.locator('.question-card').first().waitFor({ state: 'visible', timeout: 15_000 });

  // ── Interview: type every answer the screen shows ──────────────────────
  const remaining = new Set(answers.map((a) => a.question_id));
  const tabs = page.locator('[data-testid^="tab-"]:not([data-testid="tab-profile"])');
  // Answers can reveal questions (asked_when); sweep the tabs until a pass types nothing new.
  for (let pass = 0; pass < 4 && remaining.size > 0; pass++) {
    let progressed = false;
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      for (const card of await page.locator('[data-question-id]').all()) {
        const id = (await card.getAttribute('data-question-id')) ?? '';
        const a = byId.get(id);
        if (!a || !remaining.has(id)) continue;
        await caption(page, `Typing ${id} = ${a.answer.slice(0, 60)}`);
        const r = await typeAnswer(page, a);
        (r === 'typed' ? record.typed : record.kept_discovery).push(id);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  record.not_shown = [...remaining];

  // Readiness questions the file does not answer still gate Finish. Answer each still-open radio card
  // "I don't know" ('unknown') where offered (never an invented yes/no; plan-input cards without that
  // option are optional for Finish and stay open), and record it as defaulted: these
  // then travel in interview_answers, which is why V125's twin uses the UI's own answers file (S-B).
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    for (const card of await page.locator('[data-question-id]').all()) {
      const id = (await card.getAttribute('data-question-id')) ?? '';
      if ((await card.locator('input[type="radio"]').count()) === 0) continue;
      if ((await card.locator('input[type="radio"]:checked').count()) > 0) continue;
      const unknown = card.locator('input[type="radio"][value="unknown"]');
      if ((await unknown.count()) === 0) continue;
      await caption(page, `Not in the answers file: ${id} (answered "I don't know")`);
      await unknown.check();
      record.defaulted.push(id);
    }
  }
  await expect(page.getByTestId('finish-interview')).toBeEnabled({ timeout: 10_000 });
  await caption(page, `Typed ${record.typed.length}; kept from discovery ${record.kept_discovery.length}; not shown ${record.not_shown.length}`);
  await page.getByTestId('finish-interview').click();
  await page.waitForSelector('h2:has-text("Readiness Posture Result")', { timeout: 30_000 });

  // ── Result exports and Readiness ───────────────────────────────────────
  await caption(page, 'Exports: StatusPayload, readiness result and evidence package');
  const statusPayload = await clickAndSave(page, 'export-status-payload', outDir, record.downloads);
  await clickAndSave(page, 'export-readiness-result', outDir, record.downloads);
  await clickAndSave(page, 'export-evidence-package', outDir, record.downloads);
  await page.getByTestId('nav-tab-readiness').click();
  await expect(page.getByTestId('readiness-report')).toBeVisible({ timeout: 15_000 });
  await clickAndSave(page, 'readiness-download-result', outDir, record.downloads);

  // ── Plan: compile and push through muster-api ───────────────────────────
  await page.getByTestId('nav-tab-plan').click();
  await caption(page, 'Plan: compile through POST /api/plan/compile (discovery again, read-only)');
  await expect(page.getByTestId('muster-signin-state')).toBeVisible();
  await expect(page.getByTestId('plan-api-slug')).toHaveText(slug);
  await page.getByTestId('plan-api-org-content').setInputFiles(orgContentPath);
  await expect(page.getByTestId('plan-api-org-content-name')).toBeVisible();
  await page.getByTestId('plan-api-compile-btn').click();
  await expect(page.getByTestId('plan-api-result')).toBeVisible({ timeout: 15 * 60_000 });
  record.compile_summary = await page.getByTestId('plan-api-compile-summary').textContent();
  await caption(page, 'Downloads: CUI Boundary, the answers sent');
  if ((await page.getByTestId('plan-api-download-cui-boundary').count()) > 0) {
    await clickAndSave(page, 'plan-api-download-cui-boundary', outDir, record.downloads);
  }
  await clickAndSave(page, 'plan-api-download-answers', outDir, record.downloads);
  await caption(page, 'Send to Stamper through POST /api/plan/push');
  await page.getByTestId('plan-api-push-btn').click();
  await expect(page.getByTestId('plan-api-push-success')).toBeVisible({ timeout: 3 * 60_000 });
  record.pushed = await page.getByTestId('plan-api-pushed').textContent();

  // ── Secondary surfaces (V130): quick session, rollup import, exports ───
  await caption(page, 'Quick session export');
  await page.getByTestId('quick-session-nav').click();
  await expect(page.getByTestId('quick-session-view')).toBeVisible();
  if (p.engagement_kind === 'prime_and_subs') {
    await caption(page, 'Rollup: import the exported StatusPayload');
    await page.getByTestId('rollup-nav').click();
    await page.getByTestId('rollup-import-input').setInputFiles(statusPayload);
    if ((await page.getByTestId('rollup-export-csv').count()) > 0) await clickAndSave(page, 'rollup-export-csv', outDir, record.downloads);
  }

  // ── Accessibility (axe) on the kit shell screens ────────────────────────
  // @axe-core/playwright is not a declared ces-muster dependency (LOG-FIN-32 S-E); used when resolvable.
  try {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    for (const tab of ['help', 'situation', 'discovery', 'readiness', 'plan']) {
      await page.getByTestId(`nav-tab-${tab}`).click();
      // The root @axe-core/playwright types a newer Page than ces-muster's @playwright/test; the object is the same.
      const r = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa']).analyze();
      record.axe.push({ screen: tab, violations: r.violations.length });
    }
  } catch {
    record.axe.push({ screen: 'axe unavailable', violations: -1 });
  }

  fs.writeFileSync(path.join(outDir, 'flow7-run.json'), JSON.stringify({ ...record, finished_at: new Date().toISOString() }, null, 2));
  expect(record.typed.length).toBeGreaterThan(0);
  expect(record.pushed).toBeTruthy();
});
