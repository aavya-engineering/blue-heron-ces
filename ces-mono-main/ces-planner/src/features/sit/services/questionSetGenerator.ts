// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, RRQuestionSet, RRSchemaQuestion, ArtifactRef, CUIBoundaryOutput } from '@/shared/types/artifacts';
import { generateArtifactId, generateSHA256 } from '@/shared/utils/idGenerator';
import { toISODateTime } from '@/shared/utils/dateFormatter';
import { CUI_DOMAIN_MAP } from '@/shared/utils/cuiDomainMap';

/** Optional domain knowledge bases that enrich generated questions. */
export interface DomainKnowledge {
  cmmcRequirements?: any;
  assessorKB?: any;
}

// ---------------------------------------------------------------------------
// SI Baseline scenario profile — flat map of all filterable fields
// ---------------------------------------------------------------------------

interface ScenarioProfile {
  target_cmmc_level: string;
  cui_presence: string;
  deployment_posture: string;
  boundary_strategy: string;
  byod_posture: string;
  collaboration_mode: string;
  evidence_posture_target: string;
  assessment_route: string;
  tenant_model_preference: string;
  poam_policy_intent: string;
  devops_touches_cui: boolean;
}

function extractScenarioProfile(siBaseline: SIBaseline): ScenarioProfile {
  const si = siBaseline.si_baseline;
  return {
    target_cmmc_level: si.target?.target_cmmc_level || 'unknown',
    cui_presence: si.target?.cui_presence || 'unknown',
    deployment_posture: si.scope?.deployment_posture || 'unknown',
    boundary_strategy: si.scope?.boundary_strategy || 'unknown',
    byod_posture: si.operations?.byod_posture || 'unknown',
    collaboration_mode: si.operations?.collaboration_mode || 'unknown',
    evidence_posture_target: si.evidence?.evidence_posture_target || 'unknown',
    assessment_route: si.assessment?.assessment_route || 'unknown',
    tenant_model_preference: si.dependencies?.tenant_model_preference || 'unknown',
    poam_policy_intent: si.risk_acceptance?.poam_policy_intent || 'unknown',
    devops_touches_cui: si.operations?.devops_touches_cui === true,
  };
}

// ---------------------------------------------------------------------------
// Applicability rules — heuristic filters applied at generation time
// ---------------------------------------------------------------------------

interface ApplicabilityResult {
  excluded: boolean;
  reason?: string;
  ruleId?: string;
  priorityBoost: number; // 0 = no boost, positive = boost up
}

type ApplicabilityRule = {
  id: string;
  test: (activity: any, profile: ScenarioProfile) => ApplicabilityResult | null;
};

