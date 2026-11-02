// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the second real live op: EO, on stage as **"Assessment"**
 * (THREAD_HANDOFF "Stage naming + show format", binding). Assessment is one of
 * the two capabilities the founder ruled must be demoed LIVE — "operate the
 * real interface to prove key points" — so this op drives the EO SPA in the app
 * pane, as an assessor does.
 *
 * ## Why the op has two phases
 *
 * The expensive thing EO does is the assess itself. The cheap, *visual* thing —
 * the part worth a stage moment — is walking the RESULT: the control-compliance
 * matrix, one family's NOT-MET determinations, then the SPRS score. So this
 * single op id branches on the slide's own op mode, which is the mode the
 * founder authored in the deck:
 *
 * - **`warm`** (started during prep, before slide 1): tenant -> Connect ->
 *   Assess, via `runEoUiFlow`. Whatever it costs, it is paid off-stage, and its
 *   result is parked on the pane.
 * - **`live`** (when the operator arrives at the slide): NO assess. It walks the
 *   already-loaded page — dashboard metrics, per-control determinations inside a
 *   family, the SPRS hero — in seconds.
 * - **`staged`** never reaches here (`op-registry.ts` shows the replay instead).
 *
 * ## The fact that forces the design
 *
 * **The EO SPA does not hydrate an assessment on page load.** `renderFamilyTable`
 * / `loadSprsDetail` are reached only from `loadFullAssessment()`, which is
 * called only from the `assess_summary` SSE handler (ces-eo
 * `public/index.html`, the INIT block at its foot calls `loadTenants()`,
 * `loadCommandRegistry()`, `checkHealth()` — and nothing else). A reload after a
 * warm assess therefore shows `--` tiles and an empty matrix even though the
 * server still has the snapshot.
 *
 * Two consequences, both load-bearing:
 *
 * 1. **The live phase must NOT navigate.** It drives tabs inside the SAME page
 *    the warm phase left hydrated. `op-registry.ts`'s rule that a slide with no
 *    op leaves the pane untouched is what makes that survivable across the
 *    narration slides in between.
 * 2. **It self-heals rather than lying.** If the pane is not on a hydrated EO
 *    page when the live slide arrives (deck authored with no warm slide; an
 *    `ao-registry` op navigated the pane away in between), the op says so and
 *    runs the real assess itself. Slower, still real. It never shows an empty
 *    matrix and narrates a result.
 *
 * ## Numbers
 *
 * The DOM is what the audience sees; the numbers this op LOGS come from the
 * server's own API (`/api/assessment`, `/api/sprs`) over absolute URLs, per the
 * house rule GP-DEMO-3 set for every EO surface. `UiPage.getJson` is
 * deliberately given absolute URLs: the app pane's browser context is created
 * with no `baseURL` (`ui-page.ts` `openPositionedUiPage`), so a relative path
 * would reject rather than resolve.
 */

