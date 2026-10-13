// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 T1.5 S1 — the in-slide app mirror: a CDP screencast fanned out to
 * the slides window as MJPEG (DEMO-ACTS-CONCEPT §6 mechanism (b)).
 *
 * Shape:
 *
 *   attach(pane page)  ->  a CDP session on the VISIBLE pane (never backstage)
 *   GET /mirror        ->  subscribe(res): one long-lived multipart response
 *   Page.screencastFrame -> push(jpeg): store lastFrame, fan out, ACK the frame
 *   last subscriber gone -> stop the screencast; server teardown -> dispose()
 *
 * **Three load-bearing rules, each learned the hard way (§6.4):**
 *
 * 1. **Ack every frame.** `Page.startScreencast` stalls after a few frames
 *    unless each `Page.screencastFrame` is answered with
 *    `Page.screencastFrameAck` — Chromium will not send frame N+1 until frame N
 *    is acked. A missed ack looks exactly like a frozen app on stage.
 * 2. **Never queue for a slow client.** The screencast is change-driven and a
 *    single viewer; if `res.write()` returns false we skip that client until its
 *    `'drain'` and only ever send it the LATEST frame — a per-frame queue is the
 *    memory leak the concept called out.
 * 3. **Destroy every subscriber on teardown.** `node:http`'s `server.close()`
 *    blocks on open connections, and a `multipart/x-mixed-replace` response
 *    never ends on its own — so `dispose()` must destroy them or the run hangs
 *    on exit (A8). `dispose()` is called from more than one disposer, so it is
 *    idempotent.
 *
 * `PaneMirror` is SOURCE-AGNOSTIC: it screencasts whatever page it is `attach`ed
 * to. A run builds two instances — one bound to the visible `pane`
 * (`GET /mirror`), and one bound to the headless `backstage` session
 * (`GET /mirror/backstage`). Decision 11 (2026-09-07) lifted decision 8's
 * no-live-Config rule, so the backstage instance streams the real Configuration
 * GUI into a Config op's slide; before that, backstage was never screencast.
 * Which source a slide subscribes to is decided by `SlideOp.mirrorSource`
 * (`slide-render.ts`), not by this class.
 */

import type * as http from 'node:http';
import type { Page } from 'playwright';

/**
 * The slice of a Playwright `CDPSession` this file uses. Declared structurally
 * so the unit test can drive `PaneMirror` with a hand-written fake — no browser,
 * no real CDP — which is the only way frame→bytes fan-out and ack behaviour are
 * pinned without flaking on a live Chromium.
 */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: 'Page.screencastFrame', handler: (payload: ScreencastFramePayload) => void): void;
  detach?(): Promise<void>;
}

export interface ScreencastFramePayload {
  readonly data: string;
  readonly sessionId: number;
}

/** Measured against headless Chromium in the S1 spike (2026-09-07): headless
 * emits frames unconditionally, so the negative-coord headed fallback the plan
 * scoped is NOT used. Kept portrait right-third sized. */
export interface ScreencastConfig {
  readonly format: 'jpeg';
  readonly quality: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly everyNthFrame: number;
}

export const DEFAULT_SCREENCAST: ScreencastConfig = {
  format: 'jpeg',
  quality: 75,
  // GP-DEMO-6 (founder 2026-09-07): 640 → 736 to track `MIRROR_VIEWPORT.width`
  // (app-pane.ts). The pane now renders at 736; a 640 frame cap would downscale
  // it and the in-slide `<img>` would upscale — a stretch, which the "render
  // genuinely wider at the capture" directive forbids. Keep this equal to the
  // mirror viewport width.
  maxWidth: 736,
  maxHeight: 1080,
  everyNthFrame: 1,
};

/**
 * The backstage screencast (GP-DEMO-5 streamgui, P2-1). The backstage session is
 * a LANDSCAPE 1280×900 desktop viewport (`BACKSTAGE_GEOMETRY`) so the Stamper
 * Configuration GUI lays its workflow cards out the way it does on a real screen.
 * Encoding that at `DEFAULT_SCREENCAST`'s 640 maxWidth would 2× downscale the
 * Stamper text into the letterboxed right third; keep the source width so the
 * GUI stays legible. Legibility at this width is judged at the A2 headed proof.
 */
