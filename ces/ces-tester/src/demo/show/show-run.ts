// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S3 — the operator run: two windows, one disposer list.
 *
 * Shape of a run:
 *
 *   probe the slides port -> start the slides server -> open BOTH windows ->
 *   prep (invisible setup + warm ops) -> hand control to the operator ->
 *   on exit, run every disposer in reverse
 *
 * **Teardown is the part most likely to be neglected and most expensive to get
 * wrong** (A8). A demo that leaves an orphaned Chromium, a listening slides port
 * or a spawned GUI server behind poisons the NEXT run — and the next run is
 * usually in front of the same customer. So there is exactly one disposer list,
 * appended to as resources are acquired, and it runs on `Esc`/`q`, on
 * `SIGINT`/`SIGTERM`, and on any fatal error. Restoring the terminal is one of
 * those disposers: raw mode left on keeps the node process alive forever, which
 * looks exactly like a hang.
 *
 * Op SCHEDULING lives here rather than in `op-registry.ts` because it is a
 * property of the show, not of any op: `warm` ops start during prep, `live` ops
 * start when their slide is entered, `staged` ops never run. The registry only
 * knows how to drive one.
 */

import { probePort } from '../preflight.js';
import { keyToAction, slideDrivesOp, type ShowAction } from './show-state.js';
import { startSlidesServer, type SlidesServer } from './slides-server.js';
import { PaneMirror, BACKSTAGE_SCREENCAST } from './screencast-mirror.js';
import {
  openAppPane,
  openSlidesWindow,
  DEFAULT_APP_GEOMETRY,
  DEFAULT_SLIDES_GEOMETRY,
  formatGeometry,
  type AppPane,
  type WindowGeometry,
} from './app-pane.js';
import { loadDeck } from './xlsx-loader.js';
import { withStandby, isStandbySlide } from './standby.js';
import {
  advanceKindFor,
  createShowReport,
  writeShowReport,
  type ExitReason,
  type ShowReportRecorder,
} from './run-report.js';
import type { DemoDeck, DemoSlide } from './deck-model.js';
import type { UiSession } from '../ui-page.js';
import * as path from 'node:path';

/** Everything the runner needs. `show-command.ts` builds this from argv. */
export interface ShowRunOptions {
  readonly deckPath: string;
  readonly slidesPort: number;
  readonly defaultDwellSec: number;
  readonly auto: boolean;
  readonly presenter: boolean;
  readonly slidesGeometry: WindowGeometry;
  readonly appGeometry: WindowGeometry;
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly aoRoot: string;
  /**
   * OPTIONAL, unlike the three above. Absent means "VAULT.md's sibling layout"
   * — `arm-sim.ts` resolves `<testerRoot>/../ces-eo`, `../ces-stamper` and
   * `../ces-muster` itself. `show-command.ts` now parses `--eo-root`,
   * `--stamper-root` and `--muster-root` and always supplies a resolved value,
   * but these stay optional so a headless proof can construct the options
   * object directly and so every existing test fixture still compiles.
   */
  readonly eoRoot?: string;
  /** EO's `REGISTRY_PATH`, and the Stamper GUI's root once a stamper op is driven. */
  readonly stamperRoot?: string;
  /** ces-muster's root — `muster-readiness` spawns its CLI from here. */
  readonly musterRoot?: string;
  /**
   * Names `runs/show/<runId>/`, which holds both the run report and every
   * screenshot it references. Flows into `armSim` too, so the two cannot land
   * in different directories.
   */
  readonly runId?: string;
  /** Write `runs/show/<runId>/report.json`. Default true; `--no-report` turns it off. */
  readonly report?: boolean;
  /** `--watchouts`: show the presenter cue band. OPTIONAL, defaults OFF. */
  readonly watchouts?: boolean;
  /**
   * The in-slide app mirror (T1.5) is active for this run. When true, driven
   * `theatrical`/`readout` slides render the right-third `<img src="/mirror">`
   * and the pane's screencast is attached. OPTIONAL, defaults OFF — the default
   * flip lands in S6; until then this is the interim `--mirror` opt-in.
   */
  readonly mirrorActive?: boolean;
  /**
   * Inject the synthetic standby cover (GP-DEMO-6). When true, `withStandby`
   * prepends a "slide 0" that HOLDS (no dwell burn) while the tools arm and warm
   * ops settle; the runner reveals authored slide 1 once prep completes. Read
   * strict-`true`, so every existing test fixture and headless proof that omits
   * it runs exactly as before. `show-command.ts` turns it on for every CLI run;
   * `--no-standby` is the rehearsal hatch.
   */
  readonly standby?: boolean;
}

