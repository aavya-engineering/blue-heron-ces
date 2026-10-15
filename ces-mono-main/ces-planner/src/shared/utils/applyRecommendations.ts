// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Shared utility to pre-populate wizard answers from YAML `recommended` fields.
 *
 * Applied AFTER SI derivation so that operator_inference answers take priority.
 * Only fills questions that have no existing answer at all.
 * Marked with provenance_class 'system_recommendation' so the UI can indicate
 * these are defaults the user should review (NOT auto-skipped).
 */

export interface RecommendableQuestion {
  id: string;
  answer_type: string;
  recommended?: unknown;
}

export interface RecommendedAnswer {
  question_id: string;
  answer_type: string;
  raw_answer: unknown;
  captured_at: string;
  provenance_class: 'system_recommendation';
}

/**
 * Build a map of recommended answers for questions that:
 *  1. Have a `recommended` value in their YAML definition
 *  2. Do NOT already have an answer in `existingAnswers`
 */
export function buildRecommendations(
  questions: RecommendableQuestion[],
  existingAnswers: Record<string, unknown>,
): Record<string, RecommendedAnswer> {
  const now = new Date().toISOString();
  const result: Record<string, RecommendedAnswer> = {};

  for (const q of questions) {
    // Skip if already answered (by user or SI derivation)
    if (existingAnswers[q.id]) continue;
    // Skip if no recommendation defined
    if (q.recommended === undefined || q.recommended === null || q.recommended === '') continue;

    result[q.id] = {
      question_id: q.id,
      answer_type: q.answer_type,
      raw_answer: q.recommended,
      captured_at: now,
      provenance_class: 'system_recommendation',
    };
  }

  return result;
}
