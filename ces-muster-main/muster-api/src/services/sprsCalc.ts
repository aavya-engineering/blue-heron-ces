// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// muster-api SPRS calculator — consumes THE single authoritative weight table.
// SINGLE SOURCE OF TRUTH (2026-07-12): ces-shared/src/data/sprs-weights.json
// (sprs-weights/2.0.0), vendored here under the drift discipline. Reference:
// ces-strategy/docs/SPRS-SCORING-METHODOLOGY.md. This retired the inline copy
// that disagreed with the methodology on 14+ controls; the SPA sprsCalc consumes
// the same table, so the cross-copy parity test holds by construction.
import SPRS_WEIGHTS from '../vendored/ces-shared/data/sprs-weights.json';

/** requirement_id normalization: Muster keys are full control ids
 * ("AC.L2-3.1.1"); the canonical table keys by NIST ref ("3.1.1"). */
function toNistRef(requirementId: string): string {
  const dash = requirementId.indexOf('-');
  return dash === -1 ? requirementId : requirementId.slice(dash + 1);
}

const WEIGHT_BY_NIST_REF: Readonly<Record<string, number>> = Object.fromEntries(
  (SPRS_WEIGHTS.controls as Array<{ nist_ref: string; weight: number }>).map((c) => [c.nist_ref, c.weight])
);

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
