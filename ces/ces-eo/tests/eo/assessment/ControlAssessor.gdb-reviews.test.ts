// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * NS-1 (GD-b): document reviews decide a control only when no stack source has an opinion; every
 * objective needs a countable met review; a countable not_met review wins; an EC item whose uploader
 * is unknown (uploadedBy null/absent) can never be satisfied; the uploader cannot review their own
 * upload; with no reviews the snapshot is unchanged. Drives the real ControlAssessor.merge.
 */
import type { AssessmentSource } from 'ces-shared/types/controls';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { ControlAssessor, objectiveIdsByControl, type DocumentReview } from '../../../src/eo/assessment/ControlAssessor';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');

const NONSTACK = 'AT.L2-3.2.1'; // 4 objectives [a]-[d]; no stack source in these fixtures
const STACK_MET = 'AC.L1-3.1.1';
const STACK_NOT_MET = 'SC.L1-3.13.1';
const HASH = 'b'.repeat(64);
const UPLOADER = { subjectId: 'uploader:u1', upn: 'Uploader.One@tenant.example.test' };
const REVIEWER = 'reviewer.two@tenant.example.test';

function ecItem(controlId: string, overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: `item-${controlId}`,
    tenantSlug: 'gdb-tenant',
    controlIds: [controlId],
    source: 'manual_upload',
    filename: 'roster.pdf',
    mediaType: 'application/pdf',
    sha256: HASH,
    sizeBytes: 10,
    collectedAt: '2026-10-30T00:00:00.000Z',
    submittedByRole: 'compliance_officer',
    uploadedBy: UPLOADER,
    mode: 'sim',
    ...overrides,
  };
}

let n = 0;
function review(controlId: string, objectiveId: string, verdict: 'met' | 'not_met' = 'met', reviewerUpn = REVIEWER): DocumentReview {
  n++;
  return {
    reviewId: `rev-${n}`, tenantSlug: 'gdb-tenant', controlId, objectiveId, artifactHash: HASH, verdict,
    reviewer: { upn: reviewerUpn, subjectId: `ao-approver:${reviewerUpn}`, tokenId: `jti-${n}` },
    uploader: UPLOADER, ecItemIds: [`item-${controlId}`], reviewedAt: '2026-10-30T01:00:00.000Z',
  };
}
const allObjectives = (controlId: string, verdict: 'met' | 'not_met' = 'met', upn = REVIEWER) =>
  objectiveIdsByControl().get(controlId)!.map(o => review(controlId, o, verdict, upn));

const stamper = new Map<string, AssessmentSource[]>([
  [STACK_MET, [{ type: 'evidence_import', timestamp: '2026-10-30T00:00:00.000Z', detail: 'Stamper AC-1 SAT', result: 'imported' }]],
  [STACK_NOT_MET, [{ type: 'evidence_import', timestamp: '2026-10-30T00:00:00.000Z', detail: 'Stamper SC-1 NOT_SAT', result: 'missing' }]],
]);
const items = [ecItem(NONSTACK), ecItem(STACK_MET), ecItem(STACK_NOT_MET)];

function run(reviews?: DocumentReview[], ec: EcEvidenceItem[] = items) {
  const a = new ControlAssessor(controlsRefPath, []);
  return reviews === undefined
    ? a.merge('gdb-tenant', [], [], [], [], stamper, undefined, undefined, ec)
    : a.merge('gdb-tenant', [], [], [], [], stamper, undefined, undefined, ec, undefined, reviews);
}
const statusOf = (snap: ReturnType<typeof run>, id: string) => snap.controls.find(c => c.control_id === id)!.status;
const counts = (s: ReturnType<typeof run>) => [s.controls_met, s.controls_not_met, s.controls_partial, s.controls_not_assessed];

describe('NS-1 GD-b: document reviews in ControlAssessor', () => {
  it('fixture: no reviews -> no status change (param omitted vs empty vs uncountable reviews)', () => {
    const base = run();
    const empty = run([]);
    const uncountable = run(allObjectives(NONSTACK), [ecItem(NONSTACK, { uploadedBy: null }), ecItem(STACK_MET), ecItem(STACK_NOT_MET)]);
    const baseNoNull = run(undefined, [ecItem(NONSTACK, { uploadedBy: null }), ecItem(STACK_MET), ecItem(STACK_NOT_MET)]);
    expect(empty.controls.map(c => c.status)).toEqual(base.controls.map(c => c.status));
    expect(counts(empty)).toEqual(counts(base));
    expect(uncountable.controls.map(c => c.status)).toEqual(baseNoNull.controls.map(c => c.status));
    expect(statusOf(base, NONSTACK)).toBe('not_assessed');
    expect(statusOf(base, STACK_MET)).toBe('met');
    expect(statusOf(base, STACK_NOT_MET)).toBe('not_met');
  });

  it('every objective required: all objectives met -> met; one missing -> stays not_assessed', () => {
    const all = allObjectives(NONSTACK);
    const met = run(all);
    expect(statusOf(met, NONSTACK)).toBe('met');
    expect(met.controls.find(c => c.control_id === NONSTACK)!.statusRationale).toMatch(/^GD-b/);
    expect(met.controls_met).toBe(run().controls_met + 1);
    expect(statusOf(run(all.slice(1)), NONSTACK)).toBe('not_assessed');
  });

  it('not_met wins over met reviews', () => {
    const reviews = [...allObjectives(NONSTACK), review(NONSTACK, `${NONSTACK}[b]`, 'not_met')];
    expect(statusOf(run(reviews), NONSTACK)).toBe('not_met');
  });

  it('a single not_met review sets not_met', () => {
    expect(statusOf(run([review(NONSTACK, `${NONSTACK}[a]`, 'not_met')]), NONSTACK)).toBe('not_met');
  });

  it('stack outranks: a stack met stays met under not_met reviews; a stack not_met stays not_met under all-met reviews', () => {
    const snap = run([...allObjectives(STACK_MET, 'not_met'), ...allObjectives(STACK_NOT_MET, 'met')]);
    expect(statusOf(snap, STACK_MET)).toBe('met');
    expect(statusOf(snap, STACK_NOT_MET)).toBe('not_met');
  });

  it('null or absent uploader is unsatisfiable (met and not_met reviews both ignored)', () => {
    const { uploadedBy: _drop, ...absent } = ecItem(NONSTACK);
    for (const item of [ecItem(NONSTACK, { uploadedBy: null }), absent as EcEvidenceItem]) {
      expect(statusOf(run(allObjectives(NONSTACK), [item]), NONSTACK)).toBe('not_assessed');
      expect(statusOf(run([review(NONSTACK, `${NONSTACK}[a]`, 'not_met')], [item]), NONSTACK)).toBe('not_assessed');
    }
  });

  it('the uploader cannot satisfy their own upload (UPN compared case-insensitively)', () => {
    expect(statusOf(run(allObjectives(NONSTACK, 'met', UPLOADER.upn.toUpperCase())), NONSTACK)).toBe('not_assessed');
  });

  it('a review citing a hash no EC item for the control carries does not count', () => {
    const reviews = allObjectives(NONSTACK).map(r => ({ ...r, artifactHash: 'c'.repeat(64) }));
    expect(statusOf(run(reviews), NONSTACK)).toBe('not_assessed');
  });
});
