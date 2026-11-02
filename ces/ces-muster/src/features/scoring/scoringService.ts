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
//     → scenario SI Baseline + preamble  (readinessScope / preambleMapper)
//     → deriveActionStatuses   (vendored 6-step cascade, Planner rrt copy)
//     → convertToRRTAnswers    (vendored)
//     → merge with interview-derived answers (scenario-selected activities only)
//     → generateReadinessPosture (vendored)
//     → conservative score
//
// MG-07 (D5): the posture covers every requirement the cascade derives over
// all RR activities for the scenario (Planner's bulk path), not the answered
// nodes alone. With Planner's preamble and SI, the cascade alone reproduces
// Planner's posture (readinessPosture.test.ts).
//
// No dual paths: this is the single production scoring entry-point.
// Tests that need a minimal direct call to generateReadinessPosture
// (e.g. fcaGuardrails) import it directly from the vendored module.
import { deriveActionStatuses, convertToRRTAnswers } from '@/features/plan/engine/rrt/services/bulkAnswerDerivation';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import type { ReadinessPosture } from '@/vendored/ces-spine/types/artifacts';
import type { RRTAnswer } from '@/vendored/ces-spine/types/rrt';
import type { PreambleAnswers } from '@/features/plan/engine/rrt/types';
import type { SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { TechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';
import type { InterviewFact } from '@/shared/types/engagement';
import { QUESTION_GRAPH, expandLegacyReadinessFacts } from '@/features/interview/questionGraph';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { loadKnowledge, type KnowledgeBundle } from './knowledgeLoader';
import { mapToPreamble } from './preambleMapper';
import { scorableFacts } from './draftSemantics';
import { RR_ACTIVITY_PREFIX, scenarioSiBaseline, selectActivities } from './readinessScope';

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
  // MG-07: callers pass the ASKED graph (loadQuestionGraph); a fact answered for
  // a node the asked set no longer shows (pruned, cascade-settled) still maps
  // through the full graph rather than leaking as a synthetic requirement.
  const nodeMap = new Map(QUESTION_GRAPH.map((n) => [n.id, n]));
  for (const n of questionNodes) nodeMap.set(n.id, n);
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
 * MG-07: what a caller that holds more than the facts can pass. The plan compile
 * holds the compiled SI Baseline; a session may carry Planner's preamble
 * snapshot (session.preamble — only fixtures and imported sessions set it today).
 */
export interface ScoringContext {
  preamble?: PreambleAnswers | null;
  siBaseline?: SIBaseline | null;
  techRef?: TechRefIndex | null;
  /** The patterns + playbook the caller already holds (the plan compile's banks); absent -> loadKnowledge(). */
  knowledge?: Pick<KnowledgeBundle, 'patterns' | 'playbook'>;
}

/**
 * Full cascade scoring — production path.
 *
 * 1. Load vendored patterns + playbook (+ the tech-ref index) from /knowledge/.
 * 2. Scenario SI Baseline (context, else from the facts) + preamble (context,
 *    else mapped from stacks + facts). Retired readiness ids are re-keyed first.
 * 3. Run deriveActionStatuses (6-step cascade) over every pattern.
 * 4. Convert to RRTAnswers.
 * 5. Merge with interview-fact answers; a readiness answer counts only for an
 *    activity Planner's selection keeps for the scenario (MG-07 scoping).
 * 6. Call generateReadinessPosture.
 * 7. Compute conservative score.
 */
export async function scoreFacts(
  facts: InterviewFact[],
  questionNodes: QuestionNode[],
  selectedStacks: string[] = [],
  context: ScoringContext = {}
): Promise<{ posture: ReadinessPosture; conservativeScore: number }> {
  // G-MUSTER-GO-2 M5: unconfirmed drafts NEVER reach any scoring input — a
  // drafts-only session must score identically to the facts-absent session.
  // Exclusion happens here (the single production scoring entry-point), before
  // preamble mapping and RRT conversion, so a draft can neither pass nor deduct.
  const scorable = expandLegacyReadinessFacts(scorableFacts(facts));
  const knowledge: Partial<KnowledgeBundle> = context.knowledge ?? (await loadKnowledge());
  const { patterns, playbook } = knowledge as KnowledgeBundle;
  const techRef = context.techRef === null ? undefined : (context.techRef ?? knowledge.techRef);
  const preamble = context.preamble ?? mapToPreamble(selectedStacks, scorable);
  const siBaseline = context.siBaseline ?? scenarioSiBaseline(scorable, selectedStacks);

  const actionStatuses = deriveActionStatuses(patterns, playbook, preamble, siBaseline, techRef);
  const cascadeAnswers = convertToRRTAnswers(actionStatuses);

  // Interview facts override cascade-derived answers for the same action ID.
  // MG-07: an answer for an RR activity the scenario excludes is out of scope.
  const selected = new Set((await selectActivities(siBaseline)).selected);
  const inScope = scorable.filter((f) => !f.question_id.startsWith(RR_ACTIVITY_PREFIX) || selected.has(f.question_id));
  const interviewAnswers = mapFactsToRRTAnswers(inScope, questionNodes);
  const mergedAnswers: Record<string, RRTAnswer> = { ...cascadeAnswers, ...interviewAnswers };

  const posture = generateReadinessPosture(mergedAnswers, [], {}, siBaseline);
  const conservativeScore = computeConservativeScore(posture);
  return { posture, conservativeScore };
}
