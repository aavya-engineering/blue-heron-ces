// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU4 acceptance (SPA half): the Plan tab signs the operator in to
// muster-api through POST /auth/login, stores ONLY the returned token under
// 'muster-jwt', and "Send to Stamper" / "Check Stamper progress" then carry it.
// No token is injected: localStorage starts empty. A 401 drops the stale token
// and re-shows the sign-in form.
//
// Only compilePlanForSession (Dexie + banks) and the network (global fetch) are
// faked. PlanTab, MusterSignIn, musterAuth, planPushService and musterApi are
// the production code.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlanCompileResult } from '../planCompileService';
import { getAuthBase } from '@/shared/api/musterAuth';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MISSION_PLAN = {
  ces: { artifact: 'manual_mission_plan', version: '1.0.0', generated_on: '2026-09-27' },
  outputs: {
    human_readable_mission_plan: {
      plan_id: 'MP-FXMU4-001',
      control_directives: [{ control_id: 'AC.L2-3.1.1', directive: 'implement', step_ids: ['s1'] }],
    },
  },
};
const TENANT_MANIFEST = { ces: { artifact: 'tenant_manifest' } };

const RESULT: PlanCompileResult = {
  artifacts: {
    missionPlan: MISSION_PLAN,
    tenantManifest: TENANT_MANIFEST,
  } as unknown as PlanCompileResult['artifacts'],
  docs: [
    { kind: 'mission-plan', label: 'Mission Plan', artifact: MISSION_PLAN, validationWarnings: [] },
    { kind: 'tenant-manifest', label: 'Tenant Manifest', artifact: TENANT_MANIFEST, validationWarnings: [] },
  ],
  tenantSlug: 'acme-gcc-high',
  defaultedInputs: [],
  siFieldSources: {},
};

vi.mock('../planCompileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../planCompileService')>();
  return { ...actual, compilePlanForSession: vi.fn(async () => RESULT) };
});

const { default: PlanTab } = await import('../PlanTab');

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** Type into a React-controlled input (native setter + input event). */
function type(id: string, value: string) {
  const el = q(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function generate() {
  act(() => root.render(<PlanTab completedSessionId="sess-fxmu4" />));
  await act(async () => (q('plan-generate-btn') as HTMLButtonElement).click());
  await flush();
  expect(q('plan-doc-list')).not.toBeNull();
}

async function signIn(email: string, password: string) {
  type('muster-signin-email', email);
  type('muster-signin-password', password);
  await act(async () => (q('muster-signin-btn') as HTMLButtonElement).click());
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('muster-api-url', 'http://localhost:4000/api');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('FX-MU4: Plan tab sign-in to muster-api', () => {
  it('auth base strips only a trailing /api (auth is mounted at /auth)', () => {
    expect(getAuthBase()).toBe('http://localhost:4000');
    localStorage.setItem('muster-api-url', 'https://host.example/muster/api/');
    expect(getAuthBase()).toBe('https://host.example/muster');
  });

  it('no token → sign-in form; sign in → POST /auth/login → token stored → Send carries it', async () => {
    await generate();
    expect(localStorage.getItem('muster-jwt')).toBeNull();
    expect(q('muster-signin-form')).not.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok-from-login' }));
    await signIn('operator@muster.test', 'pw-typed');

    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe('http://localhost:4000/auth/login');
    expect(loginInit.method).toBe('POST');
    expect(JSON.parse(loginInit.body as string)).toEqual({
      email: 'operator@muster.test',
      password: 'pw-typed',
    });
    expect(localStorage.getItem('muster-jwt')).toBe('tok-from-login');
    // The password is not persisted anywhere in storage.
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('pw-typed');
    }
    expect(q('muster-signin-form')).toBeNull();
    expect(q('muster-signin-state')?.textContent).toContain('Signed in');

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { pushed: ['manual-mission-plan-acme-gcc-high-x.json'], plansDir: '/p' })
    );
    await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
    await flush();
    const [pushUrl, pushInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(pushUrl).toBe('http://localhost:4000/api/plan/push');
    expect((pushInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-from-login');
    expect(q('plan-send-stamper-success')).not.toBeNull();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        planId: 'MP-FXMU4-001',
        runId: null,
        total: 1,
        counts: { sat: 0, not_sat: 0, provisional: 0, not_applicable: 0, pending: 1 },
        directives: [{ control_id: 'AC.L2-3.1.1', directive: 'implement', verdict: null, outcome: null }],
      })
    );
    await act(async () => (q('plan-progress-refresh-btn') as HTMLButtonElement).click());
    await flush();
    const [, statusInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((statusInit.headers as Record<string, string>).Authorization).toBe('Bearer tok-from-login');
  });

  it('bad credentials: shows the failure, stores no token', async () => {
    await generate();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid credentials' }));
    await signIn('operator@muster.test', 'wrong');

    expect(localStorage.getItem('muster-jwt')).toBeNull();
    expect(q('muster-signin-error')?.textContent).toContain('did not accept that email and password');
    expect(q('muster-signin-form')).not.toBeNull();
  });

  it('a 401 on Send drops the stale token and re-shows the sign-in form', async () => {
    localStorage.setItem('muster-jwt', 'expired-token');
    await generate();
    expect(q('muster-signin-state')).not.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or expired token' }));
    await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
    await flush();

    expect(localStorage.getItem('muster-jwt')).toBeNull();
    expect(q('muster-signin-form')).not.toBeNull();
    expect(q('plan-send-stamper-error')?.textContent).toContain('no valid muster-api sign-in token');
  });

  it('Sign out removes the token', async () => {
    localStorage.setItem('muster-jwt', 'tok');
    await generate();
    await act(async () => (q('muster-signout-btn') as HTMLButtonElement).click());
    expect(localStorage.getItem('muster-jwt')).toBeNull();
    expect(q('muster-signin-form')).not.toBeNull();
  });
});
