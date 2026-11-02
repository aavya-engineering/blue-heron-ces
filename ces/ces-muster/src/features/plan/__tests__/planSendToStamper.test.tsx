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
// Only compilePlanForSession (Dexie + banks), the policy render
// (attachPolicyHandoffWithTexts, FIN-28) and the network (global fetch) are
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
  cuiBoundaryBuild: { skipped: null, sources: {} },
  planModeDecision: { planMode: 'harden_existing', source: 'derived', reason: 'test', deferred: null },
  validation: {
    blocking: [],
    warnings: [],
    schema: { warnings: [], accepted: [] },
    operatorValues: { simOnly: false, defaulted: [], blocking: [] },
  },
  posture: {} as PlanCompileResult['posture'],
  handoff: {},
  recurringCostNotice: { price_date: '2026-10-31', items: [], licence_dependencies: [], total_estimate_low: 0, total_estimate_high: 0, items_hash: 'x', note: 'n' },
};

const POLICY_TEXTS = vi.hoisted(() => [] as Array<{ name: string; markdown: string }>);

vi.mock('../planCompileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../planCompileService')>();
  // W7-MX2: the policy envelopes need the session and the policy bank (covered in handoffArtifacts.test.ts).
  return { ...actual, compilePlanForSession: vi.fn(async () => RESULT), attachPolicyHandoff: vi.fn(async () => {}) };
});

// FIN-28: the Plan tab builds the policy envelopes and their texts in one render (planPushService).
vi.mock('../planPushService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../planPushService')>();
  return { ...actual, attachPolicyHandoffWithTexts: vi.fn(async () => POLICY_TEXTS) };
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
  it('W7-MX2: the push carries every hand-off envelope; posture, CUI Boundary and BTC Confirmation download', async () => {
    const env = (artifact: string) => ({
      cesId: 'ces-w7',
      schema_id: `muster:${artifact}`,
      artifact_id: `${artifact}-ces-w7`,
      version: '1.0.0',
      hash_sha256: 'a'.repeat(64),
      artifact: { ces: { artifact } },
    });
    const handoff = {
      readiness_posture: env('CES_READINESS_POSTURE'),
      policy_inputs_profile: env('policy_inputs_output'),
      policy_set_manifest: env('policy_set_manifest'),
      cui_boundary: env('cui_boundary_output'),
    };
    const btc = {
      ces: { artifact: 'btc_confirmation_output' },
      btc_confirmation: { answers: {}, evidence_refs: [], risk_flags: [], gate_status: {}, decision_log: [] },
    };
    const saved = { handoff: RESULT.handoff, btc: RESULT.artifacts.btcConfirmation };
    RESULT.handoff = handoff;
    (RESULT.artifacts as { btcConfirmation: unknown }).btcConfirmation = btc;
    try {
      fetchMock.mockResolvedValue(jsonResponse(201, { pushed: [], plansDir: '/tmp/plans' }));
      await generate();
      expect(q('plan-download-readiness-posture')).not.toBeNull();
      expect(q('plan-download-cui-boundary')).not.toBeNull();
      expect(q('plan-download-btc-confirmation')).not.toBeNull();

      await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
      await flush();
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      for (const [kind, e] of Object.entries(handoff)) expect(body[kind], kind).toEqual(e);
    } finally {
      RESULT.handoff = saved.handoff;
      (RESULT.artifacts as { btcConfirmation: unknown }).btcConfirmation = saved.btc;
    }
  });

  it('FIN-28 (V122): the push carries the policy texts the policy-set manifest hashes, as the API push does', async () => {
    const env = (artifact: string) => ({
      cesId: 'ces-fin28',
      schema_id: `muster:${artifact}`,
      artifact_id: `${artifact}-ces-fin28`,
      version: '1.0.0',
      hash_sha256: 'b'.repeat(64),
      artifact: { ces: { artifact } },
    });
    const saved = RESULT.handoff;
    RESULT.handoff = { policy_inputs_profile: env('policy_inputs_output'), policy_set_manifest: env('policy_set_manifest') };
    POLICY_TEXTS.splice(0, POLICY_TEXTS.length, { name: 'policies/access-control-policy.md', markdown: '# Access Control' });
    try {
      fetchMock.mockResolvedValue(jsonResponse(201, { pushed: [], plansDir: '/tmp/plans' }));
      await generate();
      await act(async () => (q('plan-send-stamper-btn') as HTMLButtonElement).click());
      await flush();
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.policies).toEqual([{ name: 'policies/access-control-policy.md', markdown: '# Access Control' }]);
      expect(body.policy_set_manifest).toEqual(RESULT.handoff.policy_set_manifest);
    } finally {
      RESULT.handoff = saved;
      POLICY_TEXTS.splice(0, POLICY_TEXTS.length);
    }
  });

  it('ROLE-3: the Plan tab has no Stamper progress control (Muster collects and writes the plan only)', async () => {
    await generate();
    expect(q('plan-progress-refresh-btn')).toBeNull();
    expect(q('plan-progress')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
