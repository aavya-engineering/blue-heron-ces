// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-SPA2 parity flow (PC-06 to PC-09, PC-14): one user flow written once and driven on both
// consoles with the demo driver's selectors (AD-4). Legacy is one page whose cards expand;
// the SPA is one screen per card, reached through the rail, never by reloading (a reload
// would drop the run state, as it would on the legacy page).
//
// Tenant: `dev` by default (PLAN §5: parity runs on the dev fixture tenant). CES_PARITY_TENANT
// picks another (S1 under `stamper gui --stacksim`); a real tenant goes through the connection
// gate first. Plan paths: /api/dev-paths for dev, CES_PARITY_MP / CES_PARITY_TM otherwise.
//
// Card 3 on `dev` (W8-PIS3): Assess is refused for `dev`, so the flows that need card 3 run on
// the seeded fictional tenant (SEED_TENANT_SLUG, parity-state.ts, in the run-scoped registry)
// with the dev plan paths. Only its connect stream and its cached assess state are served by
// the test (serveSeedTenant); translate and a dry-run execute go to the real server, which
// writes under the run-scoped roots. PC-14 (assess: false) stays on `dev`.

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_TENANT_SLUG } from '../parity-state';
import { at, sseBody } from './cards.fixture';
import { caption } from './harness';
import { STAMPER_SELECTORS as S } from './selectors';
import type { ParityProject } from './selectors';

export const PARITY_TENANT = process.env['CES_PARITY_TENANT'] || 'dev';

/** The card-4 badge once a run has ended (the demo driver's terminal pattern). */
export const TERMINAL_BADGE = /complete|failed|error|halted/i;

// Bounds (W8-PIS). On `dev` nothing waits on a real tenant; a live parity tenant keeps the demo
// driver's ceilings (execute 25 min, assess 15 min). FLOW_TIMEOUT is the per-test timeout of the
// specs that drive this flow, above the longest wait inside it.
const DEV = PARITY_TENANT === 'dev';
const LONG = DEV ? 480_000 : 1_500_000;
const ASSESS = 900_000;
export const FLOW_TIMEOUT = DEV ? 600_000 : 2_700_000;

/**
 * The tenant the card-3 flows run on. Assess is refused for `dev` by both consoles (legacy
 * doAssess L7228, SPA store/assess.ts:946, server assess.routes.ts:158), so on `dev` card 3 is
 * unlocked on the seeded fictional tenant through its cached assess state instead (legacy
 * loadCachedState L5026-5048, SPA store/assess.ts loadCachedState).
 */
export const FLOW_TENANT = DEV ? SEED_TENANT_SLUG : PARITY_TENANT;

/** Cached assess state for the fictional tenant: enough for both consoles to unlock card 3. */
const SEED_ASSESS_STATE = { ok: true, accomplishedIds: [], timestamp: '2026-10-30T00:00:00.000Z' };

/** A clean connect for the fictional tenant (the canned frames of cards.fixture CLEAN_CONNECT). */
const SEED_CONNECT = [
  { type: 'connection_log', phase: 'config_loaded', tenant: SEED_TENANT_SLUG, message: `Config loaded for ${SEED_TENANT_SLUG}` },
  { type: 'prereq_check', module: 'Microsoft.Graph', version: '2.25.0', installed: true, required: true },
  { type: 'connection_log', phase: 'prereqs_ok', message: 'Prerequisites satisfied' },
  { type: 'connection_log', phase: 'connecting_graph', message: 'Connecting to Microsoft Graph...' },
  { type: 'connection_log', phase: 'connected_graph', message: 'Microsoft Graph connected' },
  { type: 'connection_log', phase: 'done', tenant: SEED_TENANT_SLUG },
];

const seedServed = new WeakSet<Page>();

/**
 * Serves the fictional tenant's connect stream and cached assess state on this page (once per
 * page; legacy and SPA runs share a page). An earlier run's `executedAt_<slug>` would mark the
 * cached state stale (legacy L5044), so it is cleared before each document loads.
 */
async function serveSeedTenant(page: Page): Promise<void> {
  if (seedServed.has(page)) return;
  seedServed.add(page);
  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, `executedAt_${SEED_TENANT_SLUG}`);
  await page.route(at('/api/connect'), (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody(SEED_CONNECT) }),
  );
  await page.route(at('/api/assess-state'), (route) =>
    new URL(route.request().url()).searchParams.get('tenant') === SEED_TENANT_SLUG
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEED_ASSESS_STATE) })
      : route.continue(),
  );
}

