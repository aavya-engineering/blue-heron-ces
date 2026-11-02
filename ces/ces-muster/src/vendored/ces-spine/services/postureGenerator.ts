// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// VENDORED from ces-planner src/features/rrt/services/postureGenerator.ts @ 4a00bee5d5e618cf55da2469ec12307ebc620418
// Import path adjustments:
//   '../types' -> '../types/rrt'
//   '@/shared/types/artifacts' -> '../types/artifacts'
//   '@/shared/utils/idGenerator' -> '../utils/idGenerator'
//   '@/shared/utils/dateFormatter' -> '../utils/dateFormatter'

import type { RRTAnswer, EvidenceItem } from '../types/rrt';
import type { ReadinessPosture, RequirementResult, Finding, ArtifactRef } from '../types/artifacts';
import { generateArtifactId, generateSHA256 } from '../utils/idGenerator';
import { toISODateTime, toISODate } from '../utils/dateFormatter';

/**
 * Generate Readiness Posture artifact from RRT answers and evidence.
 * Output strictly matches CES RRT Readiness Posture.schema.json.
 */
export function generateReadinessPosture(
  answers: Record<string, RRTAnswer>,
  evidenceItems: EvidenceItem[],
  questionSet: any,
  siBaseline: any,
  siBaselineArtifactId?: string,
  questionSetArtifactId?: string,
  btcEvidenceItems?: EvidenceItem[],
  cesId?: string,
): ReadinessPosture {
  // Merge BTC evidence items into the evidence pool
  const allEvidenceItems = btcEvidenceItems
    ? [...evidenceItems, ...btcEvidenceItems]
    : evidenceItems;

  const requirementResults = mapToRequirementResults(answers, allEvidenceItems);

  // BTC evidence auto-satisfaction: upgrade unknown→partial for requirements
  // that have matching BTC evidence
  if (btcEvidenceItems && btcEvidenceItems.length > 0) {
    const btcReqIds = new Set<string>();
    for (const item of btcEvidenceItems) {
      if (item.mapped_requirements) {
        for (const reqId of item.mapped_requirements) btcReqIds.add(reqId);
      }
    }
    for (const result of requirementResults) {
      if (result.status === 'unknown' && btcReqIds.has(result.requirement_id)) {
        result.status = 'partial';
        result.notes = (result.notes ? result.notes + ' ' : '') +
          '[BTC evidence contributes to satisfaction]';
      }
    }
  }
  const controlStatusSummary = computeControlStatusSummary(requirementResults, siBaseline);
  const keyFindings = deriveKeyFindings(requirementResults);

  const siBaselineRef: ArtifactRef = {
    schema_id: 'ces-si-baseline-output',
    artifact_id: siBaselineArtifactId || `si_baseline_${Date.now()}`,
    version: siBaseline?.ces?.version || '1.0.0',
    hash_sha256: generateSHA256(JSON.stringify(siBaseline)),
  };

  const questionSetRef: ArtifactRef = {
    schema_id: 'ces-rr-question-set-output',
    artifact_id: questionSetArtifactId || `rr_qs_${Date.now()}`,
    version: questionSet?.ces?.version || '1.0.0',
    hash_sha256: generateSHA256(JSON.stringify(questionSet)),
  };

  const posture: ReadinessPosture = {
    ces: {
      artifact: 'CES_READINESS_POSTURE',
      version: '1.0.0',
      generated_on: toISODateTime(new Date()),
      ...(cesId ? { cesId } : {}),
      snapshot_id: generateArtifactId('snapshot'),
      as_of_date: toISODate(new Date()),
      si_baseline_ref: siBaselineRef,
      rr_question_set_ref: questionSetRef,
      control_status_summary: controlStatusSummary,
      key_findings: keyFindings.length > 0
        ? keyFindings
        : [{ severity: 'low', statement: 'No significant findings at this time.' }],
      constraints: deriveConstraints(siBaseline),
      requirement_results: requirementResults.length > 0
        ? requirementResults
        : [{ requirement_id: 'placeholder', status: 'unknown', evidence_refs: [] }],
      evidence_index: allEvidenceItems.map((e) => ({
        evidence_id: e.evidence_id,
        source_system: e.source_system,
        location: e.location,
        hash_sha256: e.hash_sha256,
        ...(e.captured_at ? { captured_at: e.captured_at } : {}),
      })),
    },
  };

  return posture;
}

/**
 * Map answers and evidence to schema-compliant requirement results.
 * Uses lowercase status values per schema enum.
 */
