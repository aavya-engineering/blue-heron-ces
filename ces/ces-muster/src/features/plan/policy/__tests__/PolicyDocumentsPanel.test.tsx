// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-16: the Plan tab's policy panel. Prepare lists the 20 documents with
// their downloads, shows every input's source (ODPs defaulted), marks the set
// as not yet BHD-reviewed, and confirms a personnel draft (the confirmation
// records the PI.PER answer, after which the draft is used).
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import type { PlanCompileResult } from '../../planCompileService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const downloads: string[] = [];
vi.mock('../../reports/downloadText', () => ({
  downloadText: (filename: string) => downloads.push(filename),
}));

const PUBLIC = path.resolve(process.cwd(), 'public');
const realFetch = globalThis.fetch;
const { loadCustomer } = await import('../../__tests__/parityHarness');
const { freezeEntropy } = await import('../../__tests__/fixtureInputs');
const { default: PolicyDocumentsPanel } = await import('../PolicyDocumentsPanel');
const customer = loadCustomer('a');
const SESSION = 'sess-policy-panel';
let compiled: PlanCompileResult;

beforeAll(async () => {
  globalThis.fetch = (async (url: string) => {
    const file = path.join(PUBLIC, decodeURI(String(url)).replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  const s = customer.musterSession;
  await db.engagements.put(s.engagement);
  await db.assessed_parties.put(s.party);
  // The fixture's session without its ISSO answer: the ISSO is drafted from the Security Administrator.
  const facts = (s.session.facts as InterviewFact[]).filter((f) => f.question_id !== 'PI.PER.001');
  await db.interview_sessions.put({ ...s.session, id: SESSION, facts });
  const entropy = freezeEntropy();
  try {
    const { compilePlanForSession } = await import('../../planCompileService');
    compiled = await compilePlanForSession(SESSION);
  } finally {
    entropy.restore();
  }
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe('MG-16: Plan tab policy documents', () => {
  test('prepare, inspect sources, confirm a drafted ISSO, download', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const $ = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    await act(async () => {
      root.render(<PolicyDocumentsPanel result={compiled} sessionId={SESSION} />);
    });
    await act(async () => $('plan-policy-prepare')!.click());
    await waitFor(() => $('plan-policy-list') !== null);

    // W5c2: Planner's 20 + Muster's continuous monitoring plan and acceptable use policy.
    expect($('plan-policy-list')!.querySelectorAll('li')).toHaveLength(22);
    expect($('plan-download-policies-docx-all')!.textContent).toContain('22');
    expect($('plan-policy-bhd-review')!.textContent).toMatch(/BHD has not reviewed/);
    expect($('plan-policy-input-PI.ODP.001')!.textContent).toContain('defaulted');
    expect($('plan-policy-input-PI.ORG.002')!.textContent).toContain('discovered');
    expect($('plan-policy-input-PI.PER.001')!.textContent).toContain('drafted');

    // Confirm the draft: it becomes the session's PI.PER.001 answer and is no longer a draft.
    expect(($('plan-policy-draft-input-PI.PER.001') as HTMLInputElement).value).toContain('secadmin@simtenant-a.onmicrosoft.us');
    await act(async () => $('plan-policy-confirm-PI.PER.001')!.click());
    await waitFor(() => $('plan-policy-draft-PI.PER.001') === null && $('plan-policy-list') !== null);
    const fact = (await db.interview_sessions.get(SESSION))!.facts.find((f) => f.question_id === 'PI.PER.001');
    expect(fact).toMatchObject({ provenance: 'operator_interview' });
    expect(fact!.answer).toContain('secadmin@simtenant-a.onmicrosoft.us');
    expect($('plan-policy-input-PI.PER.001')!.textContent).toContain('answered');

    await act(async () => $('plan-download-policy-md-access-control-policy')!.click());
    expect(downloads.some((f) => f.startsWith('access-control-policy-simtenant-a-') && f.endsWith('.md'))).toBe(true);
    act(() => root.unmount());
    container.remove();
  });
});
