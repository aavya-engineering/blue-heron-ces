// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `stamper-translate`: ces-stamper on stage as **"Configuration
 * (Config)"** (THREAD_HANDOFF stage naming, binding).
 *
 * ## It drives the BACKSTAGE session, never the visible pane
 *
 * Decision 11 (2026-09-07) LIFTED decision 8's no-live-Config rule: the
 * Configuration GUI may now be shown live. But it is still shown from
 * `ctx.backstage` — a second, headless, never-displayed session created by the
 * ops runner during arming (`op-registry.ts`) — and NEVER by driving
 * `ctx.pane`. Two reasons the backstage session survives the doctrine reversal:
 *
 *   1. **The execute-only fast path depends on nothing else navigating
 *      backstage** (`stamper-execute-op.ts`). A warm `stamper-translate` leaves
 *      backstage connected with `#outputPath` populated; on the shared visible
 *      pane every intervening op clobbers that state, forcing the ~12-min full
 *      flow on every execute.
 *   2. **The GUI streams from backstage, not from the pane.** A `theatrical`
 *      Config slide subscribes `GET /mirror/backstage` (`SlideOp.mirrorSource`),
 *      so the audience watches the real GUI operate without the pane's own state
 *      (a later op's result, a readout card) being disturbed.
 *
 * It touches `ctx.pane` only to render an outcome readout, and only on a `live`
 * slide (under `--pane-window` rehearsal that card is the only Config surface;
 * under the mirror it is invisible, since the stream source is backstage).
 * **If `backstage` is absent it fails loudly** — it must never quietly fall back
 * to the visible pane, because that fallback would clobber the fast-path state
 * and re-expose the Config GUI on the pane's own surface.
 *
 * ## Why the flow is composed, not called through a wrapper
 *
 * Ops never launch their own browser. `driveStamperUi` / `createStamperDriver`
 * open one; `runStamperUiFlow(page, ctx)` is the exported seam that drives a
 * page it is handed. The backstage session is created by the RUNNER, so the rule
 * holds.
 *
 * ## Two Stamper traps this op inherits and must not weaken
 *
 * 1. **Sticky dry-run** (`REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN`) — the GUI
 *    force-sets `#execTargetSelect` to `dryrun`; a first attempt reports
 *    "Complete" in 0.7 s having mutated nothing. `runStamperUiFlow` sets it to
 *    `tenant` and throws if it did not stick. That guard belongs to the execute
 *    phase, but it is the reason `phase` exists rather than a hand-rolled
 *    partial flow here.
 * 2. **The variable seed is consumed AT TRANSLATE TIME**
 *    (`stamper-plan-variables.ts`) — without it ~23 tasks fail on variables the
 *    manifest cannot supply, and it cannot be compensated for afterwards.
 *    `runStamperUiFlow` step 5 does it, before translate, which is why this op
 *    runs `'through-translate'` rather than stopping earlier.
 *
 * ## Paths are resolved ABSOLUTE
 *
 * The plan and manifest paths are typed into `#configMissionPlanPath` /
 * `#configManifestPath` and read **server-side** by the Stamper GUI child, whose
 * `cwd` is `stamperRoot`. A tester-relative string would resolve against the
 * wrong root and fail with a confusing "file not found" from the wrong repo.
 */

import * as path from 'node:path';
import { runStamperUiFlow } from '../../stamper-ui-driver.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { escapeHtml } from '../slide-render.js';
import { htmlDataUrl, hudSurfaceOf } from '../app-pane.js';
import { formatElapsed, hudTicker, paneCaption, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['stamper-translate'];

/** The HUD title on the streamed backstage session (stage name, binding). */
export const CONFIG_HUD_TITLE = 'Configuration · Stamper';

/**
 * The checked-in plan fixture, relative to the tester root. `demo:show` never
 * runs the planner wizard, so this is where the Config beat's input comes from
 * (`assets/demo-plan/README.md` carries its provenance).
 */
export const DEMO_PLAN_DIR = path.join('assets', 'demo-plan', 'demo-dib-small');
export const DEMO_MISSION_PLAN = path.join(DEMO_PLAN_DIR, 'mission-plan.json');
export const DEMO_MANIFEST = path.join(DEMO_PLAN_DIR, 'manifest.json');

/** What the visible pane shows on a `live` slide. */
export interface TranslateOutcome {
  readonly slug: string;
  readonly taskCount?: number;
  readonly missionPlanPath: string;
  readonly manifestPath: string;
  readonly seconds: string;
}

/**
 * Pull the task count out of `POST /api/translate`'s body. Best-effort and
 * deliberately un-invented: several shapes have been seen, and a count that
 * cannot be read is reported as unknown rather than guessed.
 */
export function translatedTaskCount(response: unknown): number | undefined {
  const body = (response ?? {}) as Record<string, unknown>;
  const direct = body.taskCount ?? body.task_count ?? body.totalTasks ?? body.total_tasks;
  if (typeof direct === 'number') return direct;
  for (const key of ['tasks', 'plan_tasks', 'steps']) {
    const list = body[key];
    if (Array.isArray(list)) return list.length;
  }
  const plan = body.plan as Record<string, unknown> | undefined;
  if (plan && Array.isArray(plan.tasks)) return plan.tasks.length;
  return undefined;
}

export function readoutHtml(outcome: TranslateOutcome): string {
  const count = outcome.taskCount === undefined ? '—' : String(outcome.taskCount);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Configuration — plan translated</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;}
.badge{border:1px solid #4ade80;color:#4ade80;border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
h1{font-size:22px;margin:0;font-weight:600;}
.n{font-size:56px;font-weight:700;line-height:1;}
.cap{color:#9db2cc;font-size:14px;margin:0;}
.meta{color:#6f87a6;font-size:11px;margin:0;max-width:70ch;word-break:break-all;}
code{background:#142a4a;border-radius:4px;padding:1px 6px;}
</style></head><body><div class="wrap">
<span class="badge">Configuration</span>
<h1>Mission plan translated to executable tasks</h1>
<div class="n">${escapeHtml(count)}</div>
<p class="cap">tasks compiled for <code>${escapeHtml(outcome.slug)}</code> in ${escapeHtml(outcome.seconds)}s</p>
<p class="meta">plan: ${escapeHtml(outcome.missionPlanPath)}</p>
<p class="meta">manifest: ${escapeHtml(outcome.manifestPath)}</p>
</div></body></html>`;
}

/**
 * `stamper-translate` — connect, configure, assess, seed and translate, all on
 * the backstage session. `warm` pays it off-stage; `live` does the same work and
 * then shows the readout. The Configuration UI is never displayed in either.
 */
export async function runStamperTranslateOp(ctx: OpDriveContext): Promise<void> {
  const backstage = ctx.backstage;
  if (!backstage) {
    throw new Error(
      'stamper-translate requires the backstage session, which prep did not create — ' +
        'refusing to drive the Configuration GUI in the audience-visible pane (decision 11 shows ' +
        'Config live, but from the headless backstage session streamed on /mirror/backstage, never ' +
        'the pane — the pane fallback would clobber the execute-only fast-path state). ' +
        'See armingFor() in op-registry.ts.',
    );
  }
  const baseUrl = ctx.armed.stamperBaseUrl;
  if (!baseUrl) {
    throw new Error('the Stamper Configuration GUI is not armed — prep did not start it (see arm-sim.ts)');
  }

  // Declared in the deck's `params` cell; the catalog supplies the fixture as
  // the default. Resolved ABSOLUTE, because the GUI child reads these
  // server-side with cwd = stamperRoot — a tester-relative string would resolve
  // against the wrong root.
  const missionPlanPath = path.resolve(
    ctx.options.testerRoot,
    String(ctx.slide.op.params?.missionPlan ?? DEMO_MISSION_PLAN),
  );
  const manifestPath = path.resolve(
    ctx.options.testerRoot,
    String(ctx.slide.op.params?.manifest ?? DEMO_MANIFEST),
  );

  ctx.log(
    `  op stamper-translate (${ctx.slide.op.mode}): translating the mission plan for '${ctx.armed.slug}' ` +
      `at ${baseUrl} — BACKSTAGE (headless, never displayed)`,
  );

  const live = ctx.slide.op.mode === 'live';
  await backstage.goto(baseUrl);
  // GP-DEMO-6 theatre: the backstage session streams on `/mirror/backstage`
  // for this slide, and connect → assess → translate is minutes of the GUI
  // working. The HUD names the beat and ticks over it; the GUI's own badges
  // stay the source of truth. (`hudSurfaceOf` is undefined for a test fake.)
  const hud = hudSurfaceOf(backstage);
  // Captions render on the BACKSTAGE surface (never the visible pane — that is
  // the doctrine `ctx.caption`/`hudSurfaceOf(pane)` would violate). Emitted after
  // the goto (a load wipes the band); the "during" line stands over the flow.
  await paneCaption.show(hud, live ? CAP.live[0] : CAP.warm[0]);
  if (!live) await paneCaption.show(hud, CAP.warm[1]);
  const ticker = hudTicker(
    hud,
    CONFIG_HUD_TITLE,
    (ms) => `connect → assess → translate the mission plan for '${ctx.armed.slug}' … ${formatElapsed(ms)}`,
  );
  const started = ticker.startedAt;
  let result;
  try {
    result = await runStamperUiFlow(backstage.page, {
      baseUrl,
      slug: ctx.armed.slug,
      missionPlanPath,
      manifestPath,
      pipelineRoot: path.join(ctx.armed.runDir, 'pipeline'),
      phase: 'through-translate',
      screenshotDir: ctx.armed.runDir,
      watch: HEADLESS_MODE,
    });
  } finally {
    ticker.stop();
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  for (const shot of result.screenshots) ctx.artifact?.(shot);

  const taskCount = translatedTaskCount(result.translateResponse);
  // The task list is out the other side; this stands over the ready-to-execute
  // state (warm) or names each ordered step (live).
  await paneCaption.show(hud, live ? CAP.live[1] : CAP.warm[2]);
  if (hud) {
    await paneHud.show(
      hud,
      CONFIG_HUD_TITLE,
      `translated in ${seconds}s — ${taskCount === undefined ? 'task count not reported' : `${taskCount} task(s)`} · ready to execute`,
    );
  }
  ctx.log(
    `  op stamper-translate: translated in ${seconds}s — ` +
      `${taskCount === undefined ? 'task count not reported by /api/translate' : `${taskCount} task(s)`}; ` +
      `variable seed ${result.variableSeed ? 'written before translate' : 'SKIPPED'}; ` +
      `${result.screenshots.length} screenshot(s) in ${ctx.armed.runDir}`,
  );

  if (ctx.slide.op.mode === 'live') {
    await ctx.pane.goto(
      htmlDataUrl(readoutHtml({ slug: ctx.armed.slug, taskCount, missionPlanPath, manifestPath, seconds })),
    );
  }
}