function mapToRequirementResults(
  answers: Record<string, RRTAnswer>,
  evidenceItems: EvidenceItem[]
): RequirementResult[] {
  const requirementMap = new Map<string, RequirementResult>();

  Object.values(answers).forEach((answer) => {
    answer.mapped_requirements?.forEach((reqId) => {
      if (!requirementMap.has(reqId)) {
        requirementMap.set(reqId, {
          requirement_id: reqId,
          status: 'unknown',
          evidence_refs: [],
        });
      }

      const result = requirementMap.get(reqId)!;

      // Add evidence references
      if (answer.evidence_ids) {
        answer.evidence_ids.forEach((eid) => {
          if (!result.evidence_refs.some((r) => r.evidence_id === eid)) {
            result.evidence_refs.push({ evidence_id: eid });
          }
        });
      }

      // Update status (lowercase)
      const newStatus = determineRequirementStatus(answer);
      result.status = mergeStatuses(result.status, newStatus);
    });
  });

  // Cross-reference evidence items
  evidenceItems.forEach((evidence) => {
    evidence.mapped_requirements?.forEach((reqId) => {
      const result = requirementMap.get(reqId);
      if (result && !result.evidence_refs.some((r) => r.evidence_id === evidence.evidence_id)) {
        result.evidence_refs.push({ evidence_id: evidence.evidence_id });
      }
    });
  });

  return Array.from(requirementMap.values());
}

function computeControlStatusSummary(
  requirementResults: RequirementResult[],
  siBaseline: any
): { level: string; met: number; partial: number; not_met: number; unknown: number } {
  const level = siBaseline?.si_baseline?.target?.target_cmmc_level
    || siBaseline?.ces?.target?.target_cmmc_level
    || 'L2';

  const summary = { level, met: 0, partial: 0, not_met: 0, unknown: 0 };
  requirementResults.forEach((r) => {
    switch (r.status) {
      case 'met': summary.met++; break;
      case 'partial': summary.partial++; break;
      case 'not_met': summary.not_met++; break;
      default: summary.unknown++; break;
    }
  });
  return summary;
}

function deriveKeyFindings(results: RequirementResult[]): Finding[] {
  const findings: Finding[] = [];
  const notMetCount = results.filter((r) => r.status === 'not_met').length;
  const unknownCount = results.filter((r) => r.status === 'unknown').length;

  if (notMetCount > 0) {
    findings.push({
      severity: notMetCount > 5 ? 'critical' : 'high',
      statement: `${notMetCount} requirement(s) are currently NOT MET and require remediation.`,
      impacts_requirements: results.filter((r) => r.status === 'not_met').map((r) => r.requirement_id),
    });
  }
  if (unknownCount > 0) {
    findings.push({
      severity: 'medium',
      statement: `${unknownCount} requirement(s) have UNKNOWN status and need further investigation.`,
      impacts_requirements: results.filter((r) => r.status === 'unknown').map((r) => r.requirement_id),
    });
  }
  return findings;
}

function deriveConstraints(siBaseline: any): string[] {
  const constraints: string[] = [];
  const si = siBaseline?.si_baseline || {};
  if (si.dependencies?.budget_constraints) {
    constraints.push(`Budget: ${si.dependencies.budget_constraints}`);
  }
  if (si.dependencies?.schedule_constraints) {
    constraints.push(`Schedule: ${si.dependencies.schedule_constraints}`);
  }
  return constraints;
}

function determineRequirementStatus(answer: RRTAnswer): RequirementResult['status'] {
  if (typeof answer.answer === 'boolean') {
    return answer.answer ? 'met' : 'not_met';
  }

  // Structured JSON answers (e.g. { status: 'not_implemented', ... })
  if (typeof answer.answer === 'object' && answer.answer !== null) {
    const status = answer.answer.status;
    if (typeof status === 'string') {
      return classifyAnswerString(status);
    }
  }

  if (typeof answer.answer === 'string') {
    const result = classifyAnswerString(answer.answer);
    if (result !== 'unknown') return result;
  }

  if (answer.evidence_ids && answer.evidence_ids.length > 0) return 'met';
  return 'unknown';
}

/** Classify a string answer value — checks negative patterns before positive to avoid
 *  'not_implemented' matching 'implemented'. */
function classifyAnswerString(value: string): RequirementResult['status'] {
  const lower = value.toLowerCase();
  // Negative patterns first — 'not_implemented' contains 'implemented'
  if (lower.includes('not_implemented') || lower.includes('not implemented') || lower === 'no') {
    return 'not_met';
  }
  if (lower.includes('partial') || lower.includes('in_progress') || lower.includes('in progress')) {
    return 'partial';
  }
  if (lower === 'yes' || lower.includes('implemented') || lower === 'true') {
    return 'met';
  }
  return 'unknown';
}

function mergeStatuses(
  current: RequirementResult['status'],
  incoming: RequirementResult['status']
): RequirementResult['status'] {
  if (current === 'not_met' || incoming === 'not_met') return 'not_met';
  if (current === 'partial' || incoming === 'partial') return 'partial';
  if (current === 'unknown' || incoming === 'unknown') return 'unknown';
  return 'met';
}
