// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-6 — the theatrical page: the visible app pane driven so the audience
 * SEES it being driven.
 *
 * The founder's on-stage finding (2026-09-08): "I can see the app now, but I
 * don't see it being controlled and responding." The fix is choreography over
 * the same `UiPage` verbs. These tests pin the choreography against a fake
 * surface with no browser — the browser-level proof (the S5 dot riding a real
 * glide) lives in `demo-mirror.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { UiPage } from '../src/demo/ui-page.js';
import {
  formatElapsed,
  hudScript,
  hudTicker,
  paneHud,
  theatricalUiPage,
  type TheatreLocator,
  type TheatreSurface,
  type TheatreTempo,
} from '../src/demo/show/theatrical-page.js';

/** A tempo fast enough for a unit test but still ordered — the order is the test. */
const FAST: TheatreTempo = { glideMs: 24, hoverMs: 1, typeDelayMs: 0, maxTypeMs: 10, settleMs: 1 };

interface Fake {
  surface: TheatreSurface;
  base: UiPage;
  readonly events: string[];
  value: string;
  boxFor: (selector: string) => { x: number; y: number; width: number; height: number } | null;
}

function fake(): Fake {
  const events: string[] = [];
  const f: Fake = {
    events,
    value: '',
    boxFor: () => ({ x: 100, y: 200, width: 80, height: 30 }),
    surface: undefined as unknown as TheatreSurface,
    base: undefined as unknown as UiPage,
  };
  const locator = (selector: string): TheatreLocator => ({
    first: () => locator(selector),
    boundingBox: async () => f.boxFor(selector),
    scrollIntoViewIfNeeded: async () => undefined,
    click: async () => {
      events.push(`loc.click ${selector}`);
    },
    fill: async (v) => {
      events.push(`loc.fill ${selector} ${JSON.stringify(v)}`);
      f.value = v;
    },
    inputValue: async () => f.value,
    locator: (s) => locator(`${selector}/${s}`),
    count: async () => 1,
  });
  const surface: TheatreSurface = {
    mouse: {
      move: async (x: number, y: number) => {
        events.push(`move ${Math.round(x)},${Math.round(y)}`);
      },
    },
    keyboard: {
      type: async (text: string) => {
        events.push(`type ${JSON.stringify(text)}`);
        f.value += text;
      },
    },
    locator,
    evaluate: async (script: unknown) => {
      events.push(`evaluate ${String(script).length > 40 ? 'script' : String(script)}`);
      return undefined as never;
    },
    viewportSize: () => ({ width: 640, height: 1080 }),
  };
  f.surface = surface;
  const base: UiPage = {
    goto: async (url) => {
      events.push(`goto ${url}`);
    },
    click: async (s) => {
      events.push(`click ${s}`);
    },
    fill: async (s, v) => {
      events.push(`fill ${s} ${JSON.stringify(v)}`);
      f.value = v;
    },
    check: async (s) => {
      events.push(`check ${s}`);
    },
    selectOption: async (s, v) => {
      events.push(`select ${s} ${v}`);
    },
    setInputFiles: async (s, p) => {
      events.push(`files ${s} ${p}`);
    },
    waitForDownload: async () => '',
    inputValue: async () => f.value,
    textContent: async () => {
      events.push('read textContent');
      return 'x';
    },
    getAttribute: async () => null,
    texts: async () => [],
    count: async () => 0,
    isVisible: async () => true,
    waitForSelector: async () => undefined,
    waitForResponse: async () => undefined,
    getJson: async () => undefined,
    screenshot: async () => undefined,
  };
  f.base = base;
  return f;
}

describe('theatricalUiPage — choreography', () => {
  it('a click glides the pointer to the target (real mousemoves) BEFORE the click lands', async () => {
    const f = fake();
    const page = theatricalUiPage(f.surface, f.base, FAST);
    await page.click('#go');
    const moves = f.events.filter((e) => e.startsWith('move '));
    expect(moves.length).toBeGreaterThan(10); // a path, not a jump
    expect(moves[moves.length - 1]).toBe('move 140,215'); // box center x, capped y
    expect(f.events.indexOf('click #go')).toBeGreaterThan(f.events.lastIndexOf('move 140,215'));
  });

  it('a fill is TYPED through the keyboard after clicking into the field, not assigned', async () => {
    const f = fake();
    const page = theatricalUiPage(f.surface, f.base, FAST);
    await page.fill('#slug', 'demo-dib-small');
    expect(f.events).toContain('loc.click #slug');
    expect(f.events).toContain('type "demo-dib-small"');
    expect(f.events.some((e) => e.startsWith('fill #slug'))).toBe(false); // base fill not needed
    expect(f.value).toBe('demo-dib-small');
  });

  it('falls back to the instant fill when the typed value did not land', async () => {
    const f = fake();
    // A masked/controlled input that swallows keystrokes.
    (f.surface.keyboard as { type: TheatreSurface['keyboard']['type'] }).type = async () => undefined;
    const page = theatricalUiPage(f.surface, f.base, FAST);
    await page.fill('#slug', 'demo-dib-small');
    expect(f.events).toContain('fill #slug "demo-dib-small"');
    expect(f.value).toBe('demo-dib-small');
  });

  it('a hidden file input glides to its nearest visible ancestor, then sets the file', async () => {
    const f = fake();
    f.boxFor = (sel) => (sel.endsWith('xpath=..') ? { x: 10, y: 20, width: 100, height: 100 } : null);
    const page = theatricalUiPage(f.surface, f.base, FAST);
    await page.setInputFiles('input[type=file]', '/tmp/result.json');
    expect(f.events.some((e) => e.startsWith('move '))).toBe(true);
    expect(f.events).toContain('files input[type=file] /tmp/result.json');
  });

  it('theatre never breaks the drive: no box at all still clicks; a throwing glide still clicks', async () => {
    const f = fake();
    f.boxFor = () => null;
    let page = theatricalUiPage(f.surface, f.base, FAST);
    await page.click('#ghost');
    expect(f.events).toContain('click #ghost');

    const g = fake();
    (g.surface.mouse as { move: TheatreSurface['mouse']['move'] }).move = async () => {
      throw new Error('page navigated under the pointer');
    };
    page = theatricalUiPage(g.surface, g.base, FAST);
    await page.click('#go');
    expect(g.events).toContain('click #go');
  });

  it('reads pass straight through — theatre never slows a judge', async () => {
    const f = fake();
    const page = theatricalUiPage(f.surface, f.base, FAST);
    await page.textContent('#n');
    expect(f.events).toEqual(['read textContent']);
  });
});

describe('the HUD', () => {
  it('is CSSOM-only (no <style>, no innerHTML) and carries the detail through textContent', () => {
    const script = hudScript({ title: 'Readiness Evaluation', detail: '329 observations <b>x</b>' });
    expect(script).not.toContain('<style');
    expect(script).not.toContain('innerHTML');
    expect(script).toContain('textContent = state.detail');
    expect(script).toContain('"329 observations <b>x</b>"'); // JSON-carried, set as text
    expect(script).toContain('pointer-events:none');
    expect(hudScript(null)).toContain('if (!state) return');
  });

  it('show/hide evaluate on the surface and swallow failures', async () => {
    const f = fake();
    await paneHud.show(f.surface, 'T', 'D');
    await paneHud.hide(f.surface);
    expect(f.events.filter((e) => e.startsWith('evaluate'))).toHaveLength(2);
    await expect(paneHud.show({ evaluate: async () => { throw new Error('gone'); } }, 'T', 'D')).resolves.toBeUndefined();
  });

  it('the ticker paints at once, re-paints on the clock, stops cleanly, and is inert without a surface', async () => {
    const f = fake();
    const t = hudTicker(f.surface, 'T', (ms) => `walking … ${formatElapsed(ms)}`);
    await new Promise((r) => setTimeout(r, 5));
    expect(f.events.filter((e) => e.startsWith('evaluate'))).toHaveLength(1); // immediate paint
    t.stop();
    const painted = f.events.length;
    await new Promise((r) => setTimeout(r, 1100));
    expect(f.events.length).toBe(painted); // nothing after stop

    const inert = hudTicker(undefined, 'T', () => 'x');
    expect(typeof inert.startedAt).toBe('number');
    inert.stop();
  });

  it('formats elapsed time the way a presenter reads it', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(47_900)).toBe('47s');
    expect(formatElapsed(83_000)).toBe('1m 23s');
  });
});
