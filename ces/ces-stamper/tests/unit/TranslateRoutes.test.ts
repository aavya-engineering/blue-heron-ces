// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set CES_PIPELINE_ROOT before any ces-shared imports resolve the default
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-translate-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;
// FIN-15: the route copies each plan into getPlanDataRoot() when no tenant is given; without this
// the copies landed in the repo's ces-stamper/plan-data/ (the dev/plans refill, LOG-GC-DUP-3-8 open item 1).
process.env.CES_STAMPER_PLAN_DATA_ROOT = path.join(tmpRoot, 'plan-data');

import { createTranslateRouter, translatePlansDir } from '../../src/server/routes/translate.routes';
import { tenantPlansDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { getRepoRoot } from '../../src/config/paths';
import { translateForTenant, projectExecutablePlan } from '../../src/translators/translateForTenant';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const MP_PATH = path.join(FIXTURES, 'full-registry-mission-plan.json');
const TM_PATH = path.join(FIXTURES, 'full-registry-manifest.json');

function post(url: string, body: object): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode!, json: () => Promise.resolve(JSON.parse(buf)) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('POST /api/translate — route tests (MS-R6)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(createTranslateRouter(() => null, () => null));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns 400 when missionPlan is missing', async () => {
    const res = await post(`${baseUrl}/api/translate`, { manifest: TM_PATH });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when manifest is missing', async () => {
    const res = await post(`${baseUrl}/api/translate`, { missionPlan: MP_PATH });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('translates full-registry fixture successfully', async () => {
    const outDir = path.join(tmpRoot, 'route-test-out');
    fs.mkdirSync(outDir, { recursive: true });
    const output = path.join(outDir, 'ep-route.json');
    const res = await post(`${baseUrl}/api/translate`, {
      missionPlan: MP_PATH,
      manifest: TM_PATH,
      output,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.planId).toBeTruthy();
    expect(body.totalTasks).toBeGreaterThan(0);
    expect(fs.existsSync(output)).toBe(true);
  });

  it('FIN-15: a translate without a tenant copies its plan under CES_STAMPER_PLAN_DATA_ROOT, never the repo plan-data', async () => {
    const res = await post(`${baseUrl}/api/translate`, { missionPlan: MP_PATH, manifest: TM_PATH, output: path.join(tmpRoot, 'route-test-out', 'ep-fin15.json') });
    expect(res.status).toBe(200);
    const copies = fs.readdirSync(path.join(tmpRoot, 'plan-data')).filter((f) => /^executable-plan-.*\.json$/.test(f));
    expect(copies.length).toBeGreaterThan(0);
  });

  it('FIN-21: a translate with no output writes the plan ONCE in the plans dir (no second copy)', async () => {
    const dir = path.join(tmpRoot, 'plan-data');
    const before = fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set<string>();
    const res = await post(`${baseUrl}/api/translate`, { missionPlan: MP_PATH, manifest: TM_PATH });
    expect(res.status).toBe(200);
    const body = await res.json();
    const added = fs.readdirSync(dir).filter((f) => !before.has(f));
    expect(added).toHaveLength(1);
    expect(path.resolve(body.planDataPaths.output)).toBe(path.resolve(dir, added[0]));
  });

  it('FIN-21: an output already in the plans dir is not copied again', async () => {
    const dir = path.join(tmpRoot, 'plan-data');
    fs.mkdirSync(dir, { recursive: true });
    const output = path.join(dir, 'ep-in-plans-dir.json');
    const before = new Set(fs.readdirSync(dir));
    const res = await post(`${baseUrl}/api/translate`, { missionPlan: MP_PATH, manifest: TM_PATH, output });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => !before.has(f))).toEqual(['ep-in-plans-dir.json']);
    expect(path.resolve(body.planDataPaths.output)).toBe(path.resolve(output));
  });

  it('FIN-21: with CES_STAMPER_PLAN_DATA_ROOT unset, a dev translate targets the dev plans dir under CES_PIPELINE_ROOT, never the repo plan-data', () => {
    const env = { ...process.env };
    delete env.CES_STAMPER_PLAN_DATA_ROOT;
    const dir = translatePlansDir(undefined, env);
    expect(dir).toBe(tenantPlansDir('dev'));
    expect(path.resolve(dir).toLowerCase().startsWith(path.resolve(tmpRoot).toLowerCase())).toBe(true);
    expect(path.resolve(dir).toLowerCase().startsWith(path.join(getRepoRoot(), 'plan-data').toLowerCase())).toBe(false);
    expect(translatePlansDir('dev', env)).toBe(tenantPlansDir('dev'));
    expect(translatePlansDir('acme', env)).toBe(tenantPlansDir('acme'));
    expect(translatePlansDir(undefined, { ...env, CES_STAMPER_PLAN_DATA_ROOT: path.join(tmpRoot, 'x') })).toBe(path.resolve(tmpRoot, 'x'));
  });

  it('GUI and CLI translate produce identical task ids', async () => {
    // GUI path: via the route
    const guiOut = path.join(tmpRoot, 'gui-ep.json');
    const res = await post(`${baseUrl}/api/translate`, {
      missionPlan: MP_PATH,
      manifest: TM_PATH,
      output: guiOut,
    });
    const body = await res.json();
    expect(body.success).toBe(true);

    // CLI path: W8-STX — the CLI's translate is translateForTenant in mode 'cli'
    const cliOut = path.join(tmpRoot, 'cli-ep.json');
    const cliResult = (await translateForTenant({ mode: 'cli', missionPlanPath: MP_PATH, manifestPath: TM_PATH, outputPath: cliOut })).result;

    // Compare task ids
    const guiPlan = JSON.parse(fs.readFileSync(guiOut, 'utf-8'));
    const guiTaskIds = guiPlan.execution_graph.map((t: any) => t.id).sort();
    const cliTaskIds = cliResult.plan.execution_graph.map((t: any) => t.id).sort();
    expect(guiTaskIds).toEqual(cliTaskIds);
    // W8-STX: and the whole projection (the route's post-processing adds only excluded fields here)
    expect(projectExecutablePlan(guiPlan)).toEqual(projectExecutablePlan(cliResult.plan));
  });
});
