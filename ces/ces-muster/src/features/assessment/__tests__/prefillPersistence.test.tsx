// @vitest-environment jsdom
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-3 step 1 (P1, docs/backlog/REQ-muster-prefill-fact-persistence.md):
// an answer that came from a Graph harvest or a discovery run HIDES its
// question (pruneByCoverage). Before this fix the two session writes
// (recordAnswer, finishInterview) built facts from the PRUNED question list,
// so the prefilled answer was dropped from session.facts and never counted
// toward readiness. These tests drive the real AssessmentPage over real Dexie
// (fake-indexeddb) and the real readiness exporter.
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { storeHarvestFacts, storeDiscoveryFacts, type HarvestFact } from '../assessmentHelpers';
import { buildReadinessResult, executeReadinessExport } from '@/features/export/readinessResultService';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { computeSessionPosture } from '@/features/plan/sessionPosture';
import { loadCompilerBanks } from '@/features/plan/compilerBanks';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';

// RED-3: these tests do real rendering and a real readiness export (about 2 s
// alone, near 5 s under full-suite load), so they get an explicit budget.
vi.setConfig({ testTimeout: 30_000 });

// MG-03: the readiness export scores the session's one posture over the compiler banks.
vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('@/features/plan/__tests__/planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

let container: HTMLDivElement;
let root: Root;

const HARVEST: HarvestFact[] = [
  // The tenant does NOT enforce MFA: an auto-detected gap.
  { question_id: 'iam-001', answer: 'no', provenance: 'auto_detected', confidence: 'high', source: 'graph:conditionalAccess' },
  { question_id: 'iam-004', answer: 'yes', provenance: 'auto_detected', confidence: 'high', source: 'graph:conditionalAccess' },
  { question_id: 'ep-001', answer: 'yes', provenance: 'auto_detected', confidence: 'high', source: 'graph:intuneDevices' },
];
const PREFILLED = HARVEST.map((f) => f.question_id);

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(db.tables.map((t) => t.clear()));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

async function waitFor(cond: () => boolean | Promise<boolean>, what: string, tries = 2000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`waitFor timed out: ${what}`);
}

/** Wait until the session's saved facts record `questionId` answered `answer`. */
async function waitForFact(sessionId: string, questionId: string, answer: string): Promise<void> {
  await waitFor(
    async () => (await sessionFacts(sessionId)).some((f) => f.question_id === questionId && f.answer === answer),
    `${questionId}=${answer} saved`
  );
}

