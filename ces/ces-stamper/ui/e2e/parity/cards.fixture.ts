// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared fixture for the card 0-2 parity specs (PC-02 to PC-05; W8-SPA1). Both consoles are
// driven the same way: the legacy page at / (cards start collapsed: expand like the demo driver)
// and the SPA screens at /app/<screen>. A fictional tenant ("ridgeline", Ridgeline Machining) is
// served by route interception so connect, prerequisites, baseline, assess and gaps replay the
// same canned events on both consoles, and nothing is written to plan-data. Real-server parity
// runs on the `dev` fixture tenant (PLAN §5); CES_PARITY_TENANT=<slug> adds the live-tenant run
// (S1 under `stamper gui --stacksim`; the orchestrator starts the simulator).

import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { caption, compareRecordings, recordApiRequests, writeRecording } from './harness';
import type { RecordedRequest } from './harness';
import { STAMPER_SELECTORS } from './selectors';
import type { ParityProject } from './selectors';

export const FICTIONAL_SLUG = 'ridgeline';
export const LAST_TENANT_KEY = 'stamper_lastTenant';

export const CARD_SCREENS = ['tenant', 'configure', 'assess'] as const;
export type CardScreen = (typeof CARD_SCREENS)[number];
const CARD_INDEX: Record<CardScreen, number> = { tenant: 0, configure: 1, assess: 2 };

/** Absolute URL of a card on either console (legacy: one page; SPA: one screen per card). */
export function cardUrl(project: ParityProject, screen: CardScreen): string {
  return project === 'legacy' ? '/' : `/app/${screen}`;
}

/** Sets the remembered tenant before any page script runs (both consoles read it on load). */
export async function rememberTenant(page: Page, slug: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage unavailable */
      }
    },
    { key: LAST_TENANT_KEY, value: slug },
  );
}

/**
 * Opens a card and waits for the tenant list (the legacy page-load request) and the tenant.
 * The SPA renders #tenantSelect on its tenant screen only (card screens, intended difference
 * D-7, LOG-W8-SPAW); its other screens show the selected slug in the shell's #tenantBanner.
 */
export async function openCard(page: Page, project: ParityProject, screen: CardScreen, slug = 'dev'): Promise<void> {
  const tenantsLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tenants');
  await page.goto(cardUrl(project, screen));
  await tenantsLoaded;
  if (project === 'react' && screen !== 'tenant') await expect(page.locator('#tenantBanner .ck-banner-tenant')).toHaveText(slug);
  else await page.waitForSelector(STAMPER_SELECTORS.tenantOption(slug), { state: 'attached' });
  await page.waitForLoadState('networkidle');
  await expandCard(page, CARD_INDEX[screen]);
}

/** The demo driver's expandCard (ces-tester ui-page.ts): click the header only while collapsed. */
export async function expandCard(page: Page, index: number): Promise<void> {
  const card = page.locator(STAMPER_SELECTORS.card(index));
  const classes = (await card.getAttribute('class')) ?? '';
  if (classes.split(/\s+/).includes('card-collapsed')) await card.locator('.workflow-card-header').click();
}

export async function textOf(page: Page, selector: string): Promise<string> {
  const el = page.locator(selector);
  if ((await el.count()) === 0) return '';
  return ((await el.first().textContent()) ?? '').trim();
}

export async function hasClass(page: Page, selector: string, cls: string): Promise<boolean> {
  return ((await page.locator(selector).getAttribute('class')) ?? '').split(/\s+/).includes(cls);
}

/** SSE body for route.fulfill: one `data:` frame per event. */
export function sseBody(events: readonly unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** Route matcher on the exact path (query ignored). */
export const at = (pathname: string) => (url: URL) => url.pathname === pathname;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function fulfillSse(route: Route, events: readonly unknown[]): Promise<void> {
  await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sseBody(events) });
}

