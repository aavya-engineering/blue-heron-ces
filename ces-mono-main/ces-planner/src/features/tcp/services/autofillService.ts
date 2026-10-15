// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { TCPAnswer, TCPSectionDef } from '../types';
import type { SIBaseline } from '@/shared/types/artifacts';
import { deriveTCPDefaults } from './tcpSIDerivation';
import { buildRecommendations } from '@/shared/utils/applyRecommendations';

/**
 * Generate autofill answers for all TCP questions.
 * Uses YAML recommended fields as base layer, SI derivations as overrides.
 */
export function autofillTCPAnswers(
  sections: TCPSectionDef[],
  siBaseline?: SIBaseline | null,
): Record<string, TCPAnswer> {
  const allQuestions = sections.flatMap((s) => s.questions);

  // Base layer: YAML recommended values (pass empty existing answers to get all recommendations)
  const recs = buildRecommendations(allQuestions, {});

  // Build merged defaults from recommendations
  const mergedDefaults: Record<string, string | number | boolean | string[]> = {};
  for (const [qId, rec] of Object.entries(recs)) {
    mergedDefaults[qId] = rec.raw_answer as string | number | boolean | string[];
  }

  // Override layer: SI derivations take priority over recommendations
  if (siBaseline) {
    const { defaults: siDefaults } = deriveTCPDefaults(siBaseline, sections);
    for (const [qId, answer] of Object.entries(siDefaults)) {
      mergedDefaults[qId] = answer.raw_answer;
    }
  }

  const answers: Record<string, TCPAnswer> = {};
  const now = new Date().toISOString();

  for (const question of allQuestions) {
    const defaultValue = mergedDefaults[question.id];

    let rawAnswer: string | number | boolean | string[];
    if (defaultValue !== undefined) {
      rawAnswer = defaultValue;
    } else {
      switch (question.answer_type) {
        case 'multi_select':
        case 'list':
        case 'upn_list':
          rawAnswer = question.options.length > 0 ? [question.options[0]] : [];
          break;
        case 'single_select':
          rawAnswer = question.options[0] ?? '';
          break;
        case 'number':
          rawAnswer = 0;
          break;
        case 'boolean':
          rawAnswer = false;
          break;
        case 'guid':
          rawAnswer = '00000000-0000-0000-0000-000000000000';
          break;
        case 'text':
        default:
          rawAnswer = '';
      }
    }

    answers[question.id] = {
      question_id: question.id,
      answer_type: question.answer_type,
      raw_answer: rawAnswer,
      captured_at: now,
      provenance_class: 'client_assertion',
    };
  }

  return answers;
}

/**
 * "New Tenant" button defaults — fills all questions with typical values.
 */
export function newTenantTCPAnswers(sections: TCPSectionDef[]): Record<string, TCPAnswer> {
  return autofillTCPAnswers(sections);
}
