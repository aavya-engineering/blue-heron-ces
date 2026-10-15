// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useCallback } from 'react';
import type { RRTAnswer, RequirementResult } from '../types';

/**
 * Maps RRT answers to requirement results (MET, PARTIAL, NOT_MET, UNKNOWN)
 */
export function useRequirementMapping() {
  const mapAnswersToRequirements = useCallback(
    (answers: Record<string, RRTAnswer>, _questionSet: any): RequirementResult[] => {
      const requirementMap = new Map<string, RequirementResult>();

      // Process each answer
      Object.values(answers).forEach((answer) => {
        answer.mapped_requirements?.forEach((reqId) => {
          if (!requirementMap.has(reqId)) {
            requirementMap.set(reqId, {
              requirement_id: reqId,
              status: 'UNKNOWN',
              confidence: 0,
              evidence_refs: [],
              supporting_question_ids: [],
              assessor_methods_satisfied: [],
              evidence_archetypes_satisfied: [],
            });
          }

          const result = requirementMap.get(reqId)!;

          // Add supporting question
          if (!result.supporting_question_ids?.includes(answer.question_id)) {
            result.supporting_question_ids?.push(answer.question_id);
          }

          // Add evidence references
          if (answer.evidence_ids) {
            result.evidence_refs.push(...answer.evidence_ids);
          }

          // Add assessor methods
          if (answer.assessor_methods_satisfied) {
            answer.assessor_methods_satisfied.forEach((method) => {
              if (!result.assessor_methods_satisfied?.includes(method)) {
                result.assessor_methods_satisfied?.push(method);
              }
            });
          }

          // Update status based on answer
          const newStatus = determineRequirementStatus(answer);
          result.status = mergeStatuses(result.status, newStatus);

          // Update confidence
          result.confidence = calculateConfidence(result, answer);
        });
      });

      return Array.from(requirementMap.values());
    },
    []
  );

  return { mapAnswersToRequirements };
}

/**
 * Determine requirement status from a single answer
 */
function determineRequirementStatus(answer: RRTAnswer): 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN' {
  // Boolean answers
  if (typeof answer.answer === 'boolean') {
    return answer.answer ? 'MET' : 'NOT_MET';
  }

  // String answers with common patterns
  if (typeof answer.answer === 'string') {
    const lowerAnswer = answer.answer.toLowerCase();
    if (lowerAnswer.includes('yes') || lowerAnswer.includes('implemented')) return 'MET';
    if (lowerAnswer.includes('no') || lowerAnswer.includes('not implemented')) return 'NOT_MET';
    if (lowerAnswer.includes('partial') || lowerAnswer.includes('in progress')) return 'PARTIAL';
  }

  // Has evidence
  if (answer.evidence_ids && answer.evidence_ids.length > 0) {
    return 'MET';
  }

  return 'UNKNOWN';
}

/**
 * Merge two requirement statuses (pessimistic merge)
 */
function mergeStatuses(
  current: 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN',
  incoming: 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN'
): 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNKNOWN' {
  // Precedence: NOT_MET > PARTIAL > UNKNOWN > MET
  if (current === 'NOT_MET' || incoming === 'NOT_MET') return 'NOT_MET';
  if (current === 'PARTIAL' || incoming === 'PARTIAL') return 'PARTIAL';
  if (current === 'UNKNOWN' || incoming === 'UNKNOWN') return 'UNKNOWN';
  return 'MET';
}

/**
 * Calculate confidence score for a requirement result
 */
function calculateConfidence(result: RequirementResult, answer: RRTAnswer): number {
  let confidence = result.confidence;

  // Increase confidence based on evidence
  if (answer.evidence_ids && answer.evidence_ids.length > 0) {
    confidence += 0.3;
  }

  // Increase confidence based on provenance
  if (answer.provenance_class === 'system_observation') {
    confidence += 0.3;
  } else if (answer.provenance_class === 'operator_observation') {
    confidence += 0.2;
  } else if (answer.provenance_class === 'client_assertion') {
    confidence += 0.1;
  } else if (answer.provenance_class === 'auto_collected') {
    confidence += 0.05;
  }

  // Cap at 1.0
  return Math.min(confidence, 1.0);
}