export const FICTIONAL_CONFIG = {
  client: { slug: FICTIONAL_SLUG, name: 'Ridgeline Machining' },
  tenant: { tenant_id: '00000000-0000-4000-8000-000000000001', domain: 'ridgeline.example', environment: 'gcchigh' },
  auth: { app_id: '00000000-0000-4000-8000-000000000002', cert_thumbprint: 'ABCDEF0123456789', cert_path: 'C:\\certs\\ridgeline.pfx' },
};

/** A directive-mode cmmc_status (fictional; control ids are public CMMC L2 practice ids). */
export const FICTIONAL_CMMC_STATUS = {
  total: 110,
  hasDirectives: true,
  satisfiedControls: [
    { control_id: 'AC.L2-3.1.1', automationType: 'automated', registryEntryCount: 1, discoveredCount: 1, entryDetails: [{ entry_id: 'ac-001', label: 'Conditional access baseline', status: 'exists', engine: 'mgraph' }] },
    { control_id: 'AC.L2-3.1.2', automationType: 'excluded' },
    { control_id: 'AU.L2-3.3.1', automationType: 'inherit-fedramp' },
  ],
  provisionalControls: [{ control_id: 'CM.L2-3.4.1', automationType: 'nonstack' }],
  wontBeControls: [{ control_id: 'IA.L2-3.5.3', automationType: 'automated', sprsWeight: 5, reason: 'MFA policy missing' }],
  willBeControls: [{ control_id: 'SC.L2-3.13.11', automationType: 'document-absence', sprsWeight: 3 }],
  notVerifiedControls: [{ control_id: 'SI.L2-3.14.1', automationType: 'automated', sprsWeight: 1 }],
  sprsByCategory: { satisfied: 0, provisional: 0, not_satisfied: 9 },
  byFamily: {
    AC: { name: 'Access Control', total: 22, satisfied: 1, excluded: 1 },
    AU: { name: 'Audit and Accountability', total: 9, satisfied: 1 },
    IA: { name: 'Identification and Authentication', total: 11, wontBe: 1 },
  },
};

export const FICTIONAL_GAP_PLAN = {
  summary: { total_gap_entries: 2, total_controls_with_gaps: 1, manual_only_count: 0, automated_count: 2, by_priority: { critical: 1, high: 0, medium: 0, low: 0 } },
  gap_controls: [
    {
      control_id: 'IA.L2-3.5.3',
      practice: 'Use multifactor authentication',
      priority: 'critical',
      gap_entries: [
        { entry_id: 'ia-001', label: 'MFA for all users', status: 'missing' },
        { entry_id: 'ia-002', label: 'MFA registration policy', status: 'missing' },
      ],
    },
  ],
};

export interface FictionalTenantOptions {
  /** Events for GET /api/connect. */
  connect?: readonly unknown[];
  /** Body of GET /api/assess-state (default: no cached state). */
  assessState?: unknown;
  /** Events for GET /api/assess. */
  assess?: readonly unknown[];
  /** Events for GET /api/baseline. */
  baseline?: readonly unknown[];
  /** Events per module for GET /api/prereqs/install. */
  install?: readonly unknown[];
  /** Body of GET /api/compute-gaps. */
  gaps?: unknown;
}

/**
 * Serves the fictional tenant on both consoles: the tenant list gains it, its config,
 * variables and paths come from fixtures, and its writes (PUT tenant, save-run-log, abort)
 * are answered without touching the server. Streams replay the canned events.
 */
