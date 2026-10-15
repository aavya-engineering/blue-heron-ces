// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G3 #4 — pin the SPRS scoring math across edge cases (NIST SP 800-171 DoD methodology v1.2.1).
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';
import type { ControlAssessment } from 'ces-shared/types/controls';

const calc = new SprsCalculator();
const CONTROLS = calc.weights.controls; // 110 entries
const SUM_WEIGHTS = CONTROLS.reduce((s, c) => s + c.weight, 0);

// Minimal assessment — the calculator keys on nist_ref + status (control_id used for blocker labels).
const mk = (nist_ref: string, status: string): ControlAssessment =>
  ({ control_id: nist_ref, nist_ref, status } as unknown as ControlAssessment);
const allWith = (status: string) => CONTROLS.map((c) => mk(c.nist_ref, status));
const allMetexcept = (nist_ref: string, status: string) =>
  CONTROLS.map((c) => mk(c.nist_ref, c.nist_ref === nist_ref ? status : 'met'));

describe('SprsCalculator — scoring edge cases', () => {
  it('the weights file is the 110-control NIST set', () => {
    expect(CONTROLS).toHaveLength(110);
  });

  it('all met → 110, full certification, POA&M eligible, no deductions', () => {
    const r = calc.calculate(allWith('met'));
    expect(r.score).toBe(110);
    expect(r.controlsMet).toBe(110);
    expect(r.deductions).toEqual([]);
    expect(r.poamEligible).toBe(true);
    expect(r.certificationPath).toBe('full');
  });

  it('all not_met → 110 − ΣweightS (real SPRS minimum; score is NOT floored at 0), blocked', () => {
    const r = calc.calculate(allWith('not_met'));
    expect(r.score).toBe(110 - SUM_WEIGHTS);
    expect(r.score).toBeLessThan(0); // SPRS legitimately goes negative (down to −203)
    expect(r.controlsNotMet).toBe(110);
    expect(r.poamEligible).toBe(false);
    expect(r.certificationPath).toBe('blocked');
  });

  it('not_assessed scores identically to not_met (counts separately)', () => {
    const na = calc.calculate(allMetexcept('3.5.5', 'not_assessed'));
    const nm = calc.calculate(allMetexcept('3.5.5', 'not_met'));
    expect(na.score).toBe(nm.score);
    expect(na.controlsNotAssessed).toBe(1);
    expect(na.score).toBe(109); // 3.5.5 is a 1-pt control
  });

  it('single 5-pt not_met → −5, blocks POA&M (control is a blocker)', () => {
    const r = calc.calculate(allMetexcept('3.1.1', 'not_met')); // 3.1.1 = weight 5
    expect(r.score).toBe(105);
    expect(r.poamEligible).toBe(false);
    expect(r.certificationPath).toBe('blocked');
    expect(r.poamBlockers).toContain('3.1.1');
  });

  it('single 1-pt poam_allowed not_met → −1, conditional (POA&M candidate)', () => {
    const r = calc.calculate(allMetexcept('3.1.6', 'not_met')); // 3.1.6 = weight 1, poam_allowed
    expect(r.score).toBe(109);
    expect(r.poamEligible).toBe(true);
    expect(r.certificationPath).toBe('conditional');
    expect(r.poamCandidates.map((p) => p.nist_ref)).toContain('3.1.6');
  });

  it('prohibited control not_met → POA&M blocked (listed as blocker)', () => {
    const r = calc.calculate(allMetexcept('3.1.20', 'not_met')); // 3.1.20 is POA&M-prohibited
    expect(r.poamEligible).toBe(false);
    expect(r.poamBlockers).toContain('3.1.20');
  });

  describe('partial credit', () => {
    it('SC.L2-3.13.11 (FIPS) partial → −2 and POA&M candidate (poam_allowed_at_partial)', () => {
      const r = calc.calculate(allMetexcept('3.13.11', 'partial'));
      expect(r.score).toBe(108); // full 5 − partial 3 = 2 deduction
      expect(r.controlsPartial).toBe(1);
      expect(r.poamCandidates.map((p) => p.nist_ref)).toContain('3.13.11');
      expect(r.poamBlockers).not.toContain('3.13.11');
      expect(r.poamEligible).toBe(true); // FIPS partial is the allowed POA&M exception
      expect(r.certificationPath).toBe('conditional');
    });

    it('IA.L2-3.5.3 partial → −2 but still blocks POA&M (no poam_allowed_at_partial)', () => {
      const r = calc.calculate(allMetexcept('3.5.3', 'partial'));
      expect(r.score).toBe(108);
      expect(r.poamEligible).toBe(false);
      expect(r.poamBlockers).toContain('3.5.3');
      expect(r.certificationPath).toBe('blocked');
    });

    it('partial on a control with no partial-credit rule → full-weight deduction', () => {
      const r = calc.calculate(allMetexcept('3.1.1', 'partial')); // 5-pt, no partial rule
      expect(r.score).toBe(105); // full 5-pt deduction, not partial
      expect(r.controlsPartial).toBe(1);
    });
  });

  it('unknown/missing assessment defaults to not_assessed (deducted)', () => {
    // Provide only the 'met' controls for everything except omit 3.1.6 entirely.
    const subset = CONTROLS.filter((c) => c.nist_ref !== '3.1.6').map((c) => mk(c.nist_ref, 'met'));
    const r = calc.calculate(subset);
    expect(r.controlsNotAssessed).toBe(1);
    expect(r.score).toBe(109); // 3.1.6 weight 1
  });
});
