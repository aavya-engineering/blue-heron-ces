// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import { useSIQuestionBank } from '@/shared/hooks/useDataLoader';
import type { QuestionDefinition } from '../types';

/**
 * Load SI Question Bank and extract applicable questions
 *
 * YAML structure:
 * ces:
 *   question_bank:
 *     questions:
 *       - id: G-01
 *         text: "..."
 *         answer:
 *           type: enum
 *           options: [...]
 */
export function useSITQuestions() {
  const { data: questionBank, loading, error, fromCache } = useSIQuestionBank();

  const questions = useMemo<QuestionDefinition[]>(() => {
    // Navigate the nested YAML structure: ces.question_bank.questions
    const rawQuestions = (questionBank as any)?.ces?.question_bank?.questions;
    if (!rawQuestions || !Array.isArray(rawQuestions)) {
      console.warn('[useSITQuestions] No questions found in question bank');
      return [];
    }

    return rawQuestions.map((q: any) => ({
      question_id: q.id,
      question_text: q.text,
      description: q.advisor_description || '',
      answer_type: q.answer?.type || 'string',
      enum_values: q.answer?.options?.map((opt: any) => ({
        value: opt.value,
        description: opt.description,
        cmmc_attainment_impact: opt.cmmc_attainment_impact,
        advisor_notes: opt.advisor_notes,
      })) || [],
      structured_schema: q.answer?.schema || undefined,
      validation: {
        required: q.required || false,
        min: q.answer?.validation?.min,
        max: q.answer?.validation?.max,
      },
      advisor_guidance: {
        description: q.advisor_description || '',
        reason: q.advisor_reason_its || '',
        pitfalls: q.advisor_pitfalls || [],
        implications: q.advisor_cmmc_impact || '',
        rr_implications: q.advisor_rr_implications || [],
        mpt_gate_implications: q.advisor_mpt_gate_implications || [],
      },
      baseline_mapping: {
        target_fields: q.sets_its_fields || [],
      },
      recommended: q.recommended,
      applies_to_levels: q.applies_to_levels || ['L1', 'L2', 'L3'],
      provenance: q.provenance,
    }));
  }, [questionBank]);

  return {
    questions,
    questionBank,
    loading,
    error,
    fromCache,
  };
}
