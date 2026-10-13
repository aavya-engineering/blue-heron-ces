// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S3 — the slides server: page, SSE, nav, assets.
 *
 * One `node:http` server serves EVERYTHING the slides window needs, and it owns
 * the show's state. Three reasons that shape is not negotiable:
 *
 * 1. **`file://` cannot work.** A `file://` origin is `null`, which breaks both
 *    `EventSource` and the `fetch` POST back (RESEARCH_SUMMARY.md caveat 5). The
 *    page must be served over HTTP even though it is a local, single-viewer page.
 * 2. **The pacing timer belongs here, not in the browser.** If the page reloads
 *    mid-demo — or the operator closes and reopens it — it must land on the
 *    current slide with the current countdown, not restart the deck.
 * 3. **Nav arrives from two places** (A5): the page's keydown POSTs to `/nav`,
 *    and the terminal's raw-mode keypress calls `dispatch` directly. Both feed
 *    the same reducer, so they can never disagree.
 *
 * Assets are served by ID, never by path: `/asset/<id>` looks the id up in the
 * deck's asset table and streams that file. A request can therefore only ever
 * reach a file the deck itself declared and validation already fenced inside the
 * deck directory — there is no path to traverse.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DemoDeck } from './deck-model.js';
import type { PaneMirror } from './screencast-mirror.js';
import { buildDeckView, renderShowHtml, type DeckView } from './slide-render.js';
import {
  createShowState,
  keyToAction,
  reduceShow,
  snapshot,
  type ShowAction,
  type ShowSnapshot,
  type ShowState,
} from './show-state.js';

/**
 * Extension -> content type for the asset kinds a deck can reference. `.html`
 * is here for the `html` slide body, which the page loads into a sandboxed,
 * opaque-origin iframe — the document is served, never inlined into the shell.
 */
const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
};

export interface SlidesServerOptions {
  readonly deck: DemoDeck;
  readonly port: number;
  readonly host?: string;
  readonly defaultDwellSec?: number;
  readonly auto?: boolean;
  readonly presenter?: boolean;
  /** How often the pacing loop runs. 250 ms keeps the countdown honest. */
  readonly tickMs?: number;
  /** Test seam: the clock. */
  readonly now?: () => number;
  /** `--watchouts`: render the presenter cue band. Defaults OFF. */
  readonly watchouts?: boolean;
  /**
   * Called after every state change — the runner starts/stops ops from here.
   *
   * `action` is the third parameter (so every existing caller keeps compiling)
   * and it is what makes an auto tick distinguishable from a manual advance.
   * Without it a report can only see "the index moved", not how.
   */
  readonly onChange?: (state: ShowState, previous: ShowState, action: ShowAction) => void;
  /**
   * The in-slide app mirror (T1.5). When present, `GET /mirror` streams the
   * pane's screencast to the `<img>` a mirrored slide renders. Absent for a
   * `--pane-window` run (the second window shows the app instead) — the route
   * then simply 404s, which no slide requests because no `<img src="/mirror">`
   * is rendered without an active mirror.
   */
  readonly mirror?: PaneMirror;
  /**
   * The BACKSTAGE app mirror (GP-DEMO-5 streamgui). When present, `GET
   * /mirror/backstage` streams the headless backstage session's screencast to the
   * `<img>` a `theatrical`+`backstage` slide (a Config op) renders. A SECOND
   * `PaneMirror`, bound to `backstage.session.raw`, so Config work streams without
   * ever moving onto the visible pane. Absent (a `--pane-window` run, or a deck
   * with no Config op) → the route 404s, which no slide requests. Disposed in
   * `stop()` before `server.close()` (A8), like `mirror`.
   */
  readonly backstageMirror?: PaneMirror;
  /**
   * Whether the in-slide app mirror is active for this run (T1.5). Threaded into
   * `buildDeckView` so a driven `theatrical`/`readout` slide renders the
   * right-third split. Defaults OFF.
   */
  readonly mirrorActive?: boolean;
}

export interface SlidesServer {
  readonly url: string;
  readonly port: number;
  readonly view: DeckView;
  state(): ShowState;
  /** Apply an action and broadcast. The single mutation point. */
  dispatch(action: ShowAction): ShowState;
  snapshot(): ShowSnapshot;
  /** Open SSE connections, for teardown assertions. */
  clientCount(): number;
  stop(): Promise<void>;
}