export async function serveFictionalTenant(page: Page, opts: FictionalTenantOptions = {}): Promise<void> {
  await page.route(at('/api/tenants'), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const resp = await route.fetch();
    const list = (await resp.json()) as Array<{ slug: string }>;
    await fulfillJson(route, [...list.filter((t) => t.slug !== FICTIONAL_SLUG), { slug: FICTIONAL_SLUG, client_name: 'Ridgeline Machining', environment: 'gcchigh' }]);
  });
  await page.route(at(`/api/tenants/${FICTIONAL_SLUG}`), (route) =>
    route.request().method() === 'PUT' ? fulfillJson(route, { ok: true }) : fulfillJson(route, { ok: true, config: FICTIONAL_CONFIG }),
  );
  await page.route(at(`/api/tenants/${FICTIONAL_SLUG}/variables`), (route) => fulfillJson(route, { ok: true, variables: { tenantDomain: 'ridgeline.example' } }));
  await page.route(at('/api/last-translate'), (route) => fulfillJson(route, { ok: false }));
  await page.route(at('/api/assess-state'), (route) => fulfillJson(route, opts.assessState ?? { ok: false }));
  await page.route(at('/api/save-run-log'), (route) => fulfillJson(route, { ok: true, path: 'C:\\runs\\parity-run-log.json' }));
  await page.route(at('/api/abort'), (route) => fulfillJson(route, { ok: true }));
  await page.route(at('/api/plan-data-paths'), (route) => fulfillJson(route, { ok: false }));
  if (opts.connect) await page.route(at('/api/connect'), (route) => fulfillSse(route, opts.connect!));
  if (opts.assess) await page.route(at('/api/assess'), (route) => fulfillSse(route, opts.assess!));
  if (opts.baseline) await page.route(at('/api/baseline'), (route) => fulfillSse(route, opts.baseline!));
  if (opts.install) await page.route(at('/api/prereqs/install'), (route) => fulfillSse(route, opts.install!));
  if (opts.gaps) await page.route(at('/api/compute-gaps'), (route) => fulfillJson(route, opts.gaps));
}

/** A clean connect: config loaded, modules present, both sessions up, done. */
export const CLEAN_CONNECT = [
  { type: 'connection_log', phase: 'config_loaded', tenant: FICTIONAL_SLUG, message: 'Config loaded for ridgeline' },
  { type: 'prereq_check', module: 'Microsoft.Graph', version: '2.25.0', installed: true, required: true },
  { type: 'connection_log', phase: 'prereqs_ok', message: 'Prerequisites satisfied' },
  { type: 'connection_log', phase: 'connecting_graph', message: 'Connecting to Microsoft Graph...' },
  { type: 'connection_log', phase: 'connected_graph', message: 'Microsoft Graph connected' },
  { type: 'connection_log', phase: 'done', tenant: FICTIONAL_SLUG },
];

/** A blocked connect: two modules and the certificate missing. */
export const BLOCKED_CONNECT = [
  { type: 'connection_log', phase: 'config_loaded', tenant: FICTIONAL_SLUG, message: 'Config loaded for ridgeline' },
  { type: 'prereq_check', module: 'ExchangeOnlineManagement', installed: false, required: true },
  { type: 'prereq_check', module: 'MicrosoftTeams', installed: false, required: true },
  {
    type: 'prereq_blocked',
    message: 'Missing prerequisites: ExchangeOnlineManagement, MicrosoftTeams, certificate',
    missing: ['ExchangeOnlineManagement', 'MicrosoftTeams'],
    cert_missing: true,
    cert_path: 'C:\\certs\\ridgeline.pfx',
    thumbprint: 'ABCDEF0123456789',
  },
];

/** Selects the fictional tenant (fires the legacy change handler / the SPA onChange). */
export async function selectTenant(page: Page, slug: string): Promise<void> {
  await page.selectOption(STAMPER_SELECTORS.tenantSelect, slug);
  await page.waitForLoadState('networkidle');
}

