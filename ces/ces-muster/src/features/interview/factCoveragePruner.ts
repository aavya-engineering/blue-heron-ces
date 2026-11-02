// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// P1 resolution #3 — net-new pruner as ONE shared module.
// Manual branch calls pruneByCoverage(nodes, []) — a no-op (Finding 4 invariant).
// Discovery branch calls it with synthesized + human facts.
// Never touches src/vendored/ces-spine/services/bulkAnswerDerivation.ts —
// that cascade is precedent only.
// 2026-07-11 (ADAPTIVE_VERIFY divergence fix #1): confidence-tiered pruning
// made production-live — see doc comment on pruneByCoverage for the exact
// tier rules now enforced.
import type { QuestionNode } from './questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';
import { confidenceRank } from './discoveryFactJoin';

/**
 * Prune question nodes that are already covered by a fact with sufficient
 * confidence.
 *
 * MG-02: an auto_detected (discovery) fact on a readiness node prunes only when
 * its answer is 'yes' (a predicate-backed met); a not_met 'no' never prunes.
 *
 * FCA clause 1 (Finding 2): a fact with confidence 'unknown' NEVER prunes its
 * question, regardless of any other fact present for that question — an
 * unknown discovery row must still surface to the operator. 'unknown' facts
 * are excluded before rank comparison (hard exclusion, applied first).
 *
 * Confidence-tiered semantics (GO-1 "Adaptive answering, defined" —
 * "equal-or-higher confidence"; ADAPTIVE_VERIFY-2026-07-11 divergence #1
 * resolution): among the remaining (non-unknown) facts for a question_id,
 * only the fact(s) at the HIGHEST confidenceRank for that question govern
 * coverage —
 *   1. Group non-unknown facts by question_id.
 *   2. For each group, take max(confidenceRank(f.confidence)).
 *   3. The question is covered/pruned by that top rank regardless of answer
 *      value, UNLESS a strictly lower-ranked fact in the same group has a
 *      different `answer` than a top-rank fact — that lower-ranked
 *      conflicting fact contributes nothing; it is simply excluded from the
 *      governing set. It can never veto or independently prune, since only
 *      top-rank facts ever prune.
 *   4. A question is pruned iff its top rank among covering facts is >= 0
 *      (i.e., at least one non-unknown fact exists for it) — the same
 *      admission bar as before, but the identity of which fact "counts" as
 *      coverage is now always the highest-ranked one, per the design text.
 */
export function pruneByCoverage(
  nodes: QuestionNode[],
  facts: InterviewFact[]
): QuestionNode[] {
  if (facts.length === 0) return nodes;

  // MG-02: a discovery not_met (auto_detected 'no') on a readiness node keeps the
  // question asked — discovery prunes only with a met verdict. Plan-input nodes
  // (mapped_requirements: [], e.g. a discovered TCP value) are unaffected.
  const readinessIds = new Set(
    nodes.filter((n) => n.mapped_requirements.length > 0 && !n.plan_input).map((n) => n.id)
  );
  const nonUnknown = facts.filter(
    (f) =>
      f.confidence !== 'unknown' &&
      !(f.provenance === 'auto_detected' && f.answer !== 'yes' && readinessIds.has(f.question_id))
  );
  if (nonUnknown.length === 0) return nodes;

  // Group by question_id, track the governing (highest-ranked) fact per group.
  const topRankByQuestion = new Map<string, number>();
  for (const f of nonUnknown) {
    const rank = confidenceRank(f.confidence);
    const existing = topRankByQuestion.get(f.question_id);
    if (existing === undefined || rank > existing) {
      topRankByQuestion.set(f.question_id, rank);
    }
  }

  return nodes.filter((n) => !topRankByQuestion.has(n.id));
}
