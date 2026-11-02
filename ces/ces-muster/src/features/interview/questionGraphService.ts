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
import { PHANTOM_RR_ACTIVITY_IDS, QUESTION_GRAPH, expandLegacyReadinessFacts, type QuestionNode } from './questionGraph';
import { pruneByCoverage } from './factCoveragePruner';
import type { InterviewFact } from '@/shared/types/engagement';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { mapToPreamble } from '@/features/scoring/preambleMapper';
import {
  RR_ACTIVITY_PREFIX,
  cascadeScope,
  residueActivities,
  scenarioSiBaseline,
  selectActivities,
} from '@/features/scoring/readinessScope';

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
 * covered by a non-unknown-confidence fact. Omitted or empty facts prunes
 * nothing by coverage (Finding 4 invariant).
 *
 * MG-07: the RR readiness activities are always scoped first — only the
 * scenario-selected activities the bulk cascade cannot settle are returned
 * (readinessResidueIds). Callers that MAP facts to requirements must resolve
 * nodes against the full QUESTION_GRAPH, not this asked subset.
 */
export async function loadQuestionGraph(
  declaredStacks: string[],
  facts?: InterviewFact[]
): Promise<QuestionNode[]> {
  const all = expandLegacyReadinessFacts(facts ?? []);
  const asked = await readinessResidueIds(declaredStacks, all);
  const nodes = stackFilteredGraph(declaredStacks).filter(
    (n) => !n.alias_of && (!isRrActivityNode(n) || asked.has(n.id))
  );
  return pruneByCoverage(nodes, all);
}

/** MG-07: an RR readiness activity node (one of the 165 generated from the RR bank). */
export function isRrActivityNode(n: Pick<QuestionNode, 'id'>): boolean {
  return n.id.startsWith(RR_ACTIVITY_PREFIX);
}

/**
 * MG-07 (D5): the RR activities the interview asks for this session — the
 * activities Planner's questionSetGenerator selects for the scenario, minus
 * those the vendored bulk cascade settles for the stack/answer-derived preamble.
 * Discovery and human answers then prune the rest (pruneByCoverage). Fetch-free.
 *
 * FIN-26b (NS-audit F-10): an activity whose every requirement is a phantom L2 twin
 * (an L2 label for an L1 practice the ces-shared reference does not have, e.g.
 * AC.L2-3.1.20) is never asked; the L1 twin is the practice. Scoring is unchanged:
 * a recorded fact for it still maps through QUESTION_GRAPH, and the cascade
 * derives its posture row exactly as before.
 */
export async function readinessResidueIds(declaredStacks: string[], facts: InterviewFact[]): Promise<Set<string>> {
  const scorable = scorableFacts(facts);
  const si = scenarioSiBaseline(scorable, declaredStacks);
  const { selected } = await selectActivities(si);
  const residue = residueActivities(selected, cascadeScope(mapToPreamble(declaredStacks, scorable), si));
  for (const id of PHANTOM_RR_ACTIVITY_IDS) residue.delete(id);
  return residue;
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
