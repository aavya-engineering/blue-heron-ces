// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// siResidue.ts — G-MUSTER-PLAN-3 M1: the SIT plan-input residue as
// question-graph nodes, built FROM Planner's primed SI Question Bank (the
// source), with options recovered from the SI schema's per-field enums. This is
// the "one graph, one bank" realization: the residue joins the existing
// QuestionNode graph and prunes through the existing pruneByCoverage against
// derived facts. No second bank, no second pruner.
//
// Plan-input nodes carry `mapped_requirements: []` — they capture plan inputs,
// never readiness posture, so they contribute ZERO to SPRS (the brutal-critic
// "score leak" surface; asserted in the score-leak test).
//
// Field labels double as the human names shown on the Plan tab's
// defaultedInputs line.
import type { QuestionNode } from '@/features/interview/questionGraph';
import { pruneByCoverage } from '@/features/interview/factCoveragePruner';
import type { InterviewFact } from '@/shared/types/engagement';

/** SIT question id -> short human label (for the Plan tab's "N plan inputs
 * unanswered" line and node text fallback). */
export const SI_FIELD_LABELS: Record<string, string> = {
  'G-01': 'target CMMC level',
  'G-02': 'CUI presence',
  'G-03': 'CUI types',
  'G-04': 'regulated data notes',
  'G-05': 'assessment route',
  'G-06': 'certification timing goal',
  'G-07': 'boundary strategy',
  'G-08': 'deployment posture',
  'S-11': 'in-scope users/endpoints estimate',
  'S-12': 'collaboration mode',
  'S-13': 'BYOD posture',
  'S-16': 'evidence posture target',
  'S-20': 'tenant model preference',
  'SIT-020': 'infrastructure model',
  'SIT-021': 'license tier',
  'SIT-022': 'in-scope M365 user count',
  'SIT-023': 'FedRAMP package IDs',
  'SIT-024': 'physical facility count',
  'SIT-025': 'customer equipment count',
  'S-24': 'POA&M policy intent',
  'S-25': 'mobile device presence',
  'S-26': 'wireless posture',
  'S-27': 'removable media posture',
  'S-28': 'remote access posture',
  'S-29': 'maintenance posture',
  'S-30': 'CUI endpoint posture',
};

/** A primed-bank question (the fields siResidue reads). */
export interface SiBankQuestion {
  id: string;
  text: string;
  sets_its_fields?: string[];
  recommended?: string;
}

/** Turn a schema enum value into a readable option label. */
function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build SIT plan-input QuestionNodes from the primed bank. `enumsByField` maps
 * a si_baseline.* path to its schema enum (from the SI schema); a question whose
 * field has an enum renders those options, otherwise a free-text node (options
 * empty). `cluster` is 'plan-input:si' so the interview can group them. Every
 * node carries `plan_input` and empty `mapped_requirements`.
 */
export function buildSiPlanInputNodes(
  questions: SiBankQuestion[],
  enumsByField: Record<string, string[]>
): QuestionNode[] {
  return questions.map((q) => {
    const field = q.sets_its_fields?.[0] ?? '';
    const enumVals = enumsByField[field] ?? [];
    return {
      id: q.id,
      text: q.text,
      options: enumVals.map((v) => ({ label: labelize(v), value: v })),
      cluster: 'plan-input:si',
      mapped_requirements: [],
      plan_input: { contract: 'si_baseline', field },
    };
  });
}

/**
 * The residue the interview should ask: SIT plan-input nodes minus those a
 * derived (or already-answered) fact covers — the existing confidence-based
 * pruner, unchanged. `derivedFacts` are siDerivation's facts plus any residue
 * already answered.
 */
export function residueSiNodes(
  allSiNodes: QuestionNode[],
  derivedFacts: InterviewFact[]
): QuestionNode[] {
  return pruneByCoverage(allSiNodes, derivedFacts);
}
