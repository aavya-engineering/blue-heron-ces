// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-32 (FLOW-7): the Plan tab's "Compile on muster-api" panel, clicked. Only Dexie (the
// session) and the network (compileOnApi / pushCompiledOnApi) are faked; the panel and the
// push-body builder are production code. Render pattern: react-dom/client + act.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InterviewSession } from '@/shared/types/engagement';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION: Partial<InterviewSession> = {
  id: 'sess-1',
  party_id: 'p1',
  status: 'complete',
  facts: [
    { question_id: 'G-01', question_text: 'Q', answer: 'yes', provenance: 'operator_interview', confidence: 'high', recorded_at: '2026-10-31T00:00:00.000Z' },
    { question_id: 'G-02', question_text: 'Q2', answer: 'no', provenance: 'auto_detected', confidence: 'high', recorded_at: '2026-10-31T00:00:00.000Z' },
  ],
  readiness_manifest: { mode: 'independent', auth_tier: 'lite', tenant_slug: 's1-mach', tenant_kind: 'sim', operator_name: 'Op', operator_role: 'assessor' },
};
let session: Partial<InterviewSession> = SESSION;

vi.mock('@/shared/db/schema', () => ({
  db: { interview_sessions: { get: vi.fn(async () => session) } },
}));

const TS = '2026-10-31T11-00-00-000Z';
const FILES = [
  { name: `manual-mission-plan-s1-mach-${TS}.json`, encoding: 'utf8', content: '{"mp":1}' },
  { name: `tenant-manifest-s1-mach-${TS}.json`, encoding: 'utf8', content: '{"tm":1}' },
  { name: `cui-boundary-s1-mach-${TS}.json`, encoding: 'utf8', content: '{"cui":1}' },
];
const compileOnApi = vi.fn();
const pushCompiledOnApi = vi.fn();
vi.mock('../apiCompile', async (orig) => ({
  ...(await orig<typeof import('../apiCompile')>()),
  compileOnApi: (...a: unknown[]) => compileOnApi(...a),
  pushCompiledOnApi: (...a: unknown[]) => pushCompiledOnApi(...a),
}));
const downloadBlob = vi.fn();
vi.mock('../policy/downloadBlob', () => ({ downloadBlob: (...a: unknown[]) => downloadBlob(...a) }));

import ApiCompilePanel from '../ApiCompilePanel';

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(signedIn: boolean, onUnauthorized = vi.fn()) {
  await act(async () => {
    root.render(<ApiCompilePanel completedSessionId="sess-1" signedIn={signedIn} onUnauthorized={onUnauthorized} />);
  });
  await flush();
  return onUnauthorized;
}

beforeEach(() => {
  session = SESSION;
  compileOnApi.mockReset();
  pushCompiledOnApi.mockReset();
  downloadBlob.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ApiCompilePanel', () => {
  it('names the tenant and the typed-answer count; compile needs a sign-in', async () => {
    await mount(false);
    expect(q('plan-api-slug')?.textContent).toBe('s1-mach');
    expect(q('plan-api-answers-count')?.textContent).toBe('1');
    expect(q('plan-api-signin-needed')).not.toBeNull();
    expect((q('plan-api-compile-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a live tenant is refused (sim only)', async () => {
    session = { ...SESSION, readiness_manifest: { ...SESSION.readiness_manifest!, tenant_kind: 'live' } };
    await mount(true);
    expect(q('plan-api-sim-only')).not.toBeNull();
    expect((q('plan-api-compile-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('compile → CUI Boundary download → Send to Stamper through muster-api', async () => {
    compileOnApi.mockResolvedValue({ ok: true, data: { tenant_slug: 's1-mach', summary: 'n=3', files: FILES, initial_password_ref: null, recurring_cost_notice: null } });
    pushCompiledOnApi.mockResolvedValue({ ok: true, data: { pushed: ['a.json', 'b.json'] }, sent: ['missionPlan', 'tenantManifest'] });
    await mount(true);
    await act(async () => q('plan-api-compile-btn')!.click());
    await flush();
    expect(compileOnApi).toHaveBeenCalledTimes(1);
    const arg = compileOnApi.mock.calls[0][0] as { slug: string; answers: Array<{ question_id: string }> };
    expect(arg.slug).toBe('s1-mach');
    expect(arg.answers.map((a) => a.question_id)).toEqual(['G-01']);
    expect(q('plan-api-compile-summary')?.textContent).toContain('3 files');

    await act(async () => q('plan-api-download-cui-boundary')!.click());
    expect(downloadBlob).toHaveBeenCalledWith(`cui-boundary-s1-mach-${TS}.json`, expect.any(Blob));
    await act(async () => q('plan-api-download-answers')!.click());
    expect(downloadBlob.mock.calls[1][0]).toBe('interview-answers-s1-mach.json');

    await act(async () => q('plan-api-push-btn')!.click());
    await flush();
    expect(pushCompiledOnApi).toHaveBeenCalledWith(FILES, 's1-mach', undefined);
    expect(q('plan-api-pushed')?.textContent).toBe('a.json, b.json');
  });

  it('a gated push offers the audited override; a 401 drops the sign-in', async () => {
    compileOnApi.mockResolvedValue({ ok: true, data: { tenant_slug: 's1-mach', summary: null, files: FILES, initial_password_ref: null, recurring_cost_notice: null } });
    pushCompiledOnApi.mockResolvedValueOnce({ ok: false, status: 409, message: 'gate', blocking: true, sent: [] });
    const onUnauthorized = await mount(true);
    await act(async () => q('plan-api-compile-btn')!.click());
    await flush();
    await act(async () => q('plan-api-push-btn')!.click());
    await flush();
    expect(q('plan-api-push-override')).not.toBeNull();
    expect(onUnauthorized).toHaveBeenCalledWith(409);

    compileOnApi.mockResolvedValueOnce({ ok: false, status: 401, message: 'sign in' });
    await act(async () => q('plan-api-compile-btn')!.click());
    await flush();
    expect(q('plan-api-compile-error')?.textContent).toContain('sign in');
    expect(onUnauthorized).toHaveBeenLastCalledWith(401);
  });
});
