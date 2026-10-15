// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useCallback } from 'react';
import type { SITAnswer } from '../types';
import type { SIBaseline } from '@/shared/types/artifacts';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { toISODateTime } from '@/shared/utils/dateFormatter';

/**
 * Maps SIT answers to SI Baseline fields using question bank mappings
 */
export function useAnswerMapping() {
  const mapAnswersToBaseline = useCallback(
    (answers: Record<string, SITAnswer>, questionBank: any, _customerId: number): SIBaseline => {
      // Initialize baseline structure
      const baseline = {
        ces: {
          artifact: 'si_baseline_output',
          version: '1.0.0',
          generated_on: toISODateTime(new Date()),
          artifact_id: generateArtifactId('si_baseline'),
          source_question_bank_ref: {
            schema_id: questionBank?.schema_id || 'si_question_bank',
            artifact_id: questionBank?.artifact_id || 'si_qb_v1',
            version: questionBank?.version || '1.0.0',
            hash_sha256: '',
          },
          scenario_tags: [],
          target: {},
          scope: {},
          operating_assumptions: {},
          constraints: {},
          risk_acceptance: {},
          dependencies: {},
          governance: {},
        },
      };

      // Map each answer to baseline fields using baseline_mapping
      Object.entries(answers).forEach(([questionId, answer]) => {
        const question = questionBank?.questions?.find((q: any) => q.question_id === questionId);
        if (!question?.baseline_mapping?.field_path) return;

        const fieldPath = question.baseline_mapping.field_path;
        const value = answer.raw_answer;

        // Set value at nested path (e.g., "ces.target.level")
        setNestedValue(baseline, fieldPath, value);
      });

      return baseline as unknown as SIBaseline;
    },
    []
  );

  return { mapAnswersToBaseline };
}

/**
 * Helper to set nested object value by path
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}
