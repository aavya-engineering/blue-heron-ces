// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// SPRS calculator — DoD NIST SP 800-171 R2 Assessment Methodology v1.2.1 / 32 CFR 170.24.
// Start: 110. Subtract requirement weight for each NOT MET requirement. Floor: -203.
// Conservative rule (FCA): 'unknown' and 'partial' count as not met (full deduction).
// Only requirements present in the input are assessed; requirements not present are excluded.
//
// SINGLE SOURCE OF TRUTH (2026-07-12): the weight values come from the canonical
// table ces-shared/src/data/sprs-weights.json (schema sprs-weights/2.0.0), vendored
// here under the drift-check discipline. Reference:
// ces-strategy/docs/SPRS-SCORING-METHODOLOGY.md. Do NOT hand-edit weights here — fix
// the methodology doc, regenerate the shared JSON, re-vendor. The prior inline table
// disagreed with the methodology on 14+ controls and is retired.
import SPRS_WEIGHTS from '@/vendored/ces-shared/data/sprs-weights.json';

/**
 * requirement_id normalization: Muster keys requirements as full CMMC control ids
 * ("AC.L2-3.1.1", "MP.L1-3.8.3"); the canonical table keys by NIST ref ("3.1.1").
 * Strip the family/level prefix through the dash to join them. A value already in
 * NIST-ref form passes through unchanged.
 */
function toNistRef(requirementId: string): string {
  const dash = requirementId.indexOf('-');
  return dash === -1 ? requirementId : requirementId.slice(dash + 1);
}

/** NIST-ref -> weight, built once from the canonical vendored table. */
const WEIGHT_BY_NIST_REF: Readonly<Record<string, number>> = Object.fromEntries(
  (SPRS_WEIGHTS.controls as Array<{ nist_ref: string; weight: number }>).map((c) => [
    c.nist_ref,
    c.weight,
  ])
);

// Unlisted requirements fall back to 1 (the modal weight); 3.12.4/SSP is weight 0
// in the table (unscored prerequisite — never deducts).
const DEFAULT_WEIGHT = 1;
const STARTING_SCORE = SPRS_WEIGHTS.starting_score ?? 110;
const FLOOR_SCORE = SPRS_WEIGHTS.floor_score ?? -203;

function weightFor(requirementId: string): number {
  return WEIGHT_BY_NIST_REF[toNistRef(requirementId)] ?? DEFAULT_WEIGHT;
}

export interface SprsDeduction {
  requirement_id: string;
  weight: number;
}

export interface SprsResult {
  sprs: number;
  assessed_count: number;
  deductions: SprsDeduction[];
}

/**
 * Compute the SPRS score from an array of requirement results.
 *
 * Conservative rule (FCA): only status === 'met' counts as passing.
 * 'partial' and 'unknown' each incur the full requirement weight as a deduction.
 *
 * Requirements not present in requirementResults are excluded — they do not
 * affect the score and are not counted in assessed_count.
 *
 * Score floor: -203 (DoD Assessment Methodology minimum).
 */
export function computeSprs(
  requirementResults: Array<{ requirement_id: string; status: string }>
): SprsResult {
  const deductions: SprsDeduction[] = [];
  let score = STARTING_SCORE;

  for (const result of requirementResults) {
    // FCA conservative rule: only 'met' passes; partial/unknown/not_met all deduct
    if (result.status !== 'met') {
      const weight = weightFor(result.requirement_id);
      deductions.push({ requirement_id: result.requirement_id, weight });
      score -= weight;
    }
  }

  // Apply DoD floor
  score = Math.max(score, FLOOR_SCORE);

  return {
    sprs: score,
    assessed_count: requirementResults.length,
    deductions,
  };
}