/** What an op is told when it is asked to drive the pane. */
export interface ShowOpContext {
  readonly pane: AppPane;
  readonly slide: DemoSlide;
  readonly index: number;
  readonly options: ShowRunOptions;
  readonly log: (line: string) => void;
  /**
   * Record a file this op produced as evidence — a screenshot, a report, an
   * artifact it wrote. Declared here, one slice ahead of the ops that call it
   * and two ahead of the recorder behind it, so each op compiles on its own.
   * A no-op until the run report supplies a recorder.
   */
  readonly artifact?: (absPath: string) => void;
}

/**
 * The seam between the show and the op library (`op-registry.ts`). The show
 * decides WHEN an op runs; the runner decides HOW.
 */
export interface ShowOpRunner {
  /** Invisible setup completed before slide 1 (arming: cert, serve, GUIs). */
  prepare?(): Promise<void>;
  run(ctx: ShowOpContext): Promise<void>;
  /**
   * Entering a slide that is NOT driving an op. Used for the staged replay.
   * Non-holding and non-fatal by contract: it never gates the deck's pacing and
   * a failure here must not end the show.
   */
  reveal?(ctx: ShowOpContext): Promise<void>;
  dispose?(): Promise<void>;
}

export interface ShowRunDeps {
  readonly load?: (deckPath: string) => Promise<DemoDeck>;
  readonly probe?: (port: number) => Promise<'free' | 'occupied'>;
  readonly startServer?: typeof startSlidesServer;
  readonly openSlides?: (url: string, geometry: WindowGeometry) => Promise<UiSession>;
  readonly openApp?: (geometry: WindowGeometry) => Promise<AppPane>;
  /**
   * Built once the pane exists, so ops can drive it. The 4th argument is the
   * BACKSTAGE mirror (GP-DEMO-5 streamgui) — present only on a mirror-active run
   * that constructs one; `op-registry.ts` attaches it to the backstage session in
   * `prepare()`. OPTIONAL so the act harness and test fakes call `makeOps` with
   * three arguments untouched.
   */
  readonly makeOps?: (
    pane: AppPane,
    deck: DemoDeck,
    options: ShowRunOptions,
    backstageMirror?: PaneMirror,
  ) => ShowOpRunner;
  readonly stdin?: NodeJS.ReadStream;
  readonly log?: (line: string) => void;
  /** Test seam: called with the run's "end now" function. */
  readonly until?: (exit: () => void) => void;
}

/**
 * Raw terminal bytes -> the same key names the browser sends, so both nav routes
 * (A5) collapse onto one `keyToAction`. Pure, and directly testable.
 */
export function terminalKeyName(data: string): string | undefined {
  switch (data) {
    case '': // Ctrl-C — the operator's reflex; a clean exit, not a kill
    case '':
    case 'q':
    case 'Q':
      return 'Escape';
    case '[A':
      return 'ArrowUp';
    case '[B':
      return 'ArrowDown';
    case '[C':
      return 'ArrowRight';
    case '[D':
      return 'ArrowLeft';
    case '[H':
    case '[1~':
      return 'Home';
    case '[F':
    case '[4~':
      return 'End';
    case '[5~':
      return 'PageUp';
    case '[6~':
      return 'PageDown';
    case '\r':
    case '\n':
    case ' ':
      return ' ';
    default:
      return /^[a-zA-Z]$/.test(data) ? data.toLowerCase() : undefined;
  }
}

