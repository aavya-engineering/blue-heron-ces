// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S2 — the show's state machine, as a pure reducer.
 *
 * The pacing timer lives on the SERVER, never in the browser: the slides page
 * is a dumb renderer fed by SSE, so if the page reloads mid-demo it lands on
 * the right slide with the right countdown instead of restarting the deck. The
 * server owns this reducer; `slides-server.ts` is the only thing that calls it
 * with a real clock.
 *
 * Being pure is what makes A5 (nav) and A6 (pacing) provable without a browser:
 * every test below drives it with an injected `now`, so a 90-second dwell is a
 * number, not a wait.
 *
 * **FD-3's hold rule, precisely.** A slide whose op is still running does not
 * merely "hold past its dwell" — its dwell has not started. Entering such a
 * slide sets NO deadline; the deadline is set when the op reports `done` or
 * `failed`, so the slide then dwells for its full duration with results on
 * screen. Manual advance is always available and ignores the op entirely.
 */

import { slideDwellMs, type DemoDeck, type DemoSlide } from './deck-model.js';

/** Lifecycle of one slide's app-pane op. `none` = the slide drives nothing. */
export type OpStatus = 'none' | 'pending' | 'running' | 'done' | 'failed';

/**
 * The hold ladder (RESEARCH_SUMMARY 3): 0-800ms nothing, 800ms-2.5s a status
 * pill, past 2.5s the full-slide hold card. Rung boundaries live here rather
 * than in the page so they are arithmetic a test can pin.
 */
export const HOLD_PILL_MS = 800;
export const HOLD_CARD_MS = 2_500;
/** The rung at which the deck promotes to the full-slide hold card. */
export const HOLD_CARD_RUNG = 2;

export interface ShowState {
  /** 0-based index into `deck.slides`. */
  readonly index: number;
  /** Presenter band (talk track) visible — toggled with `t`. */
  readonly presenter: boolean;
  /** Auto-pacing on. Off means manual-only; toggling doubles as pause. */
  readonly auto: boolean;
  readonly exited: boolean;
  /** ms epoch the current slide advances at; `null` while holding or manual. */
  readonly dwellDeadline: number | null;
  readonly defaultDwellSec: number;
  /** One status per slide, parallel to `deck.slides`. */
  readonly ops: readonly OpStatus[];
  /** Ops that failed are surfaced, never swallowed — the band shows the reason. */
  readonly opError: string | null;
  /**
   * ms epoch the CURRENT slide started waiting on its op; `null` when it is not
   * waiting. This is the hold ladder's clock, and the only thing the ladder
   * needs that the state machine did not already hold.
   */
  readonly opSince: number | null;
}

export type ShowAction =
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'first' }
  | { readonly type: 'last' }
  | { readonly type: 'goto'; readonly index: number }
  | { readonly type: 'toggle-presenter' }
  | { readonly type: 'toggle-auto' }
  | { readonly type: 'exit' }
  | { readonly type: 'op'; readonly index: number; readonly status: OpStatus; readonly error?: string }
  | { readonly type: 'tick' };

/** Does this slide drive the app pane, or only narrate? */
export function slideDrivesOp(slide: DemoSlide): boolean {
  return slide.op.opId !== undefined && slide.op.mode !== 'staged';
}

export interface CreateShowStateOptions {
  readonly defaultDwellSec?: number;
  readonly auto?: boolean;
  readonly presenter?: boolean;
  readonly now?: number;
}

/** FD-3's configurable default when a slide's `duration (sec)` is blank. */
export const DEFAULT_DWELL_SEC = 30;

export function createShowState(deck: DemoDeck, opts: CreateShowStateOptions = {}): ShowState {
  const defaultDwellSec = opts.defaultDwellSec ?? DEFAULT_DWELL_SEC;
  const ops: OpStatus[] = deck.slides.map((s) => (slideDrivesOp(s) ? 'pending' : 'none'));
  const auto = opts.auto ?? true;
  const now = opts.now ?? Date.now();
  return {
    index: 0,
    presenter: opts.presenter ?? true,
    auto,
    exited: false,
    dwellDeadline:
      auto && ops[0] === 'none' && deck.slides[0] ? now + slideDwellMs(deck.slides[0], defaultDwellSec) : null,
    defaultDwellSec,
    ops,
    opError: null,
    opSince: isHolding(ops[0]) ? now : null,
  };
}

/** An op the room is waiting on — the dwell has not started. */
function isHolding(status: OpStatus | undefined): boolean {
  return status === 'pending' || status === 'running';
}

/** Is the slide's op still outstanding — i.e. is the dwell not yet started? */
function holding(state: ShowState, index: number): boolean {
  return isHolding(state.ops[index]);
}

/** Recompute the deadline for whatever slide `index` now is. */
function deadlineFor(deck: DemoDeck, state: ShowState, index: number, now: number): number | null {
  if (!state.auto || state.exited) return null;
  if (holding(state, index)) return null;
  const slide = deck.slides[index];
  return slide ? now + slideDwellMs(slide, state.defaultDwellSec) : null;
}

