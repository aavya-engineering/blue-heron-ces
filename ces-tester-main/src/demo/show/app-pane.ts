// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S3 — the two headed windows (FD-1, A4).
 *
 * The slides window is a landscape 16:9 pane on the left; the app pane is a
 * portrait window on the right showing the REAL CES tool GUIs being driven.
 * They are two separate `chromium.launch()` calls because Chromium's window
 * geometry arrives through per-process launch args — a second context in the
 * same browser cannot be placed independently.
 *
 * The app pane hands back the narrow `UiPage` seam, which is what lets an op
 * (`op-registry.ts`, `ops/ao-registry-op.ts`) drive it against a hand-written
 * fake in tests — the same seam the four M4 drivers already use.
 */

import type { Page } from 'playwright';
import { openMirrorUiPage, openPositionedUiPage, type UiPage, type UiSession, type WindowPlacement } from '../ui-page.js';
import { theatricalUiPage, type TheatreSurface } from './theatrical-page.js';

export type WindowGeometry = WindowPlacement;

/**
 * The in-slide mirror viewport (T1.5): a FIXED 736×1080 portrait box, sized to
 * the slide's right third. Fixed (not `viewport:null`) so the GUIs lay out at
 * 736px and the screencast maps 1:1 with no rescale blur — reflow, not rescale.
 *
 * GP-DEMO-6 (founder 2026-09-07): widened 640 → 736 (+15%) so the app frame
 * renders genuinely wider on stage (at the CAPTURE, not a CSS stretch). The
 * screencast frame cap (`DEFAULT_SCREENCAST.maxWidth`, screencast-mirror.ts) was
 * bumped 640 → 736 to match, or the wider capture would be downscaled back to 640
 * and the `<img>` would upscale it — a stretch. The per-app reflow CSS below needs
 * NO width edit: it is `grid-template-columns:1fr` + `max-width:none`, so the app
 * lays out at whatever the viewport width is (now 736), never a hardcoded 640.
 */
export const MIRROR_VIEWPORT = { width: 736, height: 1080 } as const;

/**
 * The per-app narrow reflow injected into the mirror pane (T1.5 S4). It runs
 * before each page's own scripts, on every navigation, and appends a `<style>`
 * on `DOMContentLoaded` that collapses the app's fixed multi-column desktop grid
 * to a single column at the mirror viewport width (736px, GP-DEMO-6). The CSS is
 * width-agnostic (`1fr` + `max-width:none`), so it fills whatever the viewport is
 * — the 640→736 widening needed no edit here. Keyed on `location.port` because one pane process
 * navigates to more than one app across a run:
 *
 *   - AO  :3001 — `#main` is `380px 1fr`, capped at 1320px (ces-ao index.html).
 *   - EO  :4002 — `#main` is `260px 1fr`, capped at 1400px (ces-eo index.html,
 *                 verified live this slice).
 *   - Muster :4173 — NO injected CSS: `.page` `max-width` is a cap, and a 640px
 *                 viewport lays the fluid column out ≤640 by construction.
 *   - Stamper :3000 — never mirrored (Config runs backstage), so never reached.
 *
 * These four sibling GUIs set no CSP (verified §6.4/§7), so an injected `<style>`
 * is safe. If a future app sets `style-src`, the `<style>` append silently no-ops
 * — the fallback is `sheet.insertRule` (CSSOM, ungoverned), flagged not built.
 */
/** Ports whose fixed `#main` desktop grid is collapsed to one column: AO, EO. */
const REFLOW_COLLAPSE_PORTS = ['3001', '4002'] as const;
const REFLOW_COLLAPSE_CSS = '#main{grid-template-columns:1fr !important;max-width:none !important;}';

/**
 * The narrow-reflow CSS for one app port, or `''` for a port that needs none
 * (Muster :4173 lays out fluidly; Stamper :3000 is never mirrored). Pure and
 * shared with the injected script (below) so the two cannot drift — the unit
 * test pins THIS, and the script embeds the same mapping.
 */
export function reflowCssForPort(port: string): string {
  return (REFLOW_COLLAPSE_PORTS as readonly string[]).includes(port) ? REFLOW_COLLAPSE_CSS : '';
}

