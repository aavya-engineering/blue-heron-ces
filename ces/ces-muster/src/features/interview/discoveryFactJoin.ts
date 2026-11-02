// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// P1 resolution #4 — discovery-fact join + confidence comparator.
// Joins DiscoveryResult rows (keyed by control_id, matching QuestionNode's
// mapped_requirements) into InterviewFact records the rest of the pipeline
// (factRouter, sprsCalc, pruneByCoverage) already understands.
import type { QuestionNode } from './questionGraph';
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';
import type { InterviewFact } from '@/shared/types/engagement';
import verdictPredicates from '@/features/discovery/verdictPredicates.json';

/**
 * MG-02: the registry entries whose 'met' is a real verdict (an expected-value
 * predicate, src/features/discovery/verdictPredicates.json). A 'met' row from
 * any other entry is the pre-MG-02 meaning "the read returned output".
 */
const PREDICATED_ENTRIES = new Set(
  Object.entries(verdictPredicates.predicates as Record<string, { expect: unknown }>)
    .filter(([, p]) => p.expect !== null)
    .map(([id]) => id)
);

/**
 * MG-02: the verdict a discovery row carries for the interview.
 *  - unknown confidence (degraded, manual, failed) -> unknown;
 *  - a bare fixture / results-file row (no executor, so no derived_posture) keeps
 *    its legacy meaning: a non-unknown row is met;
 *  - an executor row is met only when its posture is met AND an entry it ran has
 *    a verdict predicate (an older payload's "output returned" met is unknown);
 *  - not_met stays not_met; partial and unknown are unknown.
 */
export function discoveryVerdict(result: DiscoveryResult): 'met' | 'not_met' | 'unknown' {
  if (result.confidence === 'unknown') return 'unknown';
  if (result.derived_posture === undefined) return 'met';
  if (result.derived_posture === 'met') {
    const ran = result.ran_entry_ids ?? [];
    return ran.length > 0 && !ran.some((id) => PREDICATED_ENTRIES.has(id)) ? 'unknown' : 'met';
  }
  return result.derived_posture === 'not_met' ? 'not_met' : 'unknown';
}

/** Confidence comparator — higher number = more trustworthy. */
export function confidenceRank(c: InterviewFact['confidence']): number {
  return { unknown: -1, low: 0, medium: 1, high: 2 }[c];
}

/**
 * Synthesize InterviewFacts from Discovery results, joined against the
 * question graph by mapped_requirements === control_id.
 *
 * Finding 2 FCA "never passes" clause (a): whenever the verdict is unknown,
 * the synthesized answer is the 'unsure' sentinel at confidence 'unknown' —
 * never a synthesized affirmative 'yes' — so an unknown discovery row can never
 * score as met or prune. MG-02: only a predicate-backed met synthesizes 'yes'
 * (discoveryVerdict); a not_met synthesizes 'no'.
 */
export function synthesizeFactsFromDiscovery(
  results: DiscoveryResult[],
  graph: QuestionNode[]
): InterviewFact[] {
  const now = new Date().toISOString();
  const facts: InterviewFact[] = [];

  for (const result of results) {
    // G-MUSTER-GO-2 M1: boundary questions are NEVER auto-detected. The CUI
    // boundary is intent — discovery evidence only DRAFTS it (rung 1's
    // inferBoundaryDrafts, provenance 'discovery-inferred', unattested, never
    // scores). Joining it here as 'auto_detected' (class A) would let a
    // machine assert intent straight into the scorable tier.
    const matchingNodes = graph.filter(
      (n) => n.cluster !== 'boundary' && !n.alias_of && n.mapped_requirements.includes(result.control_id)
    );
    // MX mx-01 (MG-01) + MG-02: an empty read is not a pass, and neither is a
    // read without a verdict. met -> 'yes' (class A, prunes); not_met -> 'no'
    // (scores not_met, but never prunes: factCoveragePruner keeps the question
    // asked); unknown -> 'unsure' at confidence 'unknown' (never prunes or passes).
    const verdict = discoveryVerdict(result);
    for (const node of matchingNodes) {
      facts.push({
        question_id: node.id,
        question_text: node.text,
        answer: verdict === 'met' ? 'yes' : verdict === 'not_met' ? 'no' : 'unsure',
        provenance: 'auto_detected',
        confidence: verdict === 'unknown' ? 'unknown' : result.confidence,
        recorded_at: now,
      });
    }
  }

  return facts;
}
