// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU1 acceptance (SPA half): the Plan tab's "Send to Stamper" button calls
// muster-api's POST /api/plan/push with the GENERATED plan, shows success or
// failure, and keeps the download as the fallback.
//
// Only compilePlanForSession (Dexie + banks) and the network (global fetch) are
// faked. PlanTab, planPushService and musterApi are the production code.
// Render pattern: react-dom/client + act (no Testing Library in this repo).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlanCompileResult } from '../planCompileService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MISSION_PLAN = {
  ces: { artifact: 'manual_mission_plan', version: '1.0.0', generated_on: '2026-09-27' },
  outputs: {
    human_readable_mission_plan: {
      plan_id: 'MP-FXMU1-001',
      control_directives: [{ control_id: 'AC.L2-3.1.1', directive: 'implement', step_ids: ['s1'] }],
    },
  },
};
const TENANT_MANIFEST = { ces: { artifact: 'tenant_manifest' }, tenant_manifest: { marker: 'tm-fxmu1' } };

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

async function generate() {
  act(() => root.render(<PlanTab completedSessionId="sess-fxmu1" />));
  await act(async () => (q('plan-generate-btn') as HTMLButtonElement).click());
  await flush();
  expect(q('plan-doc-list')).not.toBeNull();
}

beforeEach(() => {
  localStorage.setItem('muster-api-url', 'http://localhost:4000/api');
  localStorage.setItem('muster-jwt', 'test-jwt');
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

describe('FX-MU1: Plan tab "Send to Stamper"', () => {
  it('POSTs the generated MP + TM for the session tenant to /api/plan/push and shows success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        pushed: [
          'manual-mission-plan-acme-gcc-high-2026-09-27T00-00-00-000Z.json',
          'tenant-manifest-acme-gcc-high-2026-09-27T00-00-00-000Z.json',
        ],
        plansDir: '/tmp/Stamper/plan-data/acme-gcc-high/plans',
      })
    );
    await generate();

    await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/plan/push');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-jwt');
    const body = JSON.parse(init.body as string);
    expect(body.tenant_slug).toBe('acme-gcc-high');
    expect(body.missionPlan).toEqual(MISSION_PLAN);
    expect(body.tenantManifest).toEqual(TENANT_MANIFEST);

    expect(q('plan-send-stamper-success')?.textContent).toContain(
      'manual-mission-plan-acme-gcc-high-2026-09-27T00-00-00-000Z.json'
    );
    expect(q('plan-send-stamper-error')).toBeNull();
    // Download fallback still present.
    expect(q('plan-download-mission-plan')).not.toBeNull();
  });

  it('shows the route error and keeps the download fallback when the push is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'Mission Plan contract violation' }));
    await generate();

    await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
    await flush();

    const err = q('plan-send-stamper-error');
    expect(err?.textContent).toContain('muster-api returned 400: Mission Plan contract violation');
    expect(err?.textContent).toContain('Download');
    expect(q('plan-send-stamper-success')).toBeNull();
    expect(q('plan-download-mission-plan')).not.toBeNull();
  });

  it('names the missing sign-in token on 401 instead of a generic failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Missing or invalid authorization header' }));
    await generate();

    await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
    await flush();

    expect(q('plan-send-stamper-error')?.textContent).toContain('no valid muster-api sign-in token');
  });
  it('FX-MU2: "Check Stamper progress" reads /api/plan/status for this plan and renders directive verdicts', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        planId: 'MP-FXMU1-001',
        runId: 'run-7',
        total: 1,
        counts: { sat: 1, not_sat: 0, provisional: 0, not_applicable: 0, pending: 0 },
        directives: [{ control_id: 'AC.L2-3.1.1', directive: 'implement', verdict: 'sat', outcome: 'accomplished' }],
      })
    );
    await generate();

    await act(async () => (q('plan-progress-refresh-btn') as HTMLButtonElement).click());
    await flush();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/plan/status?tenant_slug=acme-gcc-high&plan_id=MP-FXMU1-001');
    expect(init.method).toBe('GET');
    expect(q('plan-progress-summary')?.textContent).toContain('1 of 1 directives reported');
    expect(q('plan-progress-verdict-AC.L2-3.1.1')?.textContent).toBe('Satisfied');
  });

  it('FX-MU2: progress before the plan was sent says so', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'No pushed plan' }));
    await generate();

    await act(async () => (q('plan-progress-refresh-btn') as HTMLButtonElement).click());
    await flush();

    expect(q('plan-progress-error')?.textContent).toContain('Stamper has not received this plan yet');
    expect(q('plan-progress')).toBeNull();
  });
});
