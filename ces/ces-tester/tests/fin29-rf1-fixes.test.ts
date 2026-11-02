// FIN-29: the R-F1 S1 red fixes (EC readiness before E7 pass 1, the E7C cost-probe parameters, the eo CLI abort on exit,
// the early sim-tenant registration for muster-api's own EO calls).
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { eoCliEffectiveRc, expectedEcItems, imLogAnalytics, seedCostProbeResources, waitEcItemsReady, WIN_ABORT_EXIT, COST_PROBE_RETENTION_DAYS } from '../src/flow/fin29-rf1-fixes.js';

const TESTER = path.join(__dirname, '..');

describe('E7 pass 1: EC readiness', () => {
  it('waits through a slow first read and an empty answer until EC returns every uploaded item within EO\'s 3 s budget', async () => {
    let t = 0;
    const answers = [{ ms: 9000, status: 200, count: 21 }, { ms: 100, status: 200, count: 0 }, { ms: 120, status: 200, count: 21 }];
    let i = 0;
    const r = await waitEcItemsReady({
      ecUrl: 'http://ec/', slug: 's1', secret: 'x', want: 21, pauseMs: 0, sleep: async () => undefined, now: () => t,
      fetchItems: async (url, init) => {
        expect(url).toBe('http://ec/api/items?tenant=s1');
        expect(init.headers.Authorization).toBe('Bearer x');
        const a = answers[i++]!;
        t += a.ms;
        return { status: a.status, count: a.count };
      },
    });
    expect(r.ready).toBe(true);
    expect(r.probes).toHaveLength(3);
    expect(r.note).toMatch(/21 item\(s\) in 120 ms/);
  });
  it('without a known count, needs the same non-zero count twice; gives up with a reason', async () => {
    const same = await waitEcItemsReady({ ecUrl: 'http://ec', slug: 's', secret: 'x', want: null, pauseMs: 0, sleep: async () => undefined, now: () => 0, fetchItems: async () => ({ status: 200, count: 5 }) });
    expect(same.ready).toBe(true);
    expect(same.probes).toHaveLength(2);
    const down = await waitEcItemsReady({ ecUrl: 'http://ec', slug: 's', secret: 'x', want: 3, maxAttempts: 2, pauseMs: 0, sleep: async () => undefined, fetchItems: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down.ready).toBe(false);
    expect(down.note).toMatch(/not ready after 2 probe/);
  });
  it('expectedEcItems counts the scenario upload, the records, the non-catalog review uploads and the EO-route upload', () => {
    expect(expectedEcItems({
      scenarioUpload: true,
      records: Array.from({ length: 18 }, () => ({ http_status: 201 })),
      reviewUploads: [{ http_status: 201, via_catalog_upload: true }, { http_status: 201 }, { http_status: 500 }],
      eoRoute: { http_status: 201 },
    })).toBe(21);
    expect(expectedEcItems({ scenarioUpload: false, records: null, reviewUploads: null, eoRoute: null })).toBe(0);
  });
  it('the runner waits before the connect and the first assess and records ec_ready', () => {
    const src = fs.readFileSync(path.join(TESTER, 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const wait = src.indexOf('await waitEcItemsReady(');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(src.indexOf("url: `${EO_URL}/api/connect?tenant=${slug}`"));
    expect(src).toMatch(/ec_ready: ecReady/);
  });
});

describe('E7C: the cost probe parameters', () => {
  it('imLogAnalytics finds the workspace and its resource group in an Infrastructure Manifest', () => {
    const im = { infrastructure: { logging: [{ resource_type: 'storage' }, { resource_type: 'log_analytics_workspace', name: 'law-x', properties: { resource_group: 'rg-x' } }] } };
    expect(imLogAnalytics(im)).toEqual({ name: 'law-x', resourceGroup: 'rg-x' });
    expect(imLogAnalytics(null)).toBeNull();
  });
  it('seeds only the missing keys: retention above the free tier, names from the sim, else from the IM', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29-e7c-'));
    const rec = path.join(d, 's1.json');
    fs.writeFileSync(rec, JSON.stringify({ tenant: { tenant_id: 't' }, resources: { operator_upn: 'op@x', law_name: 'law-kept' } }));
    const r = await seedCostProbeResources({
      op: 'E-01', recordFile: rec, testerRoot: TESTER, stacksimRoot: d,
      read: async () => { throw new Error('no such cmdlet'); },
      im: { a: { resource_type: 'log_analytics_workspace', name: 'law-im', properties: { resource_group: 'rg-im' } } },
    });
    const after = JSON.parse(fs.readFileSync(rec, 'utf8')) as { resources: Record<string, string> };
    expect(after.resources).toMatchObject({ operator_upn: 'op@x', law_name: 'law-kept', audit_log_retention_days: COST_PROBE_RETENTION_DAYS, resource_group: 'rg-im' });
    expect(Number(COST_PROBE_RETENTION_DAYS)).toBeGreaterThan(90);
    expect(r.provenance.resource_group).toMatch(/Infrastructure Manifest/);
    expect(r.missing.resource_group).toBeUndefined();
  });
  it('the E7C source seeds before reading the requestor', () => {
    const src = fs.readFileSync(path.join(TESTER, 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const seed = src.indexOf('await seedCostProbeResources(');
    expect(seed).toBeGreaterThan(0);
    expect(seed).toBeLessThan(src.indexOf('const rec = await runCostTraversal('));
  });
});

describe('V87: the eo CLI abort on exit', () => {
  const abort = { rc: WIN_ABORT_EXIT, stderr: 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76', stdout: 'building\n{"ok":true,"file":"x.zip"}\n' };
  it('counts a finished call that aborted only on exit; keeps every other code', () => {
    expect(eoCliEffectiveRc(abort, true)).toBe(0);
    expect(eoCliEffectiveRc(abort, false)).toBe(WIN_ABORT_EXIT);
    expect(eoCliEffectiveRc({ ...abort, stdout: '{"error":"HTTP 409"}' }, true)).toBe(WIN_ABORT_EXIT);
    expect(eoCliEffectiveRc({ ...abort, stderr: 'other crash' }, true)).toBe(WIN_ABORT_EXIT);
    expect(eoCliEffectiveRc({ rc: 1, stdout: '{"ok":true}', stderr: '' }, true)).toBe(1);
  });
});

describe('V114: the sim tenant is registered before E3 starts EO', () => {
  it('E3 creates the ephemeral sim tenant before startBg(E3-eo); E5 does not create it twice', () => {
    const src = fs.readFileSync(path.join(TESTER, 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const early = src.indexOf('simTenantRegistered = true;');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(src.indexOf("startBg('E3-eo'"));
    expect(src).toMatch(/if \(!simTenantRegistered\) await createEphemeralSimTenant/);
  });
});
