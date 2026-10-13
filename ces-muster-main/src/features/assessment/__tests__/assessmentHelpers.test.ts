// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Pure-function tests for the tabbed-assessment helpers: cluster grouping
// (tab derivation from the stack-filtered graph), progress counting, the
// finish gate, and the facts <-> answers round trip used by resume.
import { describe, test, expect } from 'vitest';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import {
  groupByCluster,
  answeredCount,
  allAnswered,
  factsFromAnswers,
  answersFromFacts,
  CLUSTER_LABELS,
} from '../assessmentHelpers';

describe('groupByCluster — tab derivation', () => {
  test('groups the full graph into the readiness clusters plus the plan-input cluster, preserving graph order', () => {
    // GO-2 M1 added the 'boundary' cluster (bnd-*) to THE question bank —
    // rungs refactor the existing bank, never author a second one.
    // G-MUSTER-PLAN-3 M1 (F8) appended the SIT plan-input residue cluster
    // ('plan-input:si') — one graph, still one bank per domain. W4-MU1 (M3)
    // appended the Tenant Config Profile plan inputs ('plan-input:tcp').
    const groups = groupByCluster(QUESTION_GRAPH);
    expect(groups.map((g) => g.cluster)).toEqual([
      'identity',
      'endpoint',
      'policy',
      'monitoring',
      'data_protection',
      'incident_response',
      'boundary',
      'plan-input:si',
      'plan-input:tcp',
    ]);
    const total = groups.reduce((n, g) => n + g.questions.length, 0);
    expect(total).toBe(QUESTION_GRAPH.length);
  });

  test('every cluster has a display label', () => {
    for (const g of groupByCluster(QUESTION_GRAPH)) {
      expect(g.label).toBe(CLUSTER_LABELS[g.cluster]);
      expect(g.label).toBeTruthy();
    }
  });

  test('stack-conditional questions appear only when their service is declared', async () => {
    const withoutStacks = groupByCluster(await loadQuestionGraph([]));
    const withIntune = groupByCluster(await loadQuestionGraph(['microsoft_intune']));

    const endpointWithout = withoutStacks.find((g) => g.cluster === 'endpoint')!;
    const endpointWith = withIntune.find((g) => g.cluster === 'endpoint')!;
    expect(endpointWithout.questions.some((q) => q.id === 'ep-001')).toBe(false);
    expect(endpointWith.questions.some((q) => q.id === 'ep-001')).toBe(true);
    expect(endpointWith.questions.length).toBe(endpointWithout.questions.length + 1);
  });

  test('a cluster whose questions are all filtered out yields no tab', () => {
    const onlyMonitoring = QUESTION_GRAPH.filter((q) => q.cluster === 'monitoring');
    const groups = groupByCluster(onlyMonitoring);
    expect(groups.map((g) => g.cluster)).toEqual(['monitoring']);
  });
});

describe('progress counting and the finish gate', () => {
  const questions = QUESTION_GRAPH.slice(0, 3);

  test('answeredCount counts only questions present in the given set', () => {
    const answers = { [questions[0].id]: 'yes', 'not-in-set': 'yes' };
    expect(answeredCount(questions, answers)).toBe(1);
  });

  test('allAnswered is false when any question lacks an answer', () => {
    const answers = { [questions[0].id]: 'yes', [questions[1].id]: 'no' };
    expect(allAnswered(questions, answers)).toBe(false);
  });

  test('allAnswered is true when every question is answered', () => {
    const answers = Object.fromEntries(questions.map((q) => [q.id, 'yes']));
    expect(allAnswered(questions, answers)).toBe(true);
  });

  test('allAnswered is false for an empty question set (nothing to finish)', () => {
    expect(allAnswered([], {})).toBe(false);
  });
});

describe('factsFromAnswers / answersFromFacts', () => {
  const questions = QUESTION_GRAPH.slice(0, 3);

  test('produces one fact per answered visible question with the InterviewFact shape', () => {
    const answers = { [questions[0].id]: 'yes', [questions[2].id]: 'unknown' };
    const facts = factsFromAnswers(questions, answers);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({
      question_id: questions[0].id,
      question_text: questions[0].text,
      answer: 'yes',
      provenance: 'operator_interview',
      confidence: 'high',
    });
    expect(facts[1].confidence).toBe('unknown');
    expect(facts[0].recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('answers to questions hidden by a service change are excluded', () => {
    const answers = { [questions[0].id]: 'yes', 'hidden-question': 'yes' };
    const facts = factsFromAnswers(questions, answers);
    expect(facts.map((f) => f.question_id)).toEqual([questions[0].id]);
  });

  test('answersFromFacts round-trips the answers map (resume path)', () => {
    const answers = Object.fromEntries(questions.map((q) => [q.id, 'no']));
    const roundTripped = answersFromFacts(factsFromAnswers(questions, answers));
    expect(roundTripped).toEqual(answers);
  });
});
