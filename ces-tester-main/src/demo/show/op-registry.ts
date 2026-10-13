// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S4 — opId -> op function, plus the live/warm/staged plumbing.
 *
 * The show decides WHEN an op runs (`show-run.ts`); this file decides HOW, and
 * owns three rules that only look small until a demo breaks on stage:
 *
 * 1. **Ops are SERIALIZED through one promise chain.** The app pane is a single
 *    browser page. A warm op started during prep is still in flight when the
 *    operator taps forward twice, and two Playwright flows interleaving on one
 *    page is a mid-demo failure with no useful error. One queue, in order.
 * 2. **A staged slide only touches the pane when it has an op to replay.** If
 *    every narration slide navigated the pane, the warm AO result would be wiped
 *    off screen two slides before the operator gets to it — the whole point of
 *    `warm`. Slides that declare no op leave the pane exactly as it was.
 * 3. **Arming is prep-phase invisible setup**, completed before slide 1, under
 *    the founder's existing carve-out (the same one `gui-servers.ts` documents).
 *    It is never a demo surface; the operator sees only its result. WHICH
 *    surfaces get armed is decided by the deck (`armingFor`), not by a constant.
 * 4. **The slide's op mode reaches the op** (via `ShowOpContext.slide`), and an
 *    op may branch on it. `eo-review` does: `warm` runs the assess off-stage,
 *    `live` walks the result it left on the pane. The show still decides WHEN;
 *    the op decides what "now" means for that mode.
 *
 * Implementations are injectable so op dispatch is testable against a
 * hand-written `UiPage` with no browser and no sibling tool running.
 */

import * as path from 'node:path';
import type { DemoDeck, DemoOpId, DemoSlide } from './deck-model.js';
import { htmlDataUrl, openAppPane, hudSurfaceOf, BACKSTAGE_GEOMETRY, type AppPane } from './app-pane.js';
import { paneCaption } from './theatrical-page.js';
import type { PaneMirror } from './screencast-mirror.js';
import type { ShowOpContext, ShowOpRunner, ShowRunOptions } from './show-run.js';
import { escapeHtml } from './slide-render.js';
import { armSim, type ArmedSim, type ArmSimOptions } from './arm-sim.js';
import { runAoRegistryOp } from './ops/ao-registry-op.js';
import { runAoMakeChangeOp } from './ops/ao-make-change-op.js';
import { runEoReviewOp } from './ops/eo-review-op.js';
import { runEoShowChangeCapturedOp } from './ops/eo-show-change-captured-op.js';
import { runMusterReadinessOp } from './ops/muster-readiness-op.js';
import { runMusterConnectTenantOp } from './ops/muster-connect-tenant-op.js';
import { runMusterAutoAnalysisOp } from './ops/muster-auto-analysis-op.js';
import { runMusterConsentAttestOp } from './ops/muster-consent-and-attest-op.js';
import { runMusterAdaptiveInterviewOp } from './ops/muster-adaptive-interview-op.js';
import { runMusterGenerateSprsMpOp } from './ops/muster-generate-sprs-mp-op.js';
import { runMusterRollupOp } from './ops/muster-rollup-op.js';
import { runSimstackCreateOp } from './ops/simstack-create-op.js';
import { runSimstackDestroyOp } from './ops/simstack-destroy-op.js';
import { runStamperTranslateOp } from './ops/stamper-translate-op.js';
import { runStamperExecuteOp } from './ops/stamper-execute-op.js';

/** What arming produced — the live surfaces an op is allowed to drive. */
export interface ArmedEnvironment {
  readonly slug: string;
  /** `http://127.0.0.1:3001` once the AO GUI is up. */
  readonly aoBaseUrl?: string;
  /** `http://127.0.0.1:4002` once the EO SPA server is up. */
  readonly eoBaseUrl?: string;
  /** `http://127.0.0.1:3000` once the Stamper Configuration GUI is up. */
  readonly stamperBaseUrl?: string;
  /** `http://127.0.0.1:4173` once the ces-muster Vite preview SPA is up. */
  readonly musterBaseUrl?: string;
  /** stacksim serve, for ops that read the ledger. */
  readonly simUrl?: string;
  /** Run-scoped evidence directory. */
  readonly runDir: string;
  /**
   * Sibling roots the ops spawn from. Resolved once, by the runner, and handed
   * over — an op never works out where a sibling lives, and never builds one.
   */
  readonly musterRoot: string;
  readonly stamperRoot: string;
}