const applicabilityRules: ApplicabilityRule[] = [
  // CUI in activity name — exclude when no CUI
  {
    id: 'CUI_IN_NAME',
    test(activity, profile) {
      const name = (activity.name || '').toLowerCase();
      if (!name.includes('cui')) return null;
      if (profile.cui_presence === 'no_cui') {
        return { excluded: true, reason: 'Activity references CUI: excluded for cui_presence=no_cui', ruleId: 'CUI_IN_NAME', priorityBoost: 0 };
      }
      return null;
    },
  },
  // Mobile device controls — exclude when BYOD not allowed
  {
    id: 'MOBILE_DEVICE',
    test(activity, profile) {
      const practiceId = extractPracticeNistId(activity);
      const name = (activity.name || '').toLowerCase();
      const mobilePractices = ['3.1.18', '3.1.19'];
      const isMobile = mobilePractices.some((p) => practiceId?.includes(p)) || name.includes('mobile device');
      if (!isMobile) return null;
      if (profile.byod_posture === 'not_allowed') {
        return { excluded: true, reason: 'Mobile device control excluded: byod_posture=not_allowed', ruleId: 'MOBILE_DEVICE', priorityBoost: 0 };
      }
      return null;
    },
  },
  // L2-only practices assume CUI — exclude for no_cui and fci_only
  {
    id: 'L2_CUI_ASSUMPTION',
    test(activity, profile) {
      const levels = activity.applies_to_levels || [];
      if (levels.includes('L1')) return null; // L1-inclusive = broadly applicable
      if (!levels.includes('L2')) return null;
      if (profile.cui_presence === 'no_cui' || profile.cui_presence === 'fci_only') {
        return { excluded: true, reason: 'L2-only practice excluded: cui_presence=' + profile.cui_presence, ruleId: 'L2_CUI_ASSUMPTION', priorityBoost: 0 };
      }
      return null;
    },
  },
  // Remote access — boost for cloud/hybrid
  {
    id: 'REMOTE_ACCESS',
    test(activity, profile) {
      const practiceId = extractPracticeNistId(activity);
      const name = (activity.name || '').toLowerCase();
      const remotePractices = ['3.1.12', '3.1.14', '3.1.15'];
      const isRemote = remotePractices.some((p) => practiceId?.includes(p)) || name.includes('remote access');
      if (!isRemote) return null;
      if (profile.deployment_posture === 'cloud_only' || profile.deployment_posture === 'hybrid') {
        return { excluded: false, ruleId: 'REMOTE_ACCESS', priorityBoost: 10 };
      }
      return null;
    },
  },
  // Audit practices — boost for C3PAO-ready / continuous compliance
  {
    id: 'AUDIT_BOOST',
    test(activity, profile) {
      if (extractDomain(activity) !== 'AU') return null;
      if (profile.evidence_posture_target === 'c3pao_ready' || profile.evidence_posture_target === 'continuous_compliance') {
        return { excluded: false, ruleId: 'AUDIT_BOOST', priorityBoost: 5 };
      }
      return null;
    },
  },
  // Assessment practices — boost for certification route
  {
    id: 'CA_CERTIFICATION',
    test(activity, profile) {
      if (extractDomain(activity) !== 'CA') return null;
      if (profile.assessment_route === 'certification') {
        return { excluded: false, ruleId: 'CA_CERTIFICATION', priorityBoost: 5 };
      }
      return null;
    },
  },
  // Crypto practices — boost for GCC-High/IL5+
  {
    id: 'CRYPTO_TENANT',
    test(activity, profile) {
      const practiceId = extractPracticeNistId(activity);
      const cryptoPractices = ['3.13.10', '3.13.11'];
      if (!cryptoPractices.some((p) => practiceId?.includes(p))) return null;
      if (['gcc_high', 'dod_il5', 'dod_il6'].includes(profile.tenant_model_preference)) {
        return { excluded: false, ruleId: 'CRYPTO_TENANT', priorityBoost: 5 };
      }
      return null;
    },
  },
  // Personnel security — exclude for no_cui (L2+ only)
  {
    id: 'PS_CUI',
    test(activity, profile) {
      if (extractDomain(activity) !== 'PS') return null;
      const levels = activity.applies_to_levels || [];
      if (levels.includes('L1')) return null;
      if (profile.cui_presence === 'no_cui') {
        return { excluded: true, reason: 'PS practice excluded: cui_presence=no_cui', ruleId: 'PS_CUI', priorityBoost: 0 };
      }
      return null;
    },
  },
  // Incident response — boost for certification route
  {
    id: 'IR_CERTIFICATION',
    test(activity, profile) {
      if (extractDomain(activity) !== 'IR') return null;
      if (profile.assessment_route === 'certification') {
        return { excluded: false, ruleId: 'IR_CERTIFICATION', priorityBoost: 3 };
      }
      return null;
    },
  },
  // Scoping activities — boost for complex boundaries
  {
    id: 'MULTI_ENCLAVE_BOOST',
    test(activity, profile) {
      const id = activity.id || '';
      if (!id.includes('UNIV-BOUNDARY') && !id.includes('UNIV-DATAFLOW')) return null;
      if (profile.boundary_strategy === 'multiple_enclaves' || profile.boundary_strategy === 'hybrid_boundary') {
        return { excluded: false, ruleId: 'MULTI_ENCLAVE_BOOST', priorityBoost: 5 };
      }
      return null;
    },
  },
];

/**
 * Evaluate an explicit `applicability` block from the YAML activity definition.
 * Returns exclusion decision based on `excludes` and `requires_any` conditions.
 */
function evaluateExplicitApplicability(
  applicabilityBlock: any,
  profile: ScenarioProfile
): ApplicabilityResult | null {
  if (!applicabilityBlock) return null;

  // Check excludes: if ANY condition matches the profile, exclude
  if (applicabilityBlock.excludes) {
    for (const condition of applicabilityBlock.excludes) {
      for (const [field, values] of Object.entries(condition)) {
        const profileValue = profile[field as keyof ScenarioProfile];
        if (profileValue === 'unknown' || profileValue === undefined) continue;
        if (Array.isArray(values) && values.includes(profileValue)) {
          return { excluded: true, reason: `YAML applicability.excludes: ${field}=${profileValue}`, ruleId: 'YAML_EXCLUDES', priorityBoost: 0 };
        }
      }
    }
  }

  // Check requires_any: if present and NO conditions match, exclude
  if (applicabilityBlock.requires_any && applicabilityBlock.requires_any.length > 0) {
    let anyMatch = false;
    for (const condition of applicabilityBlock.requires_any) {
      for (const [field, values] of Object.entries(condition)) {
        const profileValue = profile[field as keyof ScenarioProfile];
        if (profileValue === 'unknown' || profileValue === undefined) {
          anyMatch = true; // unknown = don't exclude (conservative)
          break;
        }
        if (Array.isArray(values) && values.includes(profileValue)) {
          anyMatch = true;
          break;
        }
      }
      if (anyMatch) break;
    }
    if (!anyMatch) {
      return { excluded: true, reason: 'YAML applicability.requires_any: no conditions matched', ruleId: 'YAML_REQUIRES', priorityBoost: 0 };
    }
  }

  // Check boost_when
  let boost = 0;
  if (applicabilityBlock.boost_when) {
    for (const condition of applicabilityBlock.boost_when) {
      for (const [field, values] of Object.entries(condition)) {
        const profileValue = profile[field as keyof ScenarioProfile];
        if (Array.isArray(values) && values.includes(profileValue)) {
          boost += 5;
        }
      }
    }
  }
  if (boost > 0) {
    return { excluded: false, ruleId: 'YAML_BOOST', priorityBoost: boost };
  }

  return null;
}

