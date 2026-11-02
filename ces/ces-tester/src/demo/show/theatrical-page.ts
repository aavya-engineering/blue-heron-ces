// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the THEATRICAL page: the visible app pane, driven so an audience
 * can SEE it being driven.
 *
 * The problem this solves was measured on stage (founder, 2026-09-08): "I can
 * see the app now, but I don't see it being controlled and responding." The
 * narrow `UiPage` seam is built for correctness — `fill()` is an instantaneous
 * DOM assignment, `click()` teleports the pointer, a whole five-field manifest
 * lands in ~200 ms — and at that speed a real drive is indistinguishable from a
 * static screenshot. The branded cursor overlay (`app-pane.ts`, S5) was already
 * listening for pointer events that nothing ever sent slowly enough to watch.
 *
 * This decorator keeps every op and driver EXACTLY as written (they still call
 * the same `UiPage` verbs, and the hand-written fakes in tests still satisfy
 * them) and changes only what a verb looks like on the pane:
 *
 *   click        glide the pointer to the target over ~450 ms (real `mousemove`
 *                events, so the S5 dot rides along), hover, click, settle.
 *   fill         glide, click into the field, then TYPE at a human cadence
 *                through the keyboard (capped so a long value never stalls the
 *                beat), settle. Falls back to the instant fill if the typed
 *                value did not land (a masked/controlled input).
 *   check /      glide, act, settle.
 *   selectOption
 *   setInputFiles glide to the input (or its nearest visible ancestor when the
 *                input is hidden behind a styled label), set, settle a little
 *                longer so the app's response is seen.
 *   goto         navigate, then a beat so the page is seen arriving.
 *
 * Reads (`textContent`, `isVisible`, waits …) pass straight through — theatre
 * must never slow a judge.
 *
 * Every theatrical embellishment is wrapped: if the glide cannot find a box, or
 * the page navigated under the pointer, the base verb still runs. Theatre can
 * be skipped; the drive cannot be broken by it.
 *
 * The HUD (`paneHud`) is the second half: a small, honest status strip the op
 * can pin over the app while REAL work with no UI of its own is running (the
 * ~80 s DISCOVERY-1 CLI walk). It says what is happening and how long it has
 * been happening — the pane is never silently blank while the klaxon is red.
 */

import type { UiPage } from '../ui-page.js';

/**
 * The slice of a Playwright `Page` the theatre needs. Declared structurally so
 * a test can hand in a fake and pin the choreography (glide before click,
 * typing instead of fill) without a browser. A real `Page` satisfies it as-is.
 */
export interface TheatreSurface {
  readonly mouse: { move(x: number, y: number, options?: { steps?: number }): Promise<void> };
  readonly keyboard: { type(text: string, options?: { delay?: number }): Promise<void> };
  locator(selector: string): TheatreLocator;
  evaluate<R>(pageFunction: string | ((arg: unknown) => R), arg?: unknown): Promise<R>;
  viewportSize(): { width: number; height: number } | null;
}

export interface TheatreLocator {
  first(): TheatreLocator;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  inputValue(): Promise<string>;
  locator(selector: string): TheatreLocator;
  count(): Promise<number>;
}

export interface TheatreTempo {
  /** Pointer travel time to a target. */
  readonly glideMs: number;
  /** Hover before the click lands — the audience sees WHERE before WHAT. */
  readonly hoverMs: number;
  /** Per-character typing delay. */
  readonly typeDelayMs: number;
  /** The longest a single typed value may take, whatever its length. */
  readonly maxTypeMs: number;
  /** After every action, so the app's response is seen before the next move. */
  readonly settleMs: number;
}

/** Measured against a 640×1080 pane on a 720p stage — brisk but followable. */
export const THEATRE_TEMPO: TheatreTempo = {
  glideMs: 450,
  hoverMs: 180,
  typeDelayMs: 45,
  maxTypeMs: 2_500,
  settleMs: 350,
};

/** Steps per glide. Enough that the S5 dot draws a path, not a jump. */
const GLIDE_STEPS = 24;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ease-in-out on [0,1] — a pointer that accelerates then lands. */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Run an embellishment; a failure is swallowed, the drive goes on. */
async function best<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch {
    return undefined;
  }
}

/**
 * Decorate `base` so its writing verbs are visibly performed on `surface`.
 * The returned object is a full `UiPage`; reads are `base`'s own.
 */
