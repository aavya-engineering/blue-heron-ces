// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `stamper-execute`: apply the translated plan against the sim.
 * Configuration on stage (THREAD_HANDOFF stage naming, binding).
 *
 * Like `stamper-translate`, this drives the **backstage** session and never the
 * audience-visible pane. Decision 11 (2026-09-07) lifted decision 8's
 * no-live-Config rule, so the Configuration GUI may now be shown live — but it is
 * streamed from the backstage session (`SlideOp.mirrorSource: backstage`,
 * `/mirror/backstage`), never by driving the pane, because the execute-only fast
 * path exists ONLY while nothing else navigates backstage. A warm execute streams
 * backstage's REAL current state (mid-run, or the completed report) into its
 * slide; the pane sees an outcome readout only on a `live` slide. §8 record-replay
 * (recording backstage during warm prep and replaying it) is OUT OF SCOPE.
 *
 * ## The phase is GUARDED, never assumed
 *
 * `execute-only` skips connect + config + assess + seed + translate (≈5 minutes
 * saved). It is legal **only on a page that performed the translate itself**,
 * because the GUI's `doExecute` (ces-stamper `public/index.html`):
 *
 * - bails unless the in-page `tenantConnectionState === 'connected'` — whose DOM
 *   tell is `.tenant-connected` on `#workflowCard0`; and
 * - reads `#outputPath`, a readonly input that **only a translate response
 *   populates**, and bails when it is empty.
 *
 * So this op checks BOTH in-page before choosing. If either fails it says so
 * loudly and runs `phase: 'full'` — slower (~12 min), still real. It never
 * narrates a result it did not produce.
 *
 * The backstage session is what makes the fast path the common case: nothing
 * else ever navigates it, so a warm `stamper-translate` earlier in the deck
 * leaves exactly the state `execute-only` needs. On the visible pane that state
 * was routinely destroyed by the next op, which is why the fallback used to be
 * the rule rather than the exception.
 *
 * ## Judge the artifact, never the badge
 *
 * `#cardStatus4` is NARRATIVE ONLY: M0 measured a badge reading `Complete`
 * while the on-disk report read `partial` (80/110). Every number this op logs
 * or shows comes from `result.report`.
 *
 * ## Two failure id spaces — do not mix them
 *
 * The GUI leg is judged against `GUI_LEG_KNOWN_FALSE_FAILS` (`e2e-run.ts`),
 * **not** `partitionFailures` from `known-false-fails.ts`, which is the CLI
 * registry's judge (`e2e-run.ts` says so at its own call site). And never pin a
 * raw `step_task_*` id — its suffix regenerates on every translation.
 */

import { runStamperUiFlow, STAMPER_SELECTORS, type StamperUiPhase } from '../../stamper-ui-driver.js';
import { GUI_LEG_KNOWN_FALSE_FAILS } from '../../e2e-run.js';
import { HEADLESS_MODE } from '../../watch-mode.js';
import { hasClass, type UiPage } from '../../ui-page.js';
import { escapeHtml } from '../slide-render.js';
import { htmlDataUrl, hudSurfaceOf } from '../app-pane.js';
import { formatElapsed, hudTicker, paneCaption, paneHud } from '../theatrical-page.js';
import { CAPTIONS } from '../captions.js';
import { CONFIG_HUD_TITLE } from './stamper-translate-op.js';
import type { OpDriveContext } from '../op-registry.js';

const CAP = CAPTIONS['stamper-execute'];
import { DEMO_MANIFEST, DEMO_MISSION_PLAN } from './stamper-translate-op.js';
import * as path from 'node:path';

export interface GuiFailurePartition {
  /** Failures the skip list expected — reported, not fatal. */
  readonly expected: string[];
  /** Failures nobody expected. These, and only these, fail the op. */
  readonly unexpected: string[];
  /** Skip-list entries nothing failed on — the list has drifted from reality. */
  readonly staleSkips: string[];
}

/**
 * Partition the execution report's failure ids against a skip list. Pure.
 *
 * An `undefined` skip list means **"judge nothing as expected"** — every failure
 * is unexpected. That is deliberate: an absent list is not permission to pass.
 */