/**
 * Run all applicability checks for an activity: explicit YAML block first,
 * then heuristic rules, then CUI domain boost. Returns combined result.
 */
function evaluateApplicability(
  activity: any,
  profile: ScenarioProfile,
  cuiBoundary?: CUIBoundaryOutput | null,
): { excluded: boolean; reasons: string[]; priorityBoost: number } {
  const reasons: string[] = [];
  let excluded = false;
  let totalBoost = 0;

  // 1. Explicit YAML applicability block takes precedence
  const yamlResult = evaluateExplicitApplicability(activity.applicability, profile);
  if (yamlResult) {
    if (yamlResult.excluded) return { excluded: true, reasons: [yamlResult.reason || 'YAML applicability'], priorityBoost: 0 };
    totalBoost += yamlResult.priorityBoost;
  }

  // 2. Heuristic rules
  for (const rule of applicabilityRules) {
    const result = rule.test(activity, profile);
    if (result) {
      if (result.excluded) {
        return { excluded: true, reasons: [result.reason || rule.id], priorityBoost: 0 };
      }
      totalBoost += result.priorityBoost;
    }
  }

  // 3. CUI domain boost — elevate questions whose domain is CUI-scoped
  if (cuiBoundary) {
    const activityDomain = extractDomain(activity);
    if (activityDomain) {
      const cuiKeys = Object.keys(cuiBoundary.cui_boundary || {});
      for (const [prefix, mapping] of Object.entries(CUI_DOMAIN_MAP)) {
        if (cuiKeys.some((k) => k.startsWith(prefix)) && mapping.primary.includes(activityDomain)) {
          totalBoost += 8;
          break;
        }
      }
    }
  }

  return { excluded, reasons, priorityBoost: totalBoost };
}

/**
 * Generate Scenario-Specific RR Question Set from SI Baseline.
 * Output strictly matches CES SIT Scenario-Specific Question Set.schema.json.
 *
 * When domain knowledge bases are supplied the generator cross-references each
 * bank activity with the CMMC Requirements Store and the Assessor Approach KB
 * to produce practice-specific prompts and correct answer types.
 */
