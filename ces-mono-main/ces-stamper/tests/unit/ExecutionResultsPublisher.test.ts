// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-ST6 — REQ-STAMPER-CLI-NO-RESULTS-MANIFEST + Muster delivery.
//
// 1. The real CLI `execute` (spawned via tsx against the synthetic dev fixture —
//    the mocked, dry-run adapter path) writes the shared execution-results
//    manifest to <CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/ and it
//    passes ces-shared's ExecutionResultsManifestSchema.
// 2. deliverExecutionResults POSTs { tenant_slug, manifest } with a Bearer token
//    to <origin>/api/plan/results (muster-api/src/routes/plan.ts contract) —
//    proven against a local HTTP server.
// 3. Failure (HTTP 500 / connection refused) is recorded, never thrown; the
//    manifest stays on disk. Non-localhost URLs are refused without opt-in.
import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { ExecutionResultsManifestSchema as SharedManifestSchema } from 'ces-shared/types/execution-results';
import { ExecutionResultsCollector, ResultVerdict } from '../../src/core/ExecutionResultsCollector';
import {
  deliverExecutionResults,
  publishExecutionResults,
  recordTaskStatuses,
  resolveMusterEndpoint,
  resolveResultsTenantSlug,
} from '../../src/core/ExecutionResultsPublisher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DEV_PLAN_ID = 'translated-synthetic-gcch-l2-001';

interface Captured { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }

function startServer(status = 200, reply: unknown = { applied: 1 }): Promise<{ url: string; requests: Captured[]; close: () => Promise<void> }> {
  const requests: Captured[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(r => server.close(() => r())) });
  }));
}

function sampleManifest() {
  const c = new ExecutionResultsCollector();
  c.recordControlResult('AC.L2-3.1.1', 'implement', ResultVerdict.SAT, 'completed');
  c.recordControlResult('AC.L2-3.1.2', 'automated', ResultVerdict.NOT_SAT, 'failed');
  return { collector: c, plan: { plan_id: 'translated-mp-1', variables: { _source_plan_id: 'mp-1' } } };
}

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fx-st6-'));

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(`npx tsx src/cli/index.ts ${args.join(' ')}`, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    input: '',
    encoding: 'utf-8',
    shell: true,
    timeout: 120_000,
  });
}

describe('FX-ST6: CLI execute writes the shared results manifest', () => {
  it('stamper execute --dev writes a schema-valid manifest to the canonical state dir', () => {
    const root = tmpRoot();
    const r = runCli(['execute', '--dev', '--mode', 'auto', '--tenant', 'sim-m365-azure'], {
      CES_PIPELINE_ROOT: root, STATE_DIR: path.join(root, 'state'), CES_MUSTER_API_URL: '',
    });
    expect(r.status).toBe(0);
    const manifestPath = path.join(root, 'Stamper', 'plan-data', 'sim-m365-azure', 'state', `execution-results-${DEV_PLAN_ID}.json`);
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const parsed = SharedManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.planId).toBe('synthetic-gcch-l2-001');
    expect(manifest.executablePlanId).toBe(DEV_PLAN_ID);
    expect(manifest.tenantSlug).toBe('sim-m365-azure');
    expect(manifest.totalControls).toBeGreaterThan(0);
    expect(r.stdout).toContain(manifestPath);
    // the saved report records the manifest + delivery outcome
    const reportDir = path.join(root, 'state', DEV_PLAN_ID);
    const reportJson = fs.readdirSync(reportDir).find(f => f.startsWith('execution-report-') && f.endsWith('.json'))!;
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, reportJson), 'utf-8'));
    expect(report.resultsManifest.path).toBe(manifestPath);
    expect(report.resultsManifest.delivery.status).toBe('skipped');
  }, 150_000);

  it('a dry-run CLI run does not deliver to Muster even when configured', async () => {
    const srv = await startServer();
    try {
      const root = tmpRoot();
      // spawnSync blocks the event loop, so the server could not answer anyway —
      // run the CLI async instead.
      const { spawn } = await import('child_process');
      const child = spawn(`npx tsx src/cli/index.ts execute --dev --mode auto`, {
        cwd: ROOT, shell: true,
        env: { ...process.env, CES_PIPELINE_ROOT: root, STATE_DIR: path.join(root, 'state'), CES_MUSTER_API_URL: srv.url, CES_MUSTER_API_TOKEN: 'tok' },
      });
      child.stdin.end();
      const code: number = await new Promise(res => child.on('close', res));
      expect(code).toBe(0);
      expect(srv.requests).toHaveLength(0);
      const rec = JSON.parse(fs.readFileSync(path.join(root, 'Stamper', 'plan-data', 'dev', 'state', `execution-results-${DEV_PLAN_ID}.delivery.json`), 'utf-8'));
      expect(rec.status).toBe('skipped');
      expect(rec.reason).toMatch(/dry_run/);
    } finally { await srv.close(); }
  }, 150_000);
});

