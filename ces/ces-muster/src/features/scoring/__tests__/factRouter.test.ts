// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Unit + integration tests for factRouter — T2 slice.
// Covers DONE-WHEN #4 (routing rules) and #5 (conservative merge) verbatim.
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { routeFacts, classOf, mergeExplanation } from '../factRouter';
import type { InterviewFact } from '@/shared/types/engagement';
import type { QuestionNode } from '@/features/interview/questionGraphService';

// Mock knowledgeLoader for integration test — same pattern as sprsCalc.test.ts.
// Replaces browser fetch with readFileSync so scoreFacts runs in Node.
vi.mock('@/features/scoring/knowledgeLoader', async () => {
  const { readFileSync: rfs } = await import('fs');
  const { resolve: res } = await import('path');
  const { load } = await import('js-yaml');
  return {
    loadKnowledge: async () => ({
      patterns: load(rfs(res('public/knowledge/domain Implementation Patterns.yaml'), 'utf-8')),
      playbook: load(rfs(res('public/knowledge/vendor playbook Microsoft 365.yaml'), 'utf-8')),
    }),
    _resetKnowledgeCache: () => {},
  };
});

// ── Test helper ───────────────────────────────────────────────────────────────

function makeFact(
  question_id: string,
  answer: string,
  provenance: string,
  recorded_at?: string,
  confidence: InterviewFact['confidence'] = 'high'
): InterviewFact {
  return {
    question_id,
    question_text: `Question ${question_id}`,
    answer,
    provenance,
    confidence,
    recorded_at: recorded_at ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── classOf helper ────────────────────────────────────────────────────────────

describe('classOf', () => {
  test('auto_detected maps to A', () => expect(classOf('auto_detected')).toBe('A'));
  test('captured maps to C', () => expect(classOf('captured')).toBe('C'));
  test('operator_interview maps to B', () => expect(classOf('operator_interview')).toBe('B'));
  test('ai_adaptive maps to B', () => expect(classOf('ai_adaptive')).toBe('B'));
  test('unrecognised provenance falls through to B', () => expect(classOf('anything_else')).toBe('B'));
});

// ── Precedence rules (DONE-WHEN #4) ──────────────────────────────────────────

describe('routeFacts — precedence (DONE-WHEN #4)', () => {
  test('A fact outranks C outranks B for the same objective', () => {
    const facts = [
      makeFact('q1', 'yes', 'operator_interview'),
      makeFact('q1', 'yes', 'captured'),
      makeFact('q1', 'yes', 'auto_detected'),
    ];
    const result = routeFacts(facts);
    expect(result).toHaveLength(1);
    expect(result[0].provenance).toBe('auto_detected');
  });

  test('C outranks B when A is absent', () => {
    const facts = [
      makeFact('q1', 'yes', 'operator_interview'),
      makeFact('q1', 'yes', 'captured'),
    ];
    const result = routeFacts(facts);
    expect(result).toHaveLength(1);
    expect(result[0].provenance).toBe('captured');
  });

  test('absence at A falls through — only-C group uses C (DONE-WHEN #4)', () => {
    const facts = [makeFact('q1', 'no', 'captured')];
    const result = routeFacts(facts);
    expect(result).toHaveLength(1);
    expect(result[0].provenance).toBe('captured');
  });

  test('absence at A and C falls through — only-B group uses B (DONE-WHEN #4)', () => {
    const facts = [makeFact('q1', 'yes', 'operator_interview')];
    const result = routeFacts(facts);
    expect(result).toHaveLength(1);
    expect(result[0].provenance).toBe('operator_interview');
  });

  test('objective with only unknowns never passes — winner stays unknown (DONE-WHEN #4)', () => {
    const facts = [
      makeFact('q1', 'unknown', 'operator_interview'),
      makeFact('q1', 'unknown', 'captured'),
    ];
    const result = routeFacts(facts);
    expect(result).toHaveLength(1);
    expect(result[0].answer).toBe('unknown');
  });
});

// ── Conservative merge rules (DONE-WHEN #5) ──────────────────────────────────

describe('routeFacts — conservative merge rules (DONE-WHEN #5)', () => {
  test('low-confidence B yes CANNOT upgrade objective that C captured as no (C no wins)', () => {
    const facts = [
      makeFact('q1', 'yes', 'operator_interview', undefined, 'low'),
      makeFact('q1', 'no', 'captured'),
    ];
    const result = routeFacts(facts);
    expect(result[0].provenance).toBe('captured');
    expect(result[0].answer).toBe('no');
  });

  test('B yes cannot upgrade A no (A no wins)', () => {
    const facts = [
      makeFact('q1', 'yes', 'operator_interview'),
      makeFact('q1', 'no', 'auto_detected'),
    ];
    const result = routeFacts(facts);
    expect(result[0].provenance).toBe('auto_detected');
    expect(result[0].answer).toBe('no');
  });

  test(
    'A yes DOES beat C no — higher class wins ' +
      '[validate with BHD: machine-harvested current state outranks captured point-in-time evidence]',
    () => {
      const facts = [
        makeFact('q1', 'yes', 'auto_detected'),
        makeFact('q1', 'no', 'captured'),
      ];
      const result = routeFacts(facts);
      expect(result[0].provenance).toBe('auto_detected');
      expect(result[0].answer).toBe('yes');
    }
  );

  test('within-class conservatism: two A facts yes+no → no wins regardless of recency', () => {
    const facts = [
      makeFact('q1', 'no', 'auto_detected', '2026-01-01T00:00:00.000Z'),   // earlier
      makeFact('q1', 'yes', 'auto_detected', '2026-01-02T00:00:00.000Z'), // later
    ];
    const result = routeFacts(facts);
    // 'no' wins despite 'yes' being more recent — conservatism takes priority over recency
    expect(result[0].answer).toBe('no');
  });

  test('recency tiebreak within class+answer: more recent recorded_at wins', () => {
    const earlier = '2026-01-01T00:00:00.000Z';
    const later = '2026-01-03T00:00:00.000Z';
    const facts = [
      makeFact('q1', 'yes', 'auto_detected', earlier),
      makeFact('q1', 'yes', 'auto_detected', later),
    ];
    const result = routeFacts(facts);
    expect(result[0].recorded_at).toBe(later);
  });
});

// ── mergeExplanation ──────────────────────────────────────────────────────────

describe('mergeExplanation', () => {
  test('winner and suppressed are correctly identified', () => {
    const bFact = makeFact('q1', 'yes', 'operator_interview');
    const cFact = makeFact('q1', 'no', 'captured');
    const explanation = mergeExplanation([bFact, cFact]);
    expect(explanation.question_id).toBe('q1');
    expect(explanation.winner).toBe(cFact);
    expect(explanation.suppressed).toContain(bFact);
    expect(explanation.suppressed).not.toContain(cFact);
  });

  test('single-fact group: winner is that fact and suppressed is empty', () => {
    const fact = makeFact('q1', 'yes', 'auto_detected');
    const explanation = mergeExplanation([fact]);
    expect(explanation.winner).toBe(fact);
    expect(explanation.suppressed).toHaveLength(0);
  });
});

// ── Multi-objective routing ───────────────────────────────────────────────────

describe('routeFacts — multi-objective', () => {
  test('each objective is resolved independently', () => {
    const facts = [
      makeFact('q1', 'yes', 'auto_detected'),
      makeFact('q1', 'no', 'operator_interview'),
      makeFact('q2', 'no', 'operator_interview'),
      makeFact('q2', 'yes', 'captured'),
    ];
    const result = routeFacts(facts);
    expect(result).toHaveLength(2);
    const q1 = result.find((f) => f.question_id === 'q1');
    const q2 = result.find((f) => f.question_id === 'q2');
    expect(q1?.provenance).toBe('auto_detected');
    expect(q1?.answer).toBe('yes');
    expect(q2?.provenance).toBe('captured');
    expect(q2?.answer).toBe('yes');
  });

  test('empty input returns empty output', () => {
    expect(routeFacts([])).toHaveLength(0);
  });
});

// ── Integration: router output → scoreFacts (DONE-WHEN #4 last bullet) ───────

describe('routeFacts → scoreFacts integration', () => {
  let nodes: QuestionNode[];

  beforeAll(async () => {
    const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
    nodes = await loadQuestionGraph([]);
  });

  test('merged score is <= naive all-B score — router is conservative, never inflates', async () => {
    const { scoreFacts } = await import('../scoringService');

    const earlier = '2026-01-01T00:00:00.000Z';
    const now = '2026-06-01T00:00:00.000Z';

    // Naive all-B facts: every question answered yes via operator_interview
    const allBFacts: InterviewFact[] = nodes.map((n) => ({
      question_id: n.id,
      question_text: n.text,
      answer: 'yes',
      provenance: 'operator_interview',
      confidence: 'high' as const,
      recorded_at: earlier,
    }));

    // Mixed: same B yes facts, but A says no for first 3 objectives.
    // A no overrides B yes for those questions — can only lower or maintain the score.
    const mixedFacts: InterviewFact[] = [
      ...allBFacts,
      ...nodes.slice(0, 3).map((n) => ({
        question_id: n.id,
        question_text: n.text,
        answer: 'no' as const,
        provenance: 'auto_detected',
        confidence: 'high' as const,
        recorded_at: now,
      })),
    ];

    const routed = routeFacts(mixedFacts);

    // Verify routing collapsed to one fact per question
    const uniqueIds = new Set(routed.map((f) => f.question_id));
    expect(uniqueIds.size).toBe(routed.length);

    const { conservativeScore: mergedScore } = await scoreFacts(routed, nodes, []);
    const { conservativeScore: naiveBScore } = await scoreFacts(allBFacts, nodes, []);

    // Conservative guarantee: replacing B yes with A no can only lower or maintain score
    expect(mergedScore).toBeLessThanOrEqual(naiveBScore);
  });
});
