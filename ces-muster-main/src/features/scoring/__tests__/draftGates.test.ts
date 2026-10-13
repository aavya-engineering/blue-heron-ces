// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-GO-2 M4 + M5 gates, run against the REAL production scoring path
// (scoreFacts with the same knowledgeLoader mock factRouter.test.ts uses):
//   M4 — no unconfirmed draft contributes to a passing score; the attestation
//        record string shape is asserted exactly.
//   M5 — a session containing ONLY unconfirmed drafts scores IDENTICALLY to
//        the same session with those facts absent; drafts prune; unknown
//        still never prunes.
// Plus the routing invariants (DONE-WHEN 6): A > C > B survives the new
// provenance strings; attested tier upgrades per the goal's mapping table.
import { describe, test, expect, vi } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  DRAFT_PROVENANCES,
  scorableFacts,
  attestationRecord,
  confirmFact,
} from '../draftSemantics';
import { classOf, classOfFact, routeFacts } from '../factRouter';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { pruneByCoverage } from '@/features/interview/factCoveragePruner';

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

function fact(overrides: Partial<InterviewFact>): InterviewFact {
  return {
    question_id: 'iam-001',
    question_text: 'Q',
    answer: 'yes',
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('GO-2 M4 — attestation record + never-contributes', () => {
  test('the attestation record string shape, exactly', () => {
    const draft = fact({ provenance: 'discovery-inferred' });
    const confirmed = confirmFact(draft, 'Jane Assessor', '2026-07-11');
    expect(attestationRecord(confirmed.attestation!)).toBe(
      'drafted by discovery inference, confirmed by Jane Assessor on 2026-07-11'
    );
  });

  test('D1 regression: confirmFact REJECTS a blank/whitespace name — no attestation laundering', () => {
    const draft = fact({ provenance: 'discovery-inferred' });
    expect(() => confirmFact(draft, '')).toThrow(/named human/);
    expect(() => confirmFact(draft, '   ')).toThrow(/named human/);
    // And the happy path trims the stored name.
    expect(confirmFact(draft, '  Jane  ', '2026-07-11').attestation!.confirmed_by).toBe('Jane');
  });

  test('every draft provenance maps to its record label through confirmFact', () => {
    const expected: Record<string, string> = {
      'discovery-inferred': 'discovery inference',
      'document-extracted': 'document extraction',
      'archetype-default': 'archetype default',
      'interview-extracted': 'interview parsing',
    };
    for (const prov of DRAFT_PROVENANCES) {
      const c = confirmFact(fact({ provenance: prov }), 'A. Person', '2026-07-11');
      expect(c.attestation!.drafted_by).toBe(expected[prov]);
    }
  });

  test('no unconfirmed draft contributes to a passing score (real scoreFacts path)', async () => {
    const { scoreFacts } = await import('../scoringService');
    const humanFacts = [fact({ question_id: 'iam-002', answer: 'yes' })];
    const draft = fact({ question_id: 'iam-001', answer: 'yes', provenance: 'discovery-inferred' });

    const withDraft = await scoreFacts([...humanFacts, draft], QUESTION_GRAPH, []);
    const withoutDraft = await scoreFacts(humanFacts, QUESTION_GRAPH, []);

    expect(withDraft.conservativeScore).toBe(withoutDraft.conservativeScore);
    expect(withDraft.posture.ces.control_status_summary).toEqual(
      withoutDraft.posture.ces.control_status_summary
    );
  });
});

describe('GO-2 M5 — never-passes guardrail (drafts prune, never pass)', () => {
  test('a drafts-only session scores IDENTICALLY to the facts-absent session', async () => {
    const { scoreFacts } = await import('../scoringService');
    const draftsOnly = [
      fact({ question_id: 'iam-001', provenance: 'discovery-inferred' }),
      fact({ question_id: 'ep-001', provenance: 'archetype-default', confidence: 'low' }),
      fact({ question_id: 'bnd-001', provenance: 'discovery-inferred', confidence: 'medium' }),
    ];
    const withDrafts = await scoreFacts(draftsOnly, QUESTION_GRAPH, []);
    const absent = await scoreFacts([], QUESTION_GRAPH, []);

    expect(withDrafts.conservativeScore).toBe(absent.conservativeScore);
    expect(withDrafts.posture.ces.control_status_summary).toEqual(
      absent.posture.ces.control_status_summary
    );
  });

  test('scorableFacts excludes exactly the unconfirmed drafts', () => {
    const draft = fact({ provenance: 'archetype-default' });
    const confirmed = confirmFact(fact({ provenance: 'discovery-inferred' }), 'J', '2026-07-11');
    const human = fact({ provenance: 'operator_interview' });
    expect(scorableFacts([draft, confirmed, human])).toEqual([confirmed, human]);
  });

  test('drafts PRUNE their question (non-unknown confidence defers it)', () => {
    const nodes = QUESTION_GRAPH.filter((n) => ['iam-001', 'iam-002'].includes(n.id));
    const draft = fact({ question_id: 'iam-001', provenance: 'discovery-inferred', confidence: 'medium' });
    const remaining = pruneByCoverage(nodes, [draft]);
    expect(remaining.map((n) => n.id)).toEqual(['iam-002']);
  });

  test('unknown STILL never prunes, draft or not', () => {
    const nodes = QUESTION_GRAPH.filter((n) => ['iam-001', 'iam-002'].includes(n.id));
    const unknownDraft = fact({
      question_id: 'iam-001',
      provenance: 'discovery-inferred',
      confidence: 'unknown',
      answer: 'unsure',
    });
    const remaining = pruneByCoverage(nodes, [unknownDraft]);
    expect(remaining.map((n) => n.id)).toEqual(['iam-001', 'iam-002']);
  });
});

describe('GO-2 routing invariants with the new provenance strings (DONE-WHEN 6)', () => {
  test('unconfirmed drafts route as B (conservative fallback unchanged)', () => {
    for (const prov of DRAFT_PROVENANCES) {
      expect(classOf(prov)).toBe('B');
      expect(classOfFact(fact({ provenance: prov }))).toBe('B');
    }
  });

  test('attested tier upgrades per the mapping table', () => {
    const attest = (prov: string) => confirmFact(fact({ provenance: prov }), 'J', '2026-07-11');
    expect(classOfFact(attest('discovery-inferred'))).toBe('A');
    expect(classOfFact(attest('document-extracted'))).toBe('C');
    expect(classOfFact(attest('archetype-default'))).toBe('B');
    expect(classOfFact(attest('interview-extracted'))).toBe('B');
  });

  test('A > C > B precedence survives: an attested discovery-inferred beats a human answer; an unconfirmed draft never does', () => {
    const human = fact({ answer: 'no', provenance: 'operator_interview' });
    const unconfirmed = fact({ answer: 'yes', provenance: 'discovery-inferred' });
    // Same class (B): conservative merge picks the human 'no'.
    expect(routeFacts([human, unconfirmed])[0].answer).toBe('no');

    const attested = confirmFact(unconfirmed, 'J', '2026-07-11');
    // Attested discovery-inferred is class A: outranks the human B answer.
    expect(routeFacts([human, attested])[0]).toBe(attested);
  });
});