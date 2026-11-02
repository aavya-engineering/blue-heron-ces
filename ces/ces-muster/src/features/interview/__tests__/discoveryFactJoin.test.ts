// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Unit: discoveryFactJoin — synthesis + confidenceRank + unsure sentinel.
import { describe, test, expect } from 'vitest';
import { synthesizeFactsFromDiscovery, confidenceRank, discoveryVerdict } from '../discoveryFactJoin';
import { pruneByCoverage } from '../factCoveragePruner';
import { QUESTION_GRAPH } from '../questionGraph';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';

describe('confidenceRank', () => {
  test('orders unknown < low < medium < high', () => {
    expect(confidenceRank('unknown')).toBeLessThan(confidenceRank('low'));
    expect(confidenceRank('low')).toBeLessThan(confidenceRank('medium'));
    expect(confidenceRank('medium')).toBeLessThan(confidenceRank('high'));
  });
});

describe('synthesizeFactsFromDiscovery', () => {
  test('joins a discovery row onto every graph node whose mapped_requirements includes control_id', () => {
    const facts = synthesizeFactsFromDiscovery(
      [{ control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'high' }],
      QUESTION_GRAPH
    );
    // MG-07: the RR activity for AC.L2-3.1.13 is the only QUESTION_GRAPH node
    // carrying it (boundary nodes never join)
    expect(facts.map((f) => f.question_id)).toEqual(['RR-ACT-AC_L2_3_1_13']);
    expect(facts[0].confidence).toBe('high');
    expect(facts[0].answer).toBe('yes');
    expect(facts[0].provenance).toBe('auto_detected');
  });

  test('unknown-confidence row synthesizes answer "unsure", never an affirmative "yes"', () => {
    const facts = synthesizeFactsFromDiscovery(
      [{ control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'unknown' }],
      QUESTION_GRAPH
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].answer).toBe('unsure');
    expect(facts[0].confidence).toBe('unknown');
  });

  test('a control_id matching no graph node yields no facts', () => {
    const facts = synthesizeFactsFromDiscovery(
      [{ control_id: 'ZZ.NOPE-0.0.0', objective_ids: [], confidence: 'high' }],
      QUESTION_GRAPH
    );
    expect(facts).toHaveLength(0);
  });

  test('the full DISCOVERY_RESULTS_FIXTURE synthesizes at least one unknown-confidence fact with answer "unsure"', () => {
    const facts = synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH);
    const unknownFacts = facts.filter((f) => f.confidence === 'unknown');
    expect(unknownFacts.length).toBeGreaterThan(0);
    for (const f of unknownFacts) {
      expect(f.answer).toBe('unsure');
    }
  });
});

// MG-02: discovery prunes only with a predicate-backed met verdict.
describe('MG-02 discovery verdicts in the join and the pruner', () => {
  const mfaNode = QUESTION_GRAPH.filter((n) => n.id === 'RR-ACT-IA_L2_3_5_3');
  const row = (posture: 'met' | 'not_met' | 'unknown' | 'partial', entry: string) => ({
    control_id: 'IA.L2-3.5.3',
    objective_ids: [],
    confidence: 'high' as const,
    derived_posture: posture,
    ran_entry_ids: [entry],
  });

  test('a met verdict from a predicate-backed entry synthesizes yes and prunes', () => {
    const facts = synthesizeFactsFromDiscovery([row('met', 'IA.L2-3.5.3.mfa-authenticator')], QUESTION_GRAPH);
    expect(facts).toMatchObject([{ question_id: 'RR-ACT-IA_L2_3_5_3', answer: 'yes', confidence: 'high' }]);
    expect(pruneByCoverage(mfaNode, facts)).toEqual([]);
  });

  test('muster-mfa-disabled / muster-partial shape: a not_met verdict scores no and prunes nothing', () => {
    const facts = synthesizeFactsFromDiscovery([row('not_met', 'IA.L2-3.5.3.mfa-authenticator')], QUESTION_GRAPH);
    expect(facts).toMatchObject([{ question_id: 'RR-ACT-IA_L2_3_5_3', answer: 'no', provenance: 'auto_detected' }]);
    expect(pruneByCoverage(mfaNode, facts).map((n) => n.id)).toEqual(['RR-ACT-IA_L2_3_5_3']);
  });

  test('a met from an entry without a verdict predicate (pre-MG-02 "output returned") is unknown and prunes nothing', () => {
    // W5c3: AC.L2-3.1.8.smart-lockout gained a predicate; IA.L2-3.5.8.password-reuse is still an explicit null.
    expect(discoveryVerdict(row('met', 'IA.L2-3.5.8.password-reuse'))).toBe('unknown');
    expect(discoveryVerdict(row('met', 'some.unlisted-entry'))).toBe('unknown');
    const facts = synthesizeFactsFromDiscovery([row('met', 'IA.L2-3.5.8.password-reuse')], QUESTION_GRAPH);
    expect(facts[0]).toMatchObject({ answer: 'unsure', confidence: 'unknown' });
    expect(pruneByCoverage(mfaNode, facts)).toHaveLength(1);
  });

  test('partial and unknown postures are unknown; bare fixture rows keep their legacy meaning', () => {
    expect(discoveryVerdict(row('partial', 'IA.L2-3.5.3.mfa-authenticator'))).toBe('unknown');
    expect(discoveryVerdict(row('unknown', 'IA.L2-3.5.3.mfa-authenticator'))).toBe('unknown');
    expect(discoveryVerdict({ control_id: 'IA.L2-3.5.3', objective_ids: [], confidence: 'medium' })).toBe('met');
  });

  test('a discovered plan-input value (auto_detected, not yes/no) still prunes its plan-input node', () => {
    const tcp = QUESTION_GRAPH.filter((n) => n.id === 'TCP.IA.005');
    if (tcp.length === 0) return;
    const facts = [{ question_id: 'TCP.IA.005', question_text: 'q', answer: 'no', provenance: 'auto_detected', confidence: 'high' as const, recorded_at: '' }];
    expect(pruneByCoverage(tcp, facts)).toEqual([]);
  });
});
