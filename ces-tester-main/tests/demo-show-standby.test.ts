// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the synthetic standby cover ("slide 0").
 *
 * The runner injects a held cover before authored slide 1 so both operator
 * windows never open on a bare, dwell-burning slide 1 while the CES tools arm
 * behind them. These tests pin the four things that make that honest:
 *
 * 1. **It HOLDS** — its op is `pending` forever, so `dwellDeadline` is null and
 *    the countdown never burns during arming.
 * 2. **It reveals** — once prep settles the runner advances 0 -> 1, and slide 1
 *    (not the cover) is what gets entered and drives its op.
 * 3. **It never runs an op** — not on first entry and not on a back-nav to it.
 * 4. **It does not shift the authored chrome** — the title treatment and the
 *    "01 of N" position both still follow authored slide 1, not the cover.
 *
 * The runner-only nature is the whole safety story: the loader, validator and
 * `--check` never see it, so nothing an operator authors can produce it.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withStandby, isStandbySlide, STANDBY_OP_ID } from '../src/demo/show/standby.js';
import {
  createShowState,
  reduceShow,
  holdRung,
  snapshot,
  HOLD_CARD_MS,
} from '../src/demo/show/show-state.js';
import { buildDeckView } from '../src/demo/show/slide-render.js';
import { runShow, type ShowRunOptions, type ShowOpRunner } from '../src/demo/show/show-run.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import { DEFAULT_APP_GEOMETRY, DEFAULT_SLIDES_GEOMETRY } from '../src/demo/show/app-pane.js';
import type { ShowReport } from '../src/demo/show/run-report.js';