function moveTo(deck: DemoDeck, state: ShowState, target: number, now: number): ShowState {
  const index = Math.max(0, Math.min(deck.slides.length - 1, target));
  if (index === state.index) return state;
  // A new slide restarts the hold ladder: the room has not been waiting on
  // THIS slide's op for however long the last one took.
  const moved: ShowState = { ...state, index, opError: null, opSince: holding(state, index) ? now : null };
  return { ...moved, dwellDeadline: deadlineFor(deck, moved, index, now) };
}

/**
 * The whole show, one function. `now` is injected so every pacing rule is
 * testable as arithmetic; the server passes `Date.now()`.
 */
export function reduceShow(deck: DemoDeck, state: ShowState, action: ShowAction, now: number): ShowState {
  if (state.exited) return state;

  switch (action.type) {
    case 'next':
      // The last slide is a wall, not a wrap: an auto-paced deck that looped
      // would restart the demo behind the presenter's back.
      if (state.index >= deck.slides.length - 1) return { ...state, dwellDeadline: null };
      return moveTo(deck, state, state.index + 1, now);

    case 'prev':
      return moveTo(deck, state, state.index - 1, now);

    case 'first':
      return moveTo(deck, state, 0, now);

    case 'last':
      return moveTo(deck, state, deck.slides.length - 1, now);

    case 'goto':
      return moveTo(deck, state, action.index, now);

    case 'toggle-presenter':
      return { ...state, presenter: !state.presenter };

    case 'toggle-auto': {
      const auto = !state.auto;
      const next: ShowState = { ...state, auto };
      return { ...next, dwellDeadline: deadlineFor(deck, next, next.index, now) };
    }

    case 'exit':
      return { ...state, exited: true, dwellDeadline: null };

    case 'op': {
      if (action.index < 0 || action.index >= state.ops.length) return state;
      const ops = state.ops.slice();
      ops[action.index] = action.status;
      const next: ShowState = {
        ...state,
        ops,
        opError: action.status === 'failed' ? (action.error ?? 'op failed') : state.opError,
      };
      // The dwell starts when the CURRENT slide's op finishes — that is the
      // whole of FD-3's "holds until the op completes, then dwells".
      if (action.index !== state.index) return next;
      return {
        ...next,
        // `pending -> running` keeps the original clock: the room started
        // waiting when the slide arrived, not when the driver got around to it.
        opSince: isHolding(action.status) ? (state.opSince ?? now) : null,
        dwellDeadline: deadlineFor(deck, next, next.index, now),
      };
    }

    case 'tick': {
      if (!state.auto || state.dwellDeadline === null || now < state.dwellDeadline) return state;
      return reduceShow(deck, state, { type: 'next' }, now);
    }

    default:
      return state;
  }
}

/** Keyboard/remote key -> action. Shared by the page and the terminal (A5). */
export function keyToAction(key: string): ShowAction | undefined {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'n':
      return { type: 'next' };
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'p':
      return { type: 'prev' };
    case 'Home':
    case 'f':
      return { type: 'first' };
    case 'End':
    case 'l':
      return { type: 'last' };
    case 't':
      return { type: 'toggle-presenter' };
    // `a` is also the demo's HOLD key. The V4 mockup drew hold on `p`, which is
    // already prev here; founder-approved resolution (2026-09-05) keeps
    // `p` = prev and ships hold as `a`, because holding a deck IS suspending
    // auto-pacing — one action, one key, and the footer advisory says `A hold`.
    case 'a':
      return { type: 'toggle-auto' };
    case 'Escape':
    case 'q':
      return { type: 'exit' };
    default:
      return undefined;
  }
}

/** What the page needs to draw: index, countdown, op status. Serializable. */
export interface ShowSnapshot {
  readonly index: number;
  readonly slideCount: number;
  readonly presenter: boolean;
  readonly auto: boolean;
  readonly exited: boolean;
  /** Seconds left in the dwell, or null while holding / manual. */
  readonly remainingSec: number | null;
  readonly opStatus: OpStatus;
  readonly opError: string | null;
  /**
   * Which rung of the hold ladder the current slide is on: 0 silent, 1 status
   * pill, 2 full-slide hold card. Discrete rather than raw elapsed ms so the
   * server's "only broadcast on change" stays true during a long op.
   */
  readonly holdRung: 0 | 1 | 2;
}

/** 0 | 1 | 2 — see `HOLD_PILL_MS` / `HOLD_CARD_MS`. */
export function holdRung(state: ShowState, now: number): 0 | 1 | 2 {
  if (!isHolding(state.ops[state.index]) || state.opSince === null) return 0;
  const held = now - state.opSince;
  if (held >= HOLD_CARD_MS) return 2;
  return held >= HOLD_PILL_MS ? 1 : 0;
}

export function snapshot(deck: DemoDeck, state: ShowState, now: number): ShowSnapshot {
  return {
    index: state.index,
    slideCount: deck.slides.length,
    presenter: state.presenter,
    auto: state.auto,
    exited: state.exited,
    remainingSec:
      state.dwellDeadline === null ? null : Math.max(0, Math.ceil((state.dwellDeadline - now) / 1000)),
    opStatus: state.ops[state.index] ?? 'none',
    opError: state.opError,
    holdRung: holdRung(state, now),
  };
}
