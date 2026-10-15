// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { CUIBoundaryOutput } from '@/shared/types/artifacts';
import type { CUIAnswer, CUISectionDef } from '../types';

/**
 * Reverse-map a saved CUIBoundaryOutput back into raw CUIAnswer objects.
 * Uses bindings.manifest and bindings.policy keys from question definitions.
 * Returns answers with provenance_class 'previous_run'.
 */

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function reverseMapCUIBoundary(
  output: CUIBoundaryOutput,
  sections: CUISectionDef[],
): Record<string, CUIAnswer> {
  const answers: Record<string, CUIAnswer> = {};
  const now = new Date().toISOString();
  const boundary = output.cui_boundary;

  for (const section of sections) {
    for (const question of section.questions) {
      // Try bindings.manifest keys first, then bindings.policy keys
      let value: unknown = undefined;

      if (question.bindings.manifest) {
        for (const key of Object.keys(question.bindings.manifest)) {
          if (boundary[key] !== undefined) {
            value = boundary[key];
            break;
          }
        }
      }
      if (value === undefined && question.bindings.policy) {
        for (const key of Object.keys(question.bindings.policy)) {
          if (boundary[key] !== undefined) {
            value = boundary[key];
            break;
          }
        }
      }

      if (isEmpty(value)) continue;

      answers[question.id] = {
        question_id: question.id,
        answer_type: question.answer_type,
        raw_answer: value as string | number | string[],
        captured_at: now,
        provenance_class: 'previous_run',
      };
    }
  }

  return answers;
}
