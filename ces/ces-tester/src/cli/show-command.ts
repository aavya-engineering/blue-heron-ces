// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — `demo:show`, the presentation demo runner's CLI surface.
 *
 * Two modes, one deck loader:
 *
 *   demo:show --check <deck.xlsx>   headless: load, render every slide, walk the
 *                                   whole deck with ops forced `staged`, print a
 *                                   PASS/FAIL report. Exit 0 / 1 / 2.
 *   demo:show <deck.xlsx>           the operator run: two positioned windows.
 *
 * `--check` exists so the build loop is runnable UNATTENDED. Everything an
 * acceptance check can prove without a human — the deck loads, every slide
 * renders, nav walks front to back, pacing resolves per slide — is proved here;
 * only the two-window drive (A4/A7) genuinely needs an operator.
 *
 * Arg parsing is a pure function (`parseShowArgs`) for the same reason
 * `parseDemoE2eArgs` is: flag handling must be testable without spawning
 * browsers or reading spreadsheets.
 */

import * as path from 'node:path';
import {
  DeckLoadFailure,
  formatDeckErrors,
  slideDwellMs,
  type DemoDeck,
  type DemoSlide,
} from '../demo/show/deck-model.js';
import { loadDeck } from '../demo/show/xlsx-loader.js';
import { buildDeckView, renderSlideHtml } from '../demo/show/slide-render.js';
import { createShowState, reduceShow, DEFAULT_DWELL_SEC } from '../demo/show/show-state.js';
import { runShow } from '../demo/show/show-run.js';
import { makeShowOps } from '../demo/show/op-registry.js';
import {
  DEFAULT_APP_GEOMETRY,
  DEFAULT_SLIDES_GEOMETRY,
  parseGeometry,
  type WindowGeometry,
} from '../demo/show/app-pane.js';

/** The slides server's default port — outside the five demo ports. */
export const DEFAULT_SLIDES_PORT = 4500;

/** The deck used when the operator names none. */
export const DEFAULT_DECK = 'demos/ces-overview.xlsx';

export interface DemoShowArgs {
  readonly deckPath: string;
  readonly check: boolean;
  readonly slidesPort: number;
  readonly defaultDwellSec: number;
  /** `--manual` turns auto-pacing off; nav still works. */
  readonly auto: boolean;
  /** `--no-presenter` starts with the talk-track band hidden. */
  readonly presenter: boolean;
  readonly slidesGeometry: WindowGeometry;
  readonly appGeometry: WindowGeometry;
  readonly testerRoot: string;
  readonly stacksimRoot: string;
  readonly aoRoot: string;
  /**
   * The three siblings the show may spawn from. Each defaults to VAULT.md's
   * layout (`<testerRoot>/../<name>`), so they are always resolved here rather
   * than left to `arm-sim.ts`'s own fallback — same path, one owner.
   */
  readonly eoRoot: string;
  readonly stamperRoot: string;
  readonly musterRoot: string;
  /** `--no-report` suppresses `runs/show/<runId>/report.json`. */
  readonly report: boolean;
  /** `--watchouts` shows the presenter cue band. Defaults OFF. */
  readonly watchouts: boolean;
  /**
   * The in-slide app mirror (T1.5). DEFAULT ON: the live app renders inside the
   * slide's right third (headless pane, screencast in-frame) and there is no
   * second window. `--pane-window` turns it OFF and restores the headed
   * two-window rehearsal layout. (The interim `--mirror` flag is retired — the
   * mirror is the default.)
   */
  readonly mirrorActive: boolean;
  /**
   * The synthetic standby cover (GP-DEMO-6). DEFAULT ON: every CLI run opens on
   * a held "arming apps" cover, not a bare slide 1, until prep + warm ops
   * settle. `--no-standby` is the rehearsal hatch (parallels `--pane-window`).
   */
  readonly standby: boolean;
  /** Bad flag values — the caller prints these and exits 2. */
  readonly errors: readonly string[];
}

