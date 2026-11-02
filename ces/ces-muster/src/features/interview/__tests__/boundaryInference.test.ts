// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-GO-2 M1 gate: a drafted boundary from the canned discovery fixture;
// edited fields persist as CORRECTED (ordinary human answers); unedited fields
// persist as source 'discovery-inferred', unattested.
import { describe, test, expect } from 'vitest';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';
import { inferBoundaryDrafts } from '../boundaryInference';
import { processBoundaryDecisions } from '@/features/discovery/boundaryConfirm';
import { isUnconfirmedDraft } from '@/features/scoring/draftSemantics';

describe('GO-2 M1 — boundary inference (rung 1)', () => {
  test('drafts a boundary from the canned fixture: discovery-inferred, unattested', () => {
    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.question_id).toMatch(/^bnd-/);
      expect(d.provenance).toBe('discovery-inferred');
      expect(d.attestation).toBeUndefined();
      expect(isUnconfirmedDraft(d)).toBe(true);
      expect(d.confidence).not.toBe('unknown');
    }
    // The fixture's identity+protection evidence covers all three boundary rules.
    expect(drafts.map((d) => d.question_id)).toEqual(['bnd-001', 'bnd-002', 'bnd-003']);
  });

  test('unknown-confidence evidence never drafts (FCA: unknown launders nothing)', () => {
    const unknownOnly = DISCOVERY_RESULTS_FIXTURE.map((r) => ({
      ...r,
      confidence: 'unknown' as const,
    }));
    expect(inferBoundaryDrafts(unknownOnly)).toEqual([]);
  });

  test('a drafted confidence is never stronger than its weakest evidence', () => {
    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    // bnd-003 draws on AC./IA. rows, which include medium-confidence evidence.
    const bnd3 = drafts.find((d) => d.question_id === 'bnd-003');
    expect(bnd3?.confidence).toBe('medium');
  });

  test('edited fields persist as corrected; unedited persist discovery-inferred, unattested', () => {
    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    const processed = processBoundaryDecisions(
      drafts,
      { 'bnd-002': { kind: 'correct', answer: 'no' } },
      'Jane Assessor'
    );

    const corrected = processed.find((f) => f.question_id === 'bnd-002')!;
    expect(corrected.answer).toBe('no');
    expect(corrected.provenance).toBe('operator_interview');
    expect(corrected.attestation).toBeUndefined();
    expect(isUnconfirmedDraft(corrected)).toBe(false); // a human answer, not a draft

    for (const f of processed.filter((x) => x.question_id !== 'bnd-002')) {
      expect(f.provenance).toBe('discovery-inferred');
      expect(f.attestation).toBeUndefined();
      expect(isUnconfirmedDraft(f)).toBe(true);
    }
  });

  test('D1 regression: a confirm decision with a blank name is REJECTED by the pure layer (UI gating is not trusted)', () => {
    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    expect(() =>
      processBoundaryDecisions(drafts, { 'bnd-001': { kind: 'confirm' } }, '')
    ).toThrow(/named human/);
    expect(() =>
      processBoundaryDecisions(drafts, { 'bnd-001': { kind: 'confirm' } }, '   ')
    ).toThrow(/named human/);
    // leave/correct decisions need no name — blank is fine when nothing confirms.
    const processed = processBoundaryDecisions(
      drafts,
      { 'bnd-002': { kind: 'correct', answer: 'no' } },
      ''
    );
    expect(processed.find((f) => f.question_id === 'bnd-002')!.answer).toBe('no');
  });

  test('confirming writes the named-human attestation and the fact stops being a draft', () => {
    const drafts = inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE);
    const processed = processBoundaryDecisions(
      drafts,
      { 'bnd-001': { kind: 'confirm' } },
      'Jane Assessor',
      '2026-07-11'
    );
    const confirmed = processed.find((f) => f.question_id === 'bnd-001')!;
    expect(confirmed.provenance).toBe('discovery-inferred');
    expect(confirmed.attestation).toEqual({
      drafted_by: 'discovery inference',
      confirmed_by: 'Jane Assessor',
      confirmed_on: '2026-07-11',
    });
    expect(isUnconfirmedDraft(confirmed)).toBe(false);
  });
});