export interface OpDriveContext extends ShowOpContext {
  readonly armed: ArmedEnvironment;
  /**
   * The BACKSTAGE session — a second, headless, **never-displayed** browser
   * session created by this runner during `prepare()` and torn down with it.
   *
   * It exists because `warm` is not "off stage": a warm op is dispatched
   * fire-and-forget while the deck advances, so warm work on `pane` happens in
   * the audience-visible window, concurrently with slides 1..N. THREAD_HANDOFF
   * forbids showing the Configuration (Stamper) product on stage, and a warm
   * Stamper op would walk that GUI on screen for minutes. So Config work drives
   * THIS session, and touches `pane` only on its `live` slide, only to render
   * an outcome readout.
   *
   * Present only when the deck drives an op that needs it (`armingFor`). An op
   * that requires it must fail with a specific message when it is absent — it
   * must never silently fall back to `pane`.
   */
  readonly backstage?: AppPane;
  /**
   * Pin a NARRATION caption on the surface this op drives (GP-DEMO-6). Optional,
   * matching the `artifact?` precedent so the hand-written test fakes and the act
   * harness compile unchanged. The runner binds it to the VISIBLE pane's HUD
   * surface, so a pane op calls `ctx.caption(text)` at each real step; the two
   * Stamper ops caption the BACKSTAGE surface themselves (never the visible
   * pane). Static text only — run values stay in the status HUD / log.
   * Best-effort: a caption never fails or slows an op.
   */
  readonly caption?: (text: string) => Promise<void>;
}

export type OpImplementation = (ctx: OpDriveContext) => Promise<void>;

export interface MakeShowOpsDeps {
  /** Override or stub the op library. */
  readonly implementations?: Partial<Record<DemoOpId, OpImplementation>>;
  /** Override arming — tests pass a no-op, `--check` never gets here at all. */
  readonly arm?: (
    options: ShowRunOptions,
    log: (line: string) => void,
    opts: ArmSimOptions,
  ) => Promise<ArmedSim>;
  /**
   * Open the backstage session. Test seam; the default is a HEADLESS pane, and
   * headless is not a test convenience here — it is the doctrine.
   */
  readonly openBackstage?: () => Promise<AppPane>;
  /**
   * The BACKSTAGE mirror (GP-DEMO-5 streamgui). When present, `prepare()` attaches
   * it to the backstage session's page right after opening it, so a Config op's
   * `theatrical`+`backstage` slide streams the real Configuration GUI on
   * `/mirror/backstage`. Best-effort: an attach failure never fails prep. Absent
   * for `--pane-window`, the act harness, and every test fake.
   */
  readonly backstageMirror?: PaneMirror;
  readonly log?: (line: string) => void;
}

/** The real op library. Keyed by `DemoOpId`, so an id cannot exist unimplemented. */
export const OP_IMPLEMENTATIONS: Readonly<Record<DemoOpId, OpImplementation>> = {
  'ao-registry': runAoRegistryOp,
  'ao-make-change': runAoMakeChangeOp,
  'eo-review': runEoReviewOp,
  'eo-show-change-captured': runEoShowChangeCapturedOp,
  'muster-readiness': runMusterReadinessOp,
  'muster-connect-tenant': runMusterConnectTenantOp,
  'muster-auto-analysis': runMusterAutoAnalysisOp,
  'muster-consent-and-attest': runMusterConsentAttestOp,
  'muster-adaptive-interview': runMusterAdaptiveInterviewOp,
  'muster-generate-sprs-mp': runMusterGenerateSprsMpOp,
  'muster-rollup': runMusterRollupOp,
  'simstack-create': runSimstackCreateOp,
  'simstack-destroy': runSimstackDestroyOp,
  'stamper-translate': runStamperTranslateOp,
  'stamper-execute': runStamperExecuteOp,
};

/**
 * Which surfaces a deck's ops need armed. Pure, and separate from `prepare` so
 * the mapping is directly assertable: arming a server no slide will drive costs
 * the operator prep time for nothing (EO is the slowest thing arming spawns),
 * and an op whose surface was skipped fails with a specific message rather than
 * a mystery timeout.
 */