function setInputValue(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function startAssessment(org: string): Promise<string> {
  await act(async () => {
    root.render(<AssessmentPage onEngagementReady={() => {}} onComplete={() => {}} />);
  });
  await waitFor(() => container.querySelector('input[placeholder="Acme Defense LLC"]') !== null, 'organisation input');
  await act(async () => {
    setInputValue(container.querySelector('input[placeholder="Acme Defense LLC"]') as HTMLInputElement, org);
    setInputValue(container.querySelector('[data-testid="rm-operator-name"]') as HTMLInputElement, 'Test Operator');
    (container.querySelector('input[name="on_prem_ot"][value="no"]') as HTMLInputElement).click();
  });
  // Declare Intune so every prefilled question (ep-001 is Intune-scoped) is applicable.
  await toggleService('Microsoft Intune');
  await act(async () => (container.querySelector('[data-testid="begin-interview"]') as HTMLButtonElement).click());
  let id = '';
  await waitFor(async () => {
    id = (await db.interview_sessions.toArray())[0]?.id ?? '';
    return id !== '';
  }, 'session created');
  return id;
}

async function toggleService(label: string): Promise<void> {
  await act(async () => (container.querySelector('[data-testid="tab-profile"]') as HTMLElement | null)?.click());
  const box = [...container.querySelectorAll('label.check-option')].find((l) => l.textContent?.trim() === label)?.querySelector('input') as
    | HTMLInputElement
    | undefined;
  expect(box, `service checkbox ${label}`).toBeDefined();
  await act(async () => box!.click());
}

function clusterTabs(): string[] {
  return [...container.querySelectorAll('[data-testid^="tab-"]')]
    .map((e) => (e.getAttribute('data-testid') ?? '').slice(4))
    .filter((c) => c !== 'profile');
}

/** Answer one visible radio question; returns its id. */
async function answerOne(cluster: string, value: string): Promise<string> {
  await act(async () => (container.querySelector(`[data-testid="tab-${cluster}"]`) as HTMLElement).click());
  const input = container.querySelector(`.question-card input[type="radio"][value="${value}"]`) as HTMLInputElement;
  expect(input, `a ${value} radio on ${cluster}`).not.toBeNull();
  // FIN-32 (DATA-QUESTION-ID-REQUIREMENT.md): the card carries the question's bank id, the
  // typed run's selector, and the operator's answer is marked as theirs.
  const card = input.closest('.question-card') as HTMLElement;
  expect(card.getAttribute('data-question-id')).toBe(input.name);
  await act(async () => input.click());
  expect((container.querySelector(`[data-question-id="${input.name}"]`) as HTMLElement).getAttribute('data-provenance')).toBe('operator_interview');
  return input.name;
}

/** Answer every visible, unanswered radio question on every tab with `value`. */
async function answerAllVisible(value: string): Promise<void> {
  for (const cluster of clusterTabs()) {
    await act(async () => (container.querySelector(`[data-testid="tab-${cluster}"]`) as HTMLElement).click());
    const names = [...new Set([...container.querySelectorAll('.question-card input[type="radio"]')].map((e) => (e as HTMLInputElement).name))];
    for (const name of names) {
      if (container.querySelector(`input[name="${name}"]:checked`)) continue;
      const opt =
        (container.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement | null) ??
        (container.querySelector(`input[name="${name}"]`) as HTMLInputElement);
      await act(async () => opt.click());
    }
  }
}

async function sessionFacts(id: string): Promise<InterviewFact[]> {
  return (await db.interview_sessions.get(id))!.facts;
}

async function assertPrefillPersistedThroughFinish(sessionId: string, expectedSource: boolean): Promise<void> {
  // The prefill hid its questions (the prefill path is live, so the checks below are not vacuous).
  await act(async () => (container.querySelector('[data-testid="tab-identity"]') as HTMLElement).click());
  const shown = [...container.querySelectorAll('.question-card input[type="radio"]')].map((e) => (e as HTMLInputElement).name);
  expect(shown).not.toContain('iam-001');

  // 1. Answer ONE question: the write already carries every prefilled fact.
  const answered = await answerOne('identity', 'yes');
  await waitForFact(sessionId, answered, 'yes');
  let facts = await sessionFacts(sessionId);
  expect(facts.find((f) => f.question_id === answered)?.provenance).toBe('operator_interview');
  for (const id of PREFILLED) {
    const f = facts.find((x) => x.question_id === id);
    expect(f, `${id} persisted after one answer`).toBeDefined();
    expect(f!.provenance).toBe('auto_detected');
    expect(f!.confidence).toBe('high');
    if (expectedSource) expect(f!.source).toBe(HARVEST.find((h) => h.question_id === id)!.source);
  }

  // 2. Finish: answer the rest "yes", click Finish.
  await answerAllVisible('yes');
  await waitFor(() => !(container.querySelector('[data-testid="finish-interview"]') as HTMLButtonElement).disabled, 'finish enabled');
  await act(async () => (container.querySelector('[data-testid="finish-interview"]') as HTMLButtonElement).click());
  await waitFor(async () => (await db.interview_sessions.get(sessionId))?.status === 'complete', 'session complete');
  const session = (await db.interview_sessions.get(sessionId))!;
  expect(session.status).toBe('complete');
  facts = session.facts;
  for (const id of PREFILLED) {
    expect(facts.find((x) => x.question_id === id)?.provenance, `${id} persisted at finish`).toBe('auto_detected');
  }

  // 3. Readiness counts them (same production builder both ways). Every other
  //    answer is "yes", so iam-001's auto-detected "no" is the only gap on its
  //    requirements. Before the fix that fact was never saved: its
  //    requirements were not assessed at all and the SPRS came out HIGHER.
  const exported = await executeReadinessExport(sessionId);
  expect(exported.facts?.filter((f) => f.provenance === 'auto_detected').map((f) => f.question_id).sort()).toEqual([...PREFILLED].sort());
  const party = (await db.assessed_parties.get(session.party_id))!;
  const engagement = (await db.engagements.get(party.engagement_id))!;
  const graph = await loadQuestionGraph(session.selected_stacks ?? []);
  // MG-03: the same one-posture builder, over the session without the prefills.
  const withoutSession = { ...session, facts: facts.filter((f) => !PREFILLED.includes(f.question_id)) };
  const { posture: withoutPosture } = await computeSessionPosture(withoutSession, engagement, graph, await loadCompilerBanks());
  const without = buildReadinessResult(engagement, party, withoutSession, withoutPosture);
  const deducted = exported.derived.sprs_now.deductions.map((d) => d.requirement_id);
  expect(deducted).toEqual(expect.arrayContaining(['AC.L2-3.1.13', 'IA.L2-3.5.3']));
  // MG-03: the one posture covers every cascade requirement, so the prefill
  // shows as a status change, not as a newly assessed requirement: without the
  // saved "no", IA.L2-3.5.3 is only the cascade's partial.
  const st = (r: typeof exported, id: string) => r.derived.requirement_results?.find((x) => x.requirement_id === id)?.status;
  expect(st(exported, 'IA.L2-3.5.3')).toBe('not_met');
  expect(st(without, 'IA.L2-3.5.3')).not.toBe('not_met');
  expect(exported.derived.sprs_now.sprs).toBeLessThanOrEqual(without.derived.sprs_now.sprs);
  if (process.env.FC_MU3_PRINT) {
    console.log('AFTER sprs', exported.derived.sprs_now.sprs, 'assessed', exported.derived.sprs_now.assessed_count,
      '| BEFORE sprs', without.derived.sprs_now.sprs, 'assessed', without.derived.sprs_now.assessed_count);
  }
}

describe('FC-MU-3 step 1 — prefilled answers are saved and count toward readiness', () => {
  test('harvest prefill: pruned answers persist (with source) and score', async () => {
    storeHarvestFacts(HARVEST);
    const id = await startAssessment('Harvest Prefill Co');
    await assertPrefillPersistedThroughFinish(id, true);
  });

  test('harvest prefill: the source survives a resume and the next write', async () => {
    storeHarvestFacts(HARVEST);
    const id = await startAssessment('Resume Source Co');
    const first = await answerOne('identity', 'yes');
    await waitForFact(id, first, 'yes');
    // Reload: a fresh page resumes the saved session, then the operator answers again.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<AssessmentPage existingSessionId={id} onEngagementReady={() => {}} onComplete={() => {}} />);
    });
    await waitFor(() => container.querySelector('[data-testid="tab-identity"]') !== null, 'resumed identity tab');
    const second = await answerOne('identity', 'no');
    await waitForFact(id, second, 'no');
    const facts = await sessionFacts(id);
    for (const h of HARVEST) {
      const f = facts.find((x) => x.question_id === h.question_id);
      expect(f?.provenance, h.question_id).toBe('auto_detected');
      expect(f?.source, `${h.question_id} source after resume`).toBe(h.source);
    }
  });

  test('discovery prefill: pruned answers persist and score', async () => {
    storeDiscoveryFacts(
      HARVEST.map((h) => ({
        question_id: h.question_id,
        question_text: h.question_id,
        answer: h.answer,
        provenance: 'auto_detected',
        confidence: 'high',
        recorded_at: '2026-09-28T00:00:00.000Z',
      }))
    );
    const id = await startAssessment('Discovery Prefill Co');
    await assertPrefillPersistedThroughFinish(id, false);
  });

  test('a service change still drops answers to questions it hides (unchanged contract)', async () => {
    // Persistence uses the STACK-FILTERED graph, not the whole graph: an
    // answer to an Intune-gated question is dropped once Intune is removed.
    // MG-07: the RR activities carry no stack gate; the retired ep-001 id
    // (Intune-gated, written by the harvest probe) still does, so the
    // contract is exercised through a harvested ep-001 answer.
    storeHarvestFacts([HARVEST[2]]);
    const id = await startAssessment('Stack Filter Co');
    const first = await answerOne('identity', 'yes');
    await waitForFact(id, first, 'yes');
    expect((await sessionFacts(id)).map((f) => f.question_id)).toContain('ep-001');
    await toggleService('Microsoft Intune'); // un-declare Intune
    const second = await answerOne('identity', 'no');
    await waitForFact(id, second, 'no');
    const ids = (await sessionFacts(id)).map((f) => f.question_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('ep-001');
  });
});