export function theatricalUiPage(surface: TheatreSurface, base: UiPage, tempo: TheatreTempo = THEATRE_TEMPO): UiPage {
  // Where the pointer last was, so each glide starts from the previous target.
  let cursor: { x: number; y: number } | undefined;

  const viewportCenter = (): { x: number; y: number } => {
    const v = surface.viewportSize();
    return v ? { x: v.width / 2, y: v.height / 2 } : { x: 320, y: 400 };
  };

  /** The visible box of `selector`, or of its nearest visible ancestor. */
  const targetBox = async (selector: string) => {
    let loc = surface.locator(selector).first();
    await best(() => loc.scrollIntoViewIfNeeded());
    for (let hop = 0; hop < 4; hop += 1) {
      const box = await best(() => loc.boundingBox());
      if (box && box.width > 0 && box.height > 0) return box;
      loc = loc.locator('xpath=..').first();
    }
    return null;
  };

  /** Glide the pointer to the target's center. True if a box was found. */
  const glide = async (selector: string): Promise<boolean> => {
    const box = await targetBox(selector);
    if (!box) return false;
    const to = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 24) };
    const from = cursor ?? viewportCenter();
    const stepMs = tempo.glideMs / GLIDE_STEPS;
    for (let i = 1; i <= GLIDE_STEPS; i += 1) {
      const t = ease(i / GLIDE_STEPS);
      await best(() => surface.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t));
      await sleep(stepMs);
    }
    cursor = to;
    await sleep(tempo.hoverMs);
    return true;
  };

  const settle = (): Promise<void> => sleep(tempo.settleMs);

  return {
    ...base,
    goto: async (url) => {
      await base.goto(url);
      cursor = undefined;
      await settle();
    },
    click: async (selector) => {
      await glide(selector);
      await base.click(selector);
      await settle();
    },
    check: async (selector) => {
      await glide(selector);
      await base.check(selector);
      await settle();
    },
    selectOption: async (selector, value) => {
      await glide(selector);
      await base.selectOption(selector, value);
      await settle();
    },
    setInputFiles: async (selector, absPath) => {
      await glide(selector);
      await base.setInputFiles(selector, absPath);
      // The app now reads and renders the file — give that response its beat.
      await sleep(tempo.settleMs * 2);
    },
    fill: async (selector, value) => {
      const found = await glide(selector);
      const typed = await best(async () => {
        if (!found) return false;
        const loc = surface.locator(selector).first();
        await loc.click();
        await loc.fill('');
        const delay = Math.min(tempo.typeDelayMs, value.length > 0 ? tempo.maxTypeMs / value.length : tempo.typeDelayMs);
        await surface.keyboard.type(value, { delay });
        return (await loc.inputValue()) === value;
      });
      if (typed !== true) await base.fill(selector, value);
      await settle();
    },
  };
}

/* ------------------------------------------------------------- the HUD ---- */

/** The element id the HUD lives under — one per page, replaced on each show. */
export const HUD_ID = '__mirror_hud';

/**
 * The HUD strip, as a script the page evaluates. It is `position:fixed` over
 * the app, `pointer-events:none`, styled entirely through `el.style` (CSSOM —
 * no `<style>` rule, so no CSP `style-src` surface), in the stage's own navy
 * and gold so it reads as part of the show rather than a browser artefact.
 *
 * Text is set through `textContent`, never `innerHTML`: the detail line
 * carries run-specific numbers and paths straight from the op.
 */
export function hudScript(state: { title: string; detail: string } | null): string {
  const payload = JSON.stringify(state);
  return `(() => {
    var state = ${payload};
    var old = document.getElementById(${JSON.stringify(HUD_ID)});
    if (old) old.remove();
    if (!state) return;
    var root = document.body || document.documentElement;
    if (!root) return;
    var hud = document.createElement('div');
    hud.id = ${JSON.stringify(HUD_ID)};
    hud.style.cssText = [
      'position:fixed','left:12px','right:12px','bottom:14px','z-index:2147483646',
      'pointer-events:none','background:rgba(10,25,48,.94)','border:1px solid #f5b74a',
      'border-radius:8px','padding:10px 14px','color:#dce8f7',
      'font:13px/1.4 "Segoe UI",Segoe,Tahoma,Arial,sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.45)'
    ].join(';') + ';';
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:#f5b74a;';
    title.textContent = state.title;
    var detail = document.createElement('div');
    detail.setAttribute('data-hud-detail', '');
    detail.style.cssText = 'margin-top:3px;font-variant-numeric:tabular-nums;';
    detail.textContent = state.detail;
    hud.appendChild(title);
    hud.appendChild(detail);
    root.appendChild(hud);
  })();`;
}

