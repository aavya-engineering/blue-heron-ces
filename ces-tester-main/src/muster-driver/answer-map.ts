// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PLAN.md M2 task 1: the hardcoded `clean-tenant-mfa-baseline` answer map
 * (architecture doc §6.2), keyed to Muster's real question IDs (per
 * docs/context/phase0/muster-findings.md item 1) rather than the abbreviated
 * `sit.*`/`tcp.*` keys in the architecture doc's worked example.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): the architecture doc's
 * §6.2 keys (`sit.target_cmmc_level`, `sit.cui_presence`,
 * `sit.boundary_strategy`, `tcp.license_tier`,
 * `tcp.conditional_access.mfa_enforced`) are abbreviations of the SI
 * baseline's `sets_its_fields` targets, not literal question IDs. Direct read
 * of `ces-planner/public/data/primed SI Question Bank.yaml` and
 * `primed TCP Question Bank.yaml` resolves each to its real per-question
 * `id`:
 *   - sit.target_cmmc_level -> G-01 (enum: L1|L2|L3)
 *   - sit.cui_presence      -> G-02 (enum: no_cui|fci_only|cui_present|cui_plus_other_sensitive|unknown)
 *   - sit.boundary_strategy -> G-07 (enum: single_enclave|multiple_enclaves|hybrid_boundary|unknown)
 *   - tcp.license_tier      -> TCP.LIC.001 (single_select: license SKU)
 * `tcp.conditional_access.mfa_enforced` has NO corresponding field in the TCP
 * bank (grepped: TCP-06's three CA questions are naming-convention/
 * named-locations/existing-policy-count, not an MFA toggle) — the MFA
 * Conditional Access policy is a Mission-Plan/Stamper-side outcome, not a TCP
 * input. Omitted from the answer map; not silently invented.
 */

export type MusterAnswerType =
  | 'boolean'
  | 'enum'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'text'
  | 'list'
  | 'string';

export interface MusterAnswerMapEntry {
  /** The real `data-question-id` value (per muster-findings.md item 1/2). */
  questionId: string;
  /** Which wizard route this question lives on. */
  wizard: 'sit' | 'tcp' | 'cui' | 'btc' | 'policy-inputs' | 'rrt';
  answerType: MusterAnswerType;
  value: string | number | boolean | string[];
}

/**
 * clean-tenant-mfa-baseline's answer map (architecture §6.2), resolved to
 * real question IDs. Only questions the scenario needs to steer are listed
 * here — every other required question on each wizard is left to Muster's
 * own `buildRecommendations()` pre-fill (verified live in
 * `src/shared/utils/applyRecommendations.ts`, wired into all five non-RRT
 * wizards' mount effects), which pre-populates a valid answer from the YAML
 * bank's own `recommended` field before the driver ever visits the page.
 */
export const CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP: MusterAnswerMapEntry[] = [
  { questionId: 'G-01', wizard: 'sit', answerType: 'enum', value: 'L2' },
  { questionId: 'G-02', wizard: 'sit', answerType: 'enum', value: 'cui_present' },
  { questionId: 'G-07', wizard: 'sit', answerType: 'enum', value: 'single_enclave' },
  { questionId: 'TCP.LIC.001', wizard: 'tcp', answerType: 'single_select', value: 'Microsoft 365 G5' },
];

/** Looks up the answer-map entry for a given question ID, or undefined if the
 * driver should fall through to Muster's own recommended-default pre-fill. */
export function resolveAnswerForQuestion(
  answerMap: MusterAnswerMapEntry[],
  questionId: string,
): MusterAnswerMapEntry | undefined {
  return answerMap.find((entry) => entry.questionId === questionId);
}

/** Filters the answer map down to entries for a single wizard, preserving order. */
export function answersForWizard(
  answerMap: MusterAnswerMapEntry[],
  wizard: MusterAnswerMapEntry['wizard'],
): MusterAnswerMapEntry[] {
  return answerMap.filter((entry) => entry.wizard === wizard);
}