export async function generateRRQuestionSet(
  siBaseline: SIBaseline,
  rrQuestionBank: any,
  siBaselineId: number,
  onProgress?: (processed: number, total: number) => void,
  domainKnowledge?: DomainKnowledge,
  cuiBoundary?: CUIBoundaryOutput | null,
  cesId?: string,
): Promise<RRQuestionSet> {
  const allActivities = extractActivitiesFromBank(rrQuestionBank);
  const profile = extractScenarioProfile(siBaseline);
  const { included: filteredActivities, excluded: excludedActivities } = filterActivities(allActivities, siBaseline, profile);

  // Build lookup maps from domain KBs
  const reqMap = buildRequirementsMap(domainKnowledge?.cmmcRequirements);
  const assessorMap = buildAssessorMap(domainKnowledge?.assessorKB);

  // Each activity IS a question — flatten into schema questions
  // Compute priority boosts from applicability rules (including CUI domain boost)
  const boostMap = new Map<string, number>();
  for (const activity of filteredActivities) {
    const actId = activity.id || activity.activity_id || 'unknown';
    const { priorityBoost } = evaluateApplicability(activity, profile, cuiBoundary);
    boostMap.set(actId, priorityBoost);
  }

  const flatQuestions: RRSchemaQuestion[] = [];
  let priority = 1;
  const selectedActivityIds: string[] = [];
  const allReqsCovered = new Set<string>();

  // Sort activities: boosted ones come first (higher boost = earlier)
  const sortedActivities = [...filteredActivities].sort((a, b) => {
    const boostA = boostMap.get(a.id || a.activity_id || '') || 0;
    const boostB = boostMap.get(b.id || b.activity_id || '') || 0;
    return boostB - boostA; // descending: highest boost first
  });

  for (const activity of sortedActivities) {
    const actId = activity.id || activity.activity_id || 'unknown';
    selectedActivityIds.push(actId);

    const mappedReqs: string[] = activity.mapped_requirements || [];
    mappedReqs.forEach((r: string) => allReqsCovered.add(r));

    // Look up domain data for the primary mapped requirement
    const primaryReqId = mappedReqs[0];
    const reqEntry = primaryReqId ? lookupRequirement(reqMap, primaryReqId) : undefined;
    const assessorEntry = primaryReqId ? lookupAssessor(assessorMap, primaryReqId) : undefined;

    const answerType = deriveAnswerType(activity);

    flatQuestions.push({
      question_id: actId,
      prompt: derivePrompt(activity, reqEntry, assessorEntry),
      name: activity.name || actId,
      answer_type: answerType,
      ...(answerType === 'enum' || answerType === 'multi_select'
        ? { enum_values: deriveEnumValues(activity, answerType) }
        : {}),
      priority: priority++,
      source_activity_id: actId,
      produces_rrt_fields: activity.produces_rrt_fields || [`rrt.${actId}.response`],
      mapped_requirements: mappedReqs.length > 0 ? mappedReqs : ['unspecified'],
      assessor_methods: deriveAssessorMethods(activity, assessorEntry),
      expected_evidence: normalizeExpectedEvidence(activity),
      // Advisor guidance - prefer activity bank data, fall back to requirements store
      ...(deriveAdvisorReason(activity, reqEntry) ? { advisor_reason_rrt: deriveAdvisorReason(activity, reqEntry) } : {}),
      ...(deriveAdvisorImpact(activity, reqEntry) ? { advisor_cmmc_impact: deriveAdvisorImpact(activity, reqEntry) } : {}),
      // Always include advisor_description from bank for guidance
      ...(activity.advisor_description ? { advisor_description: activity.advisor_description } : {}),
      ...(activity.steps?.length ? { steps: activity.steps } : {}),
      ...(activity.outputs?.length ? { outputs: activity.outputs } : {}),
      ...(activity.evidence_requests?.length ? { evidence_requests: normalizeEvidenceRequests(activity.evidence_requests) } : {}),
    });
  }

  const totalQuestions = flatQuestions.length;
  if (onProgress) onProgress(0, totalQuestions);

  // Simulate progress ticks
  if (onProgress) {
    for (let i = 0; i < totalQuestions; i++) {
      if (i % 25 === 0) await yieldToUi();
      onProgress(i + 1, totalQuestions);
    }
  }

  const placeholderRef: ArtifactRef = {
    schema_id: 'placeholder',
    artifact_id: 'not_available',
    version: '0.0.0',
    hash_sha256: '0'.repeat(64),
  };

  const scenarioTags = extractScenarioTags(siBaseline);

  const questionSet: RRQuestionSet = {
    ces: {
      artifact: 'CES_RR_QUESTION_SET',
      version: '1.0.0',
      generated_on: toISODateTime(new Date()),
      intent: 'Scenario-specific RR questions derived from SI Baseline',
      ...(cesId ? { cesId } : {}),
      inputs: {
        si_baseline_ref: {
          schema_id: 'ces-si-baseline-output',
          artifact_id: `si_baseline_db_${siBaselineId}`,
          version: siBaseline.ces.version,
          hash_sha256: generateSHA256(JSON.stringify(siBaseline)),
        },
        rrt_bank_ref: {
          schema_id: 'rr_question_bank',
          artifact_id: rrQuestionBank?.artifact_id || 'rr_qb_v1',
          version: rrQuestionBank?.version || '1.0.0',
          hash_sha256: generateSHA256(JSON.stringify(rrQuestionBank)),
        },
        cmmc_requirements_ref: domainKnowledge?.cmmcRequirements
          ? {
              schema_id: 'ces-cmmc-requirements-store',
              artifact_id: domainKnowledge.cmmcRequirements?.ces?.artifact || 'cmmc_req_store',
              version: domainKnowledge.cmmcRequirements?.ces?.version || '1.0.0',
              hash_sha256: generateSHA256(JSON.stringify(domainKnowledge.cmmcRequirements)),
            }
          : placeholderRef,
        assessor_evidence_matrix_ref: placeholderRef,
        assessor_approach_ref: domainKnowledge?.assessorKB
          ? {
              schema_id: 'ces-assessor-approach-kb',
              artifact_id: domainKnowledge.assessorKB?.ces?.artifact || 'assessor_kb',
              version: domainKnowledge.assessorKB?.ces?.version || '1.0.0',
              hash_sha256: generateSHA256(JSON.stringify(domainKnowledge.assessorKB)),
            }
          : placeholderRef,
        vendor_capabilities_ref: placeholderRef,
      },
      scenario: {
        scenario_id: generateArtifactId('scenario'),
        tags: scenarioTags.length > 0 ? scenarioTags : ['default'],
        derivation_rules_version: '1.0.0',
      },
      selection: {
        selected_activity_ids: selectedActivityIds.length > 0 ? selectedActivityIds : ['none'],
        excluded_activity_ids: excludedActivities.map((ex) => ({
          activity_id: ex.activity_id,
          reason: ex.reason,
        })),
      },
      questions: flatQuestions.length > 0
        ? flatQuestions
        : [{
            question_id: 'placeholder_q1',
            prompt: 'No scenario-specific questions generated.',
            name: 'Placeholder',
            answer_type: 'free_text',
            priority: 1,
            source_activity_id: 'none',
            produces_rrt_fields: ['rrt.placeholder'],
            mapped_requirements: ['unspecified'],
            assessor_methods: ['examine'],
            expected_evidence: [{
              evidence_matrix_id: 'placeholder',
              archetype_id: 'placeholder',
              minimum_fields: ['N/A'],
            }],
          }],
      coverage: {
        requirements_covered: Array.from(allReqsCovered),
        requirements_missing: computeRequirementsMissing(
          allReqsCovered,
          reqMap,
          profile.target_cmmc_level,
          excludedActivities,
        ),
      },
    },
  };

  return questionSet;
}

