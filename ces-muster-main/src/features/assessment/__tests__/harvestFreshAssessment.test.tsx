// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-06 (2026-09-27): a Graph-harvest prefill belongs to ONE assessment.
// Before this fix the mount-time prefill read 'muster-harvest-facts' and never
// cleared it (the discovery handoff beside it did), so an assessment started
// later silently re-applied the earlier assessment's AUTO-DETECTED answers.
//
// Driven through production code end to end: the real runSimHarvest client
// (muster-api HTTP stubbed at fetch — no live path), the real storeHarvestFacts
// writer, and the real AssessmentPage mount/begin/answer path over real Dexie
// (fake-indexeddb). Same react-dom/client idiom as partyIdAndProfile.test.tsx.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { runSimHarvest } from '../harvestRunService';
import { loadHarvestFacts } from '../assessmentHelpers';
import { db } from '@/shared/db/schema';

let container: HTMLDivElement;
let root: Root;

/** The sim harvest response muster-api returns (shape from harvestService PROBES). */
const SIM_HARVEST = {
  facts: [
    { question_id: 'iam-001', answer: 'yes', provenance: 'auto_detected', confidence: 'high', captured_at: '2026-09-27T00:00:00.000Z', source: 'graph:conditionalAccess' },
    { question_id: 'iam-004', answer: 'yes', provenance: 'auto_detected', confidence: 'high', captured_at: '2026-09-27T00:00:00.000Z', source: 'graph:conditionalAccess' },
    { question_id: 'ep-001', answer: 'yes', provenance: 'auto_detected', confidence: 'high', captured_at: '2026-09-27T00:00:00.000Z', source: 'graph:intuneDevices' },
  ],
};
const HARVESTED_IDS = SIM_HARVEST.facts.map((f) => f.question_id);

beforeEach(async () => {
  localStorage.clear();
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(SIM_HARVEST), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  );
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

async function waitFor(cond: () => boolean, tries = 80): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

function setInputValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Mount a FRESH assessment (no existing session), fill the profile, Begin.
 * Returns the new session id (read back from Dexie). */
async function startAssessment(org: string, key: string): Promise<string> {
  const before = new Set((await db.interview_sessions.toArray()).map((s) => s.id));
  await act(async () => {
    root.render(<AssessmentPage key={key} onEngagementReady={() => {}} onComplete={() => {}} />);
  });
  await waitFor(() => container.querySelector('input[placeholder="Acme Defense LLC"]') !== null);
  await act(async () => {
    setInputValue(container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement, org);
    (container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement).click();
  });
  await act(async () => (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click());
  let id = '';
  for (let i = 0; i < 60 && !id; i++) {
    const s = (await db.interview_sessions.toArray()).find((x) => !before.has(x.id));
    if (s) id = s.id;
    else await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  expect(id).not.toBe('');
  return id;
}

/** A cluster tab's question total (the "done/total" count on the tab rail). */
function tabTotal(cluster: string): number {
  const txt = container.querySelector(`[data-testid="tab-${cluster}"] .tab-count`)?.textContent ?? '';
  const m = /\d+\/(\d+)/.exec(txt);
  expect(m, `tab-${cluster} count`).not.toBeNull();
  return Number(m![1]);
}

/** Radio groups rendered for the active cluster (question ids on screen). */
function visibleQuestionIds(): string[] {
  return [...new Set([...container.querySelectorAll('.question-card input[type="radio"]')].map((e) => (e as HTMLInputElement).name))];
}

describe('MU-06 — harvested facts do not leak into a fresh assessment', () => {
  test("assessment 1 harvests; assessment 2 (fresh) sees none of assessment 1's harvest", async () => {
    // ── Assessment 1: harvest (real client + real store writer), then the interview mounts.
    const outcome = await runSimHarvest();
    expect(outcome).toEqual({ ok: true, stored: 3 });
    expect(loadHarvestFacts().map((f) => f.question_id)).toEqual(HARVESTED_IDS);

    await startAssessment('First Assessed Co', 'a1');
    // The harvest reached assessment 1: its AUTO-DETECTED answers cover (and so
    // prune) iam-001 / iam-004 / ep-001 — Identity shows 3 of its 5 questions.
    // (Proves the prefill path is live, so the negative below is not vacuous.)
    expect(tabTotal('identity')).toBe(3);
    expect(visibleQuestionIds()).not.toContain('iam-001');

    // ── Assessment 2: a new, fresh assessment (App keys a fresh page per session).
    act(() => root.unmount());
    root = createRoot(container);
    await startAssessment('Second Assessed Co', 'a2');

    // No assessment-1 harvest fact is visible: the harvested questions are back,
    // unanswered, with no AUTO-DETECTED badge, and the handoff store is empty.
    expect(tabTotal('identity')).toBe(5);
    const shown = visibleQuestionIds();
    expect(shown).toEqual(expect.arrayContaining(['iam-001', 'iam-004']));
    for (const id of ['iam-001', 'iam-004']) {
      expect((container.querySelector(`input[name="${id}"]:checked`) as HTMLInputElement | null), `${id} unanswered`).toBeNull();
    }
    expect(container.querySelector('[data-testid^="harvest-badge-"]')).toBeNull();
    expect(loadHarvestFacts()).toEqual([]);
    expect(localStorage.getItem('muster-harvest-facts')).toBeNull();
  });
});