export async function startSlidesServer(opts: SlidesServerOptions): Promise<SlidesServer> {
  const now = opts.now ?? (() => Date.now());
  const host = opts.host ?? '127.0.0.1';
  const deck = opts.deck;
  const view = buildDeckView(deck, {
    defaultDwellSec: opts.defaultDwellSec,
    watchouts: opts.watchouts,
    mirrorActive: opts.mirrorActive,
  });
  const page = renderShowHtml(view);
  const assets = new Map(deck.assets.map((a) => [a.id, a]));

  let state = createShowState(deck, {
    defaultDwellSec: opts.defaultDwellSec,
    auto: opts.auto,
    presenter: opts.presenter,
    now: now(),
  });

  const clients = new Set<http.ServerResponse>();
  let lastBroadcast = '';

  const broadcast = (force = false): void => {
    const payload = JSON.stringify(snapshot(deck, state, now()));
    if (!force && payload === lastBroadcast) return;
    lastBroadcast = payload;
    for (const res of clients) {
      res.write(`event: state\ndata: ${payload}\n\n`);
    }
  };

  const dispatch = (action: ShowAction): ShowState => {
    const previous = state;
    state = reduceShow(deck, state, action, now());
    if (state !== previous) opts.onChange?.(state, previous, action);
    broadcast();
    return state;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const route = url.pathname;

    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
      return;
    }

    if (req.method === 'GET' && route === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      clients.add(res);
      // The just-connected page must not wait for the next tick to draw.
      res.write(`event: state\ndata: ${JSON.stringify(snapshot(deck, state, now()))}\n\n`);
      req.on('close', () => {
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && route === '/nav') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 4096) req.destroy(); // a nav POST is tiny; anything else is not one
      });
      req.on('end', () => {
        let action: ShowAction | undefined;
        try {
          const parsed = JSON.parse(body || '{}') as { key?: string; action?: ShowAction };
          action = parsed.action ?? (parsed.key ? keyToAction(parsed.key) : undefined);
        } catch {
          action = undefined;
        }
        if (!action) {
          res.writeHead(204).end();
          return;
        }
        dispatch(action);
        res.writeHead(204).end();
      });
      return;
    }

    if (req.method === 'GET' && route === '/mirror') {
      // The in-slide app mirror: one long-lived MJPEG response. `subscribe`
      // writes the multipart head and replays the last frame; the first
      // subscriber starts the screencast, the last close stops it. With no
      // mirror wired (a `--pane-window` run) the route does not exist.
      if (!opts.mirror) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no mirror');
        return;
      }
      opts.mirror.subscribe(res);
      req.on('close', () => opts.mirror?.unsubscribe(res));
      return;
    }

    if (req.method === 'GET' && route === '/mirror/backstage') {
      // The BACKSTAGE app mirror (GP-DEMO-5 streamgui): the headless backstage
      // session's screencast, for a Config op's `theatrical`+`backstage` slide.
      // Same long-lived MJPEG contract as `/mirror`; 404s when unwired (a deck
      // with no Config op, or a `--pane-window` run).
      if (!opts.backstageMirror) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no backstage mirror');
        return;
      }
      opts.backstageMirror.subscribe(res);
      req.on('close', () => opts.backstageMirror?.unsubscribe(res));
      return;
    }

    if (req.method === 'GET' && route.startsWith('/asset/')) {
      // By ID, never by path — the id must be one the deck declared, so the
      // request cannot name a file the loader did not already fence.
      const asset = assets.get(decodeURIComponent(route.slice('/asset/'.length)));
      if (!asset) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no such asset');
        return;
      }
      fs.readFile(asset.absPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('asset unreadable');
          return;
        }
        const type = ASSET_TYPES[path.extname(asset.absPath).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data);
      });
      return;
    }

    if (req.method === 'GET' && route === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(snapshot(deck, state, now())));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const boundPort = (server.address() as AddressInfo).port;

  // Pacing + SSE heartbeat share one loop: the countdown has to be re-broadcast
  // every second anyway, which doubles as the keep-alive the stream needs.
  const timer = setInterval(() => {
    dispatch({ type: 'tick' });
    broadcast();
  }, opts.tickMs ?? 250);

  let stopped = false;
  return {
    url: `http://${host}:${boundPort}/`,
    port: boundPort,
    view,
    state: () => state,
    dispatch,
    snapshot: () => snapshot(deck, state, now()),
    clientCount: () => clients.size,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
      // The MJPEG subscribers never end on their own, and `server.close()` blocks
      // on any open connection — so destroy them here or the run hangs on exit
      // (A8). `dispose()` is idempotent; both mirrors are also their own disposers
      // in show-run. Dispose the backstage mirror too, or a Config-op deck hangs.
      await opts.mirror?.dispose();
      await opts.backstageMirror?.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
