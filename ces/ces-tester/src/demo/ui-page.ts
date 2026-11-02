// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — the shared browser seam for the three new Playwright drivers
 * (`stamper-ui-driver.ts`, `eo-ui-driver.ts`, `ao-ui-driver.ts`).
 *
 * Two jobs, both deliberately small:
 *
 * 1. **`UiPage`** — the narrow surface those drivers actually use, so each
 *    flow is a pure-ish function over an interface and its ORDERING RULES can
 *    be unit-tested without a browser. The M0 spike proved that ordering is
 *    where these GUIs bite (AO resets the tenant box on every form open;
 *    Stamper's execute target sticks on Dry Run), and an ordering rule that is
 *    only exercised live is an ordering rule that regresses silently.
 *
 * 2. **`openUiPage`** — the single `chromium.launch` site for M4, spreading M1's
 *    `WatchMode` record straight into the launch options: headless by default,
 *    headed + slow-motion under `--watch`.
 *
 * The Playwright drive is the USER-PERSPECTIVE layer, never the data source.
 * Nothing here scrapes a structured number for a verdict: `texts()` reads
 * report link paths and badge strings for the narrative, and every judged
 * number comes from each module's own API/SSE or from the artifact on disk.
 */

import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { WatchMode } from './watch-mode.js';

/**
 * The browser surface the M4 drivers use. Implemented for real by
 * `wrapPlaywrightPage`; implemented by hand in tests to pin ordering.
 */
export interface UiPage {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  check(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  /**
   * Set the files on a `<input type="file">`. GP-DEMO-5: the ces-muster discovery
   * import is a file input read via `FileReader` (zero network), so the honest
   * CLI-walk → import seam needs this verb.
   */
  setInputFiles(selector: string, absPath: string): Promise<void>;
  /**
   * Arms a download wait BEFORE running `action` (the only safe order, like
   * `waitForResponse`), saves the file into `saveDir`, and returns its path.
   * GP-DEMO-5: D.8 reads the SPRS integer from the exported payload, never the DOM.
   */
  waitForDownload(action: () => Promise<void>, saveDir: string): Promise<string>;
  inputValue(selector: string): Promise<string>;
  textContent(selector: string): Promise<string | null>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  /** All matching elements' text — report links, log rows. */
  texts(selector: string): Promise<string[]>;
  count(selector: string): Promise<number>;
  isVisible(selector: string): Promise<boolean>;
  /** Waits for the element to be ATTACHED (not visible — `<option>` never is). */
  waitForSelector(selector: string, timeoutMs: number): Promise<void>;
  /** Arms the response wait BEFORE running `action` — the only safe order. */
  waitForResponse(urlPart: string, action: () => Promise<void>, timeoutMs: number): Promise<unknown>;
  /** Read-only JSON GET issued from the page's own context (browser traffic). */
  getJson(urlPath: string): Promise<unknown>;
  screenshot(filePath: string): Promise<void>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Thrown when a polled UI condition never arrives — always names what it wanted. */
export class UiWaitTimeoutError extends Error {
  constructor(what: string, timeoutMs: number, lastSeen?: string) {
    super(`timed out after ${timeoutMs}ms waiting for ${what}${lastSeen === undefined ? '' : ` (last seen: ${JSON.stringify(lastSeen)})`}`);
    this.name = 'UiWaitTimeoutError';
  }
}

export interface WaitForTextOptions {
  readonly timeoutMs: number;
  readonly pollMs?: number;
  /** Matching this first is a real failure, reported with the text that matched. */
  readonly failOn?: RegExp;
  readonly what?: string;
}

/**
 * Poll an element's text until `match` hits. Polling (rather than a Playwright
 * text-engine selector) keeps every wait expressible against `UiPage`, so the
 * flow functions stay testable — and these waits are minutes long anyway
 * (M0 measured Assess ~5 min, Execute ~7 min), where a 500 ms poll is free.
 */
export async function waitForText(
  page: UiPage,
  selector: string,
  match: RegExp,
  opts: WaitForTextOptions,
): Promise<string> {
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let last = '';
  for (;;) {
    const text = (await page.textContent(selector))?.trim() ?? '';
    last = text;
    if (match.test(text)) return text;
    if (opts.failOn && opts.failOn.test(text)) {
      throw new Error(`${opts.what ?? selector} reported a failure state: ${JSON.stringify(text)}`);
    }
    if (Date.now() >= deadline) throw new UiWaitTimeoutError(opts.what ?? `${selector} to match ${match}`, opts.timeoutMs, last);
    await sleep(pollMs);
  }
}

/** Poll any async predicate. Same rationale as `waitForText`. */
export async function waitForCondition(
  what: string,
  probe: () => Promise<boolean>,
  timeoutMs: number,
  pollMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new UiWaitTimeoutError(what, timeoutMs);
    await sleep(pollMs);
  }
}

/** Does the element carry `className`? Used for `card-collapsed` / `tenant-connected`. */
export async function hasClass(page: UiPage, selector: string, className: string): Promise<boolean> {
  const classes = (await page.getAttribute(selector, 'class')) ?? '';
  return classes.split(/\s+/).includes(className);
}

/**
 * Stamper ships every workflow card `card-collapsed`, and `toggleCard()` is a
 * plain toggle — clicking an already-expanded card COLLAPSES it. Always guard.
 * It also returns early on `card-locked`, so a card must be unlocked (Assess
 * unlocks card 3, Translate unlocks card 4) before this can do anything.
 */
export async function expandCard(page: UiPage, cardSelector: string): Promise<void> {
  if (await hasClass(page, cardSelector, 'card-collapsed')) {
    await page.click(`${cardSelector} .workflow-card-header`);
  }
}

export interface UiSession {
  readonly page: UiPage;
  /** The raw Playwright page, for anything the narrow seam deliberately omits. */
  readonly raw: Page;
  close(): Promise<void>;
}

/** Wrap a real Playwright `Page` in the narrow seam. */
export function wrapPlaywrightPage(page: Page): UiPage {
  return {
    goto: async (url) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
    click: (selector) => page.click(selector),
    fill: (selector, value) => page.fill(selector, value),
    check: (selector) => page.check(selector),
    selectOption: async (selector, value) => {
      await page.selectOption(selector, value);
    },
    setInputFiles: async (selector, absPath) => {
      await page.setInputFiles(selector, absPath);
    },
    waitForDownload: async (action, saveDir) => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        action(),
      ]);
      const filePath = path.join(saveDir, download.suggestedFilename());
      await download.saveAs(filePath);
      return filePath;
    },
    inputValue: (selector) => page.inputValue(selector),
    textContent: (selector) => page.locator(selector).first().textContent(),
    getAttribute: (selector, name) => page.locator(selector).first().getAttribute(name),
    texts: async (selector) => (await page.locator(selector).allTextContents()).map((t) => t.trim()),
    count: (selector) => page.locator(selector).count(),
    isVisible: (selector) => page.locator(selector).first().isVisible(),
    waitForSelector: async (selector, timeoutMs) => {
      await page.waitForSelector(selector, { timeout: timeoutMs, state: 'attached' });
    },
    waitForResponse: async (urlPart, action, timeoutMs) => {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(urlPart), { timeout: timeoutMs }),
        action(),
      ]);
      try {
        return await response.json();
      } catch {
        return undefined;
      }
    },
    getJson: async (urlPath) => {
      const response = await page.request.get(urlPath);
      if (!response.ok()) return undefined;
      try {
        return await response.json();
      } catch {
        return undefined;
      }
    },
    screenshot: async (filePath) => {
      await page.screenshot({ path: filePath, fullPage: true });
    },
  };
}