export const projectOf = (name: string): ParityProject => (name === 'legacy' ? 'legacy' : 'react');

/** SPA rail node per card (railNode0-5 = tenant, configure, assess, translate, execute, evidence). */
const RAIL: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

export async function planPaths(request: APIRequestContext): Promise<{ missionPlan: string; manifest: string }> {
  if (PARITY_TENANT === 'dev') {
    const r = (await (await request.get('/api/dev-paths')).json()) as { missionPlan: string; manifest: string };
    return { missionPlan: r.missionPlan, manifest: r.manifest };
  }
  const missionPlan = process.env['CES_PARITY_MP'] ?? '';
  const manifest = process.env['CES_PARITY_TM'] ?? '';
  expect(missionPlan && manifest, 'set CES_PARITY_MP and CES_PARITY_TM for a non-dev parity tenant').toBeTruthy();
  return { missionPlan, manifest };
}

/** Legacy: expand a card by guard (demo driver expandCard). SPA: open its screen from the rail. */
export async function openCard(page: Page, project: ParityProject, n: number): Promise<void> {
  if (project === 'legacy') {
    const card = page.locator(S.card(n));
    const cls = (await card.getAttribute('class')) ?? '';
    if (cls.split(/\s+/).includes('card-collapsed')) await page.click(`${S.card(n)} .workflow-card-header`);
    return;
  }
  await page.click(`#railNode${RAIL[n]}`);
  await expect(page.locator(S.card(n))).toBeVisible();
}

/** SPA only: the right column on its own route, without a reload (client-side navigation). */
export async function openConsoleRoute(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/app/console');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('[data-screen="console"]')).toBeVisible();
}

/**
 * Tenant, connection, plan paths, Assess: the state in which card 3 unlocks. `assess: false`
 * stops before Assess and stays on PARITY_TENANT (PC-14). On `dev` the tenant is FLOW_TENANT
 * and card 3 unlocks from its cached assess state (no Assess click).
 */
export async function prepareToTranslate(
  page: Page,
  project: ParityProject,
  request: APIRequestContext,
  opts: { assess?: boolean } = {},
): Promise<void> {
  const tenant = opts.assess === false ? PARITY_TENANT : FLOW_TENANT;
  const fictional = tenant === SEED_TENANT_SLUG;
  const paths = await planPaths(request);
  if (fictional) await serveSeedTenant(page);
  await page.goto(project === 'legacy' ? '/' : '/app/');
  await caption(page, `${project}: tenant ${tenant}`);
  await page.waitForSelector(S.tenantOption(tenant), { state: 'attached' });
  await openCard(page, project, 0);
  await page.selectOption(S.tenantSelect, tenant);
  if (tenant !== 'dev') {
    await expect(page.locator(S.connectionGate)).toBeVisible();
    await page.click(S.gateAllow);
    await expect(page.locator(S.card(0))).toHaveClass(/tenant-connected/, { timeout: 180_000 });
    await expect(page.locator(S.connectErrorRows)).toHaveCount(0);
  }
  await caption(page, `${project}: plan paths`);
  await openCard(page, project, 1);
  await page.fill(S.missionPlanPath, paths.missionPlan);
  await page.fill(S.manifestPath, paths.manifest);
  if (opts.assess === false) return;
  if (fictional) {
    await caption(page, `${project}: cached assess state (unlocks Translate)`);
    await openCard(page, project, 2);
    await expect(page.locator(S.cardStatus2)).toHaveText(/assessed/i, { timeout: 30_000 });
    return;
  }
  await caption(page, `${project}: Assess (unlocks Translate)`);
  await openCard(page, project, 2);
  await page.click(S.assess);
  await expect(page.locator(S.cardStatus2)).toHaveText(/assessed/i, { timeout: ASSESS });
}

/** Clicks Translate and returns the POST /api/translate reply. */
export async function translate(page: Page, project: ParityProject): Promise<Record<string, any>> {
  await caption(page, `${project}: Translate`);
  await openCard(page, project, 3);
  const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/translate', { timeout: 120_000 });
  await page.click(S.translate);
  const body = (await (await reply).json()) as Record<string, any>;
  await expect(page.locator(S.cardStatus3)).toHaveText(/translated/i, { timeout: 120_000 });
  return body;
}