export function countQuestionSetQuestions(questionSet: any): number {
  // Handle both new flat structure and legacy activity structure
  if (questionSet?.ces?.questions) return questionSet.ces.questions.length;
  const activities = questionSet?.ces?.activities || [];
  return activities.reduce((total: number, activity: any) => {
    return total + (Array.isArray(activity.questions) ? activity.questions.length : 0);
  }, 0);
}

/** Count distinct L1 and L2 control question sets in a question set artifact. */
export function countControlQuestionSets(questionSet: any): { l1: number; l2: number } {
  const l1Controls = new Set<string>();
  const l2Controls = new Set<string>();

  const questions: any[] = questionSet?.ces?.questions || [];
  // Fallback to legacy activity structure
  if (questions.length === 0) {
    const activities = questionSet?.ces?.activities || [];
    for (const activity of activities) {
      if (Array.isArray(activity.questions)) {
        questions.push(...activity.questions);
      }
    }
  }

  for (const q of questions) {
    const reqs: string[] = q.mapped_requirements || [];
    for (const req of reqs) {
      if (req.includes('.L1-')) l1Controls.add(req);
      else if (req.includes('.L2-')) l2Controls.add(req);
    }
  }

  return { l1: l1Controls.size, l2: l2Controls.size };
}

// ---------------------------------------------------------------------------
// domain KB lookup helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map keyed by requirement_id from the CMMC Requirements Store.
 * The YAML structure is: { ces: {...}, catalogs: {...}, requirements: [...] }
 * or requirements can be directly nested or in different locations.
 */
function buildRequirementsMap(cmmcReqs: any): Map<string, any> {
  const map = new Map<string, any>();
  if (!cmmcReqs) return map;

  // Try multiple paths where requirements might live
  const reqs: any[] = cmmcReqs.requirements 
    || cmmcReqs.ces?.requirements 
    || [];
  
  for (const req of reqs) {
    if (req.requirement_id) {
      map.set(req.requirement_id, req);
    }
  }
  
  console.log(`[QuestionSetGenerator] Built requirements map with ${map.size} entries`);
  return map;
}

/**
 * Build a Map keyed by practice_id from the Assessor Approach KB.
 * The YAML structure is: { ces: { ..., practices: [...] } }
 */
function buildAssessorMap(assessorKB: any): Map<string, any> {
  const map = new Map<string, any>();
  if (!assessorKB) return map;

  const practices: any[] = assessorKB?.ces?.practices || assessorKB?.practices || [];
  for (const p of practices) {
    if (p.practice_id) {
      map.set(p.practice_id, p);
    }
  }
  return map;
}

/**
 * Look up a requirement by ID. The bank uses IDs like "AC.L1-3.1.1" while
 * the requirements store has the same format. Direct match first, then try
 * alternate levels (L1↔L2↔L3) since the same NIST control can appear at
 * different CMMC levels.
 */
function lookupRequirement(reqMap: Map<string, any>, reqId: string): any | undefined {
  if (reqMap.has(reqId)) return reqMap.get(reqId);

  // Try alternate levels: AC.L1-3.1.1 → AC.L2-3.1.1 → AC.L3-3.1.1
  const match = reqId.match(/^([A-Z]+)\.(L\d)-(.+)$/);
  if (!match) return undefined;

  const [, domain, , nistId] = match;
  for (const level of ['L1', 'L2', 'L3']) {
    const altId = `${domain}.${level}-${nistId}`;
    if (reqMap.has(altId)) return reqMap.get(altId);
  }
  return undefined;
}

/**
 * Look up assessor approach by practice ID with the same cross-level
 * fallback strategy.
 */
