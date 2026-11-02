// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// boundaryConfirm.ts — G-MUSTER-GO-2 M1: pure decision-processing for the
// boundary confirm/correct step (the UI in BoundaryConfirmPanel.tsx is a thin
// skin over this). Confirm-don't-recall semantics:
//   - leave      -> the draft persists exactly as drafted: provenance
//                   'discovery-inferred', NO attestation (unconfirmed draft —
//                   prunes, never passes).
//   - confirm    -> named-human attestation written via confirmFact (the fact
//                   now counts; classOfFact upgrades discovery-inferred to A).
//   - correct    -> the human's edit REPLACES the draft: an ordinary
//                   operator_interview fact (a corrected field is a human
//                   answer, not an annotated draft).
import type { InterviewFact } from '@/shared/types/engagement';
import { confirmFact } from '@/features/scoring/draftSemantics';

export type BoundaryDecision =
  | { kind: 'leave' }
  | { kind: 'confirm' }
  | { kind: 'correct'; answer: string };

export function processBoundaryDecisions(
  drafts: InterviewFact[],
  decisions: Record<string, BoundaryDecision>,
  confirmedBy: string,
  confirmedOn?: string
): InterviewFact[] {
  // Brutal-critic D1: the pure layer enforces the named-human invariant — it
  // never trusts the panel's disabled buttons. Any confirm decision with a
  // blank name is rejected loudly, before any fact is produced.
  if (
    confirmedBy.trim() === '' &&
    Object.values(decisions).some((d) => d.kind === 'confirm')
  ) {
    throw new Error(
      'processBoundaryDecisions: confirm decisions require a named human (blank name rejected)'
    );
  }
  const now = new Date().toISOString();
  return drafts.map((draft) => {
    const decision = decisions[draft.question_id] ?? { kind: 'leave' };
    switch (decision.kind) {
      case 'confirm':
        return confirmFact(draft, confirmedBy, confirmedOn);
      case 'correct':
        return {
          question_id: draft.question_id,
          question_text: draft.question_text,
          answer: decision.answer,
          provenance: 'operator_interview',
          confidence: decision.answer === 'unknown' ? 'unknown' : 'high',
          recorded_at: now,
        };
      case 'leave':
        return draft;
    }
  });
}

/**
 * FIN-32 (GOAL ruling 1): the boundary as confirmed or corrected on this screen, as a file. The
 * CUI Boundary artifact itself needs the SI Baseline, so it is built at compile and downloads on
 * the Plan tab (both the in-browser and the muster-api paths); this record is what feeds it.
 */
export const BOUNDARY_RECORD_SCHEMA = 'muster/boundary-confirmation@1';
export function boundaryConfirmationRecord(
  drafts: InterviewFact[],
  decisions: Record<string, BoundaryDecision>,
  confirmerName: string,
  at: string = new Date().toISOString()
): Record<string, unknown> {
  return {
    schema: BOUNDARY_RECORD_SCHEMA,
    recorded_at: at,
    confirmed_by: confirmerName.trim() || null,
    drafts: drafts.map((d) => ({ question_id: d.question_id, question_text: d.question_text, drafted_answer: d.answer })),
    decisions: Object.fromEntries(
      drafts.map((d) => [d.question_id, decisions[d.question_id] ?? { kind: 'leave' }])
    ),
    facts: processBoundaryDecisions(drafts, decisions, confirmerName.trim()),
  };
}