function argFlag(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

/** Pure argv parser. Never throws; bad values land in `errors`. */
export function parseShowArgs(argv: readonly string[], testerRoot: string): DemoShowArgs {
  const errors: string[] = [];
  const ces = path.resolve(testerRoot, '..');

  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && FLAGS_WITH_VALUES.has(argv[i - 1])));
  const deckArg = positional.find((a) => a.toLowerCase().endsWith('.xlsx'));

  const number = (flag: string, fallback: number, what: string): number => {
    const raw = argFlag(argv, flag);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      errors.push(`${flag} must be a positive number (${what}), got ${JSON.stringify(raw)}`);
      return fallback;
    }
    return n;
  };

  const geometry = (flag: string, fallback: WindowGeometry): WindowGeometry => {
    const raw = argFlag(argv, flag);
    if (raw === undefined) return fallback;
    const parsed = parseGeometry(raw);
    if (!parsed) {
      errors.push(`${flag} must look like <width>x<height>+<x>+<y> (e.g. 1280x720+0+0), got ${JSON.stringify(raw)}`);
      return fallback;
    }
    return parsed;
  };

  const root = (flag: string, name: string): string =>
    argFlag(argv, flag) ? path.resolve(argFlag(argv, flag)!) : path.join(ces, name);

  return {
    deckPath: deckArg ? path.resolve(deckArg) : path.resolve(testerRoot, DEFAULT_DECK),
    check: argv.includes('--check'),
    slidesPort: number('--slides-port', DEFAULT_SLIDES_PORT, 'TCP port'),
    defaultDwellSec: number('--default-dwell', DEFAULT_DWELL_SEC, 'seconds'),
    auto: !argv.includes('--manual'),
    presenter: !argv.includes('--no-presenter'),
    slidesGeometry: geometry('--slides-window', DEFAULT_SLIDES_GEOMETRY),
    appGeometry: geometry('--app-window', DEFAULT_APP_GEOMETRY),
    testerRoot,
    stacksimRoot: root('--stacksim-root', 'tenant-stacksim'),
    aoRoot: root('--ao-root', 'ces-ao'),
    eoRoot: root('--eo-root', 'ces-eo'),
    stamperRoot: root('--stamper-root', 'ces-stamper'),
    musterRoot: root('--muster-root', 'ces-muster'),
    report: !argv.includes('--no-report'),
    watchouts: argv.includes('--watchouts'),
    // DEFAULT ON. `--pane-window` restores the headed second window and turns the
    // mirror off (so no dead <img> renders). Boolean — deliberately NOT in
    // FLAGS_WITH_VALUES (it consumes no value; the positional .xlsx still resolves).
    mirrorActive: !argv.includes('--pane-window'),
    // DEFAULT ON. `--no-standby` restores opening straight on slide 1 for
    // rehearsal. Boolean — deliberately NOT in FLAGS_WITH_VALUES (consumes no
    // value; the positional .xlsx still resolves after it).
    standby: !argv.includes('--no-standby'),
    errors,
  };
}

/**
 * Flags that consume the next argv entry, so it is never read as the deck. A
 * value-taking flag missing from this set is not a compile error and not a test
 * failure — it silently makes `--muster-root C:\x demos/d.xlsx` pick the wrong
 * positional. Every entry above must appear here.
 */
const FLAGS_WITH_VALUES = new Set([
  '--slides-port',
  '--default-dwell',
  '--slides-window',
  '--app-window',
  '--stacksim-root',
  '--ao-root',
  '--eo-root',
  '--stamper-root',
  '--muster-root',
]);

/**
 * `--check` forces every op to `staged` (A1). Returned as a new deck rather
 * than a flag threaded through the runner, so the walk below exercises exactly
 * the same code paths a staged deck takes on stage.
 */
export function withStagedOps(deck: DemoDeck): DemoDeck {
  return {
    ...deck,
    slides: deck.slides.map((s): DemoSlide => ({ ...s, op: { ...s.op, mode: 'staged' } })),
  };
}

export interface DeckCheckResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly slideCount: number;
  readonly rowCount: number;
  readonly failures: readonly string[];
}

/**
 * The unattended acceptance runner (A1): load -> render every slide -> walk the
 * whole deck front to back. Pure over an already-loaded deck so it is directly
 * unit-testable; the command wrapper does the IO.
 */
