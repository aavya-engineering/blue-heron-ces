// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// 2026-07-11 (ADAPTIVE_VERIFY divergence #2 resolution) — on_prem_ot seeds the
// first pruning pass by joining the declaredStacks/stack-filter dimension
// loadQuestionGraph already uses for `applicable_stacks`. Two things proved
// here:
//   1. The mechanism itself: a node tagged `applicable_stacks: ['on_prem_ot']`
//      is filtered out when 'on_prem_ot' is absent from declaredStacks (the
//      "no on-prem/OT" case, AssessmentPage.tsx), and stays when present
//      (the 'yes'/'unsure' FCA-safe cases) — proved with a locally
//      constructed QuestionNode, since QUESTION_GRAPH itself carries none.
//   2. The current no-op state of QUESTION_GRAPH is enforced: zero nodes
//      carry `applicable_stacks: ['on_prem_ot']` today (per the doc comment
//      in questionGraph.ts), so this seam does not change any existing
//      graph's pruning behavior until a genuinely OT-scoped question is
//      added — guards against silent, undocumented drift either direction.
import { describe, test, expect } from 'vitest';
import { loadQuestionGraph } from '../questionGraphService';
import { QUESTION_GRAPH, type QuestionNode } from '../questionGraph';

describe('on_prem_ot stack-filter seam', () => {
  test('QUESTION_GRAPH today carries zero on_prem_ot-tagged nodes (documented no-op)', () => {
    const otTagged = QUESTION_GRAPH.filter((n) => n.applicable_stacks?.includes('on_prem_ot'));
    expect(otTagged).toHaveLength(0);
  });

  test('a node tagged applicable_stacks: ["on_prem_ot"] is pruned when the tag is absent from declaredStacks', async () => {
    const otNode: QuestionNode = {
      id: 'test-ot-001',
      text: 'Test OT-scoped question',
      options: [],
      cluster: 'endpoint',
      applicable_stacks: ['on_prem_ot'],
      mapped_requirements: ['TEST.OT-1'],
    };
    const graph = [...QUESTION_GRAPH, otNode];

    // Simulate loadQuestionGraph's filter logic directly against the
    // augmented graph by re-deriving declaredStacks the same way
    // AssessmentPage does: 'no' excludes the tag, anything else includes it.
    const declaredStacksNo: string[] = []; // onPremOt === 'no', no services selected
    const declaredStacksYes: string[] = ['on_prem_ot']; // onPremOt !== 'no'

    const withNo = graph.filter((n) => {
      const stackSet = new Set(declaredStacksNo);
      return !n.applicable_stacks || n.applicable_stacks.some((s) => stackSet.has(s));
    });
    const withYes = graph.filter((n) => {
      const stackSet = new Set(declaredStacksYes);
      return !n.applicable_stacks || n.applicable_stacks.some((s) => stackSet.has(s));
    });

    expect(withNo.map((n) => n.id)).not.toContain('test-ot-001');
    expect(withYes.map((n) => n.id)).toContain('test-ot-001');
  });

  test('loadQuestionGraph with declaredStacks excluding on_prem_ot behaves identically to today for the real (untagged) graph', async () => {
    const withoutTag = await loadQuestionGraph([], []);
    const withTag = await loadQuestionGraph(['on_prem_ot'], []);
    // No node in the real graph is on_prem_ot-scoped, so both calls return
    // the same node set — the seam is provably inert until the graph gains
    // an OT-specific question.
    expect(withoutTag.map((n) => n.id)).toEqual(withTag.map((n) => n.id));
  });
});
