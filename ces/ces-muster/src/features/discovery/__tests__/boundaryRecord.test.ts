// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-32 (GOAL ruling 1): the boundary-confirm screen's download is the record of what was
// confirmed or corrected, with the same facts the interview receives.
import { describe, it, expect } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import { boundaryConfirmationRecord, BOUNDARY_RECORD_SCHEMA, processBoundaryDecisions } from '../boundaryConfirm';

const draft = (id: string, answer: string): InterviewFact => ({
  question_id: id,
  question_text: `Q ${id}`,
  answer,
  provenance: 'resolver_draft',
  confidence: 'medium',
  recorded_at: '2026-10-31T00:00:00.000Z',
});

describe('boundaryConfirmationRecord', () => {
  it('records drafts, each decision (leave by default) and the resulting facts', () => {
    const drafts = [draft('bnd-001', 'yes'), draft('bnd-002', 'yes'), draft('bnd-003', 'no')];
    const decisions = { 'bnd-001': { kind: 'confirm' as const }, 'bnd-002': { kind: 'correct' as const, answer: 'no' } };
    const rec = boundaryConfirmationRecord(drafts, decisions, ' Jane Assessor ', '2026-10-31T12:00:00.000Z');
    expect(rec.schema).toBe(BOUNDARY_RECORD_SCHEMA);
    expect(rec.confirmed_by).toBe('Jane Assessor');
    expect((rec.decisions as Record<string, unknown>)['bnd-003']).toEqual({ kind: 'leave' });
    const facts = rec.facts as InterviewFact[];
    expect(facts.map((f) => [f.question_id, f.answer, f.provenance])).toEqual(
      processBoundaryDecisions(drafts, decisions, 'Jane Assessor').map((f) => [f.question_id, f.answer, f.provenance])
    );
    expect(facts[1]).toMatchObject({ answer: 'no', provenance: 'operator_interview' });
  });

  it('a confirm with no name is refused, as on screen', () => {
    expect(() => boundaryConfirmationRecord([draft('bnd-001', 'yes')], { 'bnd-001': { kind: 'confirm' } }, '  ')).toThrow(/named human/);
  });
});
