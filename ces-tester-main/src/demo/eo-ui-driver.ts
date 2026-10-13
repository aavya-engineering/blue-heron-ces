// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — Beats 1/3 (EO) driven through the EO SPA, as a user.
 *
 * M0 confirmed the SPA's buttons call the SAME SSE endpoints `runEoLeg`
 * already drives (`/api/connect?tenant=`, `/api/assess?tenant=`), so this
 * driver is a genuine reskin of an already-proven leg — and per the plan's
 * rule, **the structured numbers still come from the API, never from the DOM**:
 * `runEoLeg` owns `controls_met` / `liveAssessmentCount`, this file owns the
 * user-perspective drive and, at most, per-control detail read back over
 * `GET /api/controls/:id` from the page's own request context.
 *
 * Two SPA facts that shape the flow (verified in `ces-eo/public/index.html`):
 *
 * - **Connect is genuinely optional.** Selecting a tenant enables BOTH buttons;
 *   `#assessBtn` is not gated on the connection. A connect failure is therefore
 *   reported, not fatal — the assess still runs and is still the real signal.
 * - **The page navigates away 1500 ms after `assess_done`** (it programmatically
 *   clicks the evidence-explorer tab). `#assessStatus` reaching
 *   `Evidence assessment complete.` is written on the `assess_summary` event,
 *   so it must be read promptly — everything after that is best-effort.
 */

import { HEADLESS_MODE, type WatchMode } from './watch-mode.js';
import { mapControlDetail, type EoControlDetail } from './eo-leg.js';
import { eoTenantUrl } from './eo-tenant-url.js';
import { captureScreenshot, openUiPage, waitForText, type UiPage } from './ui-page.js';

/** Selector inventory — verified in the M0 spike and against `public/index.html`. */
export const EO_SELECTORS = {
  tenantSelect: '#tenantConnectSelect',
  tenantOption: (slug: string) => `#tenantConnectSelect option[value="${slug}"]`,
  connect: '#connectBtn',
  connectStatus: '#tenantStatusText',
  assess: '#assessBtn',
  assessStatus: '#assessStatus',
} as const;

/** Written only on the assess-summary event — not an idle placeholder. */
export const EO_ASSESS_DONE_TEXT = 'Evidence assessment complete.';

export interface EoUiDriveContext {
  readonly baseUrl: string;
  readonly slug: string;
  readonly watch?: WatchMode;
  /** Per-control detail to read back after the assess (best-effort). */
  readonly controlIds?: readonly string[];
  readonly screenshotDir?: string;
  /** Screenshot filename prefix — the demo drives EO twice (before/after). */
  readonly label?: string;
  readonly connectTimeoutMs?: number;
  readonly assessTimeoutMs?: number;
}

export interface EoUiDriveResult {
  /** false ⇒ Connect did not reach a connected state; the assess still ran. */
  readonly connected: boolean;
  readonly assessed: boolean;
  readonly connectStatus?: string;
  readonly assessStatus?: string;
  readonly controls?: readonly EoControlDetail[];
  readonly connectError?: string;
  readonly screenshots: readonly string[];
}

export type EoUiDriver = (ctx: EoUiDriveContext) => Promise<EoUiDriveResult>;

const DEFAULTS = {
  connectTimeoutMs: 120_000,
  assessTimeoutMs: 300_000, // M0 measured ~1 s against a warm sim; budget for a cold one
} as const;

/**
 * The SPA flow, against the narrow `UiPage` seam so it is testable without a
 * browser. Throws only when the ASSESS did not happen — a connect failure is
 * carried in the result, because the SPA itself treats Connect as optional.
 */
export async function runEoUiFlow(page: UiPage, ctx: EoUiDriveContext): Promise<EoUiDriveResult> {
  const prefix = ctx.label ? `${ctx.label}-` : '';
  const shots: string[] = [];
  const shot = async (name: string): Promise<void> => {
    const file = await captureScreenshot(page, ctx.screenshotDir, `${prefix}${name}`);
    if (file) shots.push(file);
  };

  // 1. Tenant — options are rebuilt from /api/tenants, so wait for OUR slug.
  await page.waitForSelector(EO_SELECTORS.tenantOption(ctx.slug), ctx.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs);
  await page.selectOption(EO_SELECTORS.tenantSelect, ctx.slug);
  await shot('01-tenant-selected.png');

  // 2. Connect — optional by the SPA's own design. "Connecting to <slug>..."
  //    never matches /connected/, and the failure texts are distinct.
  let connected = false;
  let connectStatus: string | undefined;
  let connectError: string | undefined;
  await page.click(EO_SELECTORS.connect);
  try {
    connectStatus = await waitForText(page, EO_SELECTORS.connectStatus, /connected/i, {
      timeoutMs: ctx.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
      failOn: /failed|error/i,
      what: 'EO connect (#tenantStatusText)',
    });
    connected = true;
  } catch (err) {
    connectError = err instanceof Error ? err.message : String(err);
    connectStatus = (await page.textContent(EO_SELECTORS.connectStatus))?.trim() ?? undefined;
  }
  await shot('02-connected.png');

  // 3. Assess — the real signal. Read the terminal text immediately: the SPA
  //    switches tabs 1500 ms later.
  await page.click(EO_SELECTORS.assess);
  const assessStatus = await waitForText(page, EO_SELECTORS.assessStatus, /assessment complete/i, {
    timeoutMs: ctx.assessTimeoutMs ?? DEFAULTS.assessTimeoutMs,
    failOn: /failed|error/i,
    what: 'EO assess (#assessStatus)',
  });
  await shot('03-assessed.png');

  // 4. Per-control detail — a read-only GET from the page's own context. Never
  //    re-hit /api/assess, which would re-run the whole assessment.
  let controls: EoControlDetail[] | undefined;
  if (ctx.controlIds && ctx.controlIds.length > 0) {
    const fetched = await Promise.all(
      ctx.controlIds.map(async (id) => {
        try {
          return mapControlDetail(await page.getJson(eoTenantUrl('', `/api/controls/${encodeURIComponent(id)}`, ctx.slug)));
        } catch {
          return undefined;
        }
      }),
    );
    controls = fetched.filter((c): c is EoControlDetail => c !== undefined);
  }

  return { connected, assessed: true, connectStatus, assessStatus, controls, connectError, screenshots: shots };
}

/** Drive the EO SPA in a real browser. Headless unless `--watch`. */
export const driveEoUi: EoUiDriver = async (ctx) => {
  const session = await openUiPage(ctx.baseUrl, ctx.watch ?? HEADLESS_MODE);
  try {
    return await runEoUiFlow(session.page, ctx);
  } finally {
    await session.close();
  }
};