/** Terminal keystroke -> show action. The terminal half of A5. */
export function terminalAction(data: string): ShowAction | undefined {
  const key = terminalKeyName(data);
  return key === undefined ? undefined : keyToAction(key);
}

/**
 * The terminal's copy of the slide window's footer advisories. It names the
 * SAME bindings `keyToAction` implements — `a` is the hold key (it suspends
 * auto-pacing), because `p` is prev and always has been.
 */
export const KEY_HELP =
  'keys: ->/space next  <- prev  Home first  End last  t talk track  a hold (auto-pace)  Esc/q exit';

/**
 * Run the show. Never throws — a failure is reported and torn down, because a
 * crash that skips teardown is exactly the orphaned-process bug A8 forbids.
 */
export async function runShow(options: ShowRunOptions, deps: ShowRunDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const disposers: { readonly what: string; readonly run: () => Promise<void> }[] = [];
  const dispose = async (): Promise<void> => {
    for (const d of disposers.reverse()) {
      try {
        await d.run();
      } catch (err) {
        log(`  teardown: ${d.what} failed (continuing): ${err instanceof Error ? err.message : err}`);
      }
    }
    disposers.length = 0;
  };

  /**
   * Assigned once the pane and the op runner exist. `onChange` fires from the
   * server's pacing loop, which can start ticking before those are built — a
   * null check here is cheaper than an ordering assumption that holds only while
   * every slide's dwell happens to be longer than a browser launch.
   */
  // Returns the op's SETTLE promise (resolves when the op is done OR failed —
  // the .catch below makes it never reject) so prep can AWAIT warm ops before
  // slide 1. Callers that fire-and-forget just ignore the return.
  let startOpFor: ((index: number) => Promise<void> | undefined) | undefined;

  /**
   * The report, and everything the `finally` block needs to write it. Declared
   * out here because the report is written in `finally` while a fatal error is
   * caught in `catch` — without a shared binding an errored run would record
   * `exitReason: 'key'`, which is exactly the kind of quiet lie this artifact
   * exists to prevent.
   */
  const now = (): number => Date.now();
  const startedAtMs = now();
  const runId = options.runId ?? `show-${startedAtMs}`;
  let recorder: ShowReportRecorder | undefined;
  let exitReason: ExitReason = 'key';
  let fatal = false;
  const noTty = !(deps.stdin ?? process.stdin).isTTY;

  try {
    let deck = await (deps.load ?? ((p: string) => loadDeck(p)))(options.deckPath);
    // Prepend the standby cover BEFORE the log, recorder, server and state are
    // built, so every downstream consumer sees the one deck the run actually
    // paces. Runner-only — the loader/validator never see it.
    if (options.standby === true) deck = withStandby(deck);
    log(`demo:show — ${deck.title}: ${deck.slides.length} slide(s) from ${options.deckPath}`);
    for (const w of deck.warnings) log(`  WARN ${w}`);

    if (options.report !== false) {
      recorder = createShowReport(deck, options, startedAtMs, runId);
    }

    const probe = deps.probe ?? ((p: number) => probePort(p));
    if ((await probe(options.slidesPort)) === 'occupied') {
      log(
        `demo:show: port ${options.slidesPort} is already in use — free it or pass --slides-port <n>. ` +
          '(The five demo ports 3000/3001/4390/4002/5173 are deliberately avoided.)',
      );
      return 1;
    }

    // Resolved once the show ends, by any route: key, signal, or fatal error.
    let endRun: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      endRun = resolve;
    });

    // The in-slide app mirror is constructed BEFORE the server (the server takes
    // it as an option) and attached AFTER the pane opens (below). Its `dispose`
    // is registered so `server.stop()` and the disposer list both tear the MJPEG
    // connections down — see A8. Built ONLY for a mirror-active run: under
    // `--pane-window` there is no mirror, so `/mirror` simply 404s.
    const mirror = options.mirrorActive === true ? new PaneMirror({ log }) : undefined;
    // The BACKSTAGE mirror (GP-DEMO-5 streamgui): a SECOND `PaneMirror`, sized for
    // the LANDSCAPE backstage viewport (P2-1) so the Stamper GUI stays legible, and
    // attached to the backstage session by `op-registry.prepare()` (below, via
    // makeOps). Built only for a mirror-active run — a Config op's slide streams it
    // on `/mirror/backstage`; every other run's route 404s.
    const backstageMirror =
      options.mirrorActive === true ? new PaneMirror({ log, screencast: BACKSTAGE_SCREENCAST }) : undefined;

    const server: SlidesServer = await (deps.startServer ?? startSlidesServer)({
      deck,
      port: options.slidesPort,
      defaultDwellSec: options.defaultDwellSec,
      auto: options.auto,
      presenter: options.presenter,
      watchouts: options.watchouts,
      mirror,
      backstageMirror,
      mirrorActive: options.mirrorActive === true,
      onChange: (state, previous, action) => {
        // A toggle fires onChange WITHOUT moving the index. Recording it as a
        // transition would invent slide moves that never happened.
        if (action.type === 'toggle-auto') recorder?.toggled('auto', state.auto, now());
        if (action.type === 'toggle-presenter') recorder?.toggled('presenter', state.presenter, now());

        if (state.exited) {
          endRun();
          return;
        }
        if (state.index !== previous.index) {
          const at = now();
          const advance = advanceKindFor(action);
          if (advance !== undefined) recorder?.slideLeft(previous.index, at, advance);
          recorder?.slideEntered(state.index, at);
          startOpFor?.(state.index);
        }
        // No TTY: auto-exit when the last slide's dwell expires and auto-pacing
        // hits the wall. The wall is: index unchanged (still on last slide) AND
        // dwellDeadline goes from non-null to null (tick→next returned without
        // advancing). On ENTRY to the last slide, index changes — that's not the wall.
        if (noTty && state.index === previous.index
            && state.index >= deck.slides.length - 1
            && state.dwellDeadline === null && previous.dwellDeadline !== null) {
          exitReason = 'end-of-deck';
          server.dispatch({ type: 'exit' });
        }
      },
    });
    disposers.push({ what: 'slides server', run: () => server.stop() });
    log(`  slides server: ${server.url}`);

    // Registered HERE, not after prep. Arming spawns the most processes of any
    // phase (stacksim serve, the AO GUI) and takes the longest, so it is the
    // likeliest moment for an operator to hit Ctrl-C. With no listener, Node
    // hard-exits on SIGINT, `finally` never runs, and those servers survive as
    // orphans — the exact A8 failure mode, in the exact window where it costs
    // the most. With one, the run falls through to teardown like any other exit.
    const onSignal = (): void => {
      exitReason = 'signal';
      server.dispatch({ type: 'exit' });
      endRun();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    disposers.push({
      what: 'signal handlers',
      run: async () => {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      },
    });

    const slidesUrl = noTty ? server.url + '?no-input' : server.url;
    const slidesWindow = await (deps.openSlides ??
      ((url: string, geometry: WindowGeometry) => openSlidesWindow(url, { geometry })))(
      slidesUrl,
      options.slidesGeometry,
    );
    disposers.push({ what: 'slides window', run: () => slidesWindow.close() });
    log(`  slides window: ${formatGeometry(options.slidesGeometry)} (landscape 16:9)`);

    const pane = await (deps.openApp ??
      ((geometry: WindowGeometry) => openAppPane({ geometry, mirror: options.mirrorActive === true })))(
      options.appGeometry,
    );
    disposers.push({ what: 'app pane', run: () => pane.close() });
    log(
      options.mirrorActive === true
        ? '  app pane:      headless 640x1080 mirror (rendered in-slide via /mirror)'
        : `  app pane:      ${formatGeometry(options.appGeometry)} (portrait window)`,
    );

    // Attach the mirror to the VISIBLE pane (never backstage). The screencast
    // does not START here — it starts when the first `/mirror` subscriber
    // connects (a mirrored slide's `<img>`). Only a mirror-active run has a
    // mirror at all; otherwise the second window is the app and the pane is never
    // screencast. Best-effort: a failure (e.g. a test fake with no real page)
    // must not fail the run, and `dispose` is registered so teardown is covered
    // even if attach threw.
    if (mirror) {
      disposers.push({ what: 'app mirror', run: () => mirror.dispose() });
      try {
        await mirror.attach(pane.session.raw);
      } catch (err) {
        log(`  mirror: could not attach screencast (continuing without in-slide mirror): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const ops = deps.makeOps?.(pane, deck, options, backstageMirror);
    if (ops?.dispose) disposers.push({ what: 'ops', run: () => ops.dispose!() });
    // Registered AFTER the ops disposer so, because disposers run in reverse, the
    // backstage mirror's CDP session is detached BEFORE `ops.dispose` closes the
    // backstage browser (P2-2). `dispose()` is idempotent and a detach after
    // close is caught, so this is ordering hygiene, not a correctness gate. It is
    // attached to the session inside `op-registry.prepare()`.
    if (backstageMirror) {
      disposers.push({ what: 'backstage mirror', run: () => backstageMirror.dispose() });
    }

    startOpFor = (index: number): Promise<void> | undefined => {
      const slide = deck.slides[index];
      if (!slide) return undefined;
      // The synthetic standby cover never runs an op — not on first entry and
      // not on a back-nav to it. Its op stays `pending` forever, which is what
      // makes it hold with no dwell burn until a manual key or the reveal.
      if (isStandbySlide(slide)) return undefined;
      if (!slideDrivesOp(slide)) {
        // A staged slide replays instead of driving. Fire-and-forget: it must
        // never hold the deck, and a replay that cannot render is a log line,
        // not a failed show.
        void ops?.reveal?.({ pane, slide, index, options, log }).catch(() => undefined);
        return undefined;
      }
      // `pending` is the only startable state: a re-entered slide whose op is
      // already running or done must not be driven twice.
      if (server.state().ops[index] !== 'pending') return undefined;
      server.dispatch({ type: 'op', index, status: 'running' });
      if (!ops) {
        server.dispatch({ type: 'op', index, status: 'failed', error: 'no op runner is wired for this run' });
        return undefined;
      }
      // This is the single place that knows an op's id, mode, start, end,
      // outcome AND the slide it belongs to — so the report is recorded here,
      // not scattered through the ops.
      recorder?.opStarted(index, slide, now());
      // Returned so prep can await warm ops. The `.catch` makes this promise
      // resolve (never reject) on failure, so awaiting a failed warm op is safe.
      return ops
        .run({ pane, slide, index, options, log, artifact: (p) => recorder?.opArtifact(index, p) })
        .then(() => {
          recorder?.opFinished(index, now(), 'done');
          server.dispatch({ type: 'op', index, status: 'done' });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          log(`  op ${slide.op.opId ?? '?'} on slide ${slide.slideNumber} FAILED: ${message}`);
          recorder?.opFinished(index, now(), 'failed', message);
          server.dispatch({ type: 'op', index, status: 'failed', error: message });
        });
    };

    /* ---------------- Prep: invisible setup, then warm ops ---------------- */
    if (ops?.prepare) {
      log('  prep: arming (invisible setup — completed before slide 1)');
      // Deliberately AWAITED rather than raced against `finished`: a Ctrl-C
      // mid-arming must still let arming finish claiming its handles, or
      // `ops.dispose` would run before there is anything to dispose and the
      // servers it spawned would outlive the process anyway.
      await ops.prepare();
    }
    // A signal during prep already ended the show. Skip straight to teardown
    // rather than warming ops nobody will see.
    if (server.state().exited) {
      log('  prep interrupted — tearing down without starting the deck');
    } else {
      // Warm ops start here AND are AWAITED before slide 1. `warm` means "done
      // before the show" — the catalog and `--check`'s prep budget both say
      // "before slide 1", and the audience must never watch a warm op run. Prior
      // to this the warm runs were fire-and-forget, so a long warm op (Config
      // translate ≈5 min) actually ran DURING the deck on the single serialized
      // op queue, starving every live act behind it (blank panes). Awaiting here
      // keeps the queue clear once the show starts, so every live act drives its
      // pane. Slower prep, honest show.
      const warmups: Array<Promise<void>> = [];
      deck.slides.forEach((slide, i) => {
        if (slide.op.mode === 'warm' && slideDrivesOp(slide)) {
          log(`  prep: warming slide ${slide.slideNumber} (${slide.op.opId})`);
          const p = startOpFor?.(i);
          if (p) warmups.push(p);
        }
      });
      if (warmups.length > 0) {
        log(`  prep: awaiting ${warmups.length} warm op(s) to finish before slide 1 (warm = done before the show)`);
        await Promise.allSettled(warmups);
      }
      // A signal (Ctrl-C / exit) may have ended the show while warm ops ran.
      if (server.state().exited) {
        log('  prep interrupted during warm ops — tearing down without starting the deck');
      } else if (options.standby === true && server.state().index === 0 && !server.state().exited) {
        // REVEAL: advance off the standby cover to authored slide 1. The single
        // `next` fires `onChange`, which records `slideEntered(1)` and calls
        // `startOpFor(1)` — so slide 1's dwell/op start HERE, exactly as they
        // would have without standby, only now after arming has settled behind a
        // held cover instead of a bare, dwell-burning slide 1. The standby op
        // was never started (`startOpFor` guards it), so it held with no burn
        // until this moment.
        server.dispatch({ type: 'next' });
      } else {
        // Slide 1's dwell starts HERE, not when the window opened: prep is
        // invisible setup completed before slide 1, and counting it as dwell
        // would make every deck's first slide look wildly over-run.
        recorder?.slideEntered(server.state().index, now());
        startOpFor(server.state().index);
      }
    }

    /* ---------------- Operator control ---------------- */
    const stdin = deps.stdin ?? process.stdin;
    if (stdin.isTTY) {
      const handler = (chunk: string | Buffer): void => {
        const action = terminalAction(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        if (action) server.dispatch(action);
      };
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      stdin.on('data', handler);
      disposers.push({
        what: 'terminal raw mode',
        run: async () => {
          stdin.off('data', handler);
          stdin.setRawMode?.(false);
          stdin.pause();
        },
      });
      log(`  ${KEY_HELP}`);
    } else {
      log('  (no TTY — terminal nav disabled; drive the slides window instead)');
    }

    deps.until?.(endRun);
    await finished;

    // Let the "demo ended" overlay reach the page before the window closes.
    await new Promise((r) => setTimeout(r, 400));
    log('demo:show — exiting; tearing down both windows and the slides server');
    return 0;
  } catch (err) {
    fatal = true;
    log(`demo:show: run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 1;
  } finally {
    // The report is written BEFORE teardown. Teardown kills spawned servers and
    // browsers and is the likeliest place for a late failure — and a crash
    // there must not cost the evidence for the run that just happened.
    if (recorder) {
      const absPath = path.join(options.testerRoot, 'runs', 'show', runId, 'report.json');
      try {
        await writeShowReport(recorder.finish(now(), fatal ? 'error' : exitReason), absPath);
        log(`demo:show — run report: ${absPath}`);
      } catch (err) {
        log(`demo:show: could not write the run report (continuing to teardown): ${err instanceof Error ? err.message : err}`);
      }
    }
    await dispose();
  }
}

export { DEFAULT_APP_GEOMETRY, DEFAULT_SLIDES_GEOMETRY };