/**
 * The branded cursor overlay injected into the mirror pane (T1.5 S5). A small
 * BHD dot — navy `#1a2332` core, gold `#f5b74a` ring (`BHD-BRAND.md`) — that
 * tracks the PAGE's own `mousemove`/`mousedown` and pulses on click. It rides in
 * the same `addInitScript` channel as reflow, so it survives every navigation.
 *
 * Playwright's `click()` dispatches a genuine `mousemove` to the target over
 * CDP, so the dot jumps to each click target and pulses. The glide/typed-cadence
 * theatre that makes the drive WATCHABLE is `theatrical-page.ts` (GP-DEMO-6):
 * `openAppPane` wraps the visible pane's seam in it, so every op's click glides
 * the pointer here first and every fill is typed.
 *
 * `position:fixed; z-index:<max>; pointer-events:none` so it floats above the
 * app and never intercepts a click; position is set via `el.style` (CSSOM), and
 * the click pulse is `el.animate()` — no `<style>` rule, so no CSP surface.
 */
export function cursorOverlayInitScript(): string {
  return `(() => {
    function install() {
      var root = document.body || document.documentElement;
      if (!root || document.getElementById('__mirror_cursor')) return;
      var dot = document.createElement('div');
      dot.id = '__mirror_cursor';
      dot.style.cssText = [
        'position:fixed','left:-100px','top:-100px','width:18px','height:18px',
        'border-radius:50%','background:#1a2332','border:2px solid #f5b74a',
        'box-shadow:0 0 6px rgba(245,183,74,.6)','transform:translate(-50%,-50%)',
        'z-index:2147483647','pointer-events:none','opacity:0','transition:opacity .2s ease'
      ].join(';') + ';';
      root.appendChild(dot);
      function move(e) { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; dot.style.opacity = '1'; }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mousedown', function (e) {
        move(e);
        try {
          dot.animate(
            [ { transform: 'translate(-50%,-50%) scale(1)' },
              { transform: 'translate(-50%,-50%) scale(2.2)' },
              { transform: 'translate(-50%,-50%) scale(1)' } ],
            { duration: 400, easing: 'ease-out' },
          );
        } catch (err) { /* Web Animations unavailable — the dot still tracks */ }
      }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
  })();`;
}

export function reflowInitScript(): string {
  return `(() => {
    var PORTS = ${JSON.stringify(REFLOW_COLLAPSE_PORTS)};
    var CSS = ${JSON.stringify(REFLOW_COLLAPSE_CSS)};
    function apply() {
      if (PORTS.indexOf(location.port) === -1) return; // Muster/none: leave alone.
      try {
        var style = document.createElement('style');
        style.setAttribute('data-mirror-reflow', '');
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
      } catch (e) { /* CSP style-src: CSSOM fallback is a flagged T1 follow-on */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  })();`;
}

/** Landscape 16:9, top-left. */
export const DEFAULT_SLIDES_GEOMETRY: WindowGeometry = { width: 1280, height: 720, x: 0, y: 0 };

/** Portrait, immediately right of the slides window. */
export const DEFAULT_APP_GEOMETRY: WindowGeometry = { width: 620, height: 1000, x: 1290, y: 0 };

/**
 * The BACKSTAGE session's viewport. This window is **never displayed** — it is
 * opened headless by the ops runner so doctrine-sensitive work (the Stamper
 * Configuration GUI, which THREAD_HANDOFF forbids showing on stage) happens
 * somewhere the audience cannot see it.
 *
 * The geometry therefore does not place a window; it only sizes the headless
 * viewport, and it is landscape-desktop-sized on purpose so the Stamper GUI
 * lays its workflow cards out the way it does on a real screen. A cramped
 * viewport changes which elements are visible, and `runStamperUiFlow` waits on
 * visibility.
 */
export const BACKSTAGE_GEOMETRY: WindowGeometry = { width: 1280, height: 900, x: 0, y: 0 };

/**
 * A whole HTML document as a URL a pane can navigate to, with no server.
 *
 * It lives HERE, not in `op-registry.ts`, and that is load-bearing: every op
 * that renders a readout needs it, `op-registry.ts` imports every op to build
 * `OP_IMPLEMENTATIONS`, and a value import back the other way closes a runtime
 * cycle. When an op module happens to be loaded first — a proof harness, a
 * future entry point, a bundler's ordering — that cycle throws
 * `Cannot access 'runMusterReadinessOp' before initialization` at import time.
 * `app-pane.ts` imports nothing from the show, so nothing can cycle through it.
 */
