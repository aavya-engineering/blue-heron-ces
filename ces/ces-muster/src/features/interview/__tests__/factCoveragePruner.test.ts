// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Unit: factCoveragePruner.pruneByCoverage — coverage removal + unknown-never-prunes.
import { describe, test, expect } from 'vitest';
import { pruneByCoverage } from '../factCoveragePruner';
import { QUESTION_GRAPH } from '../questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';

function fact(overrides: Partial<InterviewFact>): InterviewFact {
  return {
    question_id: 'RR-ACT-AC_L1_3_1_1',
    question_text: 'q',
    answer: 'yes',
    provenance: 'auto_detected',
    confidence: 'high',
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('factCoveragePruner.pruneByCoverage', () => {
  test('removes a node whose question_id is covered by a non-unknown fact', () => {
    const nodes = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2');
    const facts = [fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'high' })];
    const result = pruneByCoverage(nodes, facts);
    expect(result.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_2']);
  });

  test('unknown-confidence fact never prunes its question', () => {
    const nodes = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2');
    const facts = [fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'unknown', answer: 'unsure' })];
    const result = pruneByCoverage(nodes, facts);
    expect(result.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_1', 'RR-ACT-AC_L1_3_1_2']);
  });

  // 2026-07-11 (ADAPTIVE_VERIFY divergence #1 resolution): this assertion
  // used to be titled "low/medium confidence facts still prune (any
  // non-unknown confidence is coverage)" and encoded the OLD binary
  // semantics. Under single-fact-per-question tiering the outcome for a
  // single low/medium fact is unchanged (it is still the top — and only —
  // rank for its question), so the assertions below still hold, but the
  // title/comment is updated to describe the tiered rule they now exercise:
  // a lone non-unknown fact of ANY rank is, by definition, the top rank for
  // its question and therefore governs coverage.
  test('a lone low/medium confidence fact is the top rank for its question and prunes', () => {
    const nodes = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2');
    const lowResult = pruneByCoverage(nodes, [fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'low' })]);
    expect(lowResult.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_2']);

    const medResult = pruneByCoverage(nodes, [fact({ question_id: 'RR-ACT-AC_L1_3_1_2', confidence: 'medium' })]);
    expect(medResult.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_1']);
  });

  test('a mix of unknown and non-unknown facts prunes only the non-unknown-covered node', () => {
    const nodes = QUESTION_GRAPH.filter(
      (n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2' || n.id === 'RR-ACT-AC_L1_3_1_20'
    );
    const facts = [
      fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'high' }),
      fact({ question_id: 'RR-ACT-AC_L1_3_1_2', confidence: 'unknown', answer: 'unsure' }),
    ];
    const result = pruneByCoverage(nodes, facts);
    expect(result.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_2', 'RR-ACT-AC_L1_3_1_20']);
  });

  // New coverage for the tiered semantics (ADAPTIVE_VERIFY divergence #1 fix).
  test('when two facts conflict on the same question, the higher-ranked fact governs and the question is pruned', () => {
    const nodes = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2');
    const facts = [
      fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'low', answer: 'no' }),
      fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'high', answer: 'yes' }),
    ];
    const result = pruneByCoverage(nodes, facts);
    expect(result.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_2']);
  });

  test('a strictly lower-ranked conflicting fact never independently prunes beyond what the top rank already covers', () => {
    const nodes = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-AC_L1_3_1_1' || n.id === 'RR-ACT-AC_L1_3_1_2');
    // iam-002 only has a low-ranked fact; iam-001 has both low and high.
    // Both are still pruned (low is top rank for iam-002 on its own), but
    // the point under test is that iam-001's pruning is driven by the HIGH
    // fact, not the conflicting LOW one — verified via confidenceRank-equal
    // single-fact case above; here we assert the mixed-question case does
    // not over- or under-prune relative to the per-question top rank.
    const facts = [
      fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'low', answer: 'no' }),
      fact({ question_id: 'RR-ACT-AC_L1_3_1_1', confidence: 'high', answer: 'yes' }),
      fact({ question_id: 'RR-ACT-AC_L1_3_1_2', confidence: 'low', answer: 'no' }),
    ];
    const result = pruneByCoverage(nodes, facts);
    // MG-02: the second node's only fact is a discovery (auto_detected) 'no' — a
    // not_met verdict, which never prunes a readiness question; the first node
    // is still pruned by its top-rank 'yes'.
    expect(result.map((n) => n.id)).toEqual(['RR-ACT-AC_L1_3_1_2']);
  });
});