export function partitionGuiFailures(
  failureIds: readonly string[],
  skipList: readonly string[] | undefined,
): GuiFailurePartition {
  const skips = skipList ?? [];
  const expected: string[] = [];
  const unexpected: string[] = [];
  for (const id of failureIds) {
    if (skips.includes(id)) expected.push(id);
    else unexpected.push(id);
  }
  return {
    expected,
    unexpected,
    staleSkips: skips.filter((s) => !failureIds.includes(s)),
  };
}

/** Both of `doExecute`'s in-page preconditions, read from the DOM. */
export interface ExecutePreconditions {
  readonly connected: boolean;
  readonly outputPath: string;
  readonly ready: boolean;
}

export async function readExecutePreconditions(page: UiPage): Promise<ExecutePreconditions> {
  const connected = await hasClass(page, STAMPER_SELECTORS.card(0), 'tenant-connected').catch(() => false);
  const outputPath = (await page.inputValue('#outputPath').catch(() => ''))?.trim() ?? '';
  return { connected, outputPath, ready: connected && outputPath !== '' };
}

export interface ExecuteOutcome {
  readonly slug: string;
  readonly phase: StamperUiPhase;
  readonly seconds: string;
  readonly totalTasks?: number;
  readonly completedTasks?: number;
  readonly reportStatus?: string;
  readonly reportPath?: string;
  readonly expected: readonly string[];
  readonly unexpected: readonly string[];
}

export function readoutHtml(outcome: ExecuteOutcome): string {
  const applied =
    outcome.completedTasks === undefined || outcome.totalTasks === undefined
      ? '—'
      : `${outcome.completedTasks} / ${outcome.totalTasks}`;
  const clean = outcome.unexpected.length === 0;
  const accent = clean ? '#4ade80' : '#ffb454';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Configuration — plan applied</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;}