/**
 * Pin, update or clear the HUD on a page. Best-effort throughout: the HUD is
 * theatre and must never fail an op.
 */
export const paneHud = {
  async show(surface: Pick<TheatreSurface, 'evaluate'>, title: string, detail: string): Promise<void> {
    await best(() => surface.evaluate(hudScript({ title, detail })));
  },
  async hide(surface: Pick<TheatreSurface, 'evaluate'>): Promise<void> {
    await best(() => surface.evaluate(hudScript(null)));
  },
};

/* --------------------------------------------------------- the caption ---- */

/** The element id the caption band lives under — one per page, replaced on show. */
export const CAPTION_ID = '__mirror_caption';

/**
 * The per-action NARRATION band, as a script the page evaluates. It is the top
 * counterpart to the bottom status HUD (`hudScript`): a distinct `position:fixed`
 * strip at `top:14px` (the HUD keeps `bottom:14px`), so the two never collide and
 * the caption never covers the portrait app content between them.
 *
 * Same navy/gold CSSOM styling as the HUD — everything through `el.style`, no
 * `<style>` rule (no CSP `style-src` surface) — and the text is set through
 * `textContent`, never `innerHTML`. On replace it does a short `el.animate()`
 * fade so a new line reads as arriving rather than snapping. Captions carry NO
 * run-specific numbers (those stay in the status HUD / log), so this is static
 * narration, in the founder's voice, honest to the real action the op drives.
 */
export function captionScript(text: string | null): string {
  const payload = JSON.stringify(text);
  return `(() => {
    var text = ${payload};
    var old = document.getElementById(${JSON.stringify(CAPTION_ID)});
    if (old) old.remove();
    if (text == null || text === '') return;
    var root = document.body || document.documentElement;
    if (!root) return;
    var cap = document.createElement('div');
    cap.id = ${JSON.stringify(CAPTION_ID)};
    cap.style.cssText = [
      'position:fixed','left:12px','right:12px','top:14px','z-index:2147483646',
      'pointer-events:none','background:rgba(10,25,48,.94)','border:1px solid #f5b74a',
      'border-radius:8px','padding:11px 16px','color:#f4f8fd','text-align:center',
      'font:15px/1.5 "Segoe UI",Segoe,Tahoma,Arial,sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.45)'
    ].join(';') + ';';
    cap.textContent = text;
    root.appendChild(cap);
    try {
      cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    } catch (e) { /* Web Animations unavailable — the caption still shows */ }
  })();`;
}

/**
 * Pin or clear the narration caption on a page. Best-effort throughout, and a
 * no-op when the surface is absent (a hand-written test pane has no `session`,
 * so `hudSurfaceOf` returns undefined) — a caption is theatre and must never
 * fail or slow an op.
 */
export const paneCaption = {
  async show(surface: Pick<TheatreSurface, 'evaluate'> | undefined, text: string): Promise<void> {
    if (!surface) return;
    await best(() => surface.evaluate(captionScript(text)));
  },
  async hide(surface: Pick<TheatreSurface, 'evaluate'> | undefined): Promise<void> {
    if (!surface) return;
    await best(() => surface.evaluate(captionScript(null)));
  },
};

/**
 * A HUD that ticks: `detail(elapsedMs)` is re-rendered every second until
 * `stop()` is called. The pattern every long, UI-less wait needs (a CLI walk,
 * an assess, an execute) so the pane is never silently blank while the
 * klaxon is red. `stop()` leaves the last state on screen; call `paneHud.hide`
 * or a fresh `paneHud.show` to replace it. Best-effort throughout.
 */
export function hudTicker(
  surface: Pick<TheatreSurface, 'evaluate'> | undefined,
  title: string,
  detail: (elapsedMs: number) => string,
): { stop(): void; readonly startedAt: number } {
  const startedAt = Date.now();
  if (!surface) return { stop: () => undefined, startedAt };
  void paneHud.show(surface, title, detail(0));
  const timer = setInterval(() => {
    void paneHud.show(surface, title, detail(Date.now() - startedAt));
  }, 1_000);
  // A ticker must never keep the process alive past teardown.
  timer.unref();
  return {
    startedAt,
    stop: () => clearInterval(timer),
  };
}

/** `1m 23s` / `47s` — the elapsed form the HUD ticks. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
