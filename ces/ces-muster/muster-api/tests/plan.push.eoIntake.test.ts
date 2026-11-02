// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Gap closure FLOW-3: after an accepted push muster-api delivers the bundle to EO's intake
// (POST {CES_EO_URL}/api/intake/muster, bearer CES_EO_AUTH_TOKEN) when both are set. The bundle is
// the stored plan files (same bytes as the plans folder) with their pushed file names; the push
// response carries the outcome (eo_intake). Unset → no call; an EO failure never fails the push.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { createPlanRouter, deliverToEoIntake } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const TOKEN = mintToken({ sub: 'flow3-operator', tenant_id: '00000000-0000-0000-0000-0000000000f3', party_id: null, role: 'bhd_operator' });

let server: http.Server;
let base: string;
let eo: http.Server;
let eoBase: string;
let tmpRoot: string;
let received: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];
let eoStatus = 201;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-flow3-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const eoApp = express();
  eoApp.use(express.json({ limit: '5mb' }));
  eoApp.post('/api/intake/muster', (req, res) => {
    received.push({ auth: req.headers.authorization, body: req.body });
    if (eoStatus !== 201) { res.status(eoStatus).json({ error: 'Intake bundle violation' }); return; }
    res.status(201).json({ schema: 'ces-eo/muster-intake-receipt@1', receipt_id: 'intake-test', items: [] });
  });
  eo = eoApp.listen(0);
  eoBase = `http://127.0.0.1:${(eo.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  eo?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
  delete process.env.CES_EO_URL;
  delete process.env.CES_EO_AUTH_TOKEN;
});

beforeEach(() => {
  received = [];
  eoStatus = 201;
  delete process.env.CES_EO_URL;
  delete process.env.CES_EO_AUTH_TOKEN;
});

const push = (slug: string, extra: Record<string, unknown> = {}) => fetch(`${base}/api/plan/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ tenant_slug: slug, missionPlan: mp, tenantManifest: tm, ...extra }),
});

describe('FLOW-3: push → EO intake', () => {
  test('not configured: no call, eo_intake not_configured, push 201', async () => {
    const res = await push('flow3-off');
    expect(res.status).toBe(201);
    expect(((await res.json()) as { eo_intake: unknown }).eo_intake).toEqual({ status: 'not_configured' });
    expect(received).toHaveLength(0);
  });

  test('configured: the stored files and their names reach EO with the EO token; the receipt is in the push response', async () => {
    process.env.CES_EO_URL = `${eoBase}/`;
    process.env.CES_EO_AUTH_TOKEN = 'eo-secret';
    const policies = [{ name: 'policies/access-control-policy.md', markdown: '# Access Control Policy\n' }];
    const res = await push('flow3-on', { policies });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pushed: string[]; eo_intake: { status: string; receipt: { receipt_id: string } } };
    expect(body.eo_intake).toEqual({ status: 'delivered', http: 201, receipt: { schema: 'ces-eo/muster-intake-receipt@1', receipt_id: 'intake-test', items: [] } });
    expect(received).toHaveLength(1);
    const got = received[0]!;
    expect(got.auth).toBe('Bearer eo-secret');
    expect(got.body.tenant_slug).toBe('flow3-on');
    expect(got.body.policies).toEqual(policies);
    const names = got.body.file_names as Record<string, string>;
    expect(Object.values(names)).toEqual(body.pushed);
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'flow3-on', 'plans');
    // Same bytes as the plans folder: what EO hashes is what Stamper reads.
    expect(JSON.stringify(got.body.missionPlan, null, 2)).toBe(fs.readFileSync(path.join(plansDir, names.mission_plan!), 'utf8'));
    expect(JSON.stringify(got.body.tenantManifest, null, 2)).toBe(fs.readFileSync(path.join(plansDir, names.tenant_manifest!), 'utf8'));
  });

  test('an EO refusal or an unreachable EO never fails the push', async () => {
    process.env.CES_EO_URL = eoBase;
    process.env.CES_EO_AUTH_TOKEN = 'eo-secret';
    eoStatus = 400;
    const r1 = await push('flow3-refused');
    expect(r1.status).toBe(201);
    expect(((await r1.json()) as { eo_intake: { status: string; http: number } }).eo_intake).toMatchObject({ status: 'failed', http: 400 });
    process.env.CES_EO_URL = 'http://127.0.0.1:1';
    const r2 = await push('flow3-down');
    expect(r2.status).toBe(201);
    expect(((await r2.json()) as { eo_intake: { status: string } }).eo_intake.status).toBe('failed');
  });

  test('deliverToEoIntake needs both the URL and the token', async () => {
    expect(await deliverToEoIntake({}, { CES_EO_URL: eoBase })).toEqual({ status: 'not_configured' });
    expect(await deliverToEoIntake({}, { CES_EO_AUTH_TOKEN: 'x' })).toEqual({ status: 'not_configured' });
  });
});
