// Muster driver steps (PLAN.md section 3, rows 2-9). Selectors and order copied from the module's own watched spec,
// ces-muster\e2e\flow7-muster-ui.spec.ts (lines cited per step). Every action happens on the Muster screens; the only
// file reads are the scenario's own answer and organisation files, which a person would type or attach.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotDrivable, requireOnScreen, shot, clickAndSave, writeFacts, textOf, tid, browserUrl } from './common.mjs';

const CONFIRMER = 'Walkthrough operator (simulated)';

function answersOf(cfg) {
  const rows = JSON.parse(fs.readFileSync(path.join(cfg.customerDir, 'interview-answers.json'), 'utf8'));
  return new Map(rows.map((a) => [a.question_id, a]));
}
function orgOf(cfg) {
  return JSON.parse(fs.readFileSync(path.join(cfg.customerDir, 'org-content.json'), 'utf8'));
}

/** Step 2: point the SPA at muster-api, open the Discovery tab, sign in (flow7:144-155). */
export async function muSignin(ctx) {
  const { cfg, raw } = ctx;
  // Shape B: muster-api is reached through the Muster forwarder's own /api (same origin, so no CORS question).
  const api = ctx.engine?.remote ? `${browserUrl(ctx, 'muster')}/api` : `${cfg.urls.musterApi.replace(/\/+$/, '')}/api`;
  if (!ctx.state.musterInitScript) {
    await raw.addInitScript((u) => localStorage.setItem('muster-api-url', u), api);
    ctx.state.musterInitScript = true;
  }
  await ctx.caption('Muster: open the Discovery tab and sign in to muster-api');
  await raw.goto(browserUrl(ctx, 'muster'), { waitUntil: 'domcontentloaded' });
  await requireOnScreen(raw, tid('nav-tab-discovery'), 'Discovery tab', 30_000, 'ces-muster ShellNav.tsx');
  await raw.locator(tid('nav-tab-discovery')).click();
  await requireOnScreen(raw, tid('muster-signin-email'), 'muster-api sign-in form', 20_000, 'ces-muster discovery sign-in');
  await raw.locator(tid('muster-signin-email')).fill(cfg.musterOperator.login);
  await raw.locator(tid('muster-signin-password')).fill(cfg.musterOperator.password);
  await raw.locator(tid('muster-signin-btn')).click();
  await raw.locator(tid('muster-signin-state')).waitFor({ state: 'visible', timeout: 30_000 });
  await ctx.caption('Signed in: Muster now talks to muster-api for discovery, compile and push');
  await shot(ctx, 'mu-signin-01-signed-in.png');
  return { ok: true };
}

/** Step 3: run discovery for the slug from the Discovery tab, wait, continue (flow7:156-160). */
export async function muDiscovery(ctx) {
  const { cfg, raw } = ctx;
  await requireOnScreen(raw, tid('discovery-tenant-slug'), 'discovery tenant field', 20_000, 'ces-muster DiscoveryOffer.tsx');
  await ctx.caption(`Discovery: read-only walk of the simulated tenant ${cfg.tenantSlug} through muster-api`);
  await raw.locator(tid('discovery-tenant-slug')).fill(cfg.tenantSlug);
  const t0 = Date.now();
  await raw.locator(tid('discovery-run-btn')).click();
  await raw.locator(tid('discovery-sub-tab')).waitFor({ state: 'visible', timeout: 8 * 60_000 });
  const ms = Date.now() - t0;
  await shot(ctx, 'mu-discovery-01-result.png');
  await ctx.caption('Discovery finished: continue to the boundary drafts it produced');
  await raw.locator(tid('discovery-continue-btn')).click();
  await raw.locator(tid('boundary-confirm-panel')).waitFor({ state: 'visible', timeout: 30_000 });
  const drafts = await raw.locator('[data-testid^="boundary-draft-"]').count();
  writeFacts(ctx, 'mu-discovery.json', { tenantSlug: cfg.tenantSlug, discoveryMs: ms, boundaryPanelVisible: true, boundaryDrafts: drafts });
  return { ok: true };
}