export const BACKSTAGE_SCREENCAST: ScreencastConfig = {
  format: 'jpeg',
  quality: 75,
  maxWidth: 1280,
  maxHeight: 900,
  everyNthFrame: 1,
};

const BOUNDARY = 'frame';

export interface PaneMirrorOptions {
  readonly screencast?: ScreencastConfig;
  readonly log?: (line: string) => void;
  /**
   * Test seam: how `attach(page)` obtains its CDP session. Defaults to
   * `page.context().newCDPSession(page)`. A test injects a fake here.
   */
  readonly newCdpSession?: (page: Page) => Promise<CdpSessionLike>;
}

/**
 * Fans one pane's screencast out to the `/mirror` MJPEG subscribers. One per
 * run, constructed before the slides server (the server takes it as an option),
 * attached once the pane exists.
 */
export class PaneMirror {
  private readonly screencast: ScreencastConfig;
  private readonly log: (line: string) => void;
  private readonly newCdpSession: (page: Page) => Promise<CdpSessionLike>;

  private cdp: CdpSessionLike | undefined;
  private readonly subscribers = new Set<http.ServerResponse>();
  /** Clients whose kernel buffer is full — sent only the latest frame on drain. */
  private readonly paused = new Set<http.ServerResponse>();
  private lastFrame: Buffer | undefined;
  /** "The screencast should be running" — set by the first subscriber; the CDP
   * command may be deferred until `attach` if a client connected first. */
  private wantScreencast = false;
  private screencasting = false;
  private disposed = false;

  constructor(opts: PaneMirrorOptions = {}) {
    this.screencast = opts.screencast ?? DEFAULT_SCREENCAST;
    this.log = opts.log ?? (() => undefined);
    this.newCdpSession =
      opts.newCdpSession ?? ((page: Page) => page.context().newCDPSession(page) as unknown as Promise<CdpSessionLike>);
  }

  /** Real path: attach a CDP session to the visible pane's page. */
  async attach(page: Page): Promise<void> {
    const cdp = await this.newCdpSession(page);
    await this.attachSession(cdp);
  }

