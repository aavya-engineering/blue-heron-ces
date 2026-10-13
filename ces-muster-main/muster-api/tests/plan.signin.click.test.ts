// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU4 real-click integration: the production PlanTab (SPA) rendered in
// jsdom, driven by clicks, talking over real HTTP to the REAL muster-api app
// (createApp().listen(0)). Sign in → Send to Stamper → Check Stamper progress.
// localStorage starts EMPTY — the token comes only from POST /auth/login.
//
// Faked: the database (one operator row, bcrypt hash of a run-time password)
// and compilePlanForSession (returns the committed full-size generated plan
// fixture; generation itself is proven by FX-MU3's full-session test).
// Harness shim: jsdom's AbortSignal is not an instance of Node's AbortSignal,
// so Node's fetch rejects it; the test's fetch drops the signal (timeouts only)
// and passes everything else through unchanged to the real server.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPERATOR = {
  id: 'user-fxmu4-click',
  email: 'operator@muster.test',
  tenant_id: '00000000-0000-0000-0000-0000000000f5',
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

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');
const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
const TENANT = 'fxmu4-click';

vi.mock('@/features/plan/planCompileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/plan/planCompileService')>();
  return {
    ...actual,
    compilePlanForSession: vi.fn(async () => ({
      artifacts: { missionPlan: mp, tenantManifest: tm },
      docs: [
        { kind: 'mission-plan', label: 'Mission Plan', artifact: mp, validationWarnings: [] },
        { kind: 'tenant-manifest', label: 'Tenant Manifest', artifact: tm, validationWarnings: [] },
      ],
      tenantSlug: TENANT,
      defaultedInputs: [],
    })),
  };
});

const { createApp } = await import('../src/app.js');
const { verifyToken } = await import('../src/lib/jwt.js');
const { default: PlanTab } = await import('@/features/plan/PlanTab');

let server: http.Server;
let base: string;
let tmpRoot: string;
let container: HTMLDivElement;
let root: Root;
const nodeFetch = globalThis.fetch;

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function until(cond: () => boolean, label: string) {
  for (let i = 0; i < 100 && !cond(); i++) await flush(1);
  if (!cond()) throw new Error(`timed out waiting for ${label}`);
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function type(id: string, value: string) {
  const el = q(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (id: string) => act(async () => (q(id) as HTMLButtonElement).click());

beforeAll(async () => {
  OPERATOR.password_hash = await bcrypt.hash(PASSWORD, 4);
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-signin-click-'));
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { signal: _jsdomSignal, ...rest } = init ?? {};
    return nodeFetch(url, rest);
  });
  localStorage.clear();
  localStorage.setItem('muster-api-url', `${base}/api`);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterAll(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  server?.close();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.CES_PIPELINE_ROOT;
  localStorage.clear();
});

describe('FX-MU4: real click flow — PlanTab ↔ real muster-api', () => {
  test('sign in, Send to Stamper, Check Stamper progress', async () => {
    act(() => root.render(createElement(PlanTab, { completedSessionId: 'sess-fxmu4-click' })));
    await click('plan-generate-btn');
    await until(() => !!q('plan-doc-list'), 'plan generated');

    // No token yet: an unauthenticated Send is refused by the real server.
    expect(localStorage.getItem('muster-jwt')).toBeNull();
    await click('plan-send-stamper-btn');
    await until(() => !!q('plan-send-stamper-error'), 'unauthenticated send error');
    expect(q('plan-send-stamper-error')!.textContent).toContain('no valid muster-api sign-in token');

    // Sign in through the form → real /auth/login.
    expect(q('muster-signin-form')).not.toBeNull();
    type('muster-signin-email', OPERATOR.email);
    type('muster-signin-password', PASSWORD);
    await click('muster-signin-btn');
    await until(() => !!q('muster-signin-state'), 'signed in');
    const token = localStorage.getItem('muster-jwt')!;
    expect(verifyToken(token).sub).toBe(OPERATOR.id);

    // Send → the plan lands in the tenant's Stamper plans folder.
    await click('plan-send-stamper-btn');
    await until(() => !!q('plan-send-stamper-success'), 'send success');
    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', TENANT, 'plans');
    const files = fs.readdirSync(plansDir);
    expect(files.some((f) => /^manual-mission-plan-.*\.json$/.test(f))).toBe(true);
    expect(files.some((f) => /^tenant-manifest-.*\.json$/.test(f))).toBe(true);
    expect(q('plan-send-stamper-success')!.textContent).toContain('manual-mission-plan-');

    // Check progress → directive table renders (all pending until Stamper reports).
    await click('plan-progress-refresh-btn');
    await until(() => !!q('plan-progress-summary') || !!q('plan-progress-error'), 'progress');
    expect(q('plan-progress-error')).toBeNull();
    expect(q('plan-progress-summary')!.textContent).toContain('directives reported');
  }, 30_000);
});