export interface ExecuteOptions {
  mode: 'auto' | 'manual' | 'batch';
  target: 'dryrun' | 'tenant';
  /** Incremental / Batch: approve every gate until the run ends (default true). */
  approveAll?: boolean;
}

/** Card 4: mode, target (asserted to stick, as the demo driver does), Execute. */
export async function startExecute(page: Page, project: ParityProject, opts: ExecuteOptions): Promise<void> {
  await caption(page, `${project}: Execute (${opts.mode}, ${opts.target})`);
  await openCard(page, project, 4);
  await page.selectOption(S.execMode, opts.mode);
  await page.selectOption(S.execTarget, opts.target);
  await expect(page.locator(S.execTarget)).toHaveValue(opts.target);
  await page.click(S.execute);
  await expect(page.locator(S.cardStatus4)).toHaveText(/execut|retry/i, { timeout: 30_000 });
}

/** Approve buttons of the open approval rows, both consoles (legacy .approval-btns and the kit card). */
const APPROVE_BUTTON = '.approval-btns button:has-text("Approve"), .sub-approval-btns button:has-text("Approve")';

/** Waits for the terminal badge, approving gates on the way when asked. Returns the badge text. */
export async function awaitTerminal(page: Page, approveAll = false): Promise<string> {
  const badge = page.locator(S.cardStatus4);
  const deadline = Date.now() + LONG;
  while (Date.now() < deadline) {
    const text = (await badge.textContent()) ?? '';
    if (TERMINAL_BADGE.test(text) && !/executing|retrying/i.test(text)) return text.trim();
    if (approveAll) {
      const approve = page.locator(APPROVE_BUTTON).first();
      if (await approve.isVisible().catch(() => false)) {
        await approve.click().catch(() => undefined);
        continue;
      }
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error('execute did not reach a terminal badge');
}

/** The Execution Results summary as Metric -> Count (both consoles: #resultsContent table). */
export async function summaryTable(page: Page): Promise<Record<string, string>> {
  const rows = await page.locator('#resultsContent table tr').allTextContents();
  const out: Record<string, string> = {};
  for (const row of rows) {
    const m = /^(.*?)(\d+)\s*$/.exec(row.replace(/\s+/g, ' ').trim());
    if (m && !/^Metric/.test(row)) out[m[1].trim()] = m[2];
  }
  return out;
}

/** The card-4 grid values (#val_<group>_<row>, both consoles). */
export async function gridValues(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of ['l03', 'l47', 'l8', 'total', 'act']) {
    for (const r of ['pass', 'fail', 'excluded', 'nonstack']) {
      const loc = page.locator(`#val_${g}_${r}`);
      out[`${g}_${r}`] = (await loc.count()) ? ((await loc.textContent()) ?? '').trim() : '';
    }
  }
  return out;
}

/** Visible step statuses in #taskList, in order (legacy and SPA both use .step-status). */
export async function stepStatuses(page: Page): Promise<string[]> {
  return (await page.locator('#taskList .step-status').allTextContents()).map((t) => t.trim());
}

/** Rows each console renders per event kind, keyed by meaning (the class names differ by console). */
export async function consoleCounts(page: Page, project: ParityProject): Promise<Record<string, number>> {
  const sel =
    project === 'legacy'
      ? {
          stepRows: '#taskList .step-row',
          subRows: '#taskList .sub-cmd-row',
          termSeparators: '#terminalList .term-separator',
          termLines: '#terminalList .term-line',
          termVerdicts: '#terminalList .term-verdict',
          errorEntries: '#errorLogContent .error-log-entry',
        }
      : {
          stepRows: '#taskList .step-row',
          subRows: '#taskList .sub-cmd-row',
          termSeparators: '#terminalList .ck-term-separator',
          termLines: '#terminalList .ck-term-line',
          termVerdicts: '#terminalList .ck-term-verdict',
          errorEntries: '#errorLogContent .ck-error-entry',
        };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sel)) out[k] = await page.locator(v).count();
  return out;
}

/** ISO timestamps differ between two runs; everything else in a ledger export must not. */
export function normaliseTimestamps(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<ts>').replace(/"sha256Hash": "[^"]*"/g, '"sha256Hash": "<hash>"');
}
