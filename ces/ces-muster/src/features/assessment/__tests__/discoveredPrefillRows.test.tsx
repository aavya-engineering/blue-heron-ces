// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-13 / MG-14 hand-off (c) and MG-25 hand-off: a plan-input node a harvest
// pre-fill answers is shown as an editable row (not pruned), with the
// provenance badge and the derived-value tooltip beside it; editing it makes
// the operator's value the answer. Readiness pre-fills stay pruned (MG-07).
// Also covers MG-16's Policy Inputs tab (the /organization address pre-fill).
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import AssessmentPage from '../AssessmentPage';
import { createSession } from '@/driver/sessionDriver';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import { withDiscoveredPlanInputs } from '../assessmentHelpers';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

function typeAndBlur(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

const q = (sel: string) => container.querySelector(sel) as HTMLInputElement | null;
const harvested = (question_id: string, answer: string, read: string): InterviewFact => ({
  question_id,
  question_text: question_id,
  answer,
  provenance: 'auto_detected',
  confidence: 'high',
  recorded_at: '2026-01-15T00:00:00.000Z',
  source: `graph:${read}`,
});

async function openTab(cluster: string): Promise<void> {
  await waitFor(() => container.querySelector(`[data-testid="tab-${cluster}"]`) !== null);
  const tab = container.querySelector(`[data-testid="tab-${cluster}"]`) as HTMLButtonElement;
  await waitFor(() => !tab.disabled);
  await act(async () => tab.click());
}

describe('hand-off (c): discovered plan-input pre-fills are editable rows', () => {
  test('helper: only auto_detected plan-input nodes come back, in graph order', () => {
    const graph = QUESTION_GRAPH.filter((n) => ['TCP.TI.002', 'TCP.TI.005', 'RR-ACT-001', 'PI.ORG.002'].includes(n.id) || n.id === 'G-05');
    const visible = graph.filter((n) => n.id === 'G-05');
    const out = withDiscoveredPlanInputs(visible, graph, {
      'TCP.TI.002': 'auto_detected',
      'TCP.TI.005': 'operator_interview',
      'PI.ORG.002': 'auto_detected',
    });
    expect(out.map((n) => n.id)).toEqual(graph.filter((n) => ['G-05', 'TCP.TI.002', 'PI.ORG.002'].includes(n.id)).map((n) => n.id));
    expect(withDiscoveredPlanInputs(visible, graph, {})).toBe(visible);
  });

  test('a harvested TCP value and the /organization address show with their value, badge and tooltip; an edit wins', async () => {
    const handle = await createSession('individual_contractor', {
      stacks: ['m365_e5_gcc'],
      party: { name: 'Prefill Rows Co', on_prem_ot: 'no' },
    });
    await db.interview_sessions.update(handle.sessionId, {
      facts: [
        harvested('TCP.TI.002', 'prefill-rows.onmicrosoft.us', 'organization'),
        harvested('PI.ORG.002', '1 Synthetic Way', 'organization'),
      ],
    });
    await act(async () => {
      root.render(<AssessmentPage existingSessionId={handle.sessionId} onEngagementReady={() => {}} onComplete={() => {}} />);
    });

    await openTab('plan-input:tcp');
    await waitFor(() => q('[data-testid="plan-input-TCP.TI.002"]') !== null);
    expect(q('[data-testid="plan-input-TCP.TI.002"]')!.value).toBe('prefill-rows.onmicrosoft.us');
    expect(container.querySelector('[data-testid="harvest-badge-TCP.TI.002"]')).not.toBeNull();
    const help = container.querySelector('[data-testid="derived-help-TCP.TI.002"]');
    expect(help).not.toBeNull();
    expect(help!.getAttribute('data-kind')).toBe('tcp');
    expect(container.querySelector('[data-testid="derived-help-tip-TCP.TI.002-value"]')?.textContent).toContain(
      'prefill-rows.onmicrosoft.us'
    );

    await openTab('plan-input:policy');
    await waitFor(() => q('[data-testid="plan-input-PI.ORG.002"]') !== null);
    expect(q('[data-testid="plan-input-PI.ORG.002"]')!.value).toBe('1 Synthetic Way');
    await act(async () => typeAndBlur(q('[data-testid="plan-input-PI.ORG.002"]')!, '2 Synthetic Way'));
    await waitFor(() => false, 10);
    const f = (await db.interview_sessions.get(handle.sessionId))!.facts.find((x) => x.question_id === 'PI.ORG.002');
    expect(f).toMatchObject({ answer: '2 Synthetic Way', provenance: 'operator_interview' });
  });
});