function slide(n: number, op: Partial<DemoSlide['op']> = {}): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}`, talkTrack: `talk ${n}` }],
    op: { mode: 'staged', tools: [], images: [], ...op },
  };
}

function deckOf(...slides: DemoSlide[]): DemoDeck {
  return {
    sourcePath: 'demos/t.xlsx',
    baseDir: '/demos',
    title: 'standby-deck',
    slides,
    assets: [],
    warnings: [],
  };
}

const OPTIONS: ShowRunOptions = {
  deckPath: 'demos/t.xlsx',
  slidesPort: 0,
  defaultDwellSec: 30,
  auto: true,
  presenter: true,
  slidesGeometry: DEFAULT_SLIDES_GEOMETRY,
  appGeometry: DEFAULT_APP_GEOMETRY,
  testerRoot: os.tmpdir(),
  stacksimRoot: 'C:/ces/tenant-stacksim',
  aoRoot: 'C:/ces/ces-ao',
};

function fakePane(): AppPane {
  return {
    page: {} as AppPane['page'],
    session: {} as AppPane['session'],
    goto: async () => undefined,
    close: async () => undefined,
  } as AppPane;
}

describe('withStandby / isStandbySlide', () => {
  it('prepends exactly one synthetic cover and leaves the authored slides intact', () => {
    const deck = deckOf(slide(1), slide(2));
    const withCover = withStandby(deck);
    expect(withCover.slides).toHaveLength(3);
    expect(withCover.slides[0].slideNumber).toBe(0);
    expect(withCover.slides[0].op.opId).toBe(STANDBY_OP_ID);
    // The authored slides ride through untouched.
    expect(withCover.slides.slice(1)).toEqual(deck.slides);
    // The input deck is not mutated.
    expect(deck.slides).toHaveLength(2);
  });

  it('identifies only the synthetic cover, never an authored slide', () => {
    const withCover = withStandby(deckOf(slide(1), slide(2)));
    expect(isStandbySlide(withCover.slides[0])).toBe(true);
    expect(isStandbySlide(withCover.slides[1])).toBe(false);
    expect(isStandbySlide(withCover.slides[2])).toBe(false);
    // slideNumber 0 alone is not enough — the synthetic op id must match too.
    expect(isStandbySlide(slide(0))).toBe(false);
  });
});

describe('the standby cover HOLDS (no dwell burn)', () => {
  it('starts pending with a null deadline, and climbs to the hold card', () => {
    // A narration-only authored slide 1 would set a deadline at state creation
    // and burn its dwell during arming. The cover's live op holds instead.
    const deck = withStandby(deckOf(slide(1), slide(2)));
    const state = createShowState(deck, { now: 1_000 });
    expect(state.index).toBe(0);
    expect(state.ops[0]).toBe('pending');
    expect(state.dwellDeadline).toBeNull();
    expect(state.opSince).toBe(1_000);
    // The hold ladder promotes to the full-slide card past 2.5s, exactly as a
    // real live op would — the operator sees a deliberate "standby", not a hang.
    expect(holdRung(state, 1_000 + HOLD_CARD_MS)).toBe(2);
    // A tick never advances a holding cover — the countdown is dormant.
    const ticked = reduceShow(deck, state, { type: 'tick' }, 1_000 + 999_999);
    expect(ticked.index).toBe(0);
    expect(snapshot(deck, state, 5_000).remainingSec).toBeNull();
  });

  it('a manual advance escapes the cover early even while it holds', () => {
    const deck = withStandby(deckOf(slide(1), slide(2)));
    const state = createShowState(deck, { now: 0 });
    const next = reduceShow(deck, state, { type: 'next' }, 5_000);
    expect(next.index).toBe(1); // moved onto authored slide 1
  });
});

describe('buildDeckView with a standby cover', () => {
  it('renders the cover, blanks its hold card, and keeps the title + position on authored slide 1', () => {
    const view = buildDeckView(withStandby(deckOf(slide(1), slide(2))));
    // The cover renders its own static body from existing V4 classes.
    expect(view.slides[0].html).toContain('Preparing the demo');
    expect(view.slides[0].html).toContain('Standby · arming the CES tools');
    // No hold card for the cover — draw() must never swap its body away.
    expect(view.slides[0].holdHtml).toBe('');
    // The title treatment follows authored slide 1 (deck index 1), not the cover.
    expect(view.slides[0].isTitle).toBe(false);
    expect(view.slides[1].isTitle).toBe(true);
  });

  it('counts only authored slides in the position chrome, so slide 1 reads 01 of N', () => {
    // Three authored slides + the cover. The authored title slide's stat row and
    // the hold-card foot must read "N" and "of N", never "N+1".
    const view = buildDeckView(withStandby(deckOf(slide(1), slide(2, { mode: 'live', opId: 'ao-registry' }), slide(3))));
    expect(view.slides[1].html).toContain('<span>3 slides</span>');
    // Authored slide 2 drives a live op, so it carries a hold card whose foot
    // counts real slides: "slide 02 of 03", not 03 of 04.
    expect(view.slides[2].holdHtml).toContain('slide 02 of 03');
  });

  it('is byte-identical to a standby-free deck for every authored slide (no leak)', () => {
    const deck = deckOf(slide(1), slide(2, { mode: 'live', opId: 'ao-registry' }));
    const plain = buildDeckView(deck);
    const withCover = buildDeckView(withStandby(deck));
    // The authored slides render exactly as they do without a cover — the only
    // difference in the view is the prepended cover at index 0.
    for (let i = 0; i < plain.slides.length; i++) {
      const a = plain.slides[i];
      const b = withCover.slides[i + 1];
      expect(b.html).toBe(a.html);
      expect(b.holdHtml).toBe(a.holdHtml);
      expect(b.isTitle).toBe(a.isTitle);
    }
  });
});

describe('runShow reveals the cover and never runs its op', () => {
  it('advances 0 -> 1 on settle and drives authored slide 1, never the cover', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-standby-'));
    try {
      const runCalls: number[] = [];
      const ops: ShowOpRunner = {
        run: async (ctx) => {
          runCalls.push(ctx.index);
        },
      };
      const deck = deckOf(slide(1, { mode: 'live', opId: 'ao-registry' }), slide(2));

      const code = await runShow(
        { ...OPTIONS, standby: true, testerRoot: root, runId: 'standby-reveal' },
        {
          load: async () => deck,
          probe: async () => 'free',
          openSlides: async () => ({ close: async () => undefined }) as never,
          openApp: async () => fakePane(),
          makeOps: () => ops,
          until: (exit) => exit(),
          log: () => undefined,
        },
      );
      expect(code).toBe(0);

      // The reveal advanced onto authored slide 1 (deck index 1) and drove its
      // op; the cover's op (index 0) was guarded and never ran.
      expect(runCalls).toContain(1);
      expect(runCalls).not.toContain(0);

      const report = JSON.parse(
        fs.readFileSync(path.join(root, 'runs', 'show', 'standby-reveal', 'report.json'), 'utf8'),
      ) as ShowReport;
      // The cover is a slide-0 sentinel with no visits — no phantom entry.
      expect(report.slides[0].slideNumber).toBe(0);
      expect(report.slides[0].visits).toHaveLength(0);
      // Authored slide 1 was entered exactly once, on the reveal.
      expect(report.slides[1].visits).toHaveLength(1);
      // The count documents that the cover DOES ride in the deck the run pacing
      // sees (accepted; the sentinel lets consumers filter it).
      expect(report.deck.slideCount).toBe(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a back-nav onto the cover does NOT run an op', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-standby-back-'));
    try {
      const runCalls: number[] = [];
      const ops: ShowOpRunner = {
        run: async (ctx) => {
          runCalls.push(ctx.index);
        },
      };
      const deck = deckOf(slide(1, { mode: 'live', opId: 'ao-registry' }), slide(2));

      // A TTY-shaped fake so the runner wires the terminal handler. In `until`
      // we send ArrowLeft (prev) — which, from revealed slide 1, moves back onto
      // the cover and calls startOpFor(0) — then exit.
      const stdin = Object.assign(new EventEmitter(), {
        isTTY: true,
        setRawMode: () => undefined,
        resume: () => undefined,
        setEncoding: () => undefined,
        pause: () => undefined,
      }) as unknown as NodeJS.ReadStream;

      await runShow(
        { ...OPTIONS, standby: true, testerRoot: root, runId: 'standby-back', report: false },
        {
          load: async () => deck,
          probe: async () => 'free',
          openSlides: async () => ({ close: async () => undefined }) as never,
          openApp: async () => fakePane(),
          makeOps: () => ops,
          stdin,
          until: (exit) => {
            stdin.emit('data', '\u001b[D'); // ArrowLeft -> prev -> back onto the cover
            exit();
          },
          log: () => undefined,
        },
      );

      // Slide 1's op ran once on the reveal; the back-nav onto the cover ran
      // nothing (the guard held), so index 0 never appears.
      expect(runCalls).toEqual([1]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
