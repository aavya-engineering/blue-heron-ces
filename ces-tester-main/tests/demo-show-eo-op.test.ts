// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — the `eo-review` op ("Assessment" on stage) against a hand-written
 * `UiPage`, per the house pattern (`ui-page.ts`'s header, and the four M4
 * drivers' tests).
 *
 * Three behaviours are worth a test here, and they are all things that only
 * fail LIVE, mid-demo, if they regress:
 *
 * 1. **`warm` assesses, `live` does not.** The whole point of the split is that
 *    the stage moment costs seconds. A `live` phase that re-assessed would look
 *    identical in code review and cost five minutes in front of a customer.
 * 2. **`live` never reloads the page.** The EO SPA hydrates an assessment ONLY
 *    from its own `assess_summary` event (ces-eo `public/index.html`: the INIT
 *    block calls `loadTenants` / `loadCommandRegistry` / `checkHealth`, and
 *    `loadFullAssessment` is reachable from nowhere else). Navigating would
 *    silently empty the matrix the operator is about to narrate.
 * 3. **The API reads use ABSOLUTE urls.** The app pane's browser context is
 *    created with no `baseURL` (`openPositionedUiPage`), so a relative
 *    `/api/sprs` rejects instead of resolving — a failure that only appears
 *    against a real Playwright page, never against a permissive fake.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runEoShowChangeCapturedOp } from '../src/demo/show/ops/eo-show-change-captured-op.js';
import { eoTenantUrl } from '../src/demo/eo-tenant-url.js';
import type { AppPane } from '../src/demo/show/app-pane.js';
import type { DemoSlide, OpMode } from '../src/demo/show/deck-model.js';
import type { ShowRunOptions } from '../src/demo/show/show-run.js';
import type { UiPage } from '../src/demo/ui-page.js';
import type { OpDriveContext, ArmedEnvironment } from '../src/demo/show/op-registry.js';
import {
  runEoReviewOp,
  readEoNumbers,
  hasRenderedAssessment,
  EO_REVIEW_SELECTORS,
  EO_REVIEW_FAMILY,
} from '../src/demo/show/ops/eo-review-op.js';

const EO_URL = 'http://127.0.0.1:4002';

const OPTIONS: ShowRunOptions = {
  deckPath: 'demos/t.xlsx',
  slidesPort: 4500,
  defaultDwellSec: 30,
  auto: true,
  presenter: true,
  slidesGeometry: { width: 1280, height: 720, x: 0, y: 0 },
  appGeometry: { width: 620, height: 1000, x: 1290, y: 0 },
  testerRoot: 'C:/ces/ces-tester',
  stacksimRoot: 'C:/ces/tenant-stacksim',
  aoRoot: 'C:/ces/ces-ao',
};

interface FakeEoPage extends UiPage {
  readonly clicks: string[];
  readonly navigations: string[];
  readonly jsonUrls: string[];
  readonly shots: string[];
  /** Flipped on once an assess has "run" in this page, as the SPA behaves. */
  hydrated: boolean;
  /**
   * FX-TE5 — the ONLY tenant this fake EO server knows. getJson enforces ces-eo
   * FX-EO8: no `?tenant=` rejects (400), any other tenant rejects (404).
   */
  tenant: string;
}

/**
 * ces-eo FX-EO8's read contract, as the fake server enforces it: a read with no
 * `?tenant=` is a 400, a tenant the server does not know is a 404. Returns the
 * pathname so the caller can route on it.
 */
function eoTenantGate(url: string, knownTenant: string): string {
  const u = new URL(url, EO_URL);
  const tenant = u.searchParams.get('tenant');
  if (!tenant) throw new Error(`GET ${url} -> 400 tenant required`);
  if (tenant !== knownTenant) throw new Error(`GET ${url} -> 404 unknown tenant ${tenant}`);
  return u.pathname;
}

/**
 * A fake EO SPA. Text answers are keyed by selector; the matrix is empty until
 * an assess completes in THIS page, which is exactly the sibling's real rule.
 */
