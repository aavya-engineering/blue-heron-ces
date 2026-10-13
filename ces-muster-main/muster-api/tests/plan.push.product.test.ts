// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU1 acceptance (API half): the SPA's production push client
// (src/features/plan/planPushService.ts → musterApi.ts) against the REAL
// muster-api app (createApp(), not a hand-built router), with a full-size
// generated Mission Plan fixture (~2.5MB compact).
//
// Proves the two halves agree end to end: the body the Plan tab sends is the
// body the route accepts, the global 100kb JSON parser no longer 413s the push,
// the files land in the tenant's Stamper plans folder under the hyphenated
// names Stamper's picker browses, and a browser origin on the Vite ports gets
// a CORS preflight answer (other origins do not).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createApp } from '../src/app.js';
import { mintToken } from '../src/lib/jwt.js';
import { pushPlanToStamper } from '@/features/plan/planPushService';
import type { PlanCompileResult } from '@/features/plan/planCompileService';

// Stamper's browse regex (ces-stamper/src/routes/utility.routes.ts:42).
const STAMPER_MP_RE = /^manual-mission-plan-.*\.json$/;
const STAMPER_TM_RE = /^tenant-manifest-.*\.json$/;

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const im = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'infrastructure-manifest.json'), 'utf8'));

const RESULT = {
  artifacts: { missionPlan: mp, tenantManifest: tm },
  docs: [],
  tenantSlug: 'fxmu1-tenant',
  defaultedInputs: [],
} as unknown as PlanCompileResult;

const TOKEN = mintToken({
  sub: 'test-operator',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  party_id: null,
  role: 'bhd_operator',
});

let server: http.Server;
let base: string;
let tmpRoot: string;
const store = new Map<string, string>();

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-push-product-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  server = createApp().listen(0);
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  // The SPA client reads its base URL and token from localStorage.
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

afterAll(() => {
  server?.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('FX-MU1: Plan tab push client → real muster-api app', () => {
  test('a full-size generated plan lands in the tenant Stamper plans folder', async () => {
    const compactBytes = JSON.stringify({ missionPlan: mp, tenantManifest: tm }).length;
    expect(compactBytes).toBeGreaterThan(100 * 1024); // over the global parser default

    store.set('muster-api-url', `${base}/api`);
    store.set('muster-jwt', TOKEN);
    const outcome = await pushPlanToStamper(RESULT);
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [mpFile, tmFile] = outcome.pushed;
    expect(mpFile).toMatch(STAMPER_MP_RE);
    expect(tmFile).toMatch(STAMPER_TM_RE);
    expect(mpFile).toContain('fxmu1-tenant');

    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'fxmu1-tenant', 'plans');
    const written = JSON.parse(fs.readFileSync(path.join(plansDir, mpFile), 'utf8'));
    expect(written.outputs.human_readable_mission_plan.plan_id).toBe(
      mp.outputs.human_readable_mission_plan.plan_id
    );
    expect(fs.existsSync(path.join(plansDir, tmFile))).toBe(true);
  });

  test('W4-MU1: a plan with an Infra Manifest pushes it too (the SPA client sends it)', async () => {
    store.set('muster-api-url', `${base}/api`);
    store.set('muster-jwt', TOKEN);
    const withInfra = {
      ...RESULT,
      artifacts: { missionPlan: mp, tenantManifest: tm, infrastructureManifest: im },
      tenantSlug: 'w4mu1-product',
    } as unknown as PlanCompileResult;
    const outcome = await pushPlanToStamper(withInfra);
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pushed).toHaveLength(3);
    const imFile = outcome.pushed[2];
    expect(imFile).toMatch(/^infrastructure-manifest-w4mu1-product-.*\.json$/);
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'w4mu1-product', 'plans');
    expect(JSON.parse(fs.readFileSync(path.join(plansDir, imFile), 'utf8'))).toEqual(im);
  });

  test('no token → the client reports the missing sign-in, nothing is written', async () => {
    store.set('muster-api-url', `${base}/api`);
    store.delete('muster-jwt');
    const outcome = await pushPlanToStamper({ ...RESULT, tenantSlug: 'fxmu1-noauth' } as PlanCompileResult);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);
    expect(outcome.message).toContain('sign-in token');
    expect(fs.existsSync(path.join(tmpRoot, 'Stamper', 'plan-data', 'fxmu1-noauth'))).toBe(false);
  });

  test('CORS preflight: Vite origin allowed, foreign origin gets no allow header', async () => {
    const ok = await fetch(`${base}/api/plan/push`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Authorization');

    const foreign = await fetch(`${base}/api/plan/push`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
    });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });
});