/**
 * The single `chromium.launch` site for M4. `WatchMode` is shaped as a launch
 * options subset precisely so it spreads (M1) — headless default, headed +
 * `slowMo` under `--watch`.
 */
export async function openUiPage(baseUrl: string, watch: WatchMode): Promise<UiSession> {
  const browser: Browser = await chromium.launch({ headless: watch.headless, slowMo: watch.slowMo });
  let page: Page;
  try {
    page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
  return {
    page: wrapPlaywrightPage(page),
    raw: page,
    close: async () => {
      await browser.close().catch(() => undefined);
    },
  };
}

/** Where a headed window is placed on the operator's desktop (GP-DEMO-4). */
export interface WindowPlacement {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

export interface OpenPositionedOptions {
  readonly placement: WindowPlacement;
  /** Navigated to on open; omit for a blank window the caller drives later. */
  readonly url?: string;
  /** Playwright `slowMo`, so an operator can follow the drive. */
  readonly slowMo?: number;
  /** Headed is the point of this function; tests pass `true`. */
  readonly headless?: boolean;
}

/**
 * GP-DEMO-4 — a SECOND launch site, deliberately beside `openUiPage` rather
 * than folded into it: `openUiPage`'s signature and behavior are load-bearing
 * for the four M4 drivers and must not move.
 *
 * Two mechanics, both measured (RESEARCH_SUMMARY.md finding 5, Q5):
 *
 * 1. **Chromium launch args are per-PROCESS, not per-context** — so two
 *    independently placed windows need two `chromium.launch()` calls. This is
 *    one of them.
 * 2. **`viewport: null` on the context** — without it Playwright forces a
 *    1280x720 viewport inside whatever OS window it gets, and the page renders
 *    letterboxed in the wrong box. `--start-maximized` is deliberately NOT used:
 *    it conflicts with `--window-position` (Playwright #14314) and wins silently.
 */
export async function openPositionedUiPage(opts: OpenPositionedOptions): Promise<UiSession> {
  const { width, height, x, y } = opts.placement;
  const browser: Browser = await chromium.launch({
    headless: opts.headless ?? false,
    slowMo: opts.slowMo ?? 0,
    args: [`--window-position=${x},${y}`, `--window-size=${width},${height}`],
  });
  let page: Page;
  try {
    // `acceptDownloads` explicit: D.8's export capture hangs silently if the
    // context rejects downloads — do not rely on the Playwright-version default.
    const context = await browser.newContext({ viewport: null, acceptDownloads: true });
    page = await context.newPage();
    if (opts.url) await page.goto(opts.url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
  return {
    page: wrapPlaywrightPage(page),
    raw: page,
    close: async () => {
      await browser.close().catch(() => undefined);
    },
  };
}

export interface MirrorPageOptions {
  /**
   * The FIXED mirror viewport (portrait right-third). Not `viewport:null` — the
   * GUIs must lay out at this width so the screencast maps 1:1 with no rescale
   * blur (reflow, not rescale).
   */
  readonly viewport: { readonly width: number; readonly height: number };
  /**
   * Scripts injected via `addInitScript` on the CONTEXT — they run before every
   * page's own scripts, on every navigation, per-frame. This is the channel the
   * per-app narrow reflow (T1.5 S4) and the branded cursor overlay (S5) both use.
   */
  readonly initScripts?: readonly string[];
  readonly slowMo?: number;
}

/**
 * GP-DEMO-5 T1.5 — the mirror pane: a THIRD launch site, headless with a fixed
 * portrait viewport and injected init-scripts. It is deliberately separate from
 * `openPositionedUiPage` (headed, `viewport:null`, window args): the mirror is
 * never a window, and forcing a fixed viewport is the whole point (the pane
 * lays out at 640px so the screencast is 1:1). The narrow seam it returns is the
 * same one the ops drive.
 */
export async function openMirrorUiPage(opts: MirrorPageOptions): Promise<UiSession> {
  const browser: Browser = await chromium.launch({ headless: true, slowMo: opts.slowMo ?? 0 });
  try {
    const context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      acceptDownloads: true,
    });
    // Injected BEFORE the first page so reflow/overlay run from the first paint.
    for (const script of opts.initScripts ?? []) await context.addInitScript(script);
    const page = await context.newPage();
    return {
      page: wrapPlaywrightPage(page),
      raw: page,
      close: async () => {
        await browser.close().catch(() => undefined);
      },
    };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

/**
 * Best-effort screenshot into `dir` — a demo beat must never fail because a
 * screenshot could not be written. Returns the path, or undefined.
 */
export async function captureScreenshot(page: UiPage, dir: string | undefined, name: string): Promise<string | undefined> {
  if (!dir) return undefined;
  const filePath = path.join(dir, name);
  try {
    await page.screenshot(filePath);
    return filePath;
  } catch {
    return undefined;
  }
}
