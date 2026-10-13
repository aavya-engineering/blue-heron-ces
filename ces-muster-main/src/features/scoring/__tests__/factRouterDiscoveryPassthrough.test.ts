// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Finding 2(b) — FCA "never passes" guard at the scoring boundary.
// Feeds a discovery-synthesized unknown-confidence fact (synthesizeFactsFromDiscovery,
// answer: 'unsure', provenance: 'auto_detected') through factRouter.ts's existing
// routing function and asserts it routes as non-passing/HIL-eligible, identical to
// a human 'unsure' answer — factRouter does not special-case discovery provenance.
import { describe, test, expect } from 'vitest';
import { routeFacts, classOf } from '../factRouter';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';

describe('factRouter — discovery-synthesized unknown fact never passes (Finding 2b)', () => {
  test('a discovery-synthesized unknown-confidence fact routes with answer "unsure", same as a human unsure answer', () => {
    const discoveryFacts = synthesizeFactsFromDiscovery(
      [{ control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'unknown' }],
      QUESTION_GRAPH
    );
    expect(discoveryFacts).toHaveLength(1);
    expect(discoveryFacts[0].answer).toBe('unsure');

    const routed = routeFacts(discoveryFacts);
    expect(routed).toHaveLength(1);
    // routeFacts is a passthrough for a single-fact group: answer/confidence
    // are preserved unchanged — the sentinel is never overwritten to a pass.
    expect(routed[0].answer).toBe('unsure');
    expect(routed[0].confidence).toBe('unknown');
  });

  test('a discovery-synthesized unknown fact behaves identically to a human operator_interview unsure fact through routeFacts', () => {
    const discoveryUnknown: InterviewFact = {
      question_id: 'iam-001',
      question_text: 'q',
      answer: 'unsure',
      provenance: 'auto_detected',
      confidence: 'unknown',
      recorded_at: '2026-01-01T00:00:00.000Z',
    };
    const humanUnsure: InterviewFact = {
      question_id: 'iam-001',
      question_text: 'q',
      answer: 'unsure',
      provenance: 'operator_interview',
      confidence: 'unknown',
      recorded_at: '2026-01-01T00:00:00.000Z',
    };

    const routedDiscovery = routeFacts([discoveryUnknown]);
    const routedHuman = routeFacts([humanUnsure]);

    expect(routedDiscovery[0].answer).toBe(routedHuman[0].answer);
    expect(routedDiscovery[0].confidence).toBe(routedHuman[0].confidence);
    // Provenance class differs (auto_detected=A vs operator_interview=B, see
    // the classOf assertions below), but the never-passes outcome is
    // identical regardless of class.
  });

  test('classOf: discovery-synthesized provenance "auto_detected" classifies as A, same as harvest facts', () => {
    expect(classOf('auto_detected')).toBe('A');
    expect(classOf('operator_interview')).toBe('B');
  });

  test('an A-class unknown fact still loses to nothing when it is the only fact — it never resolves to a pass', () => {
    // routeFacts only ever selects a winner from the input; it never invents
    // a 'yes'/'met' outcome. With a single unknown-confidence fact present,
    // the winner's answer remains 'unsure' regardless of provenance class.
    const facts = synthesizeFactsFromDiscovery(
      [{ control_id: 'AC.L2-3.1.13', objective_ids: [], confidence: 'unknown' }],
      QUESTION_GRAPH
    );
    const [winner] = routeFacts(facts);
    expect(winner.answer).not.toBe('yes');
    expect(winner.answer).toBe('unsure');
  });
});