function fakeEoPage(startHydrated: boolean, tenant = 'demo-dib-small'): FakeEoPage {
  const clicks: string[] = [];
  const navigations: string[] = [];
  const jsonUrls: string[] = [];
  const shots: string[] = [];

  const page: FakeEoPage = {
    hydrated: startHydrated,
    tenant,
    clicks,
    navigations,
    jsonUrls,
    shots,
    goto: async (url: string) => {
      navigations.push(url);
      // A reload wipes the rendered assessment — the SPA does not rehydrate.
      page.hydrated = false;
    },
    click: async (selector: string) => {
      clicks.push(selector);
      if (selector === '#assessBtn') page.hydrated = true;
    },
    fill: async () => undefined,
    check: async () => undefined,
    selectOption: async () => undefined,
    setInputFiles: async () => undefined,
    waitForDownload: async () => '',
    inputValue: async () => '',
    textContent: async (selector: string) => {
      switch (selector) {
        case '#tenantStatusText':
          return 'Connected to demo-dib-small';
        case '#assessStatus':
          return page.hydrated ? 'Evidence assessment complete.' : 'Ready to assess.';
        case EO_REVIEW_SELECTORS.metricMet:
          return page.hydrated ? '56' : '--';
        case EO_REVIEW_SELECTORS.metricNotMet:
          return page.hydrated ? '48' : '--';
        case EO_REVIEW_SELECTORS.metricPartial:
          return page.hydrated ? '0' : '--';
        case EO_REVIEW_SELECTORS.metricNotAssessed:
          return page.hydrated ? '6' : '--';
        case EO_REVIEW_SELECTORS.sprsScore:
          return page.hydrated ? '31' : '--';
        case EO_REVIEW_SELECTORS.sprsCertPath:
          return 'Conditional Certification (POA&M eligible)';
        default:
          return null;
      }
    },
    getAttribute: async () => null,
    texts: async (selector: string) =>
      selector === EO_REVIEW_SELECTORS.familyRows(EO_REVIEW_FAMILY) && page.hydrated
        ? ['IA.L2-3.5.3 not met -3', 'IA.L2-3.5.4 not met -5']
        : [],
    count: async (selector: string) => {
      if (!page.hydrated) return 0;
      if (selector === EO_REVIEW_SELECTORS.controlRows) return 110;
      if (selector === EO_REVIEW_SELECTORS.familyRows(EO_REVIEW_FAMILY)) return 9;
      if (selector === EO_REVIEW_SELECTORS.sprsDeductionRows) return 54;
      return 0;
    },
    isVisible: async () => true,
    waitForSelector: async () => undefined,
    waitForResponse: async () => undefined,
    getJson: async (url: string) => {
      jsonUrls.push(url);
      const pathname = eoTenantGate(url, page.tenant);
      if (pathname === '/api/sprs') return { score: 31, certificationPath: 'conditional' };
      return { controls_met: 56, controls_not_met: 48, controls_not_assessed: 6, liveAssessmentCount: 106 };
    },
    screenshot: async (filePath: string) => {
      shots.push(filePath);
    },
  };
  return page;
}

function ctxFor(page: FakeEoPage, mode: OpMode, armedOverrides: Partial<ArmedEnvironment> = {}): {
  ctx: OpDriveContext;
  logs: string[];
} {
  const logs: string[] = [];
  const slide: DemoSlide = {
    slideNumber: 8,
    rows: [{ sheetRow: 9, slideNumber: 8, feature: 'Assessment' }],
    op: { mode, opId: 'eo-review', tools: ['eo'], images: [] },
  };
  const pane = {
    page,
    session: {} as AppPane['session'],
    goto: (url: string) => page.goto(url),
    close: async () => undefined,
  } as AppPane;
  return {
    logs,
    ctx: {
      pane,
      slide,
      index: 7,
      options: OPTIONS,
      log: (line: string) => logs.push(line),
      armed: {
        slug: 'demo-dib-small',
        eoBaseUrl: EO_URL,
        simUrl: 'http://127.0.0.1:4390',
        runDir: 'C:/ces/ces-tester/runs/show/test',
        musterRoot: 'C:/ces/ces-muster',
        stamperRoot: 'C:/ces/ces-stamper',
        ...armedOverrides,
      },
    },
  };
}

