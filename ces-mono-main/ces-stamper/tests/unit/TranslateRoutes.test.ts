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

import { createTranslateRouter } from '../../src/server/routes/translate.routes';
import { PlanTranslator } from '../../src/translators/PlanTranslator';

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

    // CLI path: direct PlanTranslator call (mirrors converged CLI)
    const cliOut = path.join(tmpRoot, 'cli-ep.json');
    const translator = new PlanTranslator(undefined, undefined);
    const cliResult = translator.translateFile(MP_PATH, TM_PATH, cliOut);

    // Compare task ids
    const guiPlan = JSON.parse(fs.readFileSync(guiOut, 'utf-8'));
    const guiTaskIds = guiPlan.execution_graph.map((t: any) => t.id).sort();
    const cliTaskIds = cliResult.plan.execution_graph.map((t: any) => t.id).sort();
    expect(guiTaskIds).toEqual(cliTaskIds);
  });
});
