// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 T1.5 S1 — the in-slide app mirror.
 *
 * Two halves, both proving a rule that only bites live:
 *
 * 1. `PaneMirror` against a HAND-WRITTEN fake CDP session — frames in produce
 *    multipart bytes out, every frame is acked (or the real stream stalls),
 *    backpressure skips a full client instead of queueing, and `dispose()`
 *    destroys subscribers and is idempotent.
 * 2. A REAL `/mirror` HTTP subscriber held OPEN across `server.stop()` — the A8
 *    teardown proof: `stop()` must RESOLVE (a `multipart/x-mixed-replace`
 *    response never ends on its own, and `server.close()` blocks on it).
 */

import { describe, it, expect, vi } from 'vitest';
import * as http from 'node:http';
import { PaneMirror, type CdpSessionLike, type ScreencastFramePayload } from '../src/demo/show/screencast-mirror.js';
import { startSlidesServer } from '../src/demo/show/slides-server.js';
import { cursorOverlayInitScript, openAppPane, reflowCssForPort, reflowInitScript } from '../src/demo/show/app-pane.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';

/* ------------------------------------------------------------- fakes ----- */

function fakeCdp(): CdpSessionLike & { sent: { method: string; params?: Record<string, unknown> }[]; emit: (p: ScreencastFramePayload) => void; detached: boolean } {
  let handler: ((p: ScreencastFramePayload) => void) | undefined;
  return {
    sent: [],
    detached: false,
    send(method, params) {
      this.sent.push({ method, params });
      return Promise.resolve();
    },
    on(_event, h) {
      handler = h;
    },
    detach() {
      this.detached = true;
      return Promise.resolve();
    },
    emit(p) {
      handler?.(p);
    },
  };
}

interface FakeRes {
  code?: number;
  headers?: Record<string, string>;
  ended: boolean;
  destroyed: boolean;
  writable: boolean;
  chunks: Buffer[];
  writeHead(code: number, headers?: Record<string, string>): FakeRes;
  write(chunk: string | Buffer): boolean;
  once(event: string, cb: () => void): void;
  end(): void;
  destroy(): void;
  drain(): void;
  body(): Buffer;
}

function fakeRes(): FakeRes {
  const drainHandlers: (() => void)[] = [];
  return {
    ended: false,
    destroyed: false,
    writable: true,
    chunks: [],
    writeHead(code, headers) {
      this.code = code;
      this.headers = headers;
      return this;
    },
    write(chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary'));
      return this.writable;
    },
    once(event, cb) {
      if (event === 'drain') drainHandlers.push(cb);
    },
    end() {
      this.ended = true;
    },
    destroy() {
      this.destroyed = true;
    },
    drain() {
      this.writable = true;
      drainHandlers.splice(0).forEach((cb) => cb());
    },
    body() {
      return Buffer.concat(this.chunks);
    },
  };
}

const asRes = (r: FakeRes): http.ServerResponse => r as unknown as http.ServerResponse;
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/* -------------------------------------------------- PaneMirror (unit) ---- */