describe('eo-review op', () => {
  it('refuses to run when EO was never armed, naming the reason', async () => {
    const { ctx } = ctxFor(fakeEoPage(true), 'live', { eoBaseUrl: undefined });
    await expect(runEoReviewOp(ctx)).rejects.toThrow(/EO server is not armed/);
  });

  it('warm does the expensive half and never touches the result tabs', async () => {
    const page = fakeEoPage(false);
    const { ctx, logs } = ctxFor(page, 'warm');
    await runEoReviewOp(ctx);

    // The assess ran, as an operator does it: tenant -> Connect -> Assess.
    expect(page.navigations).toEqual([EO_URL]);
    expect(page.clicks).toEqual(['#connectBtn', '#assessBtn']);
    // ...and the browse is NOT part of warm — that is the stage moment.
    expect(page.clicks.some((c) => c.startsWith('.nav-tab'))).toBe(false);
    expect(logs.join('\n')).toMatch(/assess complete in [\d.]+s/);
  });

  it('live walks the already-hydrated page: no assess, no reload', async () => {
    const page = fakeEoPage(true);
    const { ctx, logs } = ctxFor(page, 'live');
    await runEoReviewOp(ctx);

    // The two things that would ruin the stage moment.
    expect(page.navigations).toEqual([]);
    expect(page.clicks).not.toContain('#assessBtn');

    // The walk itself: matrix -> one family's determinations -> SPRS.
    expect(page.clicks).toEqual([
      EO_REVIEW_SELECTORS.tab('dashboard'),
      EO_REVIEW_SELECTORS.familyNotMetLink(EO_REVIEW_FAMILY),
      EO_REVIEW_SELECTORS.tab('sprs'),
    ]);
    expect(page.shots).toHaveLength(3);

    const text = logs.join('\n');
    expect(text).toContain('56 met / 48 not met');
    expect(text).toContain('SPRS 31');
    expect(text).toContain('106 live assessment(s)');
  });

  it('live reads its narrated numbers from the API over ABSOLUTE urls', async () => {
    const page = fakeEoPage(true);
    const { ctx } = ctxFor(page, 'live');
    await runEoReviewOp(ctx);
    // The pane's context has no baseURL, so a relative path would reject.
    expect(page.jsonUrls.sort()).toEqual([
      `${EO_URL}/api/assessment?tenant=demo-dib-small`,
      `${EO_URL}/api/sprs?tenant=demo-dib-small`,
    ]);
  });

  it('FX-TE5: live and warm read the API for the ARMED tenant, not a default', async () => {
    // A slug that is not the fixture default, so a hard-coded fallback fails.
    for (const mode of ['live', 'warm'] as const) {
      const page = fakeEoPage(mode === 'live', 'acme-dib-large');
      const { ctx, logs } = ctxFor(page, mode, { slug: 'acme-dib-large' });
      await runEoReviewOp(ctx);
      expect(page.jsonUrls.length, mode).toBeGreaterThan(0);
      for (const url of page.jsonUrls) {
        expect(new URL(url).searchParams.get('tenant'), `${mode} ${url}`).toBe('acme-dib-large');
      }
      // 106 is ONLY in the API body — the numbers really came back.
      expect(logs.join('\n'), mode).toContain('106 live assessment(s)');
    }
  });

  it('FX-TE5: a tenant the EO server does not know yields no API numbers (the tenant is really sent)', async () => {
    const page = fakeEoPage(true, 'demo-dib-small');
    const { ctx, logs } = ctxFor(page, 'live', { slug: 'someone-else' });
    await runEoReviewOp(ctx);
    expect(logs.join('\n')).not.toContain('106 live assessment(s)');
  });

  it('live self-heals loudly when the pane is not showing an assessment', async () => {
    const page = fakeEoPage(false);
    const { ctx, logs } = ctxFor(page, 'live');
    await runEoReviewOp(ctx);

    // It says so, then runs the real assess rather than narrating an empty matrix.
    expect(logs.join('\n')).toMatch(/not showing a rendered assessment/);
    expect(page.navigations).toEqual([EO_URL]);
    expect(page.clicks).toContain('#assessBtn');
    // ...and still ends on the browse.
    expect(page.clicks).toContain(EO_REVIEW_SELECTORS.tab('sprs'));
  });

  it('warns rather than narrates when the live signal leg did not run', async () => {
    const page = fakeEoPage(true);
    page.getJson = async (url: string) =>
      eoTenantGate(url, page.tenant) === '/api/sprs' ? { score: 0 } : { controls_met: 0, liveAssessmentCount: 0 };
    const { ctx, logs } = ctxFor(page, 'live');
    await runEoReviewOp(ctx);
    expect(logs.join('\n')).toMatch(/LIVE SIGNAL LEG DID NOT RUN/);
  });
});

