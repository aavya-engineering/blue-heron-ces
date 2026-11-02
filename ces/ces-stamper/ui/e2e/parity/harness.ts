// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Parity harness (AD-4): record the API requests a console makes, normalise each to
// method + path + sorted query keys + sorted body keys, and compare the ordered lists of the
// legacy console (/) and the SPA (/app/). Not pixels. Also: the PC-00 bundle scan and
// localhost-only network guard, and the founder's "watchable" helpers (headed by default,
// paced, captioned; video and trace on). Only `import type` from Playwright, so the pure
// functions can be unit-tested under Vitest.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BrowserContext, Page, Request } from '@playwright/test';

export interface RecordedRequest {
  method: string;
  path: string;
  queryKeys: string[];
  /** Sorted top-level keys of a JSON object body; null when there is no JSON object body. */
  bodyKeys: string[] | null;
  resourceType: string;
}

export interface RawRequest {
  method: string;
  url: string;
  resourceType: string;
  postData: string | null;
}

/** The Stamper GUI API surface: /health and /api/* (GuiServer routers). */
export function isApiPath(pathname: string): boolean {
  return pathname === '/health' || pathname.startsWith('/api/');
}

export function normalizeRequest(raw: RawRequest): RecordedRequest | null {
  const url = new URL(raw.url);
  if (!isApiPath(url.pathname)) return null;
  const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys()))).sort();
  let bodyKeys: string[] | null = null;
  if (raw.postData) {
    try {
      const parsed: unknown = JSON.parse(raw.postData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        bodyKeys = Object.keys(parsed as Record<string, unknown>).sort();
      }
    } catch {
      bodyKeys = null;
    }
  }
  return { method: raw.method.toUpperCase(), path: url.pathname, queryKeys, bodyKeys, resourceType: raw.resourceType };
}

/** One comparable line per request, e.g. `GET /api/assess-state ?tenant` or `POST /api/approve {decision,taskId}`. */
export function signature(r: RecordedRequest): string {
  const query = r.queryKeys.length ? ` ?${r.queryKeys.join('&')}` : '';
  const body = r.bodyKeys ? ` {${r.bodyKeys.join(',')}}` : '';
  return `${r.method} ${r.path}${query}${body}`;
}

export interface CompareOptions {
  /** Only requests whose path is in this list are compared (the PC's "Routes" column). */
  routes?: readonly string[];
  /** `METHOD /path` the SPA makes by design with no legacy counterpart; removed from the SPA side. */
  spaOnly?: readonly string[];
}

export interface CompareResult {
  equal: boolean;
  legacy: string[];
  react: string[];
  /** Human-readable differences, first differing index first. */
  differences: string[];
}

export function compareRecordings(
  legacy: readonly RecordedRequest[],
  react: readonly RecordedRequest[],
  options: CompareOptions = {},
): CompareResult {
  const inScope = (r: RecordedRequest) => !options.routes || options.routes.includes(r.path);
  const spaOnly = new Set(options.spaOnly ?? []);
  const left = legacy.filter(inScope).map(signature);
  const right = react
    .filter(inScope)
    .filter((r) => !spaOnly.has(`${r.method} ${r.path}`))
    .map(signature);
  const differences: string[] = [];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    if (left[i] !== right[i]) {
      differences.push(`#${i}: legacy ${left[i] ?? '(none)'} | react ${right[i] ?? '(none)'}`);
    }
  }
  return { equal: differences.length === 0, legacy: left, react: right, differences };
}

export interface RequestRecorder {
  readonly requests: RecordedRequest[];
  stop(): void;
}

/** Records every API request (fetch, XHR, EventSource) the page makes, in order. */
export function recordApiRequests(page: Page): RequestRecorder {
  const requests: RecordedRequest[] = [];
  const onRequest = (req: Request) => {
    const recorded = normalizeRequest({
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      postData: req.postData(),
    });
    if (recorded) requests.push(recorded);
  };
  page.on('request', onRequest);
  return { requests, stop: () => page.off('request', onRequest) };
}

// ---- PC-00: localhost only ----

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return true;
  }
}

