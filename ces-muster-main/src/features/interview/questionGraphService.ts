// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Provides the question graph to the interview runner.
// The graph is a static TypeScript constant (no YAML parsing, no network calls).
// This design satisfies the DW#5 CI assertion: zero API-origin network calls
// during an interview run.
import { QUESTION_GRAPH, type QuestionNode } from './questionGraph';
import { pruneByCoverage } from './factCoveragePruner';
import type { InterviewFact } from '@/shared/types/engagement';

export type { QuestionNode };

/**
 * Return the filtered question graph for the given declared stacks.
 *
 * Filtering rule:
 *   - If a question has `applicable_stacks` set, include it only when at
 *     least one declared stack matches.
 *   - If `applicable_stacks` is absent, always include the question.
 *
 * The function is async so callers can swap in a fetch-based implementation
 * in a future stage without changing their call sites.
 *
 * `facts` (optional, Finding 1) — when provided, the stack-filtered nodes are
 * passed through pruneByCoverage before returning, pruning questions already
 * covered by a non-unknown-confidence fact. Omitted or empty facts is a
 * no-op (Finding 4 invariant) — this keeps every existing caller that does
 * not pass facts behaviorally unchanged.
 */
export async function loadQuestionGraph(
  declaredStacks: string[],
  facts?: InterviewFact[]
): Promise<QuestionNode[]> {
  return pruneByCoverage(stackFilteredGraph(declaredStacks), facts ?? []);
}

/**
 * The stack filter alone (no coverage pruning), synchronous. FC-MU-3: the
 * interview PERSISTS facts against this set — a question hidden because a
 * harvest/discovery prefill already answers it stays in it (so its answer is
 * saved and scores), while a question hidden by a service change does not.
 */
export function stackFilteredGraph(declaredStacks: string[]): QuestionNode[] {
  if (declaredStacks.length === 0) {
    // No stack filter: include questions that have no stack requirement.
    return QUESTION_GRAPH.filter((q) => !q.applicable_stacks);
  }
  const stackSet = new Set(declaredStacks);
  return QUESTION_GRAPH.filter((q) => !q.applicable_stacks || q.applicable_stacks.some((s) => stackSet.has(s)));
}

/**
 * The stacks the interview filters on: the service inventory, plus the
 * 'on_prem_ot' pseudo-tag unless the Situation answer is an explicit 'no'
 * ('unsure' and the unanswered '' prune nothing — FCA).
 */
export function declaredStacksFor(selectedServices: string[], onPremOt: string): string[] {
  return onPremOt === 'no' ? selectedServices : [...selectedServices, 'on_prem_ot'];
}
