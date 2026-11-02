// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX2-MU1 (P0, cross-tenant): the plan hand-off routes check role AND tenant.
//
// Drives the real createPlanRouter() with JWTs from two Muster tenants and
// several roles:
//   - tenant-B cannot push to tenant A's slug (404 — existence is not leaked);
//   - a wrong-role user in the right tenant is refused (403);
//   - the legitimate push path still works.
// ROLE-3 (2026-10-30): POST /results and GET /status were removed; their cases went with them.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import express from 'express';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const TENANT_A = '00000000-aaaa-0000-0000-00000000fx21';
const TENANT_B = '00000000-bbbb-0000-0000-00000000fx22';
const SLUG_A = 'fx2mu1-tenant-a';

const tok = (tenant_id: string, role: string) =>
  mintToken({ sub: `u-${role}-${tenant_id.slice(9, 13)}`, tenant_id, party_id: null, role });

const A_OPERATOR = tok(TENANT_A, 'bhd_operator');
const A_PRIME = tok(TENANT_A, 'prime');
const A_ASSESSOR = tok(TENANT_A, 'assessor_read_only');
const A_SUB = mintToken({ sub: 'u-sub-a', tenant_id: TENANT_A, party_id: 'p-1', role: 'sub' });
const B_OPERATOR = tok(TENANT_B, 'bhd_operator');
const B_PRIME = tok(TENANT_B, 'prime');

let server: http.Server;
let base: string;
let tmpRoot: string;

function call(method: 'GET' | 'POST', route: string, token: string, body?: unknown) {
  return fetch(`${base}/api/plan/${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const push = (token: string, slug = SLUG_A) =>
  call('POST', 'push', token, { tenant_slug: slug, missionPlan: mp, tenantManifest: tm });

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-fx2mu1-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // Tenant A's operator pushes the plan (legitimate path, claims SLUG_A).
  const res = await push(A_OPERATOR);
  expect(res.status).toBe(201);
});

afterAll(() => {
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('FX2-MU1: cross-tenant — tenant B cannot touch tenant A plan (404, no existence leak)', () => {
  test('tenant-B push into tenant A slug → 404, nothing written', async () => {
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', SLUG_A, 'plans');
    const before = fs.readdirSync(plansDir).length;
    const res = await push(B_OPERATOR);
    expect(res.status).toBe(404);
    expect(fs.readdirSync(plansDir).length).toBe(before);
    expect((await push(B_PRIME)).status).toBe(404);
  });
});

describe('FX2-MU1: wrong role in the right tenant is refused (403)', () => {
  test('push: assessor_read_only and sub are refused', async () => {
    expect((await push(A_ASSESSOR)).status).toBe(403);
    expect((await push(A_SUB)).status).toBe(403);
  });
});

describe('FX2-MU1: legitimate path still works end to end', () => {
  test('tenant A: prime may push', async () => {
    expect((await push(A_PRIME)).status).toBe(201);
  });

  test('tenant B may use its own slug (ownership is per slug, not global)', async () => {
    expect((await push(B_OPERATOR, 'fx2mu1-tenant-b')).status).toBe(201);
    // …and tenant A cannot push into tenant B's
    expect((await push(A_OPERATOR, 'fx2mu1-tenant-b')).status).toBe(404);
  });
});