describe('PaneMirror — frame fan-out and ack', () => {
  it('writes a multipart part per frame and acks EVERY frame', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    const res = fakeRes();
    mirror.subscribe(asRes(res));

    // First subscriber starts the screencast.
    expect(cdp.sent.some((s) => s.method === 'Page.startScreencast')).toBe(true);
    expect(res.headers?.['Content-Type']).toContain('multipart/x-mixed-replace; boundary=frame');

    const jpegA = Buffer.from([0xff, 0xd8, 0xaa, 0xff, 0xd9]);
    const jpegB = Buffer.from([0xff, 0xd8, 0xbb, 0xbb, 0xff, 0xd9]);
    cdp.emit({ data: jpegA.toString('base64'), sessionId: 7 });
    cdp.emit({ data: jpegB.toString('base64'), sessionId: 9 });
    await flush();

    const body = res.body().toString('binary');
    expect(body).toContain('--frame\r\nContent-Type: image/jpeg\r\n');
    expect(body).toContain(`Content-Length: ${jpegA.length}\r\n`);
    expect(body).toContain(`Content-Length: ${jpegB.length}\r\n`);
    expect(res.body().includes(jpegA)).toBe(true);
    expect(res.body().includes(jpegB)).toBe(true);

    const acks = cdp.sent.filter((s) => s.method === 'Page.screencastFrameAck');
    expect(acks.map((a) => a.params?.sessionId)).toEqual([7, 9]);
  });

  it('seeds a subscriber via Page.captureScreenshot when no frame has arrived yet (P1-2)', async () => {
    // A finished/idle backstage page emits no screencast frame, so a just-connected
    // <img> would sit blank without a subscribe-time capture of its CURRENT state.
    const seed = Buffer.from([0xff, 0xd8, 0x51, 0x51, 0xff, 0xd9]);
    const cdp = fakeCdp();
    const inner = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      void inner(method, params); // still record in `sent`
      return method === 'Page.captureScreenshot'
        ? Promise.resolve({ data: seed.toString('base64') })
        : Promise.resolve();
    };
    const mirror = new PaneMirror();
    await mirror.attachSession(cdp);

    const res = fakeRes();
    mirror.subscribe(asRes(res));
    await flush();
    await flush();

    // The captured CURRENT frame reached the subscriber, requested as jpeg.
    expect(res.body().includes(seed)).toBe(true);
    const cap = cdp.sent.find((s) => s.method === 'Page.captureScreenshot');
    expect(cap?.params?.format).toBe('jpeg');
  });

  it('does NOT capture a seed when a real frame already exists (never rewind a live stream)', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    // A real frame arrives first, so lastFrame is set.
    const real = Buffer.from([0xff, 0xd8, 0x99, 0xff, 0xd9]);
    cdp.emit({ data: real.toString('base64'), sessionId: 1 });
    await flush();

    const late = fakeRes();
    mirror.subscribe(asRes(late));
    await flush();
    // The late subscriber gets the REAL last frame, and no capture is attempted.
    expect(late.body().includes(real)).toBe(true);
    expect(cdp.sent.some((s) => s.method === 'Page.captureScreenshot')).toBe(false);
  });

  it('replays the last frame to a late subscriber (screencast is change-driven)', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    const jpeg = Buffer.from([0xff, 0xd8, 0x42, 0xff, 0xd9]);
    cdp.emit({ data: jpeg.toString('base64'), sessionId: 1 });
    await flush();

    // A subscriber that arrives AFTER the only frame must not sit blank.
    const late = fakeRes();
    mirror.subscribe(asRes(late));
    expect(late.body().includes(jpeg)).toBe(true);
  });

  it('skips a backpressured client until it drains, never queueing', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    const res = fakeRes();
    mirror.subscribe(asRes(res));

    res.writable = false; // kernel buffer full on the next write
    cdp.emit({ data: Buffer.from([0x01]).toString('base64'), sessionId: 1 });
    await flush();
    const afterFirst = res.chunks.length;

    // Paused: a second frame must NOT be written while the client is full.
    cdp.emit({ data: Buffer.from([0x02]).toString('base64'), sessionId: 2 });
    await flush();
    expect(res.chunks.length).toBe(afterFirst);

    // After drain, the NEXT frame flows (last-frame-only, not the queued one).
    res.drain();
    cdp.emit({ data: Buffer.from([0x03]).toString('base64'), sessionId: 3 });
    await flush();
    expect(res.chunks.length).toBeGreaterThan(afterFirst);

    // Ack was still sent for every frame, paused or not.
    expect(cdp.sent.filter((s) => s.method === 'Page.screencastFrameAck').length).toBe(3);
  });

  it('starts on the first subscriber and stops on the last', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    const a = fakeRes();
    const b = fakeRes();
    mirror.subscribe(asRes(a));
    mirror.subscribe(asRes(b));
    expect(cdp.sent.filter((s) => s.method === 'Page.startScreencast').length).toBe(1);
    expect(cdp.sent.some((s) => s.method === 'Page.stopScreencast')).toBe(false);

    mirror.unsubscribe(asRes(a));
    expect(cdp.sent.some((s) => s.method === 'Page.stopScreencast')).toBe(false); // b still open
    mirror.unsubscribe(asRes(b));
    expect(cdp.sent.filter((s) => s.method === 'Page.stopScreencast').length).toBe(1);
  });

  it('dispose destroys every subscriber, detaches, and is idempotent', async () => {
    const mirror = new PaneMirror();
    const cdp = fakeCdp();
    await mirror.attachSession(cdp);
    const a = fakeRes();
    const b = fakeRes();
    mirror.subscribe(asRes(a));
    mirror.subscribe(asRes(b));
    expect(mirror.subscriberCount()).toBe(2);

    await mirror.dispose();
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(true);
    expect(cdp.detached).toBe(true);
    expect(mirror.subscriberCount()).toBe(0);

    // Idempotent: a second dispose (server.stop() also disposes) must not throw.
    await expect(mirror.dispose()).resolves.toBeUndefined();

    // A subscriber after dispose is politely closed, never left hanging.
    const late = fakeRes();
    mirror.subscribe(asRes(late));
    expect(late.ended).toBe(true);
    expect(mirror.subscriberCount()).toBe(0);
  });
});

