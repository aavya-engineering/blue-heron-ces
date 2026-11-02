// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-35 (finishing plan PH-3 harness): one launch site for the watched AO, EO and Muster console runs. It joins the
 * two existing ones without changing either (`openRecordedUiPage` in stamper-ui-driver.ts: video + trace; and
 * `openPositionedUiPage` in ui-page.ts: a placed headed window): one browser per console, its own window position, a
 * video and a Playwright trace under the run folder, and a caption banner when headed (the founder's Watchable rule,
 * 2026-10-29). Headless runs (rounds before the founder watches) record the same video and trace.
 *
 * `ConsolePage` widens the narrow `UiPage` seam by the three verbs the console flows need: every attribute value of a
 * selector (the Muster interview enumerates `[data-question-id]` cards), a response wait that also returns the HTTP
 * status (EO's upload and review are judged on 201), and a caption call (a no-op when headless).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { wrapPlaywrightPage, type UiPage } from './ui-page.js';
import { captionScript } from './stamper-ui-driver.js';
import type { WatchMode } from './watch-mode.js';

export interface ConsolePage extends UiPage {
  /** Every matching element's attribute value (absent attributes skipped). */
  attrs(selector: string, name: string): Promise<string[]>;
  /** Arms the wait BEFORE `action`; resolves with the status and the JSON body (undefined when not JSON). */
  waitForResponseFull(urlPart: string, action: () => Promise<void>, timeoutMs: number, method?: string): Promise<{ status: number; json: unknown; url: string }>;
  /** A step caption at the bottom of the page when headed; a no-op headless. */
  caption(text: string): Promise<void>;
}

export interface ConsoleWindowPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Default placements: one window per console, side by side on a 2560-wide desktop, never overlapping. */
export const CONSOLE_PLACEMENT: Readonly<Record<'ao' | 'eo' | 'muster', ConsoleWindowPlacement>> = {
  muster: { x: 0, y: 0, width: 1280, height: 900 },
  eo: { x: 1280, y: 0, width: 1280, height: 900 },
  ao: { x: 640, y: 120, width: 1280, height: 900 },
};

export interface ConsoleSession {
  readonly page: ConsolePage;
  readonly raw: Page;
  /** Stops the trace (`<dir>/trace.zip`), closes the context (writes the video), closes the browser. */
  close(): Promise<{ videoPath?: string; tracePath?: string }>;
}

/** Adds the three console verbs to a wrapped page. Exported for tests (a fake raw page). */
export function wrapConsolePage(raw: Page, headless: boolean): ConsolePage {
  const base = wrapPlaywrightPage(raw);
  return {
    ...base,
    attrs: async (selector, name) => {
      const loc = raw.locator(selector);
      const n = await loc.count();
      const vals: string[] = [];
      for (let i = 0; i < n; i++) {
        const v = await loc.nth(i).getAttribute(name);
        if (typeof v === 'string') vals.push(v);
      }
      return vals;
    },
    waitForResponseFull: async (urlPart, action, timeoutMs, method) => {
      const [response] = await Promise.all([
        raw.waitForResponse((r) => r.url().includes(urlPart) && (!method || r.request().method() === method.toUpperCase()), { timeout: timeoutMs }),
        action(),
      ]);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { status: response.status(), json, url: response.url() };
    },
    caption: async (text) => {
      if (headless) return;
      try {
        await raw.evaluate(captionScript(text));
      } catch {
        /* a caption never fails a run */
      }
    },
  };
}

export interface OpenConsoleOptions {
  readonly url: string;
  readonly watch: WatchMode;
  /** Video + trace go here (`<WS>/out/ui/<surface>/<variant>/playwright`). */
  readonly recordDir: string;
  readonly placement: ConsoleWindowPlacement;
  /** Values the page should find in localStorage before its first script runs (Muster: api url, token). */
  readonly localStorage?: Record<string, string>;
}

export async function openConsoleWindow(o: OpenConsoleOptions): Promise<ConsoleSession> {
  fs.mkdirSync(o.recordDir, { recursive: true });
  const { x, y, width, height } = o.placement;
  const browser: Browser = await chromium.launch({
    headless: o.watch.headless,
    slowMo: o.watch.slowMo,
    ...(o.watch.headless ? {} : { args: [`--window-position=${x},${y}`, `--window-size=${width},${height}`] }),
  });
  let context: BrowserContext;
  let page: Page;
  try {
    context = await browser.newContext({
      viewport: { width, height: Math.max(480, height - 80) },
      recordVideo: { dir: o.recordDir, size: { width, height: Math.max(480, height - 80) } },
      acceptDownloads: true,
    });
    if (o.localStorage && Object.keys(o.localStorage).length) {
      // A string script (this Node-side module has no DOM types): set each key before the page's first script runs.
      await context.addInitScript({ content: `(() => { const kv = ${JSON.stringify(o.localStorage)}; for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); })()` });
    }
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    await page.goto(o.url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
  const tracePath = path.join(o.recordDir, 'trace.zip');
  let closed = false;
  return {
    page: wrapConsolePage(page, o.watch.headless),
    raw: page,
    close: async () => {
      if (closed) return {};
      closed = true;
      let traced: string | undefined;
      let videoPath: string | undefined;
      try {
        await context.tracing.stop({ path: tracePath });
        traced = tracePath;
      } catch {
        traced = undefined;
      }
      try {
        videoPath = await page.video()?.path();
      } catch {
        videoPath = undefined;
      }
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      return { videoPath, tracePath: traced };
    },
  };
}
