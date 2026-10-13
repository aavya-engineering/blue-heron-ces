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

/** Confidence comparator — higher number = more trustworthy. */
export function confidenceRank(c: InterviewFact['confidence']): number {
  return { unknown: -1, low: 0, medium: 1, high: 2 }[c];
}

/**
 * Synthesize InterviewFacts from Discovery results, joined against the
 * question graph by mapped_requirements === control_id.
 *
 * Finding 2 FCA "never passes" clause (a): whenever confidence === 'unknown',
 * the synthesized answer is the 'unsure' sentinel — never a synthesized
 * affirmative 'yes' — so an unknown discovery row can never score as met.
 * Non-unknown rows synthesize answer: 'yes' (Discovery resolved the objective
 * as covered).
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
      (n) => n.cluster !== 'boundary' && n.mapped_requirements.includes(result.control_id)
    );
    for (const node of matchingNodes) {
      const isUnknown = result.confidence === 'unknown';
      facts.push({
        question_id: node.id,
        question_text: node.text,
        answer: isUnknown ? 'unsure' : 'yes',
        provenance: 'auto_detected',
        confidence: result.confidence,
        recorded_at: now,
      });
    }
  }

  return facts;
}