describe('FX-ST6: recordTaskStatuses', () => {
  it('maps task states with the server words; a failure wins over a pass', () => {
    const c = new ExecutionResultsCollector();
    const status: Record<string, any> = { t1: 'completed', t2: 'failed', t3: 'accomplished', t4: 'skipped' };
    recordTaskStatuses(c, [
      { id: 't1', controls: ['A', 'B'] },
      { id: 't2', controls: ['B'] },
      { id: 't3', controls: ['C'] },
      { id: 't4', controls: ['D'] },
    ], id => status[id], { A: 'implement' });
    const m = c.buildManifestForPlan('run', 'sim', { plan_id: 'translated-p' });
    const by = Object.fromEntries(m.results.map(r => [r.controlId, r]));
    expect(by.A).toMatchObject({ verdict: 'sat', directive: 'automated', outcome: 'completed' });
    expect(by.B).toMatchObject({ verdict: 'not_sat', outcome: 'failed' });
    expect(by.C).toMatchObject({ verdict: 'sat', outcome: 'accomplished' });
    expect(by.D).toBeUndefined();
    expect(SharedManifestSchema.safeParse(m).success).toBe(true);
  });

  it('tenant slug: --tenant > plan.ces > variables > env > dev', () => {
    expect(resolveResultsTenantSlug({ plan_id: 'p', ces: { tenantSlug: 'a' } } as any, 'x', {})).toBe('x');
    expect(resolveResultsTenantSlug({ plan_id: 'p', ces: { tenantSlug: 'a' } } as any, undefined, {})).toBe('a');
    expect(resolveResultsTenantSlug({ plan_id: 'p', variables: { tenant_slug: 'b' } }, undefined, {})).toBe('b');
    expect(resolveResultsTenantSlug({ plan_id: 'p' }, undefined, { TENANT_SLUG: 'c' })).toBe('c');
    expect(resolveResultsTenantSlug({ plan_id: 'p' }, undefined, {})).toBe('dev');
  });
});

