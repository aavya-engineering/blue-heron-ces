// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCAnswer, RunlistEntry } from '../types';

/**
 * Generate autofill answers for all BTC runlist entries.
 *
 * Strategy:
 * - boolean → true (verified / compliant)
 * - single_select → first option (YAML consistently puts positive/compliant option first)
 * - Attaches evidence IDs from existing seeded default evidence
 * - Sets mode from the runlist entry
 * - Respects existing operator_inference answers (does not overwrite derived values)
 */
export function autofillBTCAnswers(
  entries: RunlistEntry[],
  existingAnswers?: Record<string, BTCAnswer>,
): Record<string, BTCAnswer> {
  const answers: Record<string, BTCAnswer> = {};
  const now = new Date().toISOString();

  for (const entry of entries) {
    if (!entry.enabled) continue;

    // Preserve derived answers — don't overwrite operator_inference values
    const existing = existingAnswers?.[entry.question_id];
    if (existing?.provenance_class === 'operator_inference') {
      answers[entry.question_id] = existing;
      continue;
    }

    const question = entry.question;
    let rawAnswer: string | boolean;

    if (question.answer_type === 'boolean') {
      rawAnswer = true;
    } else {
      // single_select — pick first option (the positive/compliant one)
      rawAnswer = question.options[0] ?? 'Yes';
    }

    answers[entry.question_id] = {
      question_id: entry.question_id,
      raw_answer: rawAnswer,
      mode: entry.mode,
      evidence_ids: entry.evidence_required ? [`default-${entry.question_id}`] : [],
      captured_at: now,
    };
  }

  return answers;
}

/**
 * Generate new-tenant (greenfield) answers for all BTC runlist entries.
 *
 * Strategy:
 * - boolean → false (nothing verified yet)
 * - single_select → last option (YAML consistently puts "Unknown" / "No" last)
 * - Attaches evidence IDs from existing seeded default evidence
 * - Sets mode from the runlist entry
 */
export function newTenantBTCAnswers(entries: RunlistEntry[]): Record<string, BTCAnswer> {
  const answers: Record<string, BTCAnswer> = {};
  const now = new Date().toISOString();

  for (const entry of entries) {
    if (!entry.enabled) continue;

    const question = entry.question;
    let rawAnswer: string | boolean;

    if (question.answer_type === 'boolean') {
      rawAnswer = false;
    } else {
      // single_select — pick last option (the negative/unknown one)
      rawAnswer = question.options[question.options.length - 1] ?? 'Unknown';
    }

    answers[entry.question_id] = {
      question_id: entry.question_id,
      raw_answer: rawAnswer,
      mode: entry.mode,
      evidence_ids: entry.evidence_required ? [`default-${entry.question_id}`] : [],
      captured_at: now,
    };
  }

  return answers;
}
