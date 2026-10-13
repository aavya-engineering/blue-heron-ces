// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Scoring service — full cascade path:
//   interview facts + stack declarations
//     → preamble + siBaseline  (preambleMapper)
//     → deriveActionStatuses   (vendored 6-step cascade)
//     → convertToRRTAnswers    (vendored)
//     → merge with interview-derived answers
//     → generateReadinessPosture (vendored)
//     → conservative score
//
// No dual paths: this is the single production scoring entry-point.
// Tests that need a minimal direct call to generateReadinessPosture
// (e.g. fcaGuardrails) import it directly from the vendored module.
import { deriveActionStatuses, convertToRRTAnswers } from '@/vendored/ces-spine/services/bulkAnswerDerivation';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import type { ReadinessPosture } from '@/vendored/ces-spine/types/artifacts';
import type { RRTAnswer } from '@/vendored/ces-spine/types/rrt';
import type { InterviewFact } from '@/shared/types/engagement';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { loadKnowledge } from './knowledgeLoader';
import { mapToPreamble, buildSIBaseline } from './preambleMapper';
import { scorableFacts } from './draftSemantics';

export type { ReadinessPosture };

/**
 * Conservative scoring: only fully-met requirements count.
 * unknown is treated as not-met — never yields a passing objective.
 */
export function computeConservativeScore(posture: ReadinessPosture): number {
  const s = posture.ces.control_status_summary;
  const total = s.met + s.partial + s.not_met + s.unknown;
  if (total === 0) return 0;
  return Math.round((s.met / total) * 100);
}

/**
 * Map interview facts to RRTAnswer records using the question graph to resolve
 * mapped_requirements. Returns only facts that have explicit answers (non-cascade).
 *
 * Exported for the G-MUSTER-PLAN-3 score-leak test: a plan-input SIT fact must
 * resolve to `mapped_requirements: []` here (its node in the graph carries []),
 * never to the `scre.<id>` synthetic-requirement fallback that fires only for
 * facts with NO node — which is why SIT nodes live in QUESTION_GRAPH.
 */
export function mapFactsToRRTAnswers(
  facts: InterviewFact[],
  questionNodes: QuestionNode[]
): Record<string, RRTAnswer> {
  const nodeMap = new Map(questionNodes.map((n) => [n.id, n]));
  const answers: Record<string, RRTAnswer> = {};
  for (const fact of facts) {
    const node = nodeMap.get(fact.question_id);
    const reqIds = node?.mapped_requirements ?? [`scre.${fact.question_id}`];
    answers[fact.question_id] = {
      question_id: fact.question_id,
      answer: fact.answer,
      provenance_class: 'client_assertion',
      mapped_requirements: reqIds,
    };
  }
  return answers;
}

/**
 * Full cascade scoring — production path.
 *
 * 1. Load vendored patterns + playbook from /knowledge/ static assets.
 * 2. Map stacks + facts → PreambleAnswers + siBaseline.
 * 3. Run deriveActionStatuses (6-step cascade).
 * 4. Convert to RRTAnswers.
 * 5. Merge with interview-fact answers (interview overrides cascade per action_id).
 * 6. Call generateReadinessPosture.
 * 7. Compute conservative score.
 */
export async function scoreFacts(
  facts: InterviewFact[],
  questionNodes: QuestionNode[],
  selectedStacks: string[] = []
): Promise<{ posture: ReadinessPosture; conservativeScore: number }> {
  // G-MUSTER-GO-2 M5: unconfirmed drafts NEVER reach any scoring input — a
  // drafts-only session must score identically to the facts-absent session.
  // Exclusion happens here (the single production scoring entry-point), before
  // preamble mapping and RRT conversion, so a draft can neither pass nor deduct.
  const scorable = scorableFacts(facts);
  const { patterns, playbook } = await loadKnowledge();
  const preamble = mapToPreamble(selectedStacks, scorable);
  const siBaseline = buildSIBaseline(selectedStacks);

  const actionStatuses = deriveActionStatuses(patterns, playbook, preamble, siBaseline);
  const cascadeAnswers = convertToRRTAnswers(actionStatuses);

  // Interview facts override cascade-derived answers for the same action ID
  const interviewAnswers = mapFactsToRRTAnswers(scorable, questionNodes);
  const mergedAnswers: Record<string, RRTAnswer> = { ...cascadeAnswers, ...interviewAnswers };

  const posture = generateReadinessPosture(mergedAnswers, [], siBaseline, {});
  const conservativeScore = computeConservativeScore(posture);
  return { posture, conservativeScore };
}