export function runDeckCheck(loaded: DemoDeck, defaultDwellSec: number): DeckCheckResult {
  const deck = withStagedOps(loaded);
  const lines: string[] = [];
  const failures: string[] = [];
  const view = buildDeckView(deck, { defaultDwellSec });

  lines.push(`deck: ${loaded.sourcePath}`);
  lines.push(`  ${deck.slides.length} slide(s), ${deck.slides.reduce((n, s) => n + s.rows.length, 0)} row(s), ${deck.assets.length} image asset(s)`);
  for (const w of deck.warnings) lines.push(`  WARN ${w}`);

  // 1. Every slide renders, and renders something.
  for (const slide of deck.slides) {
    const html = renderSlideHtml(slide);
    // A full-bleed `html` slide has no head by design — the deck author wrote a
    // graphic, not narration — so "no <h1>" is only a failure when there is no
    // html body either.
    if (html.trim() === '' || (!html.includes('<h1>') && !html.includes('class="slide-html"'))) {
      failures.push(`slide ${slide.slideNumber} rendered no title and no html body`);
    }
    if (slide.rows.length === 0) {
      failures.push(`slide ${slide.slideNumber} has no content rows`);
    }
    const dwellSec = slideDwellMs(slide, defaultDwellSec) / 1000;
    const original = loaded.slides.find((s) => s.slideNumber === slide.slideNumber)!;
    lines.push(
      `  slide ${String(slide.slideNumber).padStart(3)} — ${slide.rows.length} row(s), ` +
        `${dwellSec}s${original.op.durationSec === undefined ? ' (default)' : ''}, ` +
        `op ${original.op.mode}${original.op.opId ? ` ${original.op.opId}` : ''} ` +
        `[${original.op.tools.join(',') || 'no tools'}]${slide.op.images.length ? ` +${slide.op.images.length} image` : ''}`,
    );
  }

  // 2. The whole deck walks front to back, one `next` per slide, and stops.
  let state = createShowState(deck, { defaultDwellSec, now: 0 });
  const visited: number[] = deck.slides.length === 0 ? [] : [state.index];
  for (let step = 0; step < deck.slides.length + 2 && visited.length > 0; step++) {
    const before = state.index;
    state = reduceShow(deck, state, { type: 'next' }, 0);
    if (state.index === before) break;
    visited.push(state.index);
  }
  if (visited.length !== deck.slides.length) {
    failures.push(`walk visited ${visited.length} slide(s), expected ${deck.slides.length}`);
  }
  if (visited.some((v, i) => v !== i)) {
    failures.push(`walk order was ${visited.join(',')}, expected front-to-back`);
  }
  lines.push(`  walk: ${visited.length} slide(s) front-to-back, ops forced staged`);

  // 3. The page the operator would see actually builds.
  if (view.slides.length !== deck.slides.length) {
    failures.push(`deck view has ${view.slides.length} slide(s), deck has ${deck.slides.length}`);
  }

  return {
    ok: failures.length === 0,
    lines,
    slideCount: deck.slides.length,
    rowCount: deck.slides.reduce((n, s) => n + s.rows.length, 0),
    failures,
  };
}

export interface DemoShowDeps {
  /** Test seam: the operator run. Defaults to the real two-window runner. */
  readonly run?: (args: DemoShowArgs) => Promise<number>;
  readonly load?: (deckPath: string) => Promise<DemoDeck>;
  readonly log?: (line: string) => void;
}

/**
 * Exit codes: 0 = pass, 1 = the deck loaded but a check failed, 2 = the deck
 * could not be loaded or the invocation was bad. A malformed deck NEVER renders
 * partially (A3).
 */
export async function runDemoShowCommand(
  argv: string[],
  testerRoot: string,
  deps: DemoShowDeps = {},
): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const args = parseShowArgs(argv, testerRoot);

  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(`demo:show: ${e}`);
    return 2;
  }

  let deck: DemoDeck;
  try {
    deck = await (deps.load ?? ((p: string) => loadDeck(p)))(args.deckPath);
  } catch (err) {
    if (err instanceof DeckLoadFailure) {
      for (const line of formatDeckErrors(err.sourcePath, err.errors)) console.error(line);
      console.error(`demo:show: ${err.errors.length} problem(s) — nothing was rendered.`);
      return 2;
    }
    console.error(`demo:show: crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 2;
  }

  if (args.check) {
    const result = runDeckCheck(deck, args.defaultDwellSec);
    log('demo:show --check');
    for (const line of result.lines) log(line);
    for (const f of result.failures) log(`  FAIL ${f}`);
    log(`  => ${result.ok ? 'PASS' : 'FAIL'} — ${result.slideCount} slide(s), ${result.rowCount} row(s)`);
    return result.ok ? 0 : 1;
  }

  try {
    return await (deps.run ??
      ((a: DemoShowArgs) =>
        runShow(a, {
          // The 4th arg is the backstage mirror (GP-DEMO-5 streamgui), threaded
          // into `makeShowOps` so `prepare()` attaches it to the backstage session.
          makeOps: (pane, deck, runOptions, backstageMirror) =>
            makeShowOps(pane, deck, runOptions, { backstageMirror }),
        })))(args);
  } catch (err) {
    console.error(`demo:show: crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return 2;
  }
}
