// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCConfirmationOutput } from '@/shared/types/artifacts';
import type { BTCAnswer } from '../types';

/**
 * Reverse-map a saved BTCConfirmationOutput back into raw BTCAnswer objects.
 * BTC stores answers directly with question_id keys, so this is straightforward.
 * Returns answers with provenance_class 'previous_run'.
 */

export function reverseMapBTCConfirmation(
  output: BTCConfirmationOutput,
): Record<string, BTCAnswer> {
  const answers: Record<string, BTCAnswer> = {};
  const now = new Date().toISOString();
  const savedAnswers = output.btc_confirmation.answers;

  for (const [questionId, saved] of Object.entries(savedAnswers)) {
    answers[questionId] = {
      question_id: questionId,
      raw_answer: saved.answer as string | boolean,
      mode: (saved.mode as 'full' | 'minimal' | 'substitute') || 'full',
      evidence_ids: saved.evidence_ids || [],
      captured_at: now,
      provenance_class: 'previous_run',
    };
  }

  return answers;
}