.badge{border:1px solid ${accent};color:${accent};border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
h1{font-size:22px;margin:0;font-weight:600;}
.n{font-size:52px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;}
.cap{color:#9db2cc;font-size:14px;margin:0;}
.note{color:#ffb454;font-size:13px;margin:4px 0 0;max-width:56ch;line-height:1.5;}
.meta{color:#6f87a6;font-size:11px;margin:0;max-width:70ch;word-break:break-all;}
code{background:#142a4a;border-radius:4px;padding:1px 6px;}
</style></head><body><div class="wrap">
<span class="badge">Configuration</span>
<h1>Remediation applied and verified against the tenant</h1>
<div class="n">${escapeHtml(applied)}</div>
<p class="cap">tasks applied for <code>${escapeHtml(outcome.slug)}</code> in ${escapeHtml(outcome.seconds)}s</p>
<p class="cap">report status: <code>${escapeHtml(outcome.reportStatus ?? 'not reported')}</code></p>
${
  outcome.expected.length === 0
    ? ''
    : `<p class="note">${escapeHtml(String(outcome.expected.length))} known sim-only verification failure(s), skipped by the pinned list</p>`
}
${
  clean
    ? ''
    : `<p class="note">${escapeHtml(String(outcome.unexpected.length))} UNEXPECTED failure(s): ${escapeHtml(outcome.unexpected.slice(0, 5).join(', '))}</p>`
}
<p class="meta">${escapeHtml(outcome.reportPath ?? 'no execution report on disk')}</p>
</div></body></html>`;
}

/**
 * `stamper-execute` — the expensive half (~7 min execute, ~12 min if the full
 * flow is needed), on the backstage session. Fails only on UNEXPECTED reds.
 */
export async function runStamperExecuteOp(ctx: OpDriveContext): Promise<void> {
  const backstage = ctx.backstage;
  if (!backstage) {
    throw new Error(
      'stamper-execute requires the backstage session, which prep did not create — ' +
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

  // Phase selection, GUARDED. Both of doExecute's preconditions, read in-page.
  const pre = await readExecutePreconditions(backstage.page);
  const phase: StamperUiPhase = pre.ready ? 'execute-only' : 'full';
  if (pre.ready) {
    ctx.log(
      `  op stamper-execute (${ctx.slide.op.mode}): the backstage page is connected and carries an executable plan ` +
        `(${pre.outputPath}) — running execute-only, skipping ~5 minutes of connect/assess/translate`,
    );
  } else {
    ctx.log(
      `  op stamper-execute (${ctx.slide.op.mode}): CANNOT take the fast path — ` +
        `connected=${pre.connected}, outputPath=${pre.outputPath === '' ? '(empty)' : pre.outputPath}. ` +
        'Running the FULL flow (~12 min). Put a warm `stamper-translate` on an earlier slide to avoid this.',
    );
    await backstage.goto(baseUrl);
  }

  // GP-DEMO-6 theatre: the streamed backstage session gets a ticking HUD for the
  // minutes the execute takes; the execution report on disk stays the judge.
  const hud = hudSurfaceOf(backstage);
  // Captions render on the BACKSTAGE surface. The LIVE set is present-tense
  // ("applying right now") and is emitted BEFORE the flow so it stands over the
  // minutes-long run; the WARM set is past-tense ("already ran … the report it
  // wrote") and is emitted AFTER the report is read (below), never before —
  // narrating a report that does not exist yet would be the dishonesty.
  // DEMO PEEK: `peekMs` (deck param) turns this into a "start it, watch it run,
  // cut away" beat — the execute is kicked off, confirmed running, streamed for
  // peekMs, then LEFT RUNNING; nothing below judges a report it never awaited.
  const peekMs = typeof ctx.slide.op.params?.peekMs === 'number' ? (ctx.slide.op.params.peekMs as number) : 0;
  const peek = peekMs > 0;
  const live = ctx.slide.op.mode === 'live';
  if (peek) {
    for (const c of CAP.livePeek) await paneCaption.show(hud, c);
  } else if (live) {
    await paneCaption.show(hud, CAP.live[0]);
    await paneCaption.show(hud, CAP.live[1]);
  }
  const ticker = hudTicker(
    hud,
    CONFIG_HUD_TITLE,
    (ms) =>
      `${phase === 'execute-only' ? 'executing the translated plan' : 'connect → assess → translate → execute'} ` +
      `against '${ctx.armed.slug}' … ${formatElapsed(ms)}`,
  );
  const started = ticker.startedAt;
  let result;
  try {
    result = await runStamperUiFlow(backstage.page, {
      baseUrl,
      slug: ctx.armed.slug,
      missionPlanPath: path.resolve(
        ctx.options.testerRoot,
        String(ctx.slide.op.params?.missionPlan ?? DEMO_MISSION_PLAN),
      ),
      manifestPath: path.resolve(ctx.options.testerRoot, String(ctx.slide.op.params?.manifest ?? DEMO_MANIFEST)),
      pipelineRoot: path.join(ctx.armed.runDir, 'pipeline'),
      phase,
      screenshotDir: ctx.armed.runDir,
      watch: HEADLESS_MODE,
      executePeekMs: peek ? peekMs : undefined,
    });
  } finally {
    ticker.stop();
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  for (const shot of result.screenshots) ctx.artifact?.(shot);
  if (result.reportPath) ctx.artifact?.(result.reportPath);

  // PEEK: the run was started and verified running, then left running on the
  // backstage session. There is no report to judge — say exactly that, narrate
  // nothing the run did not produce, and do NOT paint the "applied and verified"
  // readout (that would fabricate a result). The execution finishes off-stage
  // and is torn down with the session; a deck that needs the judged report puts
  // a full (non-peek) `stamper-execute` elsewhere.
  if (peek || result.executeLeftRunning || result.executeHalted) {
    const stopped = result.executeHalted
      ? 'then HALTED after the peek so it does not churn on backstage'
      : 'and LEFT RUNNING (halt did not land)';
    ctx.log(
      `  op stamper-execute (peek): execution started and confirmed running ` +
        `(badge ${JSON.stringify(result.executeBadge ?? '')}) after ${seconds}s — ${stopped}; ` +
        'not run to completion, so no execution report is judged this run',
    );
    if (hud) {
      await paneHud.show(
        hud,
        CONFIG_HUD_TITLE,
        `execution started against '${ctx.armed.slug}' and confirmed applying changes, then stopped here — ` +
          'in production it runs to completion and writes the report we judge, never the badge',
      );
    }
    return;
  }

  // Judge the ARTIFACT. `#cardStatus4` read "Complete" on a `partial` run.
  const report = result.report;
  if (!report) {
    throw new Error(
      `stamper-execute produced no execution report on disk (badge read ${JSON.stringify(result.executeBadge ?? '')}) — ` +
        'the badge is narrative only and is never the judge, so there is nothing here to report honestly',
    );
  }

  // Declared in the deck's `params` cell; the catalog defaults it to true.
  // `false` means judge NOTHING as expected — every failure fails the op.
  const skipKnownFalseFails = ctx.slide.op.params?.skipKnownFalseFails !== false;
  const skipList = skipKnownFalseFails ? GUI_LEG_KNOWN_FALSE_FAILS : undefined;
  const partition = partitionGuiFailures(report.failureIds, skipList);
  ctx.log(
    `  op stamper-execute: report ${report.status ?? 'unknown'} — ` +
      `${report.completedTasks ?? '?'} / ${report.totalTasks ?? '?'} task(s) applied in ${seconds}s ` +
      `(phase ${result.phase}); badge said ${JSON.stringify(result.executeBadge ?? '')}, which is NOT the judge`,
  );
  ctx.log(`  op stamper-execute: execution report — ${result.reportPath ?? '(none)'}`);
  ctx.log(
    skipList === undefined
      ? `  op stamper-execute: NO skip list in effect (${skipKnownFalseFails ? 'none is configured' : 'skipKnownFalseFails=false'}), so every failure counts as unexpected`
      : `  op stamper-execute: ${partition.expected.length} expected sim false-FAIL(s) skipped` +
        (partition.expected.length > 0 ? ` — ${partition.expected.join(', ')}` : ''),
  );
  if (partition.staleSkips.length > 0) {
    ctx.log(
      `  op stamper-execute: NOTE — ${partition.staleSkips.length} skip-list entr(y/ies) matched nothing this run: ` +
        `${partition.staleSkips.slice(0, 10).join(', ')}`,
    );
  }

  // WARM captions, now that the report is on disk and judged: they narrate the
  // report that already exists (past tense), ending on the known-sim-failures
  // line — the honest standing caption when the operator arrives at the slide.
  if (!live) {
    await paneCaption.show(hud, CAP.warm[0]);
    await paneCaption.show(hud, CAP.warm[1]);
    await paneCaption.show(hud, CAP.warm[2]);
    await paneCaption.show(hud, CAP.warm[3]);
  }

  const outcome: ExecuteOutcome = {
    slug: ctx.armed.slug,
    phase: result.phase,
    seconds,
    totalTasks: report.totalTasks,
    completedTasks: report.completedTasks,
    reportStatus: report.status,
    reportPath: result.reportPath,
    expected: partition.expected,
    unexpected: partition.unexpected,
  };

  if (hud) {
    // The report's numbers, on the streamed session — never the GUI badge.
    await paneHud.show(
      hud,
      CONFIG_HUD_TITLE,
      `execution report ${report.status ?? 'unknown'} — ${report.completedTasks ?? '?'} / ${report.totalTasks ?? '?'} task(s) in ${seconds}s` +
        (partition.expected.length > 0 ? ` · ${partition.expected.length} known sim false-FAIL(s) skipped` : '') +
        (partition.unexpected.length > 0 ? ` · ${partition.unexpected.length} UNEXPECTED failure(s)` : ''),
    );
  }

  if (ctx.slide.op.mode === 'live') {
    await ctx.pane.goto(htmlDataUrl(readoutHtml(outcome)));
  }

  // Only UNEXPECTED reds fail the op. Expected sim false-FAILs are reported and
  // skipped — that is the honesty guard, not a way to pass.
  if (partition.unexpected.length > 0) {
    throw new Error(
      `stamper-execute: ${partition.unexpected.length} unexpected failure(s) not on the GUI-leg skip list: ` +
        partition.unexpected.join(', '),
    );
  }
}
