// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '@/shared/types/artifacts';
import type { SITAnswer, QuestionDefinition } from '../types';

/**
 * Reverse-map a saved SIBaseline back into raw SITAnswer objects.
 * Uses baseline_mapping.target_fields (sets_its_fields) paths from question definitions.
 * Returns answers with provenance_class 'client_assertion' (original provenance is lost in baseline).
 */

function resolveBaselinePath(baseline: SIBaseline, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = baseline;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function reverseMapBaseline(
  baseline: SIBaseline,
  questions: QuestionDefinition[],
): Record<string, SITAnswer> {
  const answers: Record<string, SITAnswer> = {};
  const now = new Date().toISOString();

  for (const question of questions) {
    const paths = question.baseline_mapping?.target_fields ?? [];
    if (paths.length === 0) continue;

    // Use the first path to extract the value
    const value = resolveBaselinePath(baseline, paths[0]);
    if (isEmpty(value)) continue;

    answers[question.question_id] = {
      question_id: question.question_id,
      answer_type: question.answer_type,
      raw_answer: value as string | number | string[] | Record<string, unknown> | boolean,
      captured_at: now,
      provenance_class: 'previous_run',
    };
  }

  return answers;
}