export function armingFor(
  drivenOpIds: ReadonlySet<DemoOpId>,
): Pick<ArmSimOptions, 'withAoGui' | 'withEo' | 'withStamperGui' | 'withMuster'> {
  return {
    withAoGui: drivenOpIds.has('ao-registry') || drivenOpIds.has('ao-make-change'),
    withEo: drivenOpIds.has('eo-review') || drivenOpIds.has('eo-show-change-captured'),
    withStamperGui: drivenOpIds.has('stamper-translate') || drivenOpIds.has('stamper-execute'),
    // The Muster SPA (Vite preview :4173) is armed for the GUI acts (D.4-D.8) AND
    // for `muster-readiness` (GP-DEMO-5 streamgui): it now imports its real CLI
    // result INTO the SPA and streams the boundary panel, so it needs the SPA
    // armed as well as the stacksim serve its CLI walks.
    withMuster:
      drivenOpIds.has('muster-readiness') ||
      drivenOpIds.has('muster-connect-tenant') ||
      drivenOpIds.has('muster-auto-analysis') ||
      drivenOpIds.has('muster-consent-and-attest') ||
      drivenOpIds.has('muster-adaptive-interview') ||
      drivenOpIds.has('muster-generate-sprs-mp') ||
      drivenOpIds.has('muster-rollup'),
  };
}

/**
 * The staged replay shown in the app pane: an honest placeholder naming the op
 * that WOULD have run, plus the slide's image if it has one. It is deliberately
 * not a fake result — a demo that dresses a replay up as a live run is the
 * failure mode this whole harness exists to avoid.
 */
