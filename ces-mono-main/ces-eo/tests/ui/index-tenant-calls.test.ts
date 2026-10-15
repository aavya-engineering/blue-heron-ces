// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO7 — every EvidenceOps screen action that calls a tenant-scoped API sends the current
 * tenant, so the FX-EO1/FX-EO6/FX-EO7 server-side scoping (missing tenant → 400) does not
 * break the UI.
 *
 * Reads the HTML the server actually serves (EoServer: express.static(<cwd>/public) and
 * sendFile(public/index.html)) and checks every fetch / EventSource / window.open / href
 * that targets /api. Each call must EITHER target a tenant-scoped route and carry the tenant,
 * OR target a route on the explicit tenant-free list below — so a new call to a scoped route
 * without a tenant fails this test. The package button is also executed for real: its
 * function is lifted out of the served HTML and run against a stubbed fetch.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.resolve(__dirname, '../../public/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

/** Routes that require or honour ?tenant= on the server (FX-EO1/6/7 + pre-existing). */
const TENANT_SCOPED = [
  '/api/evidence',            // blob browser (FX-EO7)
  '/api/evidence-explorer',   // index/item/verify (FX-EO1/2), signal/capture (FX-EO7)
  '/api/package/build',       // FX-EO1
  '/api/adminops',            // FX-EO1
  '/api/ssp',                 // generate (body tenantSlug), latest/:id/export (FX-EO6/7)
  '/api/poam',                // FX-EO6
  '/api/personnel',           // FX-EO7
  '/api/training',            // FX-EO7
  '/api/risk-assessment',
  '/api/timeline',
  '/api/assess',
  '/api/connect',
  // FX-EO8: per-tenant assessment reads and per-tenant package storage.
  '/api/assessment', '/api/sprs', '/api/packages', '/api/package/download',
  // EO-16: the Policy Store screen reads imported policies for the requested tenant only.
  '/api/policies',
  // FC-EO-F/M4a: runs/findings are aggregate across tenants without ?tenant=, but the UI
  // always sends the current one when set (loadEcRuns/loadEcFindings), so they are scoped.
  '/api/ec/runs', '/api/ec/findings',
];

/**
 * Routes the UI calls WITHOUT a tenant, on purpose. Each is either tenant-free by nature or a
 * named residual whose server route does not read ?tenant= yet (so sending one would be a
 * no-op, and asserting it here would be a false claim).
 */
const TENANT_FREE = [
  '/api/tenants', '/api/health', '/api/registry',
  // FC-EO-F/M4a: health is a global EC status check (no per-tenant concept). Ingest DOES
  // carry tenantSlug, but as a FormData field set on a separate line above the fetch() call
  // (see uploadEcEvidence), not inside the fetch() expression text this scanner captures.
  '/api/ec/health', '/api/ec/ingest',
  '/api/screening/definitions', '/api/screening/element6-form',
  // Static reference data (the 110 SPRS weights) — the same for every tenant.
  '/api/sprs/weights',
];

const under = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + '/');
/** Tenant-free wins: '/api/sprs/weights' sits under the scoped '/api/sprs' but is static data. */
const isFree = (p: string) => TENANT_FREE.some(f => under(p, f));
const isScoped = (p: string) => !isFree(p) && TENANT_SCOPED.some(s => under(p, s));

/** Text of a call from its opening paren to the matching close paren. */
function callText(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced call at ' + openIdx);
}

interface ApiCall { kind: string; line: number; path: string; text: string }

