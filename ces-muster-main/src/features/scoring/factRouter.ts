// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// factRouter.ts — A→C→B per-objective fact router (T2 slice, pure module).
//
// Provenance classes (A > C > B precedence):
//   A = 'auto_detected'  — machine-harvested current state
//   C = 'captured'       — recipe-captured point-in-time evidence
//   B = all others       — operator_interview / ai_adaptive interview answers
//
// FCA conservative merge rules:
//   1. Winner is always drawn from the highest class present.
//      A lower class can never override a higher class — not even with 'yes'.
//   2. Within the winning class, pick by conservative answer order:
//        'no' > 'unknown'|'unsure' > 'yes'
//      then by most recent recorded_at for ties.
//   3. [validate with BHD: machine-harvested current state (A) outranks captured
//      point-in-time evidence (C), so A 'yes' beats C 'no'.]
import type { InterviewFact } from '@/shared/types/engagement';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Provenance tier assigned by classOf().
 *   A — machine-harvested; highest precedence
 *   C — recipe-captured; middle precedence
 *   B — interview/adaptive; lowest precedence
 */
export type ProvenanceClass = 'A' | 'C' | 'B';

/** Audit record returned by mergeExplanation for a single objective group. */
export interface MergeExplanation {
  question_id: string;
  winner: InterviewFact;
  suppressed: InterviewFact[];
}

// ── Internal constants ────────────────────────────────────────────────────────

/** Lower number = higher precedence. */
const CLASS_RANK: Record<ProvenanceClass, number> = { A: 0, C: 1, B: 2 };

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Map a provenance string to its tier class.
 * Unknown/unrecognised provenances default to B (conservative fallback).
 */
export function classOf(provenance: string): ProvenanceClass {
  if (provenance === 'auto_detected') return 'A';
  if (provenance === 'captured') return 'C';
  return 'B';
}

/**
 * G-MUSTER-GO-2: fact-aware tier. An UNCONFIRMED resolver draft is B (today's
 * conservative fallback for its unrecognized provenance string — unchanged).
 * Once ATTESTED (goal's mapping table):
 *   discovery-inferred  → A  (derived from auto_detected evidence; confirmation
 *                             upgrades it to the evidence's own class)
 *   document-extracted  → C  (point-in-time evidence read from a captured document)
 *   archetype-default   → B  (a prior; attestation makes it a human answer)
 *   interview-extracted → B  (parsed human speech is still a human answer)
 * Everything else defers to classOf(provenance). A > C > B precedence itself is
 * untouched.
 */
const ATTESTED_DRAFT_CLASS: Record<string, ProvenanceClass> = {
  'discovery-inferred': 'A',
  'document-extracted': 'C',
  'archetype-default': 'B',
  'interview-extracted': 'B',
};

export function classOfFact(fact: InterviewFact): ProvenanceClass {
  if (fact.attestation !== undefined) {
    const attested = ATTESTED_DRAFT_CLASS[fact.provenance];
    if (attested) return attested;
  }
  return classOf(fact.provenance);
}

/**
 * Return the winner and suppressed facts for a single-objective group.
 * All facts in `group` must share the same question_id.
 * The returned `winner` is the same object reference as in the input array.
 */
export function mergeExplanation(group: InterviewFact[]): MergeExplanation {
  const winner = pickWinner(group);
  return {
    question_id: group[0].question_id,
    winner,
    suppressed: group.filter((f) => f !== winner),
  };
}

/**
 * Route a mixed-provenance fact set to one winner per objective (question_id).
 *
 * Groups facts by question_id, then for each group selects the single winning
 * fact using A > C > B precedence with FCA conservative within-class merge.
 *
 * The output is safe to pass directly to scoreFacts — one InterviewFact per
 * question_id, same shape as the original array. A single-fact group returns
 * that fact unchanged.
 */
export function routeFacts(facts: InterviewFact[]): InterviewFact[] {
  const groups = new Map<string, InterviewFact[]>();
  for (const fact of facts) {
    let group = groups.get(fact.question_id);
    if (!group) {
      group = [];
      groups.set(fact.question_id, group);
    }
    group.push(fact);
  }

  const winners: InterviewFact[] = [];
  for (const group of groups.values()) {
    winners.push(pickWinner(group));
  }
  return winners;
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Conservative answer rank: lower = more conservative = wins within-class ties.
 *   'no' (0) > 'unknown'|'unsure' (1) > 'yes' and anything else (2)
 */
function answerRank(answer: string): number {
  if (answer === 'no') return 0;
  if (answer === 'unknown' || answer === 'unsure') return 1;
  return 2;
}

/**
 * Comparator for within-class winner selection (for use with Array.sort).
 * Primary key: most conservative answer (ascending answerRank).
 * Tiebreak: most recent recorded_at (descending — later = closer to index 0).
 */
function compareConservative(a: InterviewFact, b: InterviewFact): number {
  const rankDiff = answerRank(a.answer) - answerRank(b.answer);
  if (rankDiff !== 0) return rankDiff;
  return new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
}

/**
 * Pick the single winning fact from a same-question_id group.
 *
 * 1. Find the highest-precedence class present (A → C → B).
 * 2. Filter to that class.
 * 3. Sort by conservative answer then recency; return the first element.
 *
 * Returns an original object reference from the input array, not a copy.
 */
function pickWinner(group: InterviewFact[]): InterviewFact {
  let bestClass: ProvenanceClass = 'B';
  for (const f of group) {
    const cls = classOfFact(f);
    if (CLASS_RANK[cls] < CLASS_RANK[bestClass]) {
      bestClass = cls;
    }
  }
  const candidates = group.filter((f) => classOfFact(f) === bestClass);
  return [...candidates].sort(compareConservative)[0];
}