/** Step 4: confirm or correct each CUI boundary draft, download the record, continue (flow7:163-182). */
export async function muBoundary(ctx) {
  const { cfg, raw } = ctx;
  const byId = answersOf(cfg);
  await requireOnScreen(raw, tid('boundary-confirm-panel'), 'CUI boundary confirm panel', 20_000, 'ces-muster BoundaryConfirmPanel.tsx');
  await ctx.caption('CUI boundary: a named person confirms or corrects each draft the machine inferred');
  await raw.locator(tid('boundary-confirmer-name')).fill(CONFIRMER);
  const decisions = [];
  for (const draft of await raw.locator('[data-testid^="boundary-draft-"]').all()) {
    const id = ((await draft.getAttribute('data-testid')) ?? '').replace('boundary-draft-', '');
    const want = byId.get(id)?.answer;
    if (want) {
      await raw.locator(tid(`boundary-correct-${id}`)).click();
      const option = raw.locator(tid(`boundary-correct-${id}-${want}`));
      if ((await option.count()) > 0) {
        await option.click();
        decisions.push({ question_id: id, decision: `correct:${want}` });
        continue;
      }
    }
    await raw.locator(tid(`boundary-confirm-${id}`)).click();
    decisions.push({ question_id: id, decision: 'confirm' });
  }
  await shot(ctx, 'mu-boundary-01-confirmed.png');
  if ((await raw.locator(tid('boundary-download-record')).count()) > 0 && (await raw.locator(tid('boundary-download-record')).isEnabled())) {
    await clickAndSave(ctx, tid('boundary-download-record'));
  }
  writeFacts(ctx, 'mu-boundary.json', { confirmer: CONFIRMER, decisions });
  await ctx.caption('Boundary attested: continue to the situation questions');
  await raw.locator(tid('boundary-continue-btn')).click();
  return { ok: true };
}

/** Step 5: strategic intent on the Situation screen: profile, services, manifest; Begin Interview stays unclicked (flow7:185-198). */
export async function muIntent(ctx) {
  const { cfg, raw } = ctx;
  const p = orgOf(cfg).profile ?? {};
  const slug = cfg.tenantSlug;
  await requireOnScreen(raw, 'input[type="radio"][name="engagement_kind"]', 'Situation profile', 30_000, 'ces-muster AssessmentPage.tsx');
  await ctx.caption('Strategic intent: who the organisation is and what it runs');
  await raw.locator(`input[type="radio"][name="engagement_kind"][value="${p.engagement_kind ?? 'individual_contractor'}"]`).check();
  await raw.locator('input[placeholder="Acme Defense LLC"]').fill(p.org_name ?? slug);
  if (p.uei) await raw.locator('input[placeholder="12-char UEI"]').fill(p.uei);
  if (p.cage) await raw.locator('input[placeholder="5-char CAGE"]').fill(p.cage);
  if (p.covers_m365) await raw.locator(`input[type="radio"][name="covers_m365"][value="${p.covers_m365}"]`).check();
  await raw.locator(`input[type="radio"][name="on_prem_ot"][value="${p.on_prem_ot ?? 'no'}"]`).check();
  if (p.has_ssp) await raw.locator(`input[type="radio"][name="has_ssp"][value="${p.has_ssp}"]`).check();
  await ctx.caption('Services in scope: the stack tiles the plan will be written for');
  const services = ['m365_e5_gcc', 'microsoft_intune', 'microsoft_sentinel'];
  for (const s of services) await raw.locator(tid(`service-${s}`)).check();
  await ctx.caption('Session manifest: which tenant, what kind, who is operating');
  await raw.locator(tid('rm-tenant-slug')).fill(slug);
  await raw.locator(tid('rm-tenant-kind')).selectOption('sim');
  await raw.locator(tid('rm-operator-name')).fill(CONFIRMER);
  const readback = {
    orgName: await raw.locator('input[placeholder="Acme Defense LLC"]').inputValue(),
    engagementKind: p.engagement_kind ?? 'individual_contractor',
    services,
    tenantSlug: await raw.locator(tid('rm-tenant-slug')).inputValue(),
    tenantKind: await raw.locator(tid('rm-tenant-kind')).inputValue(),
    operatorName: await raw.locator(tid('rm-operator-name')).inputValue(),
    beginInterviewReachable: await raw.locator(tid('begin-interview')).isVisible(),
  };
  await shot(ctx, 'mu-intent-01-situation.png');
  writeFacts(ctx, 'mu-intent-manifest.json', readback);
  return { ok: true };
}