describe('eo-review pure helpers', () => {
  it('reads the numbers the API actually ships', () => {
    expect(
      readEoNumbers({ controls_met: 56, controls_not_met: 48, liveAssessmentCount: 106, sprs_score: 30 }, { score: 31 }),
    ).toMatchObject({ controlsMet: 56, controlsNotMet: 48, liveAssessmentCount: 106, sprsScore: 31 });
  });

  it('falls back to the assessment snapshot when /api/sprs is unavailable', () => {
    expect(readEoNumbers({ sprs_score: 30 }, undefined).sprsScore).toBe(30);
    expect(readEoNumbers(undefined, undefined)).toEqual({
      controlsMet: undefined,
      controlsNotMet: undefined,
      controlsPartial: undefined,
      controlsNotAssessed: undefined,
      liveAssessmentCount: undefined,
      sprsScore: undefined,
    });
  });

  it('treats a page that cannot be queried as un-hydrated rather than throwing', async () => {
    const page = { count: async () => { throw new Error('page closed'); } } as unknown as UiPage;
    expect(await hasRenderedAssessment(page)).toBe(false);
  });
});

describe('eo-show-change-captured op (FX-TE5 tenant)', () => {
  async function runFor(serverTenant: string, armedSlug: string): Promise<{ page: FakeEoPage; after: Record<string, unknown> }> {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-change-'));
    try {
      const page = fakeEoPage(true, serverTenant);
      const { ctx } = ctxFor(page, 'live', { slug: armedSlug, runDir });
      await runEoShowChangeCapturedOp(ctx);
      const after = JSON.parse(fs.readFileSync(path.join(runDir, 'eo-after.json'), 'utf8')) as Record<string, unknown>;
      return { page, after };
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  }

  it('reads the AFTER snapshot for the armed tenant', async () => {
    const { page, after } = await runFor('acme-dib-large', 'acme-dib-large');
    // assessInPane logs its own numbers too, so each route may be read twice.
    expect([...new Set(page.jsonUrls)].sort()).toEqual([
      `${EO_URL}/api/assessment?tenant=acme-dib-large`,
      `${EO_URL}/api/sprs?tenant=acme-dib-large`,
    ]);
    expect(after.assessment).toMatchObject({ liveAssessmentCount: 106 });
    expect(after.sprs).toMatchObject({ score: 31 });
  });

  it('gets nothing when the tenant sent is not the one EO knows', async () => {
    const { after } = await runFor('acme-dib-large', 'demo-dib-small');
    expect(after.assessment).toBeUndefined();
    expect(after.sprs).toBeUndefined();
  });
});

describe('eoTenantUrl (FX-TE5)', () => {
  it('appends the URL-encoded tenant, with ? or & as the route needs', () => {
    expect(eoTenantUrl(EO_URL, '/api/assessment', 'demo-dib-small')).toBe(`${EO_URL}/api/assessment?tenant=demo-dib-small`);
    expect(eoTenantUrl(`${EO_URL}/`, '/api/sprs', 'a b&c')).toBe(`${EO_URL}/api/sprs?tenant=a%20b%26c`);
    expect(eoTenantUrl('', '/api/x?source=adminops', 't')).toBe('/api/x?source=adminops&tenant=t');
  });

  it('has NO default: a blank tenant throws rather than reading some other tenant', () => {
    expect(() => eoTenantUrl(EO_URL, '/api/assessment', '')).toThrow(/requires a tenant/);
    expect(() => eoTenantUrl(EO_URL, '/api/sprs', '   ')).toThrow(/requires a tenant/);
    expect(() => eoTenantUrl(EO_URL, '/api/sprs', undefined as unknown as string)).toThrow(/requires a tenant/);
  });
});
