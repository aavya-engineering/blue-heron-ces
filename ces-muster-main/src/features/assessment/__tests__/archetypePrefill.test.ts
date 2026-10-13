// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-GO-2 M2 gate: archetype prefills carry archetype-default provenance
// until overridden; an override replaces it with a human-entered source.
import { describe, test, expect } from 'vitest';
import { ARCHETYPES_FIXTURE } from '@/__fixtures__/archetypes';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { applyArchetypeDefaults } from '../archetypePrefill';
import { factsFromAnswers } from '../assessmentHelpers';
import { isUnconfirmedDraft } from '@/features/scoring/draftSemantics';

const CLOUD = ARCHETYPES_FIXTURE[0];

describe('GO-2 M2 — archetype selection (rung 3 mechanism)', () => {
  test('prefills carry archetype-default provenance and are unconfirmed drafts', () => {
    const prefill = applyArchetypeDefaults(CLOUD, QUESTION_GRAPH, {});
    expect(Object.keys(prefill.answers).length).toBeGreaterThan(0);
    for (const qid of Object.keys(prefill.answers)) {
      expect(prefill.provenances[qid]).toBe('archetype-default');
      expect(prefill.confidences[qid]).toBe('low');
    }
    const facts = factsFromAnswers(
      QUESTION_GRAPH,
      prefill.answers,
      prefill.provenances,
      prefill.confidences
    );
    for (const f of facts) expect(isUnconfirmedDraft(f)).toBe(true);
  });

  test('existing answers are never overwritten by an archetype', () => {
    const existing = { 'iam-001': 'no' };
    const prefill = applyArchetypeDefaults(CLOUD, QUESTION_GRAPH, existing);
    expect(prefill.answers['iam-001']).toBeUndefined();
    expect(prefill.provenances['iam-001']).toBeUndefined();
  });

  test('an override replaces the archetype source with a human-entered one', () => {
    // The override path is AssessmentPage.recordAnswer's operator-takeover rule;
    // its persistence shape is what matters: the fact regenerated after an edit
    // carries operator_interview and no attestation.
    const prefill = applyArchetypeDefaults(CLOUD, QUESTION_GRAPH, {});
    const qid = Object.keys(prefill.answers)[0];

    const answers = { ...prefill.answers, [qid]: 'no' };
    const provenances = { ...prefill.provenances, [qid]: 'operator_interview' };
    const facts = factsFromAnswers(QUESTION_GRAPH, answers, provenances, prefill.confidences);

    const overridden = facts.find((f) => f.question_id === qid)!;
    expect(overridden.provenance).toBe('operator_interview');
    expect(isUnconfirmedDraft(overridden)).toBe(false);

    const untouched = facts.filter((f) => f.question_id !== qid && prefill.answers[f.question_id]);
    expect(untouched.length).toBeGreaterThan(0);
    for (const f of untouched) expect(f.provenance).toBe('archetype-default');
  });

  test('defaults naming unknown question ids are dropped (the bank is the schema)', () => {
    const bogus = { ...CLOUD, defaults: { ...CLOUD.defaults, 'not-a-question': 'yes' } };
    const prefill = applyArchetypeDefaults(bogus, QUESTION_GRAPH, {});
    expect(prefill.answers['not-a-question']).toBeUndefined();
  });
});