// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// archetypePriors.ts — MG-21: the selected archetype's priors for the SI plan
// inputs. Order is discover -> infer -> archetype -> ask: a prior fills only a
// bank question that is neither derived nor answered, so it never overrides
// discovery, a derivation or the operator. Each prior is a fact with provenance
// `archetype:<id>` (SIT provenance_class 'assumption'), reported as field source
// 'archetype' and removed from defaultedInputs.
import { archetypeById, validArchetypeDefaults } from '@/__fixtures__/archetypes';
import type { QuestionNode } from '@/features/interview/questionGraph';
import type { InterviewFact } from '@/shared/types/engagement';

export const ARCHETYPE_PROVENANCE_PREFIX = 'archetype:';

export function archetypeSitFacts(
  archetypeId: string | null | undefined,
  graph: QuestionNode[],
  bankIds: Set<string>,
  filledIds: Set<string>
): InterviewFact[] {
  const archetype = archetypeById(archetypeId);
  if (!archetype) return [];
  const textById = new Map(graph.map((n) => [n.id, n.text]));
  return Object.entries(validArchetypeDefaults(archetype, graph))
    .filter(([qid]) => bankIds.has(qid) && !filledIds.has(qid))
    .map(([qid, answer]) => ({
      question_id: qid,
      question_text: textById.get(qid) ?? qid,
      answer,
      provenance: `${ARCHETYPE_PROVENANCE_PREFIX}${archetype.id}`,
      confidence: 'low' as const,
      recorded_at: '1970-01-01T00:00:00.000Z',
    }));
}
