// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-F (M4a) — EC evidence items (manual uploads/attestations) must appear in a
 * control's detail (`sources`) WITHOUT ever changing that control's computed verdict, its
 * `automationSource`, or its `evidenceArtifactIds` (that array also feeds
 * `DirectiveSprsCalculator`'s "verified artifact" check and the SSP narrative's "Evidence:"
 * line — both would read an EC upload as verified, a claim EO can't back for evidence
 * nobody has reviewed yet, so EC items are display-only via `sources`). Drives the real
 * `ControlAssessor.merge` (production code), not a re-implementation of its status rule.
 */
import type { ControlAssessment, AssessmentSource } from 'ces-shared/types/controls';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { ControlAssessor } from '../../../src/eo/assessment/ControlAssessor';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');

const NOT_ASSESSED_CONTROL = 'SC.L1-3.13.1'; // no other source wired for this test
const MET_CONTROL = 'AC.L1-3.1.1';
const NOT_MET_CONTROL = 'AU.L2-3.3.1';

function ecItem(overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: 'item-1',
    tenantSlug: 'acme-sim',
    controlIds: [NOT_ASSESSED_CONTROL],
    source: 'manual_upload',
    filename: 'training-roster.pdf',
    mediaType: 'application/pdf',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    collectedAt: '2026-09-28T00:00:00.000Z',
    submittedByRole: 'compliance_officer',
    mode: 'sim',
    ...overrides,
  };
}

function assessments(ecItems: EcEvidenceItem[], stamperEvidenceSources?: Map<string, AssessmentSource[]>): ControlAssessment[] {
  return new ControlAssessor(controlsRefPath, []).merge(
    'ec-items-tenant',
    [],
    [],
    [],
    [],
    stamperEvidenceSources,
    undefined,
    undefined,
    ecItems,
  ).controls;
}

function find(controls: ControlAssessment[], controlId: string): ControlAssessment {
  const c = controls.find(x => x.control_id === controlId);
  if (!c) throw new Error(`control ${controlId} not found in reference`);
  return c;
}

describe('M4a: ControlAssessor.merge with EC evidence items', () => {
  it('a control with no other source stays not_assessed after an EC upload (no auto-SAT)', () => {
    const withoutEc = find(assessments([]), NOT_ASSESSED_CONTROL);
    expect(withoutEc.status).toBe('not_assessed');

    const withEc = find(assessments([ecItem()]), NOT_ASSESSED_CONTROL);
    expect(withEc.status).toBe('not_assessed'); // verdict unchanged
  });

  it('the EC item is visible in that control detail via sources, with a neutral no_query result', () => {
    const c = find(assessments([ecItem({ itemId: 'item-42', filename: 'visitor-log.pdf' })]), NOT_ASSESSED_CONTROL);
    const ecSource = c.sources.find(s => s.type === 'ec_capture');
    expect(ecSource).toBeDefined();
    expect(ecSource?.result).toBe('no_query');
    expect(ecSource?.detail).toContain('item-42');
    expect(ecSource?.detail).toContain('visitor-log.pdf');
  });

  it('evidenceArtifactIds is untouched by an EC upload (SSP/SPRS "verified artifact" consumers never see it)', () => {
    const withoutEc = find(assessments([]), NOT_ASSESSED_CONTROL);
    const withEc = find(assessments([ecItem({ itemId: 'item-42' })]), NOT_ASSESSED_CONTROL);
    expect(withEc.evidenceArtifactIds).toEqual(withoutEc.evidenceArtifactIds);
    expect(withEc.evidenceArtifactIds).not.toContain('item-42');
  });

  it('a control already MET by a positive source stays met after an EC upload', () => {
    const positiveSource = new Map<string, AssessmentSource[]>([
      [MET_CONTROL, [{ type: 'evidence_import', timestamp: '2026-09-28T00:00:00.000Z', detail: 'x', result: 'imported' }]],
    ]);
    const withoutEc = find(assessments([], positiveSource), MET_CONTROL);
    expect(withoutEc.status).toBe('met');

    const withEc = find(assessments([ecItem({ controlIds: [MET_CONTROL] })], positiveSource), MET_CONTROL);
    expect(withEc.status).toBe('met');
    expect(withEc.sources.some(s => s.type === 'ec_capture')).toBe(true);
  });

  it('a control that is NOT_MET (a real negative source, no positive one) stays not_met after an EC upload', () => {
    const negativeSource = new Map<string, AssessmentSource[]>([
      [NOT_MET_CONTROL, [{ type: 'discovery', timestamp: '2026-09-28T00:00:00.000Z', detail: 'x', result: 'missing' }]],
    ]);
    const withoutEc = find(assessments([], negativeSource), NOT_MET_CONTROL);
    expect(withoutEc.status).toBe('not_met');

    const withEc = find(assessments([ecItem({ controlIds: [NOT_MET_CONTROL] })], negativeSource), NOT_MET_CONTROL);
    expect(withEc.status).toBe('not_met'); // still not_met — EC upload alone never flips it to met
  });

  it('an item naming two controls appears in both control details (via sources)', () => {
    const controls = assessments([ecItem({ itemId: 'item-multi', controlIds: [NOT_ASSESSED_CONTROL, NOT_MET_CONTROL] })]);
    expect(find(controls, NOT_ASSESSED_CONTROL).sources.some(s => s.type === 'ec_capture' && s.detail.includes('item-multi'))).toBe(true);
    expect(find(controls, NOT_MET_CONTROL).sources.some(s => s.type === 'ec_capture' && s.detail.includes('item-multi'))).toBe(true);
  });

  it('sources_merged carries "ec_capture" only when EC items are actually present', () => {
    const snapshotWithoutEc = new ControlAssessor(controlsRefPath, []).merge('t', [], [], [], [], undefined, undefined, undefined, []);
    expect(snapshotWithoutEc.sources_merged).not.toContain('ec_capture');
    const snapshotWithEc = new ControlAssessor(controlsRefPath, []).merge('t', [], [], [], [], undefined, undefined, undefined, [ecItem()]);
    expect(snapshotWithEc.sources_merged).toContain('ec_capture');
  });

  it('automationSource is unaffected by an EC upload alone (stays "manual")', () => {
    const c = find(assessments([ecItem()]), NOT_ASSESSED_CONTROL);
    expect(c.automationSource).toBe('manual');
  });

  it('SprsCalculator.calculate output is byte-identical with and without an EC upload (SPRS reads only .status)', () => {
    const sprs = new SprsCalculator();
    const withoutEc = sprs.calculate(assessments([]));
    const withEc = sprs.calculate(assessments([ecItem({ controlIds: [MET_CONTROL, NOT_MET_CONTROL, NOT_ASSESSED_CONTROL] })]));
    expect(withEc).toEqual(withoutEc);
  });
});
