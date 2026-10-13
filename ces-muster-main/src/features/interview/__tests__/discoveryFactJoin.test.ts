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
import { synthesizeFactsFromDiscovery, confidenceRank } from '../discoveryFactJoin';
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
    // iam-001 is the only QUESTION_GRAPH node carrying AC.L2-3.1.13
    expect(facts.map((f) => f.question_id)).toEqual(['iam-001']);
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
