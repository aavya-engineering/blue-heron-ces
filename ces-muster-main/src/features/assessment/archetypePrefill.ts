// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// archetypePrefill.ts — GO-2 M2 (rung 3 mechanism): apply an archetype's
// defaults as 'archetype-default' PRIORS over the unanswered part of the
// question set. Existing answers are never overwritten; every prefill is an
// unconfirmed draft (prunes, never passes) and individually overridable — an
// override is an ordinary human answer (recordAnswer's operator-takeover path).
import type { Archetype } from '@/__fixtures__/archetypes';
import { validArchetypeDefaults } from '@/__fixtures__/archetypes';
import type { QuestionNode } from '@/features/interview/questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';

export interface ArchetypePrefillResult {
  answers: Record<string, string>;
  provenances: Record<string, string>;
  confidences: Record<string, InterviewFact['confidence']>;
}

export function applyArchetypeDefaults(
  archetype: Archetype,
  graph: QuestionNode[],
  existingAnswers: Record<string, string>
): ArchetypePrefillResult {
  const answers: Record<string, string> = {};
  const provenances: Record<string, string> = {};
  const confidences: Record<string, InterviewFact['confidence']> = {};

  for (const [qid, answer] of Object.entries(validArchetypeDefaults(archetype, graph))) {
    if (existingAnswers[qid] !== undefined) continue; // existing wins, always
    answers[qid] = answer;
    provenances[qid] = 'archetype-default';
    // A prior is weak evidence: 'low' — it prunes (non-unknown) but advertises
    // its weakness; it never scores regardless (unconfirmed draft).
    confidences[qid] = 'low';
  }
  return { answers, provenances, confidences };
}