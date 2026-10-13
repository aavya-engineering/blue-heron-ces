// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PL-1 C1 — integration proof that the vendored deriveActionStatuses
// cascade output reaches the score a USER SEES. ResultScreen is the user-visible
// surface: it renders scoreFacts(...) — which runs the 6-step cascade over the
// real knowledge YAML — into data-testid="conservative-score". We load the real
// patterns/playbook via readFileSync (fetch is unavailable in Node; same seam
// cascadeParity.test.ts and exportWiring.test.ts use) so the cascade itself is
// real, then assert the rendered score/counts equal a direct scoreFacts call.
import 'fake-indexeddb/auto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImplementationPatterns, VendorPlaybook } from '@/vendored/ces-spine/types/domain';

const patterns = load(
  readFileSync(resolve('public/knowledge/domain Implementation Patterns.yaml'), 'utf-8')
) as ImplementationPatterns;
const playbook = load(
  readFileSync(resolve('public/knowledge/vendor playbook Microsoft 365.yaml'), 'utf-8')
) as VendorPlaybook;

// Feed the cascade the REAL knowledge, via the loader seam (no fetch in Node).
vi.mock('@/features/scoring/knowledgeLoader', () => ({
  loadKnowledge: async () => ({ patterns, playbook }),
  _resetKnowledgeCache: () => {},
}));

import ResultScreen from '../ResultScreen';
import { scoreFacts } from '../scoringService';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { db } from '@/shared/db/schema';

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

async function waitFor(cond: () => boolean, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe('C1 — the cascade-derived score is the one ResultScreen shows the user', () => {
  test('rendered conservative-score + requirement count equal the cascade output', async () => {
    // A session with selected stacks but no interview facts: the entire posture
    // the user sees is produced by the cascade, so a match proves cascade→screen.
    const stacks = ['m365_e5_gcc', 'microsoft_intune', 'microsoft_sentinel'];
    await db.engagements.add({
      id: 'eng-c1',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-c1',
      engagement_id: 'eng-c1',
      name: 'Cascade Corp',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-c1',
      party_id: 'party-c1',
      facts: [],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
      selected_stacks: stacks,
    });

    // Independent cascade computation for the same inputs.
    const graph = await loadQuestionGraph(stacks);
    const expected = await scoreFacts([], graph, stacks);
    // Guard: these stacks actually exercise the cascade (non-empty posture).
    expect(expected.posture.ces.requirement_results.length).toBeGreaterThan(0);

    await act(async () => {
      root.render(<ResultScreen sessionId="sess-c1" onExport={() => {}} />);
    });
    await waitFor(
      () => container.querySelector('[data-testid="conservative-score"]') !== null
    );

    const scoreEl = container.querySelector('[data-testid="conservative-score"]')!;
    expect(scoreEl.textContent).toBe(`${expected.conservativeScore}% compliant`);
    // The requirement count the user reads is the cascade posture's own count.
    expect(container.textContent).toContain(
      `based on ${expected.posture.ces.requirement_results.length} requirements`
    );
  });
});
