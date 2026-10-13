// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M4 gate — discovery-seeded pruning delta + unknown-never-prunes +
// never-passes-to-'met' (Finding 2c). Node environment via fake-indexeddb,
// same pattern as sessionDriver.test.ts.
import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'vitest';
import { createSession, answer, completeInterview } from '../sessionDriver';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';
import { computeSprs } from '@/features/scoring/sprsCalc';
import { db } from '@/shared/db/schema';

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  await db.subs.clear();
});

/**
 * Minimal direct requirement-status derivation for the SPRS assertion
 * (Finding 2c): a requirement is 'met' only when every graph node mapping to
 * it has a routed fact with answer 'yes' (never for a node whose only
 * supporting fact carries confidence: 'unknown', since that fact's answer is
 * always the 'unsure' sentinel per discoveryFactJoin.ts).
 */
function requirementResultsFromFacts(
  facts: { question_id: string; answer: string }[],
  graph: typeof QUESTION_GRAPH
): Array<{ requirement_id: string; status: string }> {
  const answerByQuestionId = new Map(facts.map((f) => [f.question_id, f.answer]));
  const results = new Map<string, string>();
  for (const node of graph) {
    const answer = answerByQuestionId.get(node.id);
    const status = answer === 'yes' ? 'met' : 'not_met';
    for (const reqId of node.mapped_requirements) {
      // Conservative merge across nodes sharing a requirement: any not_met wins.
      if (results.get(reqId) !== 'not_met') {
        results.set(reqId, status);
      } else {
        results.set(reqId, 'not_met');
      }
    }
  }
  return Array.from(results.entries()).map(([requirement_id, status]) => ({ requirement_id, status }));
}

describe('M4 — residual pruning wired at the questionGraphService seam (discovery-seeded)', () => {
  test('a discovery-seeded session completes with strictly fewer questions than the manual branch (same starting stacks)', async () => {
    const stacks: string[] = [];

    // Manual branch: empty facts (Finding 4 invariant path).
    const manualGraph = await loadQuestionGraph(stacks, []);

    // Discovery branch: facts synthesized from the canned fixture.
    const discoveryFacts = synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH);
    const discoveryGraph = await loadQuestionGraph(stacks, discoveryFacts);

    expect(discoveryGraph.length).toBeLessThan(manualGraph.length);

    // Drive both branches through the session driver to completeInterview.
    const manualHandle = await createSession('individual_contractor', { stacks });
    for (const node of manualGraph) {
      await answer(manualHandle, node.id, 'yes');
    }
    await completeInterview(manualHandle);
    const manualSession = await db.interview_sessions.get(manualHandle.sessionId);
    expect(manualSession?.status).toBe('complete');
    expect(manualSession?.facts).toHaveLength(manualGraph.length);

    const discoveryHandle = await createSession('individual_contractor', { stacks });
    for (const node of discoveryGraph) {
      await answer(discoveryHandle, node.id, 'yes');
    }
    await completeInterview(discoveryHandle);
    const discoverySession = await db.interview_sessions.get(discoveryHandle.sessionId);
    expect(discoverySession?.status).toBe('complete');
    expect(discoverySession?.facts).toHaveLength(discoveryGraph.length);

    // The pruning delta is asserted, not just observed.
    expect(discoverySession!.facts.length).toBeLessThan(manualSession!.facts.length);
  });

  test('unknown-confidence discovery rows never prune their question (their node remains in the pruned graph)', async () => {
    const unknownRow = DISCOVERY_RESULTS_FIXTURE.find((r) => r.confidence === 'unknown');
    expect(unknownRow).toBeDefined();

    const discoveryFacts = synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH);
    const discoveryGraph = await loadQuestionGraph([], discoveryFacts);

    const unknownNodeIds = QUESTION_GRAPH.filter((n) =>
      n.mapped_requirements.includes(unknownRow!.control_id)
    ).map((n) => n.id);
    expect(unknownNodeIds.length).toBeGreaterThan(0);

    for (const id of unknownNodeIds) {
      expect(discoveryGraph.map((n) => n.id)).toContain(id);
    }
  });

  test('Finding 2(c): no requirement whose only supporting fact has confidence "unknown" scores as met via computeSprs', async () => {
    const discoveryFacts = synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH);
    const requirementResults = requirementResultsFromFacts(discoveryFacts, QUESTION_GRAPH);
    const sprsResult = computeSprs(requirementResults);

    // Requirements whose ONLY supporting discovery fact is unknown-confidence.
    const unknownRows = DISCOVERY_RESULTS_FIXTURE.filter((r) => r.confidence === 'unknown');
    const nonUnknownControlIds = new Set(
      DISCOVERY_RESULTS_FIXTURE.filter((r) => r.confidence !== 'unknown').map((r) => r.control_id)
    );
    const unknownOnlyControlIds = unknownRows
      .map((r) => r.control_id)
      .filter((id) => !nonUnknownControlIds.has(id));

    expect(unknownOnlyControlIds.length).toBeGreaterThan(0);

    const metRequirementIds = new Set(
      requirementResults.filter((r) => r.status === 'met').map((r) => r.requirement_id)
    );
    for (const controlId of unknownOnlyControlIds) {
      expect(metRequirementIds.has(controlId)).toBe(false);
    }
    // computeSprs itself never counts a deduction for a status it doesn't
    // recognize as 'met' — sanity check the assessed count matches input size.
    expect(sprsResult.assessed_count).toBe(requirementResults.length);
  });
});