export function stagedReplayHtml(slide: DemoSlide): string {
  const title = slide.rows.find((r) => r.feature)?.feature ?? `Slide ${slide.slideNumber}`;
  const images = slide.op.images
    .map((i) => `<img src="${escapeHtml(pathToFileUrl(i.absPath))}" alt="${escapeHtml(i.rawValue)}">`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>staged — ${escapeHtml(title)}</title>
<style>
html,body{margin:0;height:100%;background:#0a1930;color:#dce8f7;font-family:"Segoe UI",Segoe,Tahoma,Arial,sans-serif;}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;}
.badge{border:1px solid #ffb454;color:#ffb454;border-radius:20px;padding:2px 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;}
h1{font-size:24px;margin:0;font-weight:600;}
p{color:#9db2cc;font-size:14px;margin:0;max-width:46ch;line-height:1.5;}
code{background:#142a4a;border-radius:4px;padding:1px 6px;}
img{max-width:100%;max-height:60%;object-fit:contain;border:1px solid #1e3a5c;border-radius:8px;}
</style></head><body><div class="wrap">
<span class="badge">staged replay</span>
<h1>${escapeHtml(title)}</h1>
<p>This slide declares <code>${escapeHtml(slide.op.opId ?? 'no op')}</code> with op mode <code>staged</code>, so nothing is being driven live. Set the slide's <code>op mode</code> to <code>live</code> or <code>warm</code> to run it for real.</p>
${images}
</div></body></html>`;
}

/** `C:\x\y.png` -> `file:///C:/x/y.png`, so the replay page can show it. */
function pathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return `file:///${normalized.replace(/^\/+/, '')}`;
}

/**
 * Re-exported for the existing importers. The DEFINITION lives in
 * `app-pane.ts` so that an op needing it does not have to import this module —
 * this one imports every op, and a value edge back would close a runtime cycle.
 */
export { htmlDataUrl };

/**
 * Build the run's op runner. `prepare` arms the sim once; `run` drives the op
 * for a live/warm slide; `reveal` shows the staged replay for a slide that
 * declares an op but is not driving it. Every one of them goes through the same
 * queue, so the pane is only ever doing one thing.
 */
export function makeShowOps(
  pane: AppPane,
  deck: DemoDeck,
  options: ShowRunOptions,
  deps: MakeShowOpsDeps = {},
): ShowOpRunner {
  const log = deps.log ?? ((line: string) => console.log(line));
  const implementations = { ...OP_IMPLEMENTATIONS, ...deps.implementations };
  // The backstage session is headless, but on a mirror-active run it STREAMS on
  // `/mirror/backstage` for the Config slides (decision 11) — so it gets the
  // theatre (GP-DEMO-6) exactly when an audience can see it, and stays at full
  // speed when nothing does (`--pane-window`, the acts harness).
  const openBackstage =
    deps.openBackstage ??
    (() =>
      openAppPane({ geometry: BACKSTAGE_GEOMETRY, headless: true, theatre: deps.backstageMirror !== undefined }));
  let armed: ArmedSim | undefined;
  let backstage: AppPane | undefined;

  /** The single-lane queue. Every pane interaction joins it, in order. */
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    // Swallow on the CHAIN only — the caller still sees the real rejection.
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /** Which ops this deck will actually drive — nothing else gets armed for. */
  const drivenOpIds = new Set(
    deck.slides.filter((s) => s.op.mode !== 'staged' && s.op.opId).map((s) => s.op.opId!),
  );

  return {
    prepare: async () => {
      if (drivenOpIds.size === 0) {
        log('  prep: no live or warm ops in this deck — nothing to arm');
        return;
      }
      // `runId` is passed EXPLICITLY. `armSim` reads it off its own
      // `ArmSimOptions` argument, not off `ShowRunOptions`, so without this line
      // the run report and the screenshots it references land in two different
      // `runs/show/` directories.
      const arming = { ...armingFor(drivenOpIds), runId: options.runId };
      armed = await (deps.arm ?? armSim)(options, log, arming);
      if (arming.withStamperGui === true) {
        backstage = await openBackstage();
        // Attach the backstage mirror to this session (GP-DEMO-5 streamgui) so a
        // Config op's `theatrical`+`backstage` slide streams the real GUI on
        // `/mirror/backstage`. The screencast does NOT start here — it starts when
        // the first `/mirror/backstage` subscriber connects. Best-effort: an
        // attach failure (e.g. a headless-pane fake) must not fail prep, and the
        // disposer is registered by `show-run.ts` regardless.
        if (deps.backstageMirror) {
          try {
            await deps.backstageMirror.attach(backstage.session.raw);
          } catch (err) {
            log(
              `  prep: could not attach the backstage mirror (Config GUI will not stream): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        log(
          '  prep: backstage session up (headless, never displayed) — Config work runs here, per THREAD_HANDOFF',
        );
      }
    },

    run: async (ctx: ShowOpContext) => {
      const opId = ctx.slide.op.opId;
      if (!opId) throw new Error(`slide ${ctx.slide.slideNumber} has op mode "${ctx.slide.op.mode}" but names no op`);
      const implementation = implementations[opId];
      if (!implementation) throw new Error(`op "${opId}" has no implementation registered`);
      if (!armed) throw new Error(`op "${opId}" cannot run: the sim was never armed (prep did not complete)`);
      const environment: ArmedEnvironment = {
        slug: armed.slug,
        aoBaseUrl: armed.aoBaseUrl,
        eoBaseUrl: armed.eoBaseUrl,
        stamperBaseUrl: armed.stamperBaseUrl,
        musterBaseUrl: armed.musterBaseUrl,
        simUrl: armed.simUrl,
        runDir: armed.runDir,
        // Same VAULT.md sibling layout `arm-sim.ts` falls back to, resolved in
        // one place so an op never has to work out where a sibling lives.
        musterRoot: options.musterRoot ?? path.resolve(options.testerRoot, '..', 'ces-muster'),
        stamperRoot: options.stamperRoot ?? path.resolve(options.testerRoot, '..', 'ces-stamper'),
      };
      // The narration caption seam, bound to the VISIBLE pane's HUD surface
      // (undefined for a hand-written test pane — `paneCaption.show` no-ops
      // then). Best-effort: it pins the top band and mirrors the line into the
      // log so a `--pane-window` rehearsal or a headless run still records the
      // narration. The two Stamper ops ignore this and caption the backstage
      // surface themselves, per THREAD_HANDOFF.
      const captionSurface = hudSurfaceOf(pane);
      const caption = async (text: string): Promise<void> => {
        await paneCaption.show(captionSurface, text);
        ctx.log(`  caption: ${text}`);
      };
      // Backstage work joins the SAME single-lane queue as pane work. That is
      // not an oversight: it preserves translate-before-execute ordering and the
      // "one thing at a time" invariant across both sessions. The wall-time
      // consequence is the deck's prep budget, not a correctness problem.
      return serialize(() => implementation({ ...ctx, armed: environment, backstage, caption }));
    },

    /**
     * Non-holding: a staged replay never blocks the deck's pacing and never
     * fails the show. A slide with no op is left alone entirely, so a warm
     * result stays on screen until its own slide arrives.
     */
    reveal: async (ctx: ShowOpContext) => {
      if (!ctx.slide.op.opId) return;
      await serialize(() => pane.goto(htmlDataUrl(stagedReplayHtml(ctx.slide)))).catch((err: unknown) => {
        log(`  staged replay for slide ${ctx.slide.slideNumber} could not render: ${err instanceof Error ? err.message : err}`);
      });
    },

    dispose: async () => {
      // The backstage browser closes BEFORE the servers it was driving — a
      // page still talking to a server being killed is how an orphaned
      // Chromium survives a teardown.
      if (backstage) {
        await backstage.close().catch(() => undefined);
        backstage = undefined;
      }
      if (armed) {
        await armed.stop();
        armed = undefined;
      }
    },
  };
}