function apiCalls(): ApiCall[] {
  const calls: ApiCall[] = [];
  const lineOf = (idx: number) => html.slice(0, idx).split('\n').length;
  for (const m of html.matchAll(/\b(fetch|new EventSource|window\.open)\(/g)) {
    const text = callText(html, m.index! + m[0].length - 1);
    const pm = /\/api\/[A-Za-z0-9/_-]*/.exec(text);
    if (!pm) continue; // e.g. window.open(url) where url is built on a previous line
    calls.push({ kind: m[1], line: lineOf(m.index!), path: pm[0].replace(/\/$/, ''), text });
  }
  for (const m of html.matchAll(/href="(\/api\/[A-Za-z0-9/_-]*)/g)) {
    const lineStart = html.lastIndexOf('\n', m.index!) + 1;
    const lineEnd = html.indexOf('\n', m.index!);
    calls.push({ kind: 'href', line: lineOf(m.index!), path: m[1].replace(/\/$/, ''), text: html.slice(lineStart, lineEnd) });
  }
  // A URL assigned to a variable and then opened (window.open(url)).
  for (const m of html.matchAll(/var url = '(\/api\/[A-Za-z0-9/_-]*)[^\n]*/g)) {
    calls.push({ kind: 'url-var', line: lineOf(m.index!), path: m[1].replace(/\/$/, ''), text: m[0] });
  }
  return calls;
}

const carriesTenant = (text: string) => /[?&]tenant=|\btenant\s*:|\btenantSlug\s*:/.test(text);

describe('FX-EO7: UI calls to tenant-scoped routes carry the current tenant', () => {
  const calls = apiCalls();
  const scoped = calls.filter(c => isScoped(c.path));

  it('finds the UI API calls (guards against a vacuous pass)', () => {
    expect(calls.length).toBeGreaterThan(90);
    expect(scoped.length).toBeGreaterThan(75);
    for (const p of ['/api/package/build', '/api/evidence/artifacts', '/api/evidence/manifests',
      '/api/evidence-explorer/index', '/api/evidence-explorer/item', '/api/evidence-explorer/verify',
      '/api/evidence-explorer/signal', '/api/ssp/generate', '/api/poam/generate', '/api/personnel',
      '/api/assessment', '/api/sprs', '/api/sprs/history', '/api/packages', '/api/package/download']) {
      expect({ p, found: scoped.some(c => c.path === p) }).toEqual({ p, found: true });
    }
  });

  it('every call to a tenant-scoped route sends the tenant', () => {
    const missing = scoped.filter(c => !carriesTenant(c.text)).map(c => `${c.line}: ${c.kind} ${c.path}`);
    expect(missing).toEqual([]);
  });

  it('every other /api call is on the explicit tenant-free list', () => {
    const unknown = calls
      .filter(c => !isScoped(c.path))
      .filter(c => !isFree(c.path))
      .map(c => `${c.line}: ${c.kind} ${c.path}`);
    expect(unknown).toEqual([]);
  });

  it('the evidence-browser calls pass currentTenant specifically', () => {
    for (const p of ['/api/evidence/artifacts', '/api/evidence/manifests']) {
      for (const c of scoped.filter(c => c.path.startsWith(p))) {
        expect({ line: c.line, ok: /tenant=\$\{encodeURIComponent\(currentTenant\)\}|tenant=' \+ encodeURIComponent\(currentTenant\)/.test(c.text) })
          .toEqual({ line: c.line, ok: true });
      }
    }
  });
});

describe('FX-EO8: the assessment, SPRS and package reads pass currentTenant specifically', () => {
  const calls = apiCalls();
  it.each(['/api/assessment', '/api/sprs', '/api/sprs/history', '/api/packages', '/api/package/download'])('%s', (p) => {
    const hits = calls.filter(c => c.path === p || (p === '/api/package/download' && c.path.startsWith(p)));
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) {
      expect({ line: c.line, ok: /tenant=\$\{encodeURIComponent\(currentTenant\)\}/.test(c.text) }).toEqual({ line: c.line, ok: true });
    }
  });
});

describe('FX-EO7: the "build package" button posts the current tenant (executed from the served HTML)', () => {
  /** Lift `async function buildPackage() {...}` out of the served HTML, unmodified. */
  function liftBuildPackage(): string {
    const start = html.indexOf('async function buildPackage()');
    expect(start).toBeGreaterThan(0);
    const open = html.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
    }
    throw new Error('unbalanced buildPackage');
  }

  async function run(currentTenant: string) {
    const fetchCalls: Array<{ url: string; init?: any }> = [];
    const alerts: string[] = [];
    const el = () => ({ disabled: false, style: {} as Record<string, string>, innerHTML: '' });
    const els: Record<string, ReturnType<typeof el>> = {};
    const $ = (sel: string) => (els[sel] ??= el());
    const fetchStub = async (url: string, init?: any) => {
      fetchCalls.push({ url, init });
      return { ok: true, json: async () => ({ sizeBytes: 2048, fileCount: 3, packageId: 'abcdef0123456789' }) };
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function('$', 'fetch', 'currentTenant', 'alert', 'loadPackages',
      `${liftBuildPackage()}\nreturn buildPackage;`);
    const buildPackage = factory($, fetchStub, currentTenant, (m: string) => alerts.push(m), () => undefined);
    await buildPackage();
    return { fetchCalls, alerts, els };
  }

  it('POSTs /api/package/build with JSON body { tenant: currentTenant }', async () => {
    const { fetchCalls, els } = await run('acme-sim');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('/api/package/build');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(fetchCalls[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ tenant: 'acme-sim' });
    expect(els['#packageBuildStatus'].innerHTML).toContain('Package built successfully');
  });

  it('with no tenant selected it asks for one and sends nothing', async () => {
    const { fetchCalls, alerts } = await run('');
    expect(fetchCalls).toHaveLength(0);
    expect(alerts).toEqual(['Select a tenant first']);
  });
});