import { runEoUiFlow, EO_SELECTORS } from '../../eo-ui-driver.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { eoTenantUrl } from '../../eo-tenant-url.js';
import { captureScreenshot, sleep, waitForText, type UiPage } from '../../ui-page.js';
import { hudSurfaceOf } from '../app-pane.js';
import { formatElapsed, hudTicker, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['eo-review'];

/** The HUD title for the assess — the stage name (THREAD_HANDOFF), binding. */
export const EO_ASSESS_HUD_TITLE = 'Assessment · EO';

/**
 * Selectors for the RESULT surfaces, verified against ces-eo
 * `public/index.html`. They live here rather than in `eo-ui-driver.ts` because
 * that driver is a GP-DEMO-3 module owned by the e2e leg; this slice adds a
 * browse, not a new capability to the shared driver.
 */
export const EO_REVIEW_SELECTORS = {
  /** `.nav-tab[data-page="..."]` — the SPA's own tab buttons. */
  tab: (page: string) => `.nav-tab[data-page="${page}"]`,
  metricMet: '#metricMet',
  metricNotMet: '#metricNotMet',
  metricPartial: '#metricPartial',
  metricNotAssessed: '#metricNotAssessed',
  familyTableBody: '#familyTableBody',
  controlRows: '#familyTableBody tr.control-sub-row',
  /** A family's NOT-MET count, which is also the filter control. */
  familyNotMetLink: (family: string) => `#familyTableBody .family-filter-link[data-family="${family}"][data-filter="not_met"]`,
  familyRows: (family: string) => `#familyTableBody tr.control-sub-row[data-family="${family}"]`,
  sprsScore: '#sprsDetailScore',
  sprsCertPath: '#sprsCertPath',
  sprsMet: '#sprsMetMet',
  sprsNotMet: '#sprsMetNotMet',
  sprsDeductionRows: '#sprsDeductionsBody tr',
} as const;

/**
 * The family the live browse opens. IA (Identification & Authentication) is the
 * family the whole demo narrative turns on — it is where the MFA control the AO
 * and Stamper beats remediate lives (`DEMO_MFA_CONTROL_ID` is `IA.L2-3.5.3`) —
 * so the determinations on screen are the ones the talk track just promised.
 */
export const EO_REVIEW_FAMILY = 'IA';

/** Short by intent: a live failure on stage must be loud in seconds, not minutes. */
const BROWSE_TIMEOUT_MS = 20_000;

/**
 * The SPA clicks the evidence-explorer tab 1500 ms after `assess_done`, which is
 * AFTER `runEoUiFlow` returns (it reads `#assessStatus`, written on the earlier
 * `assess_summary`). Anything that drives tabs immediately afterwards gets
 * yanked mid-browse by that pending timeout. Only the self-heal path can hit
 * this — a warm assess fired minutes before its slide — but it is invisible when
 * it bites, so it is waited out unconditionally after any in-op assess.
 */
const ASSESS_TAB_SWITCH_SETTLE_MS = 2_000;

export interface EoAssessNumbers {
  readonly controlsMet?: number;
  readonly controlsNotMet?: number;
  readonly controlsPartial?: number;
  readonly controlsNotAssessed?: number;
  readonly liveAssessmentCount?: number;
  readonly sprsScore?: number;
}

/** Pure: pick the numbers out of EO's `/api/assessment` + `/api/sprs` bodies. */
export function readEoNumbers(assessment: unknown, sprs: unknown): EoAssessNumbers {
  const a = (assessment ?? {}) as Record<string, unknown>;
  const s = (sprs ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  return {
    controlsMet: n(a.controls_met),
    controlsNotMet: n(a.controls_not_met),
    controlsPartial: n(a.controls_partial),
    controlsNotAssessed: n(a.controls_not_assessed),
    liveAssessmentCount: n(a.liveAssessmentCount),
    sprsScore: n(s.score) ?? n(s.sprs_score) ?? n(a.sprs_score),
  };
}

/**
 * Is the page in front of us an EO SPA carrying a rendered assessment? The
 * matrix is the tell: `renderFamilyTable` is the only thing that ever creates
 * `tr.control-sub-row`, and it only runs after an assess completes in THIS page.
 */
export async function hasRenderedAssessment(page: UiPage): Promise<boolean> {
  try {
    return (await page.count(EO_REVIEW_SELECTORS.controlRows)) > 0;
  } catch {
    return false;
  }
}

/**
 * tenant -> Connect -> Assess, in the pane. The expensive half.
 *
 * Exported (GP-DEMO-4 Slice 1C): `eo-show-change-captured` re-uses this exact
 * re-assess to capture its "after" state, rather than re-implementing the connect
 * + assess sequence and drifting from it.
 *
 * `caption` (optional, GP-DEMO-6) is the narration the caller wants standing over
 * the assess. It is emitted AFTER the goto (a load wipes the band) and differs
 * per caller — eo-review passes its warm / self-heal line, eo-show-change passes
 * its opening line — so the text lives with the caller, not here.
 */
export async function assessInPane(
  ctx: OpDriveContext,
  baseUrl: string,
  label: string,
  caption?: string,
): Promise<void> {
  await ctx.pane.goto(baseUrl);
  if (caption) await ctx.caption?.(caption);
  // GP-DEMO-6 theatre: the assess is minutes of the SPA working with little to
  // watch, so the HUD names the beat and ticks the elapsed time over it.
  const hud = hudSurfaceOf(ctx.pane);
  const ticker = hudTicker(
    hud,
    EO_ASSESS_HUD_TITLE,
    (ms) => `assessing '${ctx.armed.slug}' against the live tenant … ${formatElapsed(ms)}`,
  );
  const started = ticker.startedAt;
  let result;
  try {
    result = await runEoUiFlow(ctx.pane.page, {
      baseUrl,
      slug: ctx.armed.slug,
      // Part of the driver contract but unused by the flow — this window's
      // visibility comes from the pane's own launch, not from here.
      watch: HEADLESS_MODE,
      screenshotDir: ctx.armed.runDir,
      label,
    });
  } finally {
    ticker.stop();
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  for (const file of result.screenshots) ctx.artifact?.(file);
  ctx.log(
    `  op eo-review: assess complete in ${seconds}s ` +
      `(connect ${result.connected ? 'confirmed' : 'not confirmed — optional by the SPA’s own design'}, ` +
      `${result.screenshots.length} screenshot(s) in ${ctx.armed.runDir})`,
  );
  // Let the SPA's own post-assess tab switch fire before anything drives tabs.
  await sleep(ASSESS_TAB_SWITCH_SETTLE_MS);
  // Log the resulting numbers from the server's OWN API, in the same format the
  // live walk uses — so a warm-only leg still records what it produced. This is
  // the source `eo-show-change-captured` (D.16) compares its captured
  // `eo-before.json` against (EC2). Stub-safe: a hand-written UiPage returns
  // undefined for getJson, and we simply do not log a numbers line then.
  const [assessment, sprs] = await Promise.all([
    ctx.pane.page.getJson(eoTenantUrl(baseUrl, '/api/assessment', ctx.armed.slug)).catch(() => undefined),
    ctx.pane.page.getJson(eoTenantUrl(baseUrl, '/api/sprs', ctx.armed.slug)).catch(() => undefined),
  ]);
  if (assessment !== undefined || sprs !== undefined) {
    const numbers = readEoNumbers(assessment, sprs);
    ctx.log(
      `  op eo-review: API — met ${numbers.controlsMet ?? '?'}, not met ${numbers.controlsNotMet ?? '?'}, ` +
        `SPRS ${numbers.sprsScore ?? '?'}, ${numbers.liveAssessmentCount ?? 0} live assessment(s)` +
        ((numbers.liveAssessmentCount ?? 0) > 0 ? '' : ' — LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers'),
    );
    if (hud) {
      // The same API numbers the log carries — never DOM-scraped, never a guess.
      await paneHud.show(
        hud,
        EO_ASSESS_HUD_TITLE,
        `assessed in ${seconds}s — ${numbers.controlsMet ?? '?'} met / ${numbers.controlsNotMet ?? '?'} not met · SPRS ${numbers.sprsScore ?? '?'}`,
      );
    }
  } else if (hud) {
    await paneHud.show(hud, EO_ASSESS_HUD_TITLE, `assessed in ${seconds}s`);
  }
}

/**
 * The stage moment: walk the assessment that already exists. Dashboard tiles ->
 * one family's NOT-MET determinations -> the SPRS score. No assess, no reload.
 */
/** Where the walk ENDS. Every landing walks the matrix and the family first. */
export type EoReviewLanding = 'dashboard' | 'evidence' | 'sprs';

async function browseInPane(ctx: OpDriveContext, baseUrl: string): Promise<void> {
  const page = ctx.pane.page;
  // The walk's own tiles carry the numbers from here; the assess HUD steps aside.
  const hud = hudSurfaceOf(ctx.pane);
  if (hud) await paneHud.hide(hud);
  // The live walk does NOT navigate (the SPA cannot rehydrate on load), so each
  // caption is emitted before its own tab verb — reading the way an assessor does.
  await ctx.caption?.(CAP.liveWalk[0]);
  // Declared in the deck's `params` cell; the catalog supplies the defaults, so
  // a deck that sets no params behaves exactly as it did before params existed.
  const family = String(ctx.slide.op.params?.family ?? EO_REVIEW_FAMILY);
  const landing = String(ctx.slide.op.params?.land ?? 'sprs') as EoReviewLanding;
  const shot = async (name: string): Promise<string | undefined> => {
    const file = await captureScreenshot(page, ctx.armed.runDir, `eo-review-${name}`);
    if (file) ctx.artifact?.(file);
    return file;
  };

  // 1. The determinations, in aggregate.
  await ctx.caption?.(CAP.liveWalk[1]);
  await page.click(EO_REVIEW_SELECTORS.tab('dashboard'));
  const met = await waitForText(page, EO_REVIEW_SELECTORS.metricMet, /^\d+$/, {
    timeoutMs: BROWSE_TIMEOUT_MS,
    what: 'the EO dashboard MET tile (#metricMet)',
  });
  const notMet = (await page.textContent(EO_REVIEW_SELECTORS.metricNotMet))?.trim() ?? '?';
  const partial = (await page.textContent(EO_REVIEW_SELECTORS.metricPartial))?.trim() ?? '?';
  const notAssessed = (await page.textContent(EO_REVIEW_SELECTORS.metricNotAssessed))?.trim() ?? '?';
  await shot('01-compliance-matrix.png');

  // 2. One objective at a time: filter a family down to its NOT-MET rows. This
  //    is the "walk to per-objective determinations" beat — every row is one
  //    control id, its approach, its status badge and its SPRS deduction.
  const rowsBefore = await page.count(EO_REVIEW_SELECTORS.familyRows(family));
  let familyLine = `${family} family not shown`;
  if (rowsBefore > 0) {
    await ctx.caption?.(CAP.liveWalk[2]);
    await page.click(EO_REVIEW_SELECTORS.familyNotMetLink(family));
    const shown = await page.texts(EO_REVIEW_SELECTORS.familyRows(family));
    familyLine = `${family} ${rowsBefore} control(s), filtered to NOT MET`;
    ctx.log(`  op eo-review: ${family} determinations — ${shown.length} row(s) in the matrix`);
    await shot('02-family-determinations.png');
  }

  // 3. Where the walk ENDS, per the deck's `land` parameter. `sprs` is the
  //    default and the beat that answers the question customers actually ask;
  //    `evidence` ends on the Evidence Explorer; `dashboard` stays on the
  //    matrix. Steps 1 and 2 happen either way — the landing is the ending, not
  //    a different walk.
  let score = '(not opened)';
  let certPath = '';
  let deductions = 0;
  if (landing === 'sprs') {
    await ctx.caption?.(CAP.liveWalk[3]);
    await page.click(EO_REVIEW_SELECTORS.tab('sprs'));
    score = await waitForText(page, EO_REVIEW_SELECTORS.sprsScore, /^-?\d+$/, {
      timeoutMs: BROWSE_TIMEOUT_MS,
      what: 'the SPRS score (#sprsDetailScore)',
    });
    certPath = (await page.textContent(EO_REVIEW_SELECTORS.sprsCertPath))?.trim() ?? '';
    deductions = await page.count(EO_REVIEW_SELECTORS.sprsDeductionRows);
    await shot('03-sprs.png');
  } else if (landing === 'evidence') {
    // The SPA's Evidence Explorer tab is `data-page="evidence-explorer"`
    // (ces-eo `public/index.html` L1471), NOT `"evidence"`. The old value never
    // matched a tab and the walk timed out — GP-DEMO-4 Slice 1A runtime-verify
    // caught it. The tab fetches `/api/evidence-explorer/index` on activation,
    // so let that render before the screenshot rather than capturing "Loading…".
    await page.click(EO_REVIEW_SELECTORS.tab('evidence-explorer'));
    await sleep(ASSESS_TAB_SWITCH_SETTLE_MS);
    await shot('03-evidence.png');
  } else {
    await shot('03-dashboard.png');
  }

  // The narrated numbers come from the API, never from the DOM. Absolute URLs:
  // the pane's context has no `baseURL` (`ui-page.ts`).
  const [assessment, sprs] = await Promise.all([
    page.getJson(eoTenantUrl(baseUrl, '/api/assessment', ctx.armed.slug)).catch(() => undefined),
    page.getJson(eoTenantUrl(baseUrl, '/api/sprs', ctx.armed.slug)).catch(() => undefined),
  ]);
  const numbers = readEoNumbers(assessment, sprs);

  ctx.log(
    `  op eo-review: on screen — ${met} met / ${notMet} not met / ${partial} partial / ${notAssessed} not assessed; ` +
      `${familyLine}; landed on ${landing}` +
      (landing === 'sprs'
        ? `; SPRS ${score} (${certPath || 'no certification path shown'}), ${deductions} deduction row(s)`
        : ''),
  );
  ctx.log(
    `  op eo-review: API — met ${numbers.controlsMet ?? '?'}, not met ${numbers.controlsNotMet ?? '?'}, ` +
      `SPRS ${numbers.sprsScore ?? '?'}, ${numbers.liveAssessmentCount ?? 0} live assessment(s)` +
      ((numbers.liveAssessmentCount ?? 0) > 0 ? '' : ' — LIVE SIGNAL LEG DID NOT RUN; do not narrate these numbers'),
  );
}

/**
 * `eo-review` — Assessment, in the app pane. `warm` assesses; `live` proves.
 */
export async function runEoReviewOp(ctx: OpDriveContext): Promise<void> {
  const baseUrl = ctx.armed.eoBaseUrl;
  if (!baseUrl) {
    throw new Error('the EO server is not armed — prep did not start it (see arm-eo.ts / arm-sim.ts)');
  }

  if (ctx.slide.op.mode === 'warm') {
    ctx.log(`  op eo-review (warm): assessing '${ctx.armed.slug}' at ${baseUrl} — the expensive half, off stage`);
    await assessInPane(ctx, baseUrl, 'eo-review-warm', CAP.warm[0]);
    return;
  }

  ctx.log(`  op eo-review (live): reviewing the assessment at ${baseUrl}`);
  if (!(await hasRenderedAssessment(ctx.pane.page))) {
    // Honest, loud, and real: the SPA cannot rehydrate an assessment from a
    // page load, so the only truthful way to have one on screen is to run it.
    ctx.log(
      '  op eo-review (live): the pane is not showing a rendered assessment ' +
        '(no warm slide ran, or another op navigated the pane away) — running the assess LIVE now',
    );
    await assessInPane(ctx, baseUrl, 'eo-review-live-recover', CAP.selfHeal[0]);
    // The recovery flow re-selects the tenant, so the SPA is back in the same
    // state the warm path leaves behind.
    await ctx.pane.page.waitForSelector(EO_SELECTORS.tenantOption(ctx.armed.slug), BROWSE_TIMEOUT_MS);
  }

  await browseInPane(ctx, baseUrl);
}
