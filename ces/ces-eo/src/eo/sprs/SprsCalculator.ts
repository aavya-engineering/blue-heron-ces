// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import type { ControlAssessment } from 'ces-shared/types/controls';
import type {
  SprsResult,
  SprsDeduction,
  SprsPartialCredit,
  SprsWeightsFile,
  PoamCandidate,
} from 'ces-shared/types/sprs';

/**
 * Calculates weighted SPRS score from assessment data.
 * Based on NIST SP 800-171 DoD Assessment Methodology v1.2.1.
 */
export class SprsCalculator {
  public readonly weights: SprsWeightsFile;

  constructor(weightsPath?: string) {
    const _require = createRequire(import.meta.url);
    const resolved = weightsPath ?? _require.resolve('ces-shared/data/sprs-weights');
    this.weights = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as SprsWeightsFile;
  }

  calculate(controls: ControlAssessment[]): SprsResult {
    const controlMap = new Map<string, ControlAssessment>();
    for (const c of controls) {
      controlMap.set(c.nist_ref, c);
    }

    let score = 110;
    const deductions: SprsDeduction[] = [];
    const appliedPartials: SprsPartialCredit[] = [];
    const poamBlockers: string[] = [];
    const poamCandidates: PoamCandidate[] = [];
    let met = 0, notMet = 0, partial = 0, notAssessed = 0;

    // Build partial credit lookup
    const partialCreditMap = new Map<string, SprsWeightsFile['partial_credit'][0]>();
    for (const pc of this.weights.partial_credit) {
      partialCreditMap.set(pc.nist_ref, pc);
    }

    for (const weightEntry of this.weights.controls) {
      const assessment = controlMap.get(weightEntry.nist_ref);
      const status = assessment?.status ?? 'not_assessed';

      switch (status) {
        case 'met':
          met++;
          break;

        case 'partial': {
          partial++;
          const pc = partialCreditMap.get(weightEntry.nist_ref);
          if (pc) {
            // Apply partial credit deduction
            const deduction = pc.full_weight - pc.partial_weight;
            score -= deduction;
            deductions.push({
              nist_ref: weightEntry.nist_ref,
              control_id: assessment?.control_id ?? '',
              weight: deduction,
              status: 'partial',
            });
            appliedPartials.push(pc);
          } else {
            // No partial credit rule — treat as full deduction
            score -= weightEntry.weight;
            deductions.push({
              nist_ref: weightEntry.nist_ref,
              control_id: assessment?.control_id ?? '',
              weight: weightEntry.weight,
              status: 'partial',
            });
          }
          break;
        }

        case 'not_met':
          notMet++;
          score -= weightEntry.weight;
          deductions.push({
            nist_ref: weightEntry.nist_ref,
            control_id: assessment?.control_id ?? '',
            weight: weightEntry.weight,
            status: 'not_met',
          });
          break;

        case 'not_assessed':
          notAssessed++;
          // Not assessed = treated as NOT MET for scoring
          score -= weightEntry.weight;
          deductions.push({
            nist_ref: weightEntry.nist_ref,
            control_id: assessment?.control_id ?? '',
            weight: weightEntry.weight,
            status: 'not_assessed',
          });
          break;
      }
    }

    // Determine POA&M eligibility
    const prohibitedSet = new Set(this.weights.poam_prohibited);
    let weightRuleMet = true;
    let prohibitedControlsMet = true;

    for (const d of deductions) {
      if (d.status === 'met') continue;

      // Check prohibited controls
      if (prohibitedSet.has(d.nist_ref)) {
        prohibitedControlsMet = false;
        poamBlockers.push(d.control_id);
      }

      // Find weight entry
      const w = this.weights.controls.find(c => c.nist_ref === d.nist_ref);
      if (!w) continue;

      // Partial-credit POA&M exception (e.g. SC.L2-3.13.11 FIPS) takes precedence over the
      // weight gate — a control flagged poam_allowed_at_partial is a candidate, not a blocker,
      // regardless of its full weight.
      const pc = partialCreditMap.get(d.nist_ref);
      if (pc?.poam_allowed_at_partial && d.status === 'partial') {
        poamCandidates.push({
          nist_ref: d.nist_ref,
          control_id: d.control_id,
          weight: pc.partial_weight,
        });
      } else if (w.weight >= 5) {
        // 5-point control NOT MET → blocks POA&M
        weightRuleMet = false;
        if (!poamBlockers.includes(d.control_id)) {
          poamBlockers.push(d.control_id);
        }
      } else if (w.weight === 3) {
        // 3-point control NOT MET → blocks POA&M
        weightRuleMet = false;
        if (!poamBlockers.includes(d.control_id)) {
          poamBlockers.push(d.control_id);
        }
      } else if (w.weight === 1 && w.poam_allowed) {
        // 1-point POA&M-eligible control
        poamCandidates.push({
          nist_ref: d.nist_ref,
          control_id: d.control_id,
          weight: w.weight,
        });
      }
    }

    const poamEligible = weightRuleMet && prohibitedControlsMet;
    const certificationPath = (met === 110) ? 'full' :
                              poamEligible ? 'conditional' : 'blocked';

    return {
      score,
      maxScore: 110,
      controlsMet: met,
      controlsNotMet: notMet,
      controlsPartial: partial,
      controlsNotAssessed: notAssessed,
      deductions,
      partialCredits: appliedPartials,
      poamEligible,
      poamBlockers,
      poamCandidates,
      certificationPath,
    };
  }
}