/* --------------------------------------- /mirror teardown (integration) -- */

function slide(n: number): DemoSlide {
  return {
    slideNumber: n,
    rows: [{ sheetRow: n + 1, slideNumber: n, feature: `Slide ${n}` }],
    op: { mode: 'staged', tools: [], images: [] },
  };
}
function deckOf(...slides: DemoSlide[]): DemoDeck {
  return { sourcePath: 'demos/t.xlsx', baseDir: '/demos', title: 'test-deck', slides, assets: [], warnings: [] };
}

describe('GET /mirror (A8 server-teardown proof)', () => {
  it('server.stop() RESOLVES with an open MJPEG subscriber, and the subscriber count drops to 0', async () => {
    const mirror = new PaneMirror();
    const server = await startSlidesServer({ deck: deckOf(slide(1), slide(2)), port: 0, tickMs: 10_000, mirror });

    const controller = new AbortController();
    const res = await fetch(`${server.url}mirror`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('multipart/x-mixed-replace');
    // The subscriber is registered as the request is handled.
    await vi.waitFor(() => expect(mirror.subscriberCount()).toBe(1));

    // The whole point: an OPEN multipart response must not wedge server.close().
    await Promise.race([
      server.stop(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('server.stop() hung on the open /mirror connection')), 5_000)),
    ]);
    expect(mirror.subscriberCount()).toBe(0);

    // Reading the destroyed stream just ends; swallow the abort noise.
    controller.abort();
    await res.body?.getReader().read().catch(() => undefined);
  });

  it('404s /mirror when no mirror is wired (a --pane-window run)', async () => {
    const server = await startSlidesServer({ deck: deckOf(slide(1)), port: 0, tickMs: 10_000 });
    try {
      expect((await fetch(`${server.url}mirror`)).status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});

/* ------------------------ GET /mirror/backstage (GP-DEMO-5 streamgui) ------ */

describe('GET /mirror/backstage (backstage streamable source, A8 teardown)', () => {
  it('serves MJPEG, and server.stop() RESOLVES with an open backstage subscriber (count -> 0)', async () => {
    const backstageMirror = new PaneMirror();
    const server = await startSlidesServer({
      deck: deckOf(slide(1), slide(2)),
      port: 0,
      tickMs: 10_000,
      backstageMirror,
    });

    const controller = new AbortController();
    const res = await fetch(`${server.url}mirror/backstage`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('multipart/x-mixed-replace');
    await vi.waitFor(() => expect(backstageMirror.subscriberCount()).toBe(1));

    await Promise.race([
      server.stop(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('server.stop() hung on the open /mirror/backstage connection')), 5_000),
      ),
    ]);
    expect(backstageMirror.subscriberCount()).toBe(0);

    controller.abort();
    await res.body?.getReader().read().catch(() => undefined);
  });

  it('404s /mirror/backstage when no backstage mirror is wired', async () => {
    const server = await startSlidesServer({ deck: deckOf(slide(1)), port: 0, tickMs: 10_000 });
    try {
      expect((await fetch(`${server.url}mirror/backstage`)).status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('disposes both mirrors on stop() — the pane mirror and the backstage mirror', async () => {
    const mirror = new PaneMirror();
    const backstageMirror = new PaneMirror();
    const server = await startSlidesServer({
      deck: deckOf(slide(1)),
      port: 0,
      tickMs: 10_000,
      mirror,
      backstageMirror,
    });
    const a = await fetch(`${server.url}mirror`);
    const b = await fetch(`${server.url}mirror/backstage`);
    await vi.waitFor(() => {
      expect(mirror.subscriberCount()).toBe(1);
      expect(backstageMirror.subscriberCount()).toBe(1);
    });
    await server.stop();
    expect(mirror.subscriberCount()).toBe(0);
    expect(backstageMirror.subscriberCount()).toBe(0);
    await a.body?.getReader().read().catch(() => undefined);
    await b.body?.getReader().read().catch(() => undefined);
  });
});

/* ------------------------------------------------ S4 per-app reflow ------ */

describe('mirror-pane narrow reflow (T1.5 S4)', () => {
  const COLLAPSE = '#main{grid-template-columns:1fr !important;max-width:none !important;}';

  it('maps each app port to its reflow CSS (AO/EO collapse; Muster/Stamper/none untouched)', () => {
    expect(reflowCssForPort('3001')).toBe(COLLAPSE); // AO
    expect(reflowCssForPort('4002')).toBe(COLLAPSE); // EO
    expect(reflowCssForPort('4173')).toBe(''); // Muster — fluid, no CSS
    expect(reflowCssForPort('3000')).toBe(''); // Stamper — never mirrored
    expect(reflowCssForPort('')).toBe(''); // a data: URL / no port
  });

  it('the injected script embeds the same ports and CSS (no drift)', () => {
    const script = reflowInitScript();
    expect(script).toContain('"3001"');
    expect(script).toContain('"4002"');
    expect(script).toContain(COLLAPSE);
    expect(script).toContain('data-mirror-reflow');
  });

  it('opens headless at the fixed 736x1080 mirror viewport and injects the reflow on an AO-port page', async () => {
    // A real end-to-end proof: serve a fixed multi-column #main on :3001 (AO's
    // port, which the reflow keys on) and confirm the injected <style> collapses
    // it. Skips gracefully if :3001 is held by a live demo — the suite norm is
    // never to fight a real port.
    const bound = await new Promise<http.Server | null>((resolve) => {
      const srv = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head></head><body><div id="main" style="display:grid;grid-template-columns:380px 1fr">x</div></body></html>');
      });
      srv.once('error', () => resolve(null));
      srv.listen(3001, '127.0.0.1', () => resolve(srv));
    });
    if (!bound) {
      console.warn('  (skip: :3001 is in use — cannot prove reflow injection this run)');
      return;
    }

    const pane = await openAppPane({ geometry: { width: 736, height: 1080, x: 0, y: 0 }, mirror: true });
    try {
      // Fixed viewport, not viewport:null — the reflow-not-rescale contract.
      // GP-DEMO-6: MIRROR_VIEWPORT widened 640 → 736 (+15%).
      expect(pane.session.raw.viewportSize()).toEqual({ width: 736, height: 1080 });
      await pane.goto('http://127.0.0.1:3001/');
      const injected = await pane.session.raw.evaluate(() => {
        // Browser context — reach the DOM via globalThis so tsc needs no dom lib.
        const g = globalThis as unknown as {
          document: { querySelector(s: string): { textContent: string | null } | null; getElementById(id: string): unknown };
          getComputedStyle(el: unknown): { gridTemplateColumns: string };
        };
        const el = g.document.querySelector('style[data-mirror-reflow]');
        const cols = g.getComputedStyle(g.document.getElementById('main')).gridTemplateColumns;
        return { hasStyle: !!el, css: el?.textContent ?? '', trackCount: String(cols).trim().split(/\s+/).length };
      });
      expect(injected.hasStyle).toBe(true);
      expect(injected.css).toContain('1fr !important');
      // 380px 1fr (two tracks) collapsed to a single track.
      expect(injected.trackCount).toBe(1);
    } finally {
      await pane.close();
      await new Promise<void>((r) => bound.close(() => r()));
    }
  }, 30_000);
});

/* --------------------------------------------- S5 branded cursor -------- */

describe('mirror-pane branded cursor overlay (T1.5 S5)', () => {
  it('injects the BHD dot and it rides to a click target', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="margin:0"><button id="go" style="position:absolute;left:200px;top:300px;width:80px;height:40px">Go</button></body></html>');
    });
    const port = await new Promise<number>((resolve) => srv.listen(0, '127.0.0.1', () => resolve((srv.address() as import('node:net').AddressInfo).port)));

    const pane = await openAppPane({ geometry: { width: 736, height: 1080, x: 0, y: 0 }, mirror: true });
    try {
      await pane.goto(`http://127.0.0.1:${port}/`);
      // Present before any interaction (opacity 0), then a real Playwright click
      // dispatches a genuine mousemove so the dot jumps to the target and shows.
      await pane.page.click('#go');
      const dot = await pane.session.raw.evaluate(() => {
        const g = globalThis as unknown as { document: { getElementById(id: string): { style: { left: string; top: string; opacity: string } } | null } };
        const el = g.document.getElementById('__mirror_cursor');
        return el ? { left: el.style.left, top: el.style.top, opacity: el.style.opacity } : null;
      });
      expect(dot).not.toBeNull();
      expect(dot!.opacity).toBe('1'); // revealed by the click's mousemove
      expect(dot!.left).not.toBe('-100px'); // moved off its parked start
      // The button sits at ~200..280 x, 300..340 y; the dot lands inside it.
      expect(parseFloat(dot!.left)).toBeGreaterThan(150);
      expect(parseFloat(dot!.top)).toBeGreaterThan(250);
    } finally {
      await pane.close();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 30_000);

  it('the cursor script is self-contained (no <style>, uses el.animate for the pulse)', () => {
    const script = cursorOverlayInitScript();
    expect(script).toContain('#1a2332'); // BHD navy core
    expect(script).toContain('#f5b74a'); // BHD gold ring
    expect(script).toContain('pointer-events:none');
    expect(script).toContain('.animate('); // click pulse via Web Animations, not CSS
  });
});