/** Visible text of the CMMC grid: legacy reads whichever grid it shows (plan-less = cmmcLegacyGrid). */
export async function readGrid(page: Page, project: ParityProject): Promise<Record<string, string>> {
  const rows: Array<[string, string]> = [
    ['satisfied', 'sat'],
    ['provisional', 'prov'],
    ['not_satisfied', 'unsat'],
  ];
  const cols = ['automated', 'excluded', 'nonstack', 'total', 'sprs'];
  const legacyPlanLess = project === 'legacy' && (await page.locator('#cmmcDirectiveGrid').isHidden());
  const out: Record<string, string> = {};
  for (const [row, legacyRow] of rows) {
    for (const col of cols) {
      const valId = legacyPlanLess ? `#val_${col}_${legacyRow}` : `#cmmc_val_${row}_${col}`;
      const pctId = legacyPlanLess ? `#pct_${col}_${legacyRow}` : `#cmmc_pct_${row}_${col}`;
      out[`${row}.${col}`] = `${await textOf(page, valId)} ${await textOf(page, pctId)}`;
    }
  }
  if (!legacyPlanLess) {
    for (const col of ['automated', 'excluded', 'nonstack', 'total', 'sprs']) out[`summary.${col}`] = await textOf(page, `#cmmc_summary_${col}`);
  }
  return out;
}

/** The family table as text rows (Family, Total, OK, Prov, Gap). */
export async function readFamilyTable(page: Page): Promise<string[][]> {
  return page.$$eval('#cmmcFamilyTable tr', (trs) =>
    trs
      .slice(1)
      .map((tr) => Array.from(tr.querySelectorAll('td')).slice(0, 5).map((td) => (td.textContent ?? '').trim())),
  );
}

/** Ids shown in the CMMC editor, in order, and its count label. */
export async function readEditor(page: Page): Promise<{ count: string; ids: string[] }> {
  await page.waitForSelector('#cmmcEditorOverlay.visible');
  return {
    count: await textOf(page, '#edFilterCount'),
    ids: await page.$$eval('#cmmcEditorControls .cmmc-ctrl-card .cmmc-ctrl-id', (els) => els.map((e) => (e.textContent ?? '').trim())),
  };
}

// ---- Run the same steps on both consoles and compare (AD-4) ----

export interface ConsoleOutcome {
  requests: RecordedRequest[];
  seen: Record<string, unknown>;
}

export interface RunSetup {
  /** Remembered tenant at load (default dev). */
  slug?: string;
  /** Serve the fictional tenant with these canned streams. */
  fictional?: FictionalTenantOptions;
  /** Extra routes before load (e.g. intercepting a write). */
  before?: (page: Page) => Promise<void>;
}

export type ConsoleSteps = (page: Page, project: ParityProject) => Promise<Record<string, unknown>>;

/**
 * For one card screen: opens it on each console in a fresh page, records the API requests the
 * steps cause (after the page load settles), and asserts the ordered requests and the returned
 * visible outcomes are equal. `GET /health` is the SPA shell's own request (PC-01).
 */
export function runOnBoth(screen: CardScreen) {
  return async (page: Page, name: string, setup: RunSetup, steps: ConsoleSteps) => {
    const out = {} as Record<ParityProject, ConsoleOutcome>;
    for (const project of ['legacy', 'react'] as const) {
      const p = await page.context().newPage();
      await rememberTenant(p, setup.slug ?? 'dev');
      if (setup.fictional) await serveFictionalTenant(p, setup.fictional);
      if (setup.before) await setup.before(p);
      await openCard(p, project, screen, setup.slug ?? 'dev');
      await caption(p, `${project}: ${test.info().title}`);
      const rec = recordApiRequests(p);
      const seen = await steps(p, project);
      await p.waitForLoadState('networkidle');
      rec.stop();
      await p.close();
      out[project] = { requests: rec.requests, seen };
    }
    writeRecording(test.info().outputPath(`parity-${name}-legacy.json`), out.legacy);
    writeRecording(test.info().outputPath(`parity-${name}-react.json`), out.react);
    const result = compareRecordings(out.legacy.requests, out.react.requests, { spaOnly: ['GET /health'] });
    test.info().annotations.push({ type: `parity ${name}`, description: JSON.stringify(result) });
    expect(result.differences, `${name}: ordered requests differ`).toEqual([]);
    expect(out.react.seen, `${name}: visible outcomes differ`).toEqual(out.legacy.seen);
    return out;
  };
}
