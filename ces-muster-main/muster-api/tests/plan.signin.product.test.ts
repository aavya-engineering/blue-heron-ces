// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU4 acceptance (API half): the SPA's production sign-in client
// (src/shared/api/musterAuth.ts) obtains a token from the REAL muster-api
// app's POST /auth/login (createApp(), bcrypt check, mintToken), and the SPA's
// production push/status clients (planPushService.ts → musterApi.ts) then
// succeed with that token. NO token is minted or injected by this test.
//
// Only the database is replaced: db.user.findUnique returns one operator row
// whose password_hash is a bcrypt hash of a password generated at run time.
// (A live-Postgres run of the same chain is recorded in the session log.)
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const OPERATOR = {
  id: 'user-fxmu4',
  email: 'operator@muster.test',
  tenant_id: '00000000-0000-0000-0000-0000000000f4',
  party_id: null,
  role: 'bhd_operator',
  password_hash: '',
};
const PASSWORD = randomBytes(12).toString('hex');

vi.mock('../src/lib/prisma.js', () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        where.email === OPERATOR.email ? OPERATOR : null
      ),
    },
  },
  withTenant: vi.fn(),
}));

const { createApp } = await import('../src/app.js');
const { verifyToken } = await import('../src/lib/jwt.js');
const { signInToMuster, hasMusterToken } = await import('@/shared/api/musterAuth');
const { pushPlanToStamper, fetchPlanProgress } = await import('@/features/plan/planPushService');
type PlanCompileResult = import('@/features/plan/planCompileService').PlanCompileResult;

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));

const RESULT = {
  artifacts: { missionPlan: mp, tenantManifest: tm },
  docs: [],
  tenantSlug: 'fxmu4-tenant',
  defaultedInputs: [],
} as unknown as PlanCompileResult;

let server: http.Server;
let base: string;
let tmpRoot: string;
const store = new Map<string, string>();

beforeAll(async () => {
  OPERATOR.password_hash = await bcrypt.hash(PASSWORD, 4);
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-signin-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  server = createApp().listen(0);
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('muster-api-url', `${base}/api`);
});

afterAll(() => {
  server?.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
});

describe('FX-MU4: SPA sign-in → real /auth/login → push + status with that token', () => {
  test('wrong password: 401, no token stored, push still refused', async () => {
    store.delete('muster-jwt');
    const bad = await signInToMuster(OPERATOR.email, `${PASSWORD}x`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.status).toBe(401);
    expect(hasMusterToken()).toBe(false);

    const push = await pushPlanToStamper(RESULT);
    expect(push.ok).toBe(false);
    if (!push.ok) expect(push.status).toBe(401);
  });

  test('right password: token from /auth/login, plan lands in Stamper plans, progress readable', async () => {
    store.delete('muster-jwt');
    const signIn = await signInToMuster(OPERATOR.email, PASSWORD);
    expect(signIn).toEqual({ ok: true });

    const token = store.get('muster-jwt')!;
    const claims = verifyToken(token);
    expect(claims.sub).toBe(OPERATOR.id);
    expect(claims.tenant_id).toBe(OPERATOR.tenant_id);
    expect(claims.role).toBe('bhd_operator');
    // Only the token is stored, never the password.
    expect([...store.values()].some((v) => v.includes(PASSWORD))).toBe(false);

    const push = await pushPlanToStamper(RESULT);
    if (!push.ok) console.error('push failed:', push);
    expect(push.ok).toBe(true);
    if (!push.ok) return;
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'fxmu4-tenant', 'plans');
    expect(fs.existsSync(path.join(plansDir, push.pushed[0]))).toBe(true);

    const progress = await fetchPlanProgress(RESULT);
    if (!progress.ok) console.error('status failed:', progress);
    expect(progress.ok).toBe(true);
    if (!progress.ok) return;
    expect(progress.progress.planId).toBe(mp.outputs.human_readable_mission_plan.plan_id);
    expect(progress.progress.total).toBeGreaterThan(0);
    expect(progress.progress.counts.pending).toBe(progress.progress.total);
  });

  test('CORS preflight for /auth/login from the Vite origin is answered', async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