/** Aborts every request that leaves localhost and returns the list of attempted external URLs. */
export async function blockExternalRequests(context: BrowserContext): Promise<string[]> {
  const attempted: string[] = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (isLocalUrl(url)) {
      await route.continue();
    } else {
      attempted.push(url);
      await route.abort('internetdisconnected');
    }
  });
  return attempted;
}

/**
 * URL strings that occur inside third-party library code but are never fetched: XML namespace
 * identifiers (React DOM's SVG/MathML handling) and documentation links inside library error
 * messages. Any other absolute non-local URL in the bundle fails PC-00.
 */
export const NON_FETCHED_URL_PREFIXES: readonly string[] = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  'https://reactjs.org/docs/error-decoder.html',
  'https://react.dev/errors/',
  'https://reactrouter.com/',
  'https://tanstack.com/',
];

export interface BundleUrlHit {
  file: string;
  url: string;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s'"`)<>\\]+/g;

/** Scans the built bundle (source maps excluded: they are not loaded by the page). */
export function scanBundleForExternalUrls(
  dir: string,
  allow: readonly string[] = NON_FETCHED_URL_PREFIXES,
): BundleUrlHit[] {
  const hits: BundleUrlHit[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.map')) continue;
      if (!/\.(html|js|mjs|css|json|svg|txt)$/i.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf-8');
      for (const match of text.matchAll(URL_PATTERN)) {
        const url = match[0];
        if (isLocalUrl(url)) continue;
        if (allow.some((prefix) => url.startsWith(prefix))) continue;
        hits.push({ file: path.relative(dir, full), url });
      }
    }
  };
  walk(dir);
  return hits;
}

// ---- Watchable (PLAN §8b): headed by default, paced, captioned, video and trace ----

/** Headless only when asked for explicitly (unattended reruns): CES_UI_HEADLESS=1. */
export function watchOptions(env: NodeJS.ProcessEnv = process.env): { headless: boolean; slowMo: number } {
  const headless = env['CES_UI_HEADLESS'] === '1';
  const raw = env['CES_UI_SLOWMO'];
  const parsed = raw ? Number(raw) : Number.NaN;
  const slowMo = Number.isFinite(parsed) ? parsed : headless ? 0 : 400;
  return { headless, slowMo };
}

export interface ParityWatch {
  headless: boolean;
  slowMo: number;
  video: 'on' | 'retain-on-failure';
  trace: 'on' | 'retain-on-failure';
}

/**
 * Parity specs are developer checks (W8-PIS): headless, no slow-mo, video and trace kept on
 * failure only, unless CES_UI_WATCH=1 asks for the watchable run, which then follows
 * watchOptions (headed and paced, CES_UI_HEADLESS / CES_UI_SLOWMO honoured, video and trace on).
 * The watchable default binds ces-tester scenario runs (PLAN §8b), not this suite.
 */
export function parityWatchOptions(env: NodeJS.ProcessEnv = process.env): ParityWatch {
  if (env['CES_UI_WATCH'] !== '1') return { headless: true, slowMo: 0, video: 'retain-on-failure', trace: 'retain-on-failure' };
  return { ...watchOptions(env), video: 'on', trace: 'on' };
}

export const CAPTION_ID = 'ces-watch-caption';

/** Shows a step caption on the page (headed runs only). Call again after each navigation. */
export async function caption(page: Page, text: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (parityWatchOptions(env).headless) return;
  await page.evaluate(
    ({ id, value }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = [
          'position:fixed',
          'left:16px',
          'bottom:16px',
          'z-index:2147483647',
          'max-width:60vw',
          'padding:8px 12px',
          'pointer-events:none',
          'font:600 14px/1.4 var(--co-font-sans, sans-serif)',
          'background:var(--co-designation, CanvasText)',
          'color:var(--co-designation-text, Canvas)',
          'border-radius:4px',
        ].join(';');
        document.body.appendChild(el);
      }
      el.textContent = value;
    },
    { id: CAPTION_ID, value: text },
  );
}

/** Writes a recording next to the test's other outputs (video, trace) for replay. */
export function writeRecording(outputPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
}