/** Step 6: Begin Interview, type every answer the screen shows, "I don't know" for the rest (flow7:199-243). */
export async function muInterview(ctx) {
  const { cfg, raw } = ctx;
  const answers = answersOf(cfg);
  await requireOnScreen(raw, tid('begin-interview'), 'Begin Interview button', 20_000, 'ces-muster AssessmentPage.tsx');
  await ctx.caption('Interview: begin, then type each answer the customer gave');
  await raw.locator(tid('begin-interview')).click();
  await raw.locator('.question-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  const record = { typed: [], kept_discovery: [], not_shown: [], defaulted: [] };
  const remaining = new Set(answers.keys());
  const tabs = raw.locator('[data-testid^="tab-"]:not([data-testid="tab-profile"])');
  for (let pass = 0; pass < 4 && remaining.size > 0; pass++) {
    let progressed = false;
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      for (const card of await raw.locator('[data-question-id]').all()) {
        const id = (await card.getAttribute('data-question-id')) ?? '';
        const a = answers.get(id);
        if (!a || !remaining.has(id)) continue;
        const prov = await card.getAttribute('data-provenance');
        if (prov && prov !== 'operator_interview') {
          record.kept_discovery.push(id);
        } else {
          await ctx.caption(`Typing ${id}`);
          const radio = card.locator(`input[type="radio"][value="${String(a.answer).replace(/"/g, '\\"')}"]`);
          if ((await radio.count()) > 0) {
            await radio.check();
          } else {
            const input = card.locator(tid(`plan-input-${id}`));
            await input.fill(String(a.answer));
            await input.press('Enter');
          }
          record.typed.push(id);
        }
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  record.not_shown = [...remaining];
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    for (const card of await raw.locator('[data-question-id]').all()) {
      const id = (await card.getAttribute('data-question-id')) ?? '';
      if ((await card.locator('input[type="radio"]').count()) === 0) continue;
      if ((await card.locator('input[type="radio"]:checked').count()) > 0) continue;
      const unknown = card.locator('input[type="radio"][value="unknown"]');
      if ((await unknown.count()) === 0) continue;
      await ctx.caption(`Not in the customer's answers: ${id} is answered "I don't know"`);
      await unknown.check();
      record.defaulted.push(id);
    }
  }
  await ctx.caption(`Typed ${record.typed.length}; kept from discovery ${record.kept_discovery.length}; "I don't know" ${record.defaulted.length}`);
  const finish = raw.locator(tid('finish-interview'));
  await finish.waitFor({ state: 'visible', timeout: 10_000 });
  const deadline = Date.now() + 10_000;
  while (!(await finish.isEnabled()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  record.finishEnabled = await finish.isEnabled();
  await shot(ctx, 'mu-interview-01-answered.png');
  writeFacts(ctx, 'mu-interview.json', record);
  if (!record.finishEnabled) return { ok: false, error: 'Finish stayed disabled: an open question still gates it (see mu-interview.json)' };
  return { ok: true };
}

/**
 * Step 7 guard: true when the Muster window already shows the readiness result, so "Finish & Score" was pressed by
 * hand between steps (the window is a real browser; the page waits for the next press). The engine's op would then
 * wait 30 s for a button that is no longer on the screen (DC-FAILURES.md, 2026-11-04 step 7).
 */
export async function interviewAlreadyFinished(ctx) {
  const { raw } = ctx;
  if ((await raw.locator(tid('finish-interview')).count()) > 0) return false;
  return (await raw.locator(tid('conservative-score')).count()) > 0;
}

/**
 * Step 7 when the interview was finished by hand: export the readiness result the way the engine's op does and
 * record the same facts (muster-sprs.json, plus finishedByHand) so the step's outputs read the same.
 */
export async function muFinishExportOnly(ctx) {
  const { raw } = ctx;
  await ctx.caption('Finish & Score was already pressed in the Muster window; exporting the readiness result it produced');
  const scoreText = await textOf(raw, tid('conservative-score'));
  const saved = await clickAndSave(ctx, tid('export-readiness-result'));
  await shot(ctx, 'muster-sprs-05-result.png');
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(saved, 'utf8')); } catch { payload = {}; }
  const sprs = payload.derived?.sprs_now?.sprs;
  const payloadSprs = typeof sprs === 'number' ? sprs : null;
  const m = /(-?\d+)% compliant/.exec(scoreText);
  writeFacts(ctx, 'muster-sprs.json', {
    exportedArtifact: path.basename(saved),
    schemaVersion: payload.schema_version ?? '(none)',
    payloadSprs,
    domScoreText: scoreText,
    domScorePercent: m ? Number(m[1]) : null,
    finishedByHand: true,
  });
  ctx.log(`  finish: the interview was finished by hand before this step; exported ${path.basename(saved)}; SPRS ${payloadSprs ?? '?'} read from the payload; on screen "${scoreText}"`);
}

/** Step 7, after the op: the remaining exports and the Readiness tab download (flow7:248-254). */
export async function muFinishExtras(ctx) {
  const { raw } = ctx;
  await ctx.caption('Exports: the status payload and the evidence package, then the Readiness tab');
  for (const id of ['export-status-payload', 'export-evidence-package']) {
    if ((await raw.locator(tid(id)).count()) > 0) await clickAndSave(ctx, tid(id));
  }
  await raw.locator(tid('nav-tab-readiness')).click();
  await raw.locator(tid('readiness-report')).waitFor({ state: 'visible', timeout: 15_000 });
  await shot(ctx, 'mu-finish-02-readiness.png');
  if ((await raw.locator(tid('readiness-download-result')).count()) > 0) await clickAndSave(ctx, tid('readiness-download-result'));
}

/** Step 8: Plan tab, attach the organisation content, compile through muster-api (flow7:257-270). */
export async function muCompile(ctx) {
  const { cfg, raw } = ctx;
  await raw.locator(tid('nav-tab-plan')).click();
  await requireOnScreen(raw, tid('plan-api-compile-btn'), 'Plan compile button', 20_000, 'ces-muster plan screen (apiCompile.ts)');
  await ctx.caption('Plan: compile the Mission Plan through muster-api (discovery runs again, read-only)');
  await raw.locator(tid('muster-signin-state')).waitFor({ state: 'visible', timeout: 15_000 });
  const slugShown = await textOf(raw, tid('plan-api-slug'));
  await raw.locator(tid('plan-api-org-content')).setInputFiles(path.join(cfg.customerDir, 'org-content.json'));
  await raw.locator(tid('plan-api-org-content-name')).waitFor({ state: 'visible', timeout: 15_000 });
  const t0 = Date.now();
  await raw.locator(tid('plan-api-compile-btn')).click();
  await raw.locator(tid('plan-api-result')).waitFor({ state: 'visible', timeout: 15 * 60_000 });
  const summary = await textOf(raw, tid('plan-api-compile-summary'));
  await shot(ctx, 'mu-compile-01-compiled.png');
  await ctx.caption('Downloads: the CUI Boundary and the answers that were sent');
  if ((await raw.locator(tid('plan-api-download-cui-boundary')).count()) > 0) await clickAndSave(ctx, tid('plan-api-download-cui-boundary'));
  if ((await raw.locator(tid('plan-api-download-answers')).count()) > 0) await clickAndSave(ctx, tid('plan-api-download-answers'));
  writeFacts(ctx, 'mu-compile.json', { slugShown, compileMs: Date.now() - t0, summary });
  return { ok: true };
}

/** Step 9: send the plan to Stamper and EvidenceOps (flow7:271-274). */
export async function muPush(ctx) {
  const { cfg, raw } = ctx;
  await requireOnScreen(raw, tid('plan-api-push-btn'), 'Send to Stamper button', 20_000, 'ces-muster plan screen (apiCompile.ts)');
  await ctx.caption('Push: send the plan to Stamper and EvidenceOps through muster-api');
  await raw.locator(tid('plan-api-push-btn')).click();
  await raw.locator(tid('plan-api-push-success')).waitFor({ state: 'visible', timeout: 3 * 60_000 });
  const pushed = await textOf(raw, tid('plan-api-pushed'));
  await shot(ctx, 'mu-push-01-pushed.png');
  if (ctx.engine?.remote) {
    // Shape B: no shared folder. The screen names what was pushed; Stamper's own answer confirms it when its token is set.
    const listed = ctx.http && (await ctx.http.moduleJson(cfg, 'stamper', `/api/plan-data-paths?tenant=${encodeURIComponent(cfg.tenantSlug)}`));
    const name = (p) => (typeof p === 'string' ? p.replace(/\\/g, '/').split('/').pop() : null);
    writeFacts(ctx, 'mu-push.json', { pushed, stamperLists: listed ? { missionPlan: name(listed.missionPlan), manifest: name(listed.manifest) } : 'not read (Stamper token not set or Stamper did not answer)' });
    if (!/manual-mission-plan-/.test(pushed)) return { ok: false, error: `the push did not name a mission plan on screen (read ${JSON.stringify(pushed.slice(0, 200))})` };
    return { ok: true };
  }
  const plansDir = path.join(cfg.roots.pipelineRoot, 'Stamper', 'plan-data', cfg.tenantSlug, 'plans');
  const files = fs.existsSync(plansDir) ? fs.readdirSync(plansDir).filter((f) => f.endsWith('.json')).sort() : [];
  writeFacts(ctx, 'mu-push.json', { pushed, plansDir, files });
  if (!files.some((f) => f.startsWith('manual-mission-plan-'))) {
    return { ok: false, error: `the push reported success but no manual-mission-plan-*.json is under ${plansDir} (is the walkthrough on the machine that runs muster-api, with the same CES_PIPELINE_ROOT?)` };
  }
  return { ok: true };
}

export { NotDrivable };
