// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S2 — the pure state machine: nav (A5) and pacing (A6).
 *
 * Every test drives `reduceShow` with an injected clock, so a 90-second dwell
 * costs nothing to assert. The hold rule is the one worth reading closely: a
 * slide whose op is still running has NO deadline at all — the dwell starts
 * when the op reports done, which is FD-3's "holds until the op completes,
 * then dwells".
 */

import { describe, it, expect } from 'vitest';
import type { DemoDeck, DemoSlide, OpMode } from '../src/demo/show/deck-model.js';
import {
  createShowState,
  holdRung,
  keyToAction,
  reduceShow,
  slideDrivesOp,
  snapshot,
  DEFAULT_DWELL_SEC,
  HOLD_CARD_MS,
  HOLD_PILL_MS,
  type ShowState,
} from '../src/demo/show/show-state.js';

function slide(n: number, opts: { mode?: OpMode; opId?: 'ao-registry'; durationSec?: number } = {}): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}` }],
    op: { mode: opts.mode ?? 'staged', opId: opts.opId, tools: [], durationSec: opts.durationSec, images: [] },
  };
}

function deckOf(...slides: DemoSlide[]): DemoDeck {
  return { sourcePath: 'demos/t.xlsx', baseDir: '/demos', title: 't', slides, assets: [], warnings: [] };
}

const PLAIN = deckOf(slide(1, { durationSec: 10 }), slide(2, { durationSec: 20 }), slide(3));

describe('nav (A5)', () => {
  const start = (): ShowState => createShowState(PLAIN, { now: 0 });

  it('next / prev / first / last move as expected', () => {
    let s = start();
    expect(s.index).toBe(0);
    s = reduceShow(PLAIN, s, { type: 'next' }, 0);
    expect(s.index).toBe(1);
    s = reduceShow(PLAIN, s, { type: 'last' }, 0);
    expect(s.index).toBe(2);
    s = reduceShow(PLAIN, s, { type: 'prev' }, 0);
    expect(s.index).toBe(1);
    s = reduceShow(PLAIN, s, { type: 'first' }, 0);
    expect(s.index).toBe(0);
  });

  it('clamps at both ends — never wraps', () => {
    let s = start();
    s = reduceShow(PLAIN, s, { type: 'prev' }, 0);
    expect(s.index).toBe(0);
    s = reduceShow(PLAIN, s, { type: 'last' }, 0);
    s = reduceShow(PLAIN, s, { type: 'next' }, 0);
    expect(s.index).toBe(2);
    // The wall stops auto-pacing rather than looping the deck.
    expect(s.dwellDeadline).toBeNull();
  });

  it('goto clamps out-of-range targets', () => {
    expect(reduceShow(PLAIN, start(), { type: 'goto', index: 99 }, 0).index).toBe(2);
    expect(reduceShow(PLAIN, start(), { type: 'goto', index: -4 }, 0).index).toBe(0);
  });

  it('exit is terminal — later actions are ignored', () => {
    let s = reduceShow(PLAIN, start(), { type: 'exit' }, 0);
    expect(s.exited).toBe(true);
    s = reduceShow(PLAIN, s, { type: 'next' }, 0);
    expect(s.index).toBe(0);
    expect(s.exited).toBe(true);
  });

  it('maps the keys the page and the terminal both send', () => {
    expect(keyToAction('ArrowRight')).toEqual({ type: 'next' });
    expect(keyToAction(' ')).toEqual({ type: 'next' });
    expect(keyToAction('ArrowLeft')).toEqual({ type: 'prev' });
    expect(keyToAction('Home')).toEqual({ type: 'first' });
    expect(keyToAction('End')).toEqual({ type: 'last' });
    expect(keyToAction('Escape')).toEqual({ type: 'exit' });
    expect(keyToAction('q')).toEqual({ type: 'exit' });
    expect(keyToAction('t')).toEqual({ type: 'toggle-presenter' });
    expect(keyToAction('z')).toBeUndefined();
  });

  it('keeps p = prev and ships HOLD on a, exactly as the footer advertises', () => {
    // The V4 mockup drew hold on `p`; production had `p` = prev first, so the
    // hold key is `a` and the page's kbd chips say so.
    expect(keyToAction('p')).toEqual({ type: 'prev' });
    expect(keyToAction('a')).toEqual({ type: 'toggle-auto' });
  });

  it('toggles the presenter band without moving', () => {
    const s = reduceShow(PLAIN, createShowState(PLAIN, { now: 0 }), { type: 'toggle-presenter' }, 0);
    expect(s.presenter).toBe(false);
    expect(s.index).toBe(0);
  });
});

describe('pacing (A6)', () => {
  it('honours a per-slide duration', () => {
    let s = createShowState(PLAIN, { now: 1_000 });
    expect(s.dwellDeadline).toBe(1_000 + 10_000);
    s = reduceShow(PLAIN, s, { type: 'tick' }, 10_999);
    expect(s.index).toBe(0);
    s = reduceShow(PLAIN, s, { type: 'tick' }, 11_000);
    expect(s.index).toBe(1);
    expect(s.dwellDeadline).toBe(11_000 + 20_000);
  });

  it('falls back to the run default when the duration is blank', () => {
    let s = createShowState(PLAIN, { now: 0, defaultDwellSec: 30 });
    s = reduceShow(PLAIN, s, { type: 'goto', index: 2 }, 5_000);
    expect(s.dwellDeadline).toBe(5_000 + 30_000);
    expect(DEFAULT_DWELL_SEC).toBe(30);
  });

  it('honours an overridden --default-dwell', () => {
    const s = createShowState(deckOf(slide(1)), { now: 0, defaultDwellSec: 7 });
    expect(s.dwellDeadline).toBe(7_000);
  });

  it('--manual (auto off) never advances on a tick, but nav still works', () => {
    let s = createShowState(PLAIN, { now: 0, auto: false });
    expect(s.dwellDeadline).toBeNull();
    s = reduceShow(PLAIN, s, { type: 'tick' }, 999_999);
    expect(s.index).toBe(0);
    s = reduceShow(PLAIN, s, { type: 'next' }, 0);
    expect(s.index).toBe(1);
  });

  it('toggling auto back on restarts the dwell from now', () => {
    let s = createShowState(PLAIN, { now: 0, auto: false });
    s = reduceShow(PLAIN, s, { type: 'toggle-auto' }, 4_000);
    expect(s.auto).toBe(true);
    expect(s.dwellDeadline).toBe(4_000 + 10_000);
    s = reduceShow(PLAIN, s, { type: 'toggle-auto' }, 5_000);
    expect(s.dwellDeadline).toBeNull();
  });
});

describe('hold while an op runs (A6, FD-3)', () => {
  const OP_DECK = deckOf(
    slide(1, { durationSec: 10 }),
    slide(2, { mode: 'live', opId: 'ao-registry', durationSec: 20 }),
    slide(3, { durationSec: 5 }),
  );

  it('knows which slides drive an op', () => {
    expect(slideDrivesOp(OP_DECK.slides[0])).toBe(false);
    expect(slideDrivesOp(OP_DECK.slides[1])).toBe(true);
    // A staged slide replays; it never drives, even when it names an op.
    expect(slideDrivesOp({ ...OP_DECK.slides[1], op: { ...OP_DECK.slides[1].op, mode: 'staged' } })).toBe(false);
  });

  it('sets no deadline while the op is outstanding, then dwells its full duration', () => {
    let s = createShowState(OP_DECK, { now: 0 });
    expect(s.ops).toEqual(['none', 'pending', 'none']);

    s = reduceShow(OP_DECK, s, { type: 'next' }, 10_000);
    expect(s.index).toBe(1);
    expect(s.dwellDeadline).toBeNull(); // holding — the op has not started

    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'running' }, 10_100);
    expect(s.dwellDeadline).toBeNull();

    // Ticking during the hold must not advance, however long the op takes.
    s = reduceShow(OP_DECK, s, { type: 'tick' }, 999_999);
    expect(s.index).toBe(1);

    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'done' }, 100_000);
    expect(s.dwellDeadline).toBe(100_000 + 20_000);
    s = reduceShow(OP_DECK, s, { type: 'tick' }, 119_999);
    expect(s.index).toBe(1);
    s = reduceShow(OP_DECK, s, { type: 'tick' }, 120_000);
    expect(s.index).toBe(2);
  });

  it('manual advance always beats the hold', () => {
    let s = createShowState(OP_DECK, { now: 0 });
    s = reduceShow(OP_DECK, s, { type: 'next' }, 0);
    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'running' }, 0);
    s = reduceShow(OP_DECK, s, { type: 'next' }, 1_000);
    expect(s.index).toBe(2);
    expect(s.dwellDeadline).toBe(1_000 + 5_000);
  });

  it('a failed op releases the hold and surfaces the reason', () => {
    let s = createShowState(OP_DECK, { now: 0 });
    s = reduceShow(OP_DECK, s, { type: 'next' }, 0);
    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'failed', error: 'AO GUI never came up' }, 500);
    expect(s.dwellDeadline).toBe(500 + 20_000);
    expect(snapshot(OP_DECK, s, 500).opError).toBe('AO GUI never came up');
    expect(snapshot(OP_DECK, s, 500).opStatus).toBe('failed');
  });

  it('a warm op that already completed does not re-hold when the slide arrives', () => {
    let s = createShowState(OP_DECK, { now: 0 });
    // Warm: prep completes the op before the slide is ever entered.
    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'done' }, 0);
    expect(s.dwellDeadline).toBe(10_000); // slide 1's own dwell, untouched
    s = reduceShow(OP_DECK, s, { type: 'next' }, 10_000);
    expect(s.dwellDeadline).toBe(10_000 + 20_000);
  });
});

/**
 * The V4 hold ladder (RESEARCH_SUMMARY 3): 0-800ms the chrome says nothing,
 * 800ms-2.5s a status pill, past 2.5s the deck promotes to a full-slide hold
 * card. The rung is discrete on purpose — the page draws it, the server decides
 * it, and it is arithmetic here.
 */
describe('hold ladder (V4)', () => {
  const OP_DECK = deckOf(
    slide(1, { durationSec: 10 }),
    slide(2, { mode: 'live', opId: 'ao-registry', durationSec: 20 }),
    slide(3, { durationSec: 5 }),
  );

  const enterOpSlide = (at: number): ShowState => {
    const s = createShowState(OP_DECK, { now: 0 });
    return reduceShow(OP_DECK, s, { type: 'next' }, at);
  };

  it('climbs silent -> pill -> hold card on the research thresholds', () => {
    const s = enterOpSlide(1_000);
    expect(holdRung(s, 1_000)).toBe(0);
    expect(holdRung(s, 1_000 + HOLD_PILL_MS - 1)).toBe(0);
    expect(holdRung(s, 1_000 + HOLD_PILL_MS)).toBe(1);
    expect(holdRung(s, 1_000 + HOLD_CARD_MS - 1)).toBe(1);
    expect(holdRung(s, 1_000 + HOLD_CARD_MS)).toBe(2);
    expect(snapshot(OP_DECK, s, 1_000 + HOLD_CARD_MS).holdRung).toBe(2);
  });

  it('keeps the clock across pending -> running: the room started waiting on arrival', () => {
    let s = enterOpSlide(1_000);
    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'running' }, 1_400);
    expect(s.opSince).toBe(1_000);
    expect(holdRung(s, 1_000 + HOLD_CARD_MS)).toBe(2);
  });

  it('drops to rung 0 the moment the op reports, and stays there', () => {
    let s = enterOpSlide(0);
    expect(holdRung(s, HOLD_CARD_MS)).toBe(2);
    s = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'done' }, HOLD_CARD_MS);
    expect(s.opSince).toBeNull();
    expect(holdRung(s, 999_999)).toBe(0);
  });

  it('restarts the ladder on nav — a new slide has not been waited on', () => {
    let s = enterOpSlide(0);
    expect(holdRung(s, HOLD_CARD_MS)).toBe(2);
    s = reduceShow(OP_DECK, s, { type: 'next' }, HOLD_CARD_MS);
    expect(s.opSince).toBeNull();
    expect(holdRung(s, HOLD_CARD_MS)).toBe(0);
    // Back onto the still-pending op slide: the wait starts over.
    s = reduceShow(OP_DECK, s, { type: 'prev' }, 100_000);
    expect(s.opSince).toBe(100_000);
    expect(holdRung(s, 100_000 + HOLD_PILL_MS)).toBe(1);
  });

  it('ignores an op report for a slide the deck is not on', () => {
    const s = createShowState(OP_DECK, { now: 0 });
    const after = reduceShow(OP_DECK, s, { type: 'op', index: 1, status: 'running' }, 5_000);
    expect(after.opSince).toBeNull();          // slide 1 drives nothing
    expect(holdRung(after, 999_999)).toBe(0);
  });

  it('a slide that drives nothing never leaves rung 0', () => {
    const s = createShowState(PLAIN, { now: 0 });
    expect(s.opSince).toBeNull();
    expect(holdRung(s, 999_999)).toBe(0);
    expect(snapshot(PLAIN, s, 999_999).holdRung).toBe(0);
  });
});

describe('snapshot', () => {
  it('reports the countdown, or null while holding / manual', () => {
    const s = createShowState(PLAIN, { now: 0 });
    expect(snapshot(PLAIN, s, 2_500)).toMatchObject({ index: 0, slideCount: 3, remainingSec: 8, auto: true });
    const manual = createShowState(PLAIN, { now: 0, auto: false });
    expect(snapshot(PLAIN, manual, 0).remainingSec).toBeNull();
  });

  it('never reports a negative countdown', () => {
    const s = createShowState(PLAIN, { now: 0 });
    expect(snapshot(PLAIN, s, 99_999).remainingSec).toBe(0);
  });
});