function lookupAssessor(assessorMap: Map<string, any>, reqId: string): any | undefined {
  if (assessorMap.has(reqId)) return assessorMap.get(reqId);

  const match = reqId.match(/^([A-Z]+)\.(L\d)-(.+)$/);
  if (!match) return undefined;

  const [, domain, , nistId] = match;
  for (const level of ['L2', 'L1', 'L3']) {
    const altId = `${domain}.${level}-${nistId}`;
    if (assessorMap.has(altId)) return assessorMap.get(altId);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// prompt & answer_type derivation
// ---------------------------------------------------------------------------

/**
 * Derive a practice-specific prompt from domain KBs.
 *
 * Priority:
 * 1. Activity name (short, meaningful identifier like "AC.L1-3.1.1 — Authorized")
 * 2. Requirements Store requirement_text — the formal NIST requirement
 * 3. Assessor KB assessor_intent — what the assessor wants to confirm
 * 4. Activity advisor_description as fallback
 */
function derivePrompt(activity: any, reqEntry: any, assessorEntry: any): string {
  const actName = activity.name || '';
  const titlePart = actName.includes('—') ? actName.split('—')[1]?.trim() : '';
  const reqText = reqEntry?.requirement_text;

  // Use requirement_text as the primary source when available and not garbled
  if (reqText && !reqText.includes('No direct mapping')) {
    // If we also have a title part, combine only if they don't overlap
    if (titlePart && titlePart.length > 3) {
      const titleNorm = titlePart.toLowerCase().replace(/[^a-z]/g, '');
      const reqNorm = reqText.toLowerCase().replace(/[^a-z]/g, '');
      if (!reqNorm.startsWith(titleNorm.slice(0, 15))) {
        return `${titlePart}: ${reqText}`;
      }
    }
    return reqText;
  }

  // Assessor intent from assessor KB
  if (assessorEntry?.assessor_intent) {
    if (titlePart && titlePart.length > 3) {
      return `${titlePart}: ${assessorEntry.assessor_intent}`;
    }
    return assessorEntry.assessor_intent;
  }

  // Activity title portion
  if (titlePart && titlePart.length > 3) return titlePart;

  // Activity name or advisor_description as last resort
  return activity.name || activity.advisor_description || 'Respond to this requirement.';
}

/**
 * Derive answer_type from the activity's outputs and produces_rrt_fields.
 *
 * Rules:
 * - outputs containing "status = implemented | partial | ..." → enum
 * - produces_rrt_fields containing ".status" → enum
 * - produces_rrt_fields like "rrt.scope.*" or "rrt.governance.*" → yes_no
 * - FOUNDATION mapped_requirements → yes_no
 * - fallback → enum (most practice activities are status-based)
 */
function deriveAnswerType(activity: any): RRSchemaQuestion['answer_type'] {
  // Explicit answer_type in bank takes precedence
  if (activity.answer_type) {
    return normalizeAnswerType(activity.answer_type);
  }

  const outputs: string[] = activity.outputs || [];
  const rrtFields: string[] = activity.produces_rrt_fields || [];
  const mappedReqs: string[] = activity.mapped_requirements || [];

  // Check outputs for enum-style status patterns
  for (const output of outputs) {
    if (/status\s*=\s*\w+\s*\|\s*\w+/.test(output)) {
      return 'enum';
    }
  }

  // Check rrt_fields for .status suffix → enum
  if (rrtFields.some((f: string) => f.endsWith('.status'))) {
    return 'enum';
  }

  // Foundation / scope / governance fields → yes_no
  if (mappedReqs.includes('FOUNDATION')) {
    return 'yes_no';
  }
  if (rrtFields.some((f: string) => f.startsWith('rrt.scope.') || f.startsWith('rrt.governance.'))) {
    return 'yes_no';
  }

  // Default for level-specific practice activities
  return 'enum';
}

/**
 * Derive enum_values for enum/multi_select questions.
 *
 * Priority:
 * 1. Explicit enum_values on the activity
 * 2. Parse from outputs strings like "status = implemented | partial | not_implemented | not_applicable"
 * 3. Default practice status set for enum, empty for multi_select
 */
function deriveEnumValues(activity: any, answerType: string): string[] {
  // 1. Explicit enum_values from the bank
  if (activity.enum_values && Array.isArray(activity.enum_values) && activity.enum_values.length > 0) {
    return activity.enum_values;
  }

  // 2. Parse from outputs: "Set rrt.practice.X.status = val1 | val2 | ..."
  const outputs: string[] = activity.outputs || [];
  for (const output of outputs) {
    const match = output.match(/=\s*(.+)/);
    if (match) {
      const values = match[1]
        .split('|')
        .map((v: string) => v.trim())
        .filter((v: string) => v.length > 0);
      if (values.length >= 2) return values;
    }
  }

  // 3. Default practice status values for enum type
  if (answerType === 'enum') {
    return ['implemented', 'partial', 'not_implemented', 'not_applicable'];
  }

  return [];
}

/**
 * Derive assessor methods. Prefer the bank activity's methods, then the
 * assessor KB, then default.
 */
function deriveAssessorMethods(
  activity: any,
  assessorEntry: any
): Array<'examine' | 'interview' | 'test'> {
  const raw: string[] | undefined =
    activity.assessor_methods ||
    assessorEntry?.assessor_methods;
  return normalizeAssessorMethods(raw);
}

/**
 * Derive advisor_reason_rrt. Prefer activity bank field (already has good data),
 * then fall back to requirements store ui_help.why_it_matters.
 */
function deriveAdvisorReason(activity: any, reqEntry: any): string | undefined {
  // Activity bank already has good advisor_reason_rrt text
  if (activity.advisor_reason_rrt) return activity.advisor_reason_rrt;
  if (reqEntry?.ui_help?.why_it_matters) return reqEntry.ui_help.why_it_matters;
  return undefined;
}

/**
 * Derive advisor_cmmc_impact. Prefer activity bank field (already has good data),
 * then fall back to requirements store ui_help.attainment_impact.
 */
function deriveAdvisorImpact(activity: any, reqEntry: any): string | undefined {
  // Activity bank already has good advisor_cmmc_impact text
  if (activity.advisor_cmmc_impact) return activity.advisor_cmmc_impact;
  if (reqEntry?.ui_help?.attainment_impact) return reqEntry.ui_help.attainment_impact;
  return undefined;
}

// ---------------------------------------------------------------------------
// general helpers
// ---------------------------------------------------------------------------

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function extractScenarioTags(siBaseline: SIBaseline): string[] {
  const tags: string[] = [];
  const si = siBaseline.si_baseline;
  if (si.target?.target_cmmc_level) tags.push(`level_${si.target.target_cmmc_level}`);
  if (si.target?.cui_presence) tags.push(si.target.cui_presence);
  if (si.scope?.boundary_strategy) tags.push(si.scope.boundary_strategy);
  if (si.scope?.deployment_posture) tags.push(si.scope.deployment_posture);
  if (si.operations?.byod_posture) tags.push(`byod_${si.operations.byod_posture}`);
  if (si.operations?.collaboration_mode) tags.push(`collab_${si.operations.collaboration_mode}`);
  if (si.evidence?.evidence_posture_target) tags.push(si.evidence.evidence_posture_target);
  if (si.assessment?.assessment_route) tags.push(`assess_${si.assessment.assessment_route}`);
  if (si.dependencies?.tenant_model_preference) tags.push(`tenant_${si.dependencies.tenant_model_preference}`);
  if (si.risk_acceptance?.poam_policy_intent) tags.push(`poam_${si.risk_acceptance.poam_policy_intent}`);
  if (si.operations?.devops_touches_cui) tags.push('devops_cui');
  return tags;
}

/**
 * Extract all activities from the nested YAML question bank structure.
 * Handles: ces.activity_bank.universal.activities + ces.activity_bank.level_specific.<L>.activities
 * Falls back to rrQuestionBank.activities for legacy flat structures.
 */
function extractActivitiesFromBank(rrQuestionBank: any): any[] {
  const bank = rrQuestionBank?.ces?.activity_bank;
  if (!bank) return rrQuestionBank?.activities || [];

  const activities: any[] = [];

  // Universal activities
  if (bank.universal?.activities) {
    activities.push(...bank.universal.activities);
  }

  // Level-specific activities
  if (bank.level_specific) {
    for (const level of Object.keys(bank.level_specific)) {
      const levelGroup = bank.level_specific[level];
      if (levelGroup?.activities) {
        activities.push(...levelGroup.activities);
      }
    }
  }

  return activities;
}

interface FilterResult {
  included: any[];
  excluded: Array<{ activity_id: string; reason: string }>;
}

function filterActivities(activities: any[], siBaseline: SIBaseline, profile: ScenarioProfile): FilterResult {
  if (!activities || activities.length === 0) return { included: [], excluded: [] };

  const si = siBaseline.si_baseline;
  const targetLevel = si.target?.target_cmmc_level || 'L2';
  const currentLevelNum = parseInt(targetLevel.replace(/[^0-9]/g, '') || '2');

  const included: any[] = [];
  const excluded: FilterResult['excluded'] = [];

  for (const activity of activities) {
    const actId = activity.id || activity.activity_id || 'unknown';

    // Gate 1: CMMC level filter (existing logic)
    if (activity.applies_to_levels && Array.isArray(activity.applies_to_levels)) {
      if (!activity.applies_to_levels.includes(targetLevel)) {
        excluded.push({ activity_id: actId, reason: `Level filter: ${targetLevel} not in [${activity.applies_to_levels}]` });
        continue;
      }
    }

    // Legacy min_level check
    if (activity.applicability?.min_level) {
      const minLevel = parseInt(activity.applicability.min_level.replace(/[^0-9]/g, '') || '2');
      if (currentLevelNum < minLevel) {
        excluded.push({ activity_id: actId, reason: `Legacy min_level filter: requires L${minLevel}` });
        continue;
      }
    }

    // Gate 2: SI Baseline applicability rules
    const applicabilityResult = evaluateApplicability(activity, profile);
    if (applicabilityResult.excluded) {
      excluded.push({ activity_id: actId, reason: applicabilityResult.reasons[0] || 'Applicability rule' });
      continue;
    }

    included.push(activity);
  }

  return { included, excluded };
}

/**
 * Cross-reference covered requirements against all in-scope CMMC requirements
 * for the target level. Returns any requirements that have no question coverage.
 */
function computeRequirementsMissing(
  covered: Set<string>,
  reqMap: Map<string, any>,
  targetLevel: string,
  excludedActivities: Array<{ activity_id: string; reason: string }>,
): Array<{ requirement_id: string; reason: string }> {
  if (reqMap.size === 0) return [];

  const levelHierarchy: Record<string, string[]> = {
    L1: ['L1'],
    L2: ['L1', 'L2'],
    L3: ['L1', 'L2', 'L3'],
  };
  const inScopeLevels = levelHierarchy[targetLevel] || ['L1', 'L2'];

  // Build a map of excluded requirement IDs → reason from excluded activities
  const excludedReqReasons = new Map<string, string>();
  for (const ex of excludedActivities) {
    // Try to extract requirement ID from activity_id (e.g., RR-ACT-PE_L1_3_10_1 → PE.L1-3.10.1)
    const match = ex.activity_id.match(/RR-ACT-([A-Z]{2})_(L\d)_(\d+)_(\d+)_(\d+)/);
    if (match) {
      const reqId = `${match[1]}.${match[2]}-${match[3]}.${match[4]}.${match[5]}`;
      excludedReqReasons.set(reqId, ex.reason);
    }
  }

  const missing: Array<{ requirement_id: string; reason: string }> = [];

  for (const [reqId, req] of reqMap) {
    if (!inScopeLevels.includes(req.level)) continue;
    if (covered.has(reqId)) continue;

    const excludeReason = excludedReqReasons.get(reqId);
    const reason = excludeReason
      || 'No question in the RR Question Bank maps to this requirement';
    missing.push({ requirement_id: reqId, reason });
  }

  return missing;
}

/** Extract CMMC domain prefix from activity (e.g., 'PE', 'AC', 'SC'). */
function extractDomain(activity: any): string | null {
  const reqs: string[] = activity.mapped_requirements || [];
  if (reqs.length > 0 && reqs[0] !== 'FOUNDATION') {
    const match = reqs[0].match(/^([A-Z]{2})\./);
    if (match) return match[1];
  }
  const idMatch = (activity.id || '').match(/RR-ACT-([A-Z]{2})_/);
  return idMatch ? idMatch[1] : null;
}

/** Extract NIST practice number from activity (e.g., '3.1.1', '3.13.10'). */
function extractPracticeNistId(activity: any): string | null {
  const reqs: string[] = activity.mapped_requirements || [];
  if (reqs.length > 0 && reqs[0] !== 'FOUNDATION') {
    const match = reqs[0].match(/\d+\.\d+\.\d+/);
    return match ? match[0] : null;
  }
  return null;
}

function normalizeAnswerType(raw: string | undefined): RRSchemaQuestion['answer_type'] {
  const map: Record<string, RRSchemaQuestion['answer_type']> = {
    boolean: 'yes_no',
    yes_no: 'yes_no',
    enum: 'enum',
    multi_select: 'multi_select',
    string: 'free_text',
    free_text: 'free_text',
    number: 'free_text',
    array: 'multi_select',
    url: 'url',
    evidence_upload: 'evidence_upload',
    structured_json: 'structured_json',
  };
  return map[raw || ''] || 'free_text';
}

function normalizeAssessorMethods(
  raw: string[] | undefined
): Array<'examine' | 'interview' | 'test'> {
  if (!raw || raw.length === 0) return ['examine'];
  const allowed = new Set(['examine', 'interview', 'test']);
  const result = raw.filter((m) => allowed.has(m)) as Array<'examine' | 'interview' | 'test'>;
  return result.length > 0 ? result : ['examine'];
}

function normalizeExpectedEvidence(
  question: any
): Array<{ evidence_matrix_id: string; archetype_id: string; minimum_fields: string[]; retention_days_min?: number }> {
  if (question.expected_evidence && Array.isArray(question.expected_evidence)) {
    return question.expected_evidence.map((e: any) => ({
      evidence_matrix_id: e.evidence_matrix_id || 'default',
      archetype_id: e.archetype_id || 'default',
      minimum_fields: e.minimum_fields || ['description'],
      ...(e.retention_days_min != null ? { retention_days_min: e.retention_days_min } : {}),
    }));
  }
  // YAML structure: expected_evidence_archetypes is an array of objects or strings
  const archetypes: any[] = question.expected_evidence_archetypes || [];
  if (archetypes.length > 0) {
    return archetypes.map((arch: any) => {
      if (typeof arch === 'string') {
        return { evidence_matrix_id: 'default', archetype_id: arch, minimum_fields: ['description'] };
      }
      return {
        evidence_matrix_id: arch.evidence_matrix_id || 'default',
        archetype_id: arch.archetype_id || 'default',
        minimum_fields: arch.minimum_fields || ['description'],
        ...(arch.retention_days_min != null ? { retention_days_min: arch.retention_days_min } : {}),
      };
    });
  }
  return [{ evidence_matrix_id: 'default', archetype_id: 'default', minimum_fields: ['description'] }];
}

function normalizeEvidenceRequests(
  raw: any[]
): Array<{ id: string; evidence_type: string; description: string; acceptable_forms?: string[]; collection_method?: string; retention_notes?: string; cmmc_attainment_impact?: string; advisor_notes?: string }> {
  return raw.map((er: any) => ({
    id: er.id || 'unknown',
    evidence_type: er.evidence_type || 'unknown',
    description: er.description || '',
    ...(er.acceptable_forms?.length ? { acceptable_forms: er.acceptable_forms } : {}),
    ...(er.collection_method ? { collection_method: er.collection_method } : {}),
    ...(er.retention_notes ? { retention_notes: er.retention_notes } : {}),
    ...(er.cmmc_attainment_impact ? { cmmc_attainment_impact: er.cmmc_attainment_impact } : {}),
    ...(er.advisor_notes ? { advisor_notes: er.advisor_notes } : {}),
  }));
}

/**
 * Validate question set against schema (basic structural check)
 */
export function validateQuestionSet(questionSet: RRQuestionSet): boolean {
  if (!questionSet.ces.inputs?.si_baseline_ref) return false;
  if (!questionSet.ces.questions || questionSet.ces.questions.length === 0) return false;
  return true;
}