describe('FX-ST6: Muster delivery', () => {
  it('POSTs { tenant_slug, manifest } with Bearer auth to /api/plan/results', async () => {
    const srv = await startServer(200, { updated: 2 });
    try {
      const { collector, plan } = sampleManifest();
      const manifest = collector.buildManifestForPlan('run-1', 'sim-m365-azure', plan);
      const out = await deliverExecutionResults(manifest, 'sim-m365-azure', {
        env: { CES_MUSTER_API_URL: `${srv.url}/`, CES_MUSTER_API_TOKEN: 'test-token' }, log: () => {},
      });
      expect(out.status).toBe('delivered');
      expect(out.httpStatus).toBe(200);
      expect(out.response).toEqual({ updated: 2 });
      expect(srv.requests).toHaveLength(1);
      const req = srv.requests[0];
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/plan/results');
      expect(req.headers.authorization).toBe('Bearer test-token');
      expect(req.headers['content-type']).toMatch(/application\/json/);
      const body = JSON.parse(req.body);
      expect(body.tenant_slug).toBe('sim-m365-azure');
      expect(body.manifest).toEqual(JSON.parse(JSON.stringify(manifest)));
      expect(SharedManifestSchema.safeParse(body.manifest).success).toBe(true);
    } finally { await srv.close(); }
  });

  it('a Muster error is recorded, not thrown, and the manifest stays on disk', async () => {
    const srv = await startServer(500, { error: 'boom' });
    const prev = process.env.CES_PIPELINE_ROOT;
    const root = tmpRoot();
    process.env.CES_PIPELINE_ROOT = root;
    try {
      const { collector, plan } = sampleManifest();
      const res = await publishExecutionResults(collector, plan, 'sim-m365-azure', {
        env: { CES_MUSTER_API_URL: srv.url, CES_MUSTER_API_TOKEN: 't' }, log: () => {},
      });
      expect(res.delivery.status).toBe('failed');
      expect(res.delivery.httpStatus).toBe(500);
      expect(res.delivery.error).toMatch(/500.*boom/);
      expect(res.manifestPath.startsWith(root)).toBe(true);
      expect(SharedManifestSchema.safeParse(JSON.parse(fs.readFileSync(res.manifestPath, 'utf-8'))).success).toBe(true);
      const rec = JSON.parse(fs.readFileSync(res.deliveryRecordPath!, 'utf-8'));
      expect(rec).toMatchObject({ status: 'failed', httpStatus: 500, planId: 'mp-1', manifestPath: res.manifestPath });
    } finally {
      if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
      await srv.close();
    }
  });

  it('an unreachable Muster is recorded as failed, not thrown', async () => {
    const srv = await startServer();
    const url = srv.url;
    await srv.close(); // port now closed → connection refused
    const { collector, plan } = sampleManifest();
    const out = await deliverExecutionResults(collector.buildManifestForPlan('r', 'sim', plan), 'sim', {
      env: { CES_MUSTER_API_URL: url }, log: () => {}, timeoutMs: 5000,
    });
    expect(out.status).toBe('failed');
    expect(out.error).toBeTruthy();
  });

  it('refuses a non-localhost URL without opt-in and never calls the network', async () => {
    const fetchImpl = jest.fn();
    const { collector, plan } = sampleManifest();
    const m = collector.buildManifestForPlan('r', 'sim', plan);
    const out = await deliverExecutionResults(m, 'sim', {
      env: { CES_MUSTER_API_URL: 'https://muster.example.com' }, fetchImpl: fetchImpl as any, log: () => {},
    });
    expect(out.status).toBe('refused');
    expect(out.reason).toMatch(/CES_MUSTER_ALLOW_REMOTE/);
    expect(fetchImpl).not.toHaveBeenCalled();
    // a hostname that merely starts with "localhost" is not local
    expect(resolveMusterEndpoint({ CES_MUSTER_API_URL: 'http://localhost.evil.com' })).toMatchObject({ status: 'refused' });
  });

  it('allows a remote URL with explicit opt-in', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 200 }));
    const { collector, plan } = sampleManifest();
    const out = await deliverExecutionResults(collector.buildManifestForPlan('r', 'sim', plan), 'sim', {
      env: { CES_MUSTER_API_URL: 'https://muster.example.com/api', CES_MUSTER_ALLOW_REMOTE: '1' }, fetchImpl: fetchImpl as any, log: () => {},
    });
    expect(out.status).toBe('delivered');
    expect((fetchImpl.mock.calls[0] as any[])[0]).toBe('https://muster.example.com/api/plan/results');
  });

  it('skips with no Muster configured, and skips dry runs', async () => {
    const { collector, plan } = sampleManifest();
    const m = collector.buildManifestForPlan('r', 'sim', plan);
    expect((await deliverExecutionResults(m, 'sim', { env: {}, log: () => {} })).status).toBe('skipped');
    const fetchImpl = jest.fn();
    const dry = await deliverExecutionResults(m, 'sim', { env: { CES_MUSTER_API_URL: 'http://localhost:1' }, dryRun: true, fetchImpl: fetchImpl as any, log: () => {} });
    expect(dry).toMatchObject({ status: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