export function htmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`;
}

/** `1280x720+0+0` — the X geometry spelling, because it is unambiguous. */
export function parseGeometry(raw: string): WindowGeometry | undefined {
  const m = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/.exec(raw.trim());
  if (!m) return undefined;
  const [, w, h, x, y] = m;
  const geometry = { width: Number(w), height: Number(h), x: Number(x), y: Number(y) };
  if (geometry.width <= 0 || geometry.height <= 0) return undefined;
  return geometry;
}

export function formatGeometry(g: WindowGeometry): string {
  const sign = (n: number): string => (n < 0 ? String(n) : `+${n}`);
  return `${g.width}x${g.height}${sign(g.x)}${sign(g.y)}`;
}

export interface PaneOptions {
  readonly geometry: WindowGeometry;
  readonly slowMo?: number;
  /**
   * Open headless with no OS window. Two callers today: tests, and — since the
   * T1.5 default flip — a `mirror`-mode operator run, where the app is shown
   * in-slide via the screencast rather than a second window.
   */
  readonly headless?: boolean;
  /**
   * Open the pane as the in-slide MIRROR source (T1.5): headless, a FIXED
   * 736×1080 portrait viewport, and the per-app reflow (+ cursor overlay, S5)
   * init-scripts. The default operator run under the mirror; `--pane-window`
   * turns it off and restores the headed second window.
   */
  readonly mirror?: boolean;
  /**
   * Perform the drive visibly (`theatrical-page.ts`: glides, typed cadence,
   * settle beats). Defaults ON for anything an audience can see — the mirror
   * pane and the headed `--pane-window` — and OFF for a headless non-mirror
   * pane (the backstage session, the acts harness), where speed is the point.
   */
  readonly theatre?: boolean;
}

export interface AppPane {
  /** The narrow browser seam the ops drive. */
  readonly page: UiPage;
  readonly session: UiSession;
  goto(url: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The app pane. Two shapes:
 *
 *  - **mirror** (T1.5 default): headless, fixed 736×1080 viewport, reflow +
 *    cursor init-scripts — the source the `/mirror` screencast streams in-slide.
 *  - **window** (`--pane-window`): today's headed portrait window, placed right
 *    of the slides window, driven live for a rehearsal.
 *
 * Both open blank; ops navigate it, and both hand back the same narrow `UiPage`.
 */
export async function openAppPane(opts: PaneOptions): Promise<AppPane> {
  const session = opts.mirror
    ? await openMirrorUiPage({
        viewport: MIRROR_VIEWPORT,
        slowMo: opts.slowMo,
        initScripts: [reflowInitScript(), cursorOverlayInitScript()],
      })
    : await openPositionedUiPage({
        placement: opts.geometry,
        slowMo: opts.slowMo,
        headless: opts.headless,
      });
  const theatre = opts.theatre ?? (opts.mirror === true || opts.headless !== true);
  const page = theatre ? theatricalUiPage(theatreSurfaceOf(session.raw), session.page) : session.page;
  return {
    page,
    session,
    goto: (url) => page.goto(url),
    close: () => session.close(),
  };
}

/**
 * The HUD surface of a pane, when it has one. The hand-written test panes carry
 * no `session`; the HUD is theatre, so it simply does not exist there.
 */
export function hudSurfaceOf(pane: AppPane): Pick<TheatreSurface, 'evaluate'> | undefined {
  const raw = (pane as Partial<AppPane>).session?.raw;
  return raw ? theatreSurfaceOf(raw) : undefined;
}

/** The structural slice of a Playwright page the theatre drives. */
export function theatreSurfaceOf(raw: Page): TheatreSurface {
  return {
    mouse: raw.mouse,
    keyboard: raw.keyboard,
    locator: (selector) => raw.locator(selector),
    evaluate: (pageFunction, arg) => raw.evaluate(pageFunction as string, arg),
    viewportSize: () => raw.viewportSize(),
  };
}

/** The left-hand landscape window, pointed at the slides server. */
export async function openSlidesWindow(url: string, opts: PaneOptions): Promise<UiSession> {
  return openPositionedUiPage({
    placement: opts.geometry,
    url,
    headless: opts.headless,
  });
}