  /**
   * Shared core, taking an already-built CDP session. The real `attach` and the
   * unit test both land here, so the fan-out/ack logic is exercised identically.
   */
  async attachSession(cdp: CdpSessionLike): Promise<void> {
    if (this.disposed) return;
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', (payload) => {
      // Fire-and-forget: the ack is awaited inside so the next frame flows, but
      // a push must never reject the CDP event pump.
      void this.onFrame(payload);
    });
    // A subscriber may have connected before the pane existed; honour its intent.
    if (this.wantScreencast && !this.screencasting) await this.startCdp();
  }

  private async onFrame(payload: ScreencastFramePayload): Promise<void> {
    try {
      this.push(Buffer.from(payload.data, 'base64'));
    } finally {
      // Ack EVERY frame or the stream stalls after a few — even if the push threw.
      await this.cdp?.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined);
    }
  }

  /**
   * Store the latest frame and fan it out. Skips a client whose buffer is full
   * (backpressure) — it catches up on the next frame after its `'drain'`, never
   * from a queue.
   */
  push(jpeg: Buffer): void {
    if (this.disposed) return;
    this.lastFrame = jpeg;
    for (const res of this.subscribers) {
      if (this.paused.has(res)) continue;
      this.writeFrame(res, jpeg);
    }
  }

  private writeFrame(res: http.ServerResponse, jpeg: Buffer): void {
    const head = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`;
    try {
      res.write(head);
      const ok = res.write(jpeg);
      res.write('\r\n');
      if (ok === false) {
        // Kernel buffer full: pause this client until it drains, then let the
        // next push feed it the current frame. Never accumulate.
        this.paused.add(res);
        res.once('drain', () => this.paused.delete(res));
      }
    } catch {
      // A write to a half-closed socket throws; the 'close' handler in the
      // server route will unsubscribe it.
    }
  }

  /**
   * Register one MJPEG subscriber: write the multipart head, replay the last
   * frame (the screencast is change-driven, so a late `<img>` would sit blank
   * without this), and start the screencast if this is the first client.
   */
  subscribe(res: http.ServerResponse): void {
    if (this.disposed) {
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
    });
    // Flush the head NOW: the screencast is change-driven, so an idle pane writes
    // no body — without this the `<img>` connection (and any test `fetch`) would
    // block waiting for headers that only arrive with the first frame.
    res.flushHeaders?.();
    this.subscribers.add(res);
    if (this.lastFrame) this.writeFrame(res, this.lastFrame);
    // No frame yet — capture the page's CURRENT state at SUBSCRIBE time. The
    // screencast is change-driven, so a finished/idle backstage page (a warm
    // execute that completed before its slide is reached) emits nothing on
    // `startScreencast`; without this the `<img>` would sit blank on a page that
    // has real content. Seed on SUBSCRIBE, never on attach (P1-2): `attach` runs
    // in `prepare()` on a blank, never-navigated backstage page, so a capture
    // there would replay a BLANK page as if it were live — the fabricated stream
    // the founder forbids.
    else void this.seedFrame(res);
    if (this.subscribers.size === 1) this.start();
  }

  /**
   * Seed one just-connected subscriber with the page's CURRENT frame, via
   * `Page.captureScreenshot`. Best-effort and self-cancelling: if a real
   * screencast frame arrived while the capture was in flight (`lastFrame` set
   * again), or the client left, or the mirror was disposed, the capture is
   * DROPPED — a live stream is never rewound by a stale seed.
   */
  private async seedFrame(res: http.ServerResponse): Promise<void> {
    const cdp = this.cdp;
    if (!cdp || this.disposed) return;
    try {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: this.screencast.format,
        quality: this.screencast.quality,
      });
      const data = (shot as { data?: string } | undefined)?.data;
      if (!data || this.disposed || this.lastFrame !== undefined || !this.subscribers.has(res)) return;
      const jpeg = Buffer.from(data, 'base64');
      this.lastFrame = jpeg;
      this.writeFrame(res, jpeg);
    } catch {
      // Capture unsupported, or the page is gone — the first real screencast
      // frame will fill the `<img>` in. Never fatal.
    }
  }

  /** Drop one subscriber; stop the screencast when the last one leaves. */
  unsubscribe(res: http.ServerResponse): void {
    this.subscribers.delete(res);
    this.paused.delete(res);
    if (this.subscribers.size === 0) this.stop();
  }

  /** Open subscriber count — the teardown assertion reads this. */
  subscriberCount(): number {
    return this.subscribers.size;
  }

  private start(): void {
    this.wantScreencast = true;
    if (!this.screencasting) void this.startCdp();
  }

  private async startCdp(): Promise<void> {
    if (this.disposed || this.screencasting || !this.cdp) return;
    this.screencasting = true;
    try {
      await this.cdp.send('Page.startScreencast', {
        format: this.screencast.format,
        quality: this.screencast.quality,
        maxWidth: this.screencast.maxWidth,
        maxHeight: this.screencast.maxHeight,
        everyNthFrame: this.screencast.everyNthFrame,
      });
    } catch (err) {
      this.screencasting = false;
      this.log(`  mirror: startScreencast failed (continuing without frames): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private stop(): void {
    this.wantScreencast = false;
    if (!this.screencasting || !this.cdp) return;
    this.screencasting = false;
    void this.cdp.send('Page.stopScreencast').catch(() => undefined);
  }

  /**
   * Detach the CDP session and destroy every open subscriber. Idempotent: it is
   * pushed as its own disposer AND called from the server's `stop()` (itself a
   * disposer), so it fires at least twice.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const res of this.subscribers) {
      try {
        // Destroy the RESPONSE and its socket. `server.close()` blocks until the
        // underlying connection is gone, and a half-open multipart socket is not
        // released by ending the response alone — the socket must be destroyed.
        res.socket?.destroy();
        res.destroy();
      } catch {
        /* already gone */
      }
    }
    this.subscribers.clear();
    this.paused.clear();
    const cdp = this.cdp;
    this.cdp = undefined;
    if (cdp?.detach) await cdp.detach().catch(() => undefined);
  }
}
