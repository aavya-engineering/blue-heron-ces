// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { RRTAnswer, EvidenceItem } from '../types';
import { generateId } from '@/shared/utils/idGenerator';
import { toISODateTime } from '@/shared/utils/dateFormatter';

// ---------------------------------------------------------------------------
// Domain Context: all external data sources passed from the wizard
// ---------------------------------------------------------------------------

export interface DomainContext {
  assessorKB?: any;
  evidenceArchetypes?: any;
  cmmcRequirements?: any;
  evidenceMatrix?: any;
  techStackMapping?: any;
}

// ---------------------------------------------------------------------------
// Lookup maps built once per autofill invocation
// ---------------------------------------------------------------------------

interface Lookups {
  assessorMap: Map<string, any>;
  requirementMap: Map<string, any>;
  evidenceMatrixMap: Map<string, any>;
  techStackMappings: Map<string, any[]>; // reqId -> mapping[]
  archetypeMap: Map<string, any>;
  techStacks: any[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Auto-generate realistic RRT answers using SI Baseline profile, CMMC requirements,
 * evidence matrix, tech stack mappings, and assessor KB.
 */
export function autofillRRTAnswers(
  questionSet: any,
  siBaseline: any,
  domainContext?: DomainContext,
): Record<string, RRTAnswer> {
  const answers: Record<string, RRTAnswer> = {};

  const si = siBaseline?.si_baseline || {};

  const lookups = buildAllLookups(domainContext);

  // Handle flat questions structure
  if (questionSet?.ces?.questions && Array.isArray(questionSet.ces.questions)) {
    questionSet.ces.questions.forEach((question: any) => {
      const answer = generateDataDrivenAnswer(question, si, lookups);
      answers[question.question_id] = answer;
    });
    return answers;
  }

  // Legacy: activities structure
  if (questionSet?.ces?.activities) {
    questionSet.ces.activities.forEach((activity: any) => {
      activity.questions?.forEach((question: any) => {
        const answer = generateDataDrivenAnswer(question, si, lookups);
        answers[question.question_id] = answer;
      });
    });
  }

  return answers;
}

// ---------------------------------------------------------------------------
// Lookup builders
// ---------------------------------------------------------------------------

function buildAllLookups(ctx?: DomainContext): Lookups {
  return {
    assessorMap: buildAssessorMap(ctx?.assessorKB),
    requirementMap: buildCMMCRequirementMap(ctx?.cmmcRequirements),
    evidenceMatrixMap: buildEvidenceMatrixMap(ctx?.evidenceMatrix),
    techStackMappings: buildTechStackMappingLookup(ctx?.techStackMapping),
    archetypeMap: buildArchetypeMap(ctx?.cmmcRequirements),
    techStacks: extractTechStacks(ctx?.techStackMapping),
  };
}

function buildAssessorMap(assessorKB: any): Map<string, any> {
  const map = new Map<string, any>();
  const practices = assessorKB?.ces?.practices || assessorKB?.practices || [];
  practices.forEach((p: any) => {
    if (p.practice_id) map.set(p.practice_id, p);
  });
  return map;
}

function buildCMMCRequirementMap(cmmcReqs: any): Map<string, any> {
  const map = new Map<string, any>();
  // YAML structure: top-level `requirements` array
  const reqs = cmmcReqs?.requirements || cmmcReqs?.ces?.requirements || [];
  reqs.forEach((r: any) => {
    if (r.requirement_id) map.set(r.requirement_id, r);
  });
  return map;
}

function buildEvidenceMatrixMap(evidenceMatrix: any): Map<string, any> {
  const map = new Map<string, any>();
  // YAML structure: ces.mappings[] with practice_id
  const mappings = evidenceMatrix?.ces?.mappings || evidenceMatrix?.mappings || [];
  mappings.forEach((m: any) => {
    if (m.practice_id) map.set(m.practice_id, m);
  });
  return map;
}

function buildTechStackMappingLookup(techStackData: any): Map<string, any[]> {
  const map = new Map<string, any[]>();
  // YAML has three top-level arrays: TechStacks, CMMC_Requirements, Mappings
  const mappings = techStackData?.Mappings || [];
  // Build a secondary lookup from numeric req_id -> requirement_id string
  const reqIdLookup = new Map<number, string>();
  const reqs = techStackData?.CMMC_Requirements || [];
  reqs.forEach((r: any) => {
    if (r.id != null && r.requirement_id) reqIdLookup.set(r.id, r.requirement_id);
  });

  mappings.forEach((m: any) => {
    const reqIdStr = reqIdLookup.get(m.req_id);
    if (!reqIdStr) return;
    const existing = map.get(reqIdStr) || [];
    existing.push(m);
    map.set(reqIdStr, existing);
  });

  return map;
}

function buildArchetypeMap(cmmcReqs: any): Map<string, any> {
  const map = new Map<string, any>();
  // Archetypes may live under catalogs.evidence_archetypes
  const archetypes = cmmcReqs?.catalogs?.evidence_archetypes || [];
  archetypes.forEach((a: any) => {
    const id = a.archetype_id || a.id;
    if (id) map.set(id.toLowerCase(), a);
  });
  return map;
}

function extractTechStacks(techStackData: any): any[] {
  return techStackData?.TechStacks || [];
}

// ---------------------------------------------------------------------------
// Deterministic hash for per-question variation (avoids repeating patterns)
// ---------------------------------------------------------------------------

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash);
}

/** Returns a deterministic float in [0, 1) based on question_id */
function hashVariation(questionId: string): number {
  return (simpleHash(questionId) % 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Outcome computation: SI Baseline-aware scoring model
// ---------------------------------------------------------------------------

type Outcome = 'met' | 'partial' | 'not_met';

/** Extract the 2-letter CMMC domain from a requirement ID like "AC.L2-3.1.1" */
function extractDomain(reqId: string): string {
  return reqId.split('.')[0]?.toUpperCase() || '';
}

function computeOutcome(
  question: any,
  si: any,
  lookups: Lookups,
): Outcome {
  const mappedReqs: string[] = question.mapped_requirements || [];
  const primaryReq = mappedReqs[0] || '';
  const domain = extractDomain(primaryReq);

  // Base score: 0.70 = 70% chance of "met"
  let score = 0.70;

  // --- SI Baseline modifiers ---
  score += computeEvidenceMaturityModifier(si);
  score += computeDeploymentModifier(si, domain);
  score += computeBYODModifier(si, domain);
  score += computeCUIModifier(si);
  score += computeESPModifier(si, domain);
  score += computeGovernanceModifier(si, domain);
  score += computeRiskModifier(si);
  score += computeDomainModifier(si, domain);

  // --- Tech stack coverage modifier ---
  score += computeTechStackModifier(mappedReqs, lookups);

  // --- Scoping impact modifier ---
  score += computeScopingModifier(mappedReqs, lookups);

  // --- Deterministic per-question variation (±0.10) ---
  const variation = (hashVariation(question.question_id) - 0.5) * 0.20;
  score += variation;

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Map score to outcome
  if (score > 0.65) return 'met';
  if (score >= 0.35) return 'partial';
  return 'not_met';
}

// --- Individual modifier functions ---

function computeEvidenceMaturityModifier(si: any): number {
  const posture = si.evidence?.evidence_posture_target;
  const mode = si.evidence?.evidence_collection_mode;

  let mod = 0;
  // Higher evidence maturity → more likely to be met
  if (posture === 'continuous_compliance') mod += 0.08;
  else if (posture === 'c3pao_ready') mod += 0.05;
  else if (posture === 'l2_self_ready') mod += 0.0;
  else if (posture === 'unknown') mod -= 0.05;

  if (mode === 'automated') mod += 0.05;
  else if (mode === 'assisted') mod += 0.02;
  else if (mode === 'manual') mod -= 0.05;

  return mod;
}

function computeDeploymentModifier(si: any, domain: string): number {
  const posture = si.scope?.deployment_posture;
  if (!posture || posture === 'unknown') return -0.03;

  // Cloud deployments make certain domains easier/harder
  if (posture === 'cloud_only') {
    if (domain === 'PE') return 0.10; // Less physical scope
    if (['AC', 'SC', 'AU', 'IA'].includes(domain)) return 0.05; // Cloud-managed
    if (domain === 'MA') return 0.05; // Less maintenance scope
  }
  if (posture === 'on_prem') {
    if (domain === 'PE') return -0.08; // More physical security burden
    if (domain === 'MA') return -0.05; // More maintenance needed
    if (['AC', 'AU'].includes(domain)) return -0.03; // Manual controls
  }
  // hybrid gets no modifier (baseline)
  return 0;
}

function computeBYODModifier(si: any, domain: string): number {
  const byod = si.operations?.byod_posture;
  if (!byod || byod === 'unknown') return 0;

  if (byod === 'not_allowed') {
    // Easier for device-related domains
    if (['MP', 'SC', 'PE'].includes(domain)) return 0.05;
    return 0.02;
  }
  if (byod === 'allowed_mdm' || byod === 'allowed_vdi_only') {
    if (['MP', 'SC'].includes(domain)) return -0.05;
    return 0;
  }
  return 0;
}

function computeCUIModifier(si: any): number {
  const cui = si.target?.cui_presence;
  if (cui === 'no_cui' || cui === 'fci_only') return 0.05;
  if (cui === 'cui_plus_other_sensitive') return -0.05;
  return 0;
}

function computeESPModifier(si: any, domain: string): number {
  const esps: any[] = si.scope?.external_service_providers || [];
  const espCount = esps.length;
  if (espCount === 0) return 0.02;

  // More ESPs → CA/SC controls more complex
  if (['CA', 'SC', 'SR'].includes(domain)) {
    return espCount > 3 ? -0.10 : espCount > 1 ? -0.05 : 0;
  }
  return 0;
}

function computeGovernanceModifier(si: any, domain: string): number {
  let mod = 0;
  const gov = si.governance;
  if (!gov) return -0.03;

  // If change control owner is specified, CM domain is easier
  if (domain === 'CM' && gov.change_control_owner && gov.change_control_owner !== 'Not specified') {
    mod += 0.05;
  } else if (domain === 'CM') {
    mod -= 0.05;
  }

  // Evidence owner roles populated → better governance
  if (gov.evidence_owner_roles?.length > 1) mod += 0.02;

  return mod;
}

function computeRiskModifier(si: any): number {
  const risk = si.risk_acceptance;
  if (!risk) return 0;

  let mod = 0;
  // Known risk tolerances reduce severity of gaps
  if (risk.known_risk_tolerances?.length > 0) mod += 0.03;
  // POA&M-friendly orgs accept partial compliance more readily
  if (risk.poam_policy_intent === 'poam_if_allowed') mod += 0.02;

  return mod;
}

/** Domain-specific adjustments based on SI Baseline signals */
function computeDomainModifier(si: any, domain: string): number {
  let mod = 0;

  switch (domain) {
    case 'AT': // Awareness & Training — generally achievable
      mod += 0.08;
      break;
    case 'IR': // Incident Response — penalize if no dedicated IR implied
      if (!si.governance?.audit_interface_owner || si.governance.audit_interface_owner === 'Not specified') {
        mod -= 0.05;
      }
      break;
    case 'IA': // Identification & Auth — boost if cloud/managed identity likely
      if (si.scope?.deployment_posture === 'cloud_only') mod += 0.05;
      if (si.dependencies?.tenant_model_preference === 'gcc_high' ||
          si.dependencies?.tenant_model_preference === 'gcc') {
        mod += 0.05; // M365 identity infrastructure
      }
      break;
    case 'SI': // System & Info Integrity
      if (si.evidence?.evidence_collection_mode === 'automated') mod += 0.05;
      break;
    case 'RA': // Risk Assessment
      if (si.risk_acceptance?.risk_acceptance_authority &&
          si.risk_acceptance.risk_acceptance_authority !== 'Not specified') {
        mod += 0.05;
      }
      break;
  }

  return mod;
}

/** Tech stack coverage: Overt support → likely met, None → likely not met */
function computeTechStackModifier(mappedReqs: string[], lookups: Lookups): number {
  if (lookups.techStackMappings.size === 0) return 0;

  let totalModifier = 0;
  let count = 0;

  for (const reqId of mappedReqs) {
    const stackMappings = lookups.techStackMappings.get(reqId);
    if (!stackMappings?.length) continue;

    // Find best support type across all tech stacks
    let bestSupport = 'None';
    for (const m of stackMappings) {
      const st = (m.support_type || '').toLowerCase();
      if (st === 'full' || st === 'overt') {
        bestSupport = 'full';
        break;
      }
      if (st === 'partial' && bestSupport !== 'full') bestSupport = 'partial';
    }

    if (bestSupport === 'full') totalModifier += 0.10;
    else if (bestSupport === 'partial') totalModifier += 0.0;
    else totalModifier -= 0.08;

    count++;
  }

  return count > 0 ? totalModifier / count : 0;
}

/** Scoping impacts: if requirement has limited scope, it may be easier */
function computeScopingModifier(mappedReqs: string[], lookups: Lookups): number {
  for (const reqId of mappedReqs) {
    const req = lookups.requirementMap.get(reqId);
    if (!req?.scoping_impacts?.length) continue;
    // Having explicit scoping data suggests the requirement has conditions
    // that may reduce its applicability → slight positive modifier
    return 0.03;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Answer generation
// ---------------------------------------------------------------------------

function generateDataDrivenAnswer(
  question: any,
  si: any,
  lookups: Lookups,
): RRTAnswer {
  const outcome = computeOutcome(question, si, lookups);
  const mappedReqs: string[] = question.mapped_requirements || [];

  // Look up enrichment data for each mapped requirement
  const assessorGuidance = findFirst(mappedReqs, lookups.assessorMap);
  const cmmcReq = findFirst(mappedReqs, lookups.requirementMap);
  const evidenceMatrixEntry = findFirst(mappedReqs, lookups.evidenceMatrixMap);
  const techStackMappings = findTechStackMappings(mappedReqs, lookups);

  const answerValue = generateContextualAnswer(
    question, outcome, assessorGuidance, cmmcReq, techStackMappings,
  );
  const notes = generateContextualNotes(question, outcome, assessorGuidance, cmmcReq, evidenceMatrixEntry);
  const provenance = computeProvenance(question, outcome, cmmcReq, techStackMappings);

  // Determine assessor methods from requirement data when available
  const assessorMethods = computeAssessorMethods(question, cmmcReq, evidenceMatrixEntry);

  return {
    question_id: question.question_id,
    source_activity_id: question.source_activity_id || question.activity_id,
    answer: answerValue,
    provenance_class: provenance,
    mapped_requirements: mappedReqs,
    assessor_methods_satisfied: assessorMethods,
    expected_evidence_archetypes: extractArchetypeIds(question, cmmcReq),
    evidence_ids: [],
    notes,
  };
}

function findFirst(reqIds: string[], map: Map<string, any>): any | null {
  for (const id of reqIds) {
    if (map.has(id)) return map.get(id);
  }
  return null;
}

function findTechStackMappings(reqIds: string[], lookups: Lookups): any[] {
  for (const id of reqIds) {
    const mappings = lookups.techStackMappings.get(id);
    if (mappings?.length) return mappings;
  }
  return [];
}

function extractArchetypeIds(question: any, cmmcReq: any): string[] {
  // Prefer question-level expected evidence
  if (question.expected_evidence?.length) {
    const ids = question.expected_evidence.map((e: any) => e.archetype_id).filter(Boolean);
    if (ids.length > 0) return ids;
  }
  // Fall back to CMMC requirement evidence_minimum
  if (cmmcReq?.evidence_minimum?.must_have?.length) {
    return cmmcReq.evidence_minimum.must_have;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Contextual answer generation
// ---------------------------------------------------------------------------

function generateContextualAnswer(
  question: any,
  outcome: Outcome,
  assessorGuidance: any | null,
  cmmcReq: any | null,
  techStackMappings: any[],
): any {
  const answerType = question.answer_type || 'free_text';
  const statusEnum = parseOutputStatusEnum(question.outputs);

  switch (answerType) {
    case 'boolean':
    case 'yes_no':
      return outcome === 'met';

    case 'enum':
      if (statusEnum.length > 0) return pickEnumByOutcome(statusEnum, outcome);
      if (question.enum_values?.length) return pickEnumByOutcome(question.enum_values, outcome);
      return outcome === 'met' ? 'Yes' : outcome === 'partial' ? 'Partial' : 'No';

    case 'multi_select':
      if (question.enum_values?.length) {
        return outcome === 'met' ? question.enum_values : [question.enum_values[0]];
      }
      return outcome === 'met' ? ['implemented'] : ['in_progress'];

    case 'url':
      return 'https://evidence.internal/policy-repository';

    case 'structured_json':
      return {
        status: outcome === 'met' ? 'implemented' : outcome === 'partial' ? 'in_progress' : 'not_implemented',
        last_reviewed: new Date().toISOString().slice(0, 10),
      };

    case 'evidence_upload':
      return outcome === 'met'
        ? 'Evidence collected and verified'
        : 'Evidence collection pending';

    case 'free_text':
    default:
      return generateFreeTextAnswer(question, outcome, assessorGuidance, cmmcReq, techStackMappings);
  }
}

function parseOutputStatusEnum(outputs: string[] | undefined): string[] {
  if (!outputs?.length) return [];
  for (const out of outputs) {
    const match = out.match(/=\s*(.+)/);
    if (match) {
      const values = match[1].split('|').map((v) => v.trim()).filter(Boolean);
      if (values.length > 1) return values;
    }
  }
  return [];
}

function pickEnumByOutcome(values: string[], outcome: Outcome): string {
  const lower = values.map((v) => v.toLowerCase());

  if (outcome === 'met') {
    const impl = values.find((_, i) => lower[i].includes('implemented') && !lower[i].includes('not'));
    return impl || values[0];
  }
  if (outcome === 'partial') {
    const partial = values.find((_, i) => lower[i].includes('partial'));
    return partial || values[Math.min(1, values.length - 1)];
  }
  const notImpl = values.find(
    (_, i) => lower[i].includes('not_implemented') || lower[i].includes('not implemented'),
  );
  return notImpl || values[values.length - 1];
}

// ---------------------------------------------------------------------------
// Free-text answer generation (enriched with CMMC requirement data)
// ---------------------------------------------------------------------------

function generateFreeTextAnswer(
  question: any,
  outcome: Outcome,
  assessorGuidance: any | null,
  cmmcReq: any | null,
  techStackMappings: any[],
): string {
  const name = question.name || question.question_id;

  if (outcome === 'met') {
    return buildMetAnswer(name, question, cmmcReq, techStackMappings);
  }
  if (outcome === 'partial') {
    return buildPartialAnswer(name, question, cmmcReq, assessorGuidance, techStackMappings);
  }
  return buildNotMetAnswer(name, question, cmmcReq, assessorGuidance);
}

function buildMetAnswer(
  name: string,
  question: any,
  cmmcReq: any | null,
  techStackMappings: any[],
): string {
  const parts: string[] = [];

  // Lead with requirement-specific description if available
  const desc = cmmcReq?.ui_help?.advisor_description;
  if (desc) {
    parts.push(`Yes, fully implemented. ${truncate(desc, 200)}`);
  } else {
    parts.push(`Yes, fully implemented. ${name} controls are in place and operational.`);
  }

  // Reference specific evidence forms from requirement data
  const mustHave = cmmcReq?.evidence_minimum?.must_have;
  if (mustHave?.length) {
    const evidenceNames = mustHave.slice(0, 3).join(', ');
    parts.push(`Supporting evidence collected: ${evidenceNames}.`);
  } else {
    const forms = question.evidence_requests?.[0]?.acceptable_forms;
    if (forms?.length) parts.push(`Supporting evidence: ${forms[0]}.`);
  }

  // Reference tech stack product if available
  const overtStack = techStackMappings.find(
    (m) => m.support_type?.toLowerCase() === 'full' || m.support_type?.toLowerCase() === 'overt',
  );
  if (overtStack?.responsibility) {
    parts.push(`Implementation supported by managed tooling. ${truncate(overtStack.responsibility, 120)}`);
  }

  // Add operationalization context
  if (cmmcReq?.operationalization_notes) {
    parts.push(`Approach: ${truncate(cmmcReq.operationalization_notes, 150)}`);
  }

  return parts.join(' ');
}

function buildPartialAnswer(
  name: string,
  _question: any,
  cmmcReq: any | null,
  assessorGuidance: any | null,
  techStackMappings: any[],
): string {
  const parts: string[] = [];

  // Lead with specific gap from common_pitfalls
  const pitfall = cmmcReq?.common_pitfalls?.[0];
  if (pitfall) {
    parts.push(`Partially implemented. Primary gap: ${truncate(pitfall, 200)}`);
  } else {
    parts.push(`Partially implemented. Some controls for ${name} are in place but require completion.`);
  }

  // Add partial credit guidance from assessor KB
  const guidance = assessorGuidance?.partial_credit_guidance;
  if (guidance) {
    parts.push(truncate(guidance, 150));
  }

  // Reference design-for-assessment constraints not yet met
  const dfaConstraint = cmmcReq?.design_for_assessment?.[0]?.constraint;
  if (dfaConstraint) {
    parts.push(`Outstanding constraint: ${truncate(dfaConstraint, 150)}`);
  }

  // Reference tech stack partial support
  const partialStack = techStackMappings.find(
    (m) => m.support_type?.toLowerCase() === 'partial',
  );
  if (partialStack?.notes) {
    parts.push(`Tooling note: ${truncate(partialStack.notes, 120)}`);
  }

  return parts.join(' ');
}

function buildNotMetAnswer(
  name: string,
  _question: any,
  cmmcReq: any | null,
  assessorGuidance: any | null,
): string {
  const parts: string[] = [];

  // Use multiple common_pitfalls for realistic gap description
  const pitfalls = cmmcReq?.common_pitfalls || [];
  if (pitfalls.length > 0) {
    const gapList = pitfalls.slice(0, 2).map((p: string) => truncate(p, 120)).join('; ');
    parts.push(`Not yet implemented. Identified gaps: ${gapList}.`);
  } else {
    parts.push(`Not yet implemented. ${name} requires remediation.`);
  }

  // Reference missing evidence
  const mustHave = cmmcReq?.evidence_minimum?.must_have;
  if (mustHave?.length) {
    const missing = mustHave.slice(0, 3).join(', ');
    parts.push(`Required evidence not yet available: ${missing}.`);
  }

  // Add failure mode context from assessor KB
  const failureModes = assessorGuidance?.common_failure_modes;
  if (failureModes?.length) {
    parts.push(`Known failure mode: ${truncate(failureModes[0], 120)}.`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Contextual notes (enriched with domain data)
// ---------------------------------------------------------------------------

function generateContextualNotes(
  question: any,
  outcome: Outcome,
  assessorGuidance: any | null,
  cmmcReq: any | null,
  evidenceMatrixEntry: any | null,
): string {
  const parts: string[] = [];

  // Why it matters (from CMMC requirement)
  const whyItMatters = cmmcReq?.ui_help?.why_it_matters;
  if (whyItMatters) {
    parts.push(`Why it matters: ${truncate(whyItMatters, 150)}`);
  }

  // CMMC attainment impact
  const attainmentImpact = cmmcReq?.ui_help?.attainment_impact;
  if (attainmentImpact && outcome !== 'met') {
    parts.push(`Attainment impact: ${truncate(attainmentImpact, 120)}`);
  }

  // Advisor CMMC impact from question
  if (!attainmentImpact && question.advisor_cmmc_impact) {
    parts.push(`CMMC Impact: ${question.advisor_cmmc_impact}`);
  }

  // Anti-patterns from evidence matrix
  const antiPatterns = evidenceMatrixEntry?.anti_patterns;
  if (antiPatterns?.length && outcome !== 'met') {
    parts.push(`Avoid: ${antiPatterns[0]}`);
  }

  // Assessor focus for non-met outcomes
  if (outcome !== 'met' && assessorGuidance?.what_assessors_probe?.length) {
    parts.push(`Assessor focus: ${assessorGuidance.what_assessors_probe[0]}`);
  }

  // Scoping summary if available
  const scopingImpact = cmmcReq?.scoping_impacts?.[0]?.summary;
  if (scopingImpact) {
    parts.push(`Scope: ${truncate(scopingImpact, 100)}`);
  }

  // Assessment steps count
  if (question.steps?.length) {
    parts.push(`Assessment steps: ${question.steps.length}`);
  }

  if (parts.length === 0) {
    parts.push('Auto-generated from domain knowledge sources');
  }

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Provenance class (context-aware)
// ---------------------------------------------------------------------------

function computeProvenance(
  question: any,
  outcome: Outcome,
  cmmcReq: any | null,
  techStackMappings: any[],
): RRTAnswer['provenance_class'] {
  // Universal/foundation questions (boundary, SSP, dataflow) → directly observable
  const qid = (question.question_id || '').toLowerCase();
  const actId = (question.source_activity_id || '').toLowerCase();
  if (actId.includes('boundary') || actId.includes('dataflow') || actId.includes('ssp') ||
      qid.includes('boundary') || qid.includes('dataflow') || qid.includes('ssp')) {
    return 'operator_observation';
  }

  // Tech stack with overt/full support → system observation
  if (outcome === 'met' && techStackMappings.length > 0) {
    const hasOvert = techStackMappings.some(
      (m) => {
        const st = (m.support_type || '').toLowerCase();
        return st === 'full' || st === 'overt';
      },
    );
    if (hasOvert) return 'system_observation';
  }

  // Met with strong evidence basis → client assertion
  if (outcome === 'met') {
    // If requirement has design_for_assessment constraints, this is a stronger assertion
    if (cmmcReq?.design_for_assessment?.length) return 'client_assertion';
    return 'client_assertion';
  }

  // Partial/not_met → inferred from SI baseline + domain analysis
  return 'operator_inference';
}

// ---------------------------------------------------------------------------
// Assessor methods (from requirement data)
// ---------------------------------------------------------------------------

function computeAssessorMethods(
  question: any,
  cmmcReq: any | null,
  evidenceMatrixEntry: any | null,
): string[] {
  // Prefer question-level assessor methods
  if (question.assessor_methods?.length) return question.assessor_methods;

  // Fall back to evidence matrix entry
  if (evidenceMatrixEntry?.assessor_methods?.length) return evidenceMatrixEntry.assessor_methods;

  // Fall back to CMMC requirement assessment objectives
  if (cmmcReq?.assessment_objectives?.length) {
    const methods = new Set<string>();
    cmmcReq.assessment_objectives.forEach((ao: any) => {
      ao.methods?.forEach((m: string) => methods.add(m));
    });
    if (methods.size > 0) return Array.from(methods);
  }

  return ['examine', 'interview'];
}

// ---------------------------------------------------------------------------
// Evidence generation (enriched with Evidence Matrix + CMMC data)
// ---------------------------------------------------------------------------

/**
 * Generate mock evidence items using Evidence Matrix tiers, CMMC evidence_minimum,
 * and real archetype names.
 */
export function generateMockEvidence(
  answers: Record<string, RRTAnswer>,
  questionSet: any,
  domainContext?: DomainContext,
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const questions = questionSet?.ces?.questions || [];
  const seen = new Set<string>();

  const lookups = domainContext
    ? {
        evidenceMatrixMap: buildEvidenceMatrixMap(domainContext.evidenceMatrix),
        requirementMap: buildCMMCRequirementMap(domainContext.cmmcRequirements),
        archetypeMap: buildArchetypeMap(domainContext.cmmcRequirements),
      }
    : { evidenceMatrixMap: new Map(), requirementMap: new Map(), archetypeMap: new Map() };

  for (const q of questions) {
    const answer = answers[q.question_id];
    const outcome = inferOutcomeFromAnswer(answer);
    const mappedReqs: string[] = q.mapped_requirements || [];

    // Look up requirement + evidence matrix data
    const cmmcReq = findFirst(mappedReqs, lookups.requirementMap);
    const evidenceMatrixEntry = findFirst(mappedReqs, lookups.evidenceMatrixMap);

    // Determine assessor methods from real data
    const assessorMethods = computeEvidenceMethods(q, cmmcReq, evidenceMatrixEntry);

    // Collect archetype IDs: prefer evidence_minimum.must_have, then question's evidence_requests
    const archetypeIds = collectArchetypeIds(q, cmmcReq);

    for (const archetypeId of archetypeIds) {
      if (seen.has(archetypeId)) continue;
      seen.add(archetypeId);

      // Look up archetype details for richer evidence
      const archetype = lookups.archetypeMap.get(archetypeId.toLowerCase());
      const strengthTier = pickEvidenceStrengthTier(outcome, evidenceMatrixEntry, archetypeId);

      evidence.push({
        evidence_id: generateId(),
        source_system: archetype?.domain || q.evidence_requests?.[0]?.evidence_type || 'unknown',
        location: `/evidence/${archetypeId}.pdf`,
        hash_sha256: generateId(),
        captured_at: toISODateTime(new Date()),
        archetype_id: archetypeId,
        collector: 'autofill_service',
        retention_days: 365,
        freshness_days: 30,
        assessor_methods_supported: assessorMethods,
        mapped_requirements: mappedReqs,
        supporting_question_ids: [q.question_id],
        notes: buildEvidenceNotes(archetype, strengthTier, outcome, q),
      });
    }

    // Also process evidence_requests that didn't map to archetypeIds above
    const evReqs = q.evidence_requests || [];
    for (const er of evReqs) {
      const erId = er.id || er.evidence_type;
      if (!erId || seen.has(erId)) continue;
      seen.add(erId);

      evidence.push({
        evidence_id: generateId(),
        source_system: er.evidence_type || 'unknown',
        location: `/evidence/${erId}.pdf`,
        hash_sha256: generateId(),
        captured_at: toISODateTime(new Date()),
        archetype_id: er.evidence_type || erId,
        collector: 'autofill_service',
        retention_days: 365,
        freshness_days: 30,
        assessor_methods_supported: assessorMethods,
        mapped_requirements: mappedReqs,
        supporting_question_ids: [q.question_id],
        notes: er.description || 'Auto-generated evidence reference',
      });
    }
  }

  return evidence;
}

function inferOutcomeFromAnswer(answer?: RRTAnswer): Outcome {
  if (!answer) return 'not_met';
  const val = answer.answer;
  if (typeof val === 'boolean') return val ? 'met' : 'not_met';
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    if (lower.includes('not yet') || lower.includes('not_implemented') || lower.includes('not implemented')) {
      return 'not_met';
    }
    if (lower.includes('partial')) return 'partial';
    if (lower.includes('fully implemented') || lower.includes('yes')) return 'met';
  }
  if (typeof val === 'object' && val?.status) {
    if (val.status === 'implemented') return 'met';
    if (val.status === 'in_progress') return 'partial';
    return 'not_met';
  }
  return 'partial';
}

function collectArchetypeIds(question: any, cmmcReq: any | null): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  // From CMMC requirement evidence_minimum.must_have
  if (cmmcReq?.evidence_minimum?.must_have) {
    for (const id of cmmcReq.evidence_minimum.must_have) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  // From question expected_evidence
  if (question.expected_evidence) {
    for (const e of question.expected_evidence) {
      const id = e.archetype_id;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

function computeEvidenceMethods(
  question: any,
  cmmcReq: any | null,
  evidenceMatrixEntry: any | null,
): string[] {
  if (evidenceMatrixEntry?.assessor_methods?.length) return evidenceMatrixEntry.assessor_methods;
  if (question.assessor_methods?.length) return question.assessor_methods;
  if (cmmcReq?.assessment_objectives?.length) {
    const methods = new Set<string>();
    cmmcReq.assessment_objectives.forEach((ao: any) => {
      ao.methods?.forEach((m: string) => methods.add(m));
    });
    if (methods.size > 0) return Array.from(methods);
  }
  return ['examine', 'interview'];
}

function pickEvidenceStrengthTier(
  outcome: Outcome,
  evidenceMatrixEntry: any | null,
  archetypeId: string,
): string {
  if (!evidenceMatrixEntry?.evidence?.length) {
    return outcome === 'met' ? 'strong' : outcome === 'partial' ? 'adequate' : 'weak';
  }

  // Find matching evidence entry in the matrix
  const normalizedId = archetypeId.toUpperCase();
  const entries = evidenceMatrixEntry.evidence.filter(
    (e: any) => (e.emx_id || '').toUpperCase() === normalizedId,
  );

  if (entries.length === 0) {
    return outcome === 'met' ? 'strong' : outcome === 'partial' ? 'adequate' : 'weak';
  }

  // Pick strength tier based on outcome
  if (outcome === 'met') {
    const strong = entries.find((e: any) => e.strength === 'strong');
    return strong ? 'strong' : 'adequate';
  }
  if (outcome === 'partial') {
    const adequate = entries.find((e: any) => e.strength === 'adequate');
    return adequate ? 'adequate' : 'weak';
  }
  return 'weak';
}

function buildEvidenceNotes(
  archetype: any | null,
  strengthTier: string,
  outcome: Outcome,
  question: any,
): string {
  const parts: string[] = [];

  if (archetype?.name) {
    parts.push(archetype.name);
  }

  if (archetype?.description) {
    parts.push(truncate(archetype.description, 120));
  }

  parts.push(`Evidence strength: ${strengthTier}`);

  if (outcome !== 'met' && archetype?.collection_notes) {
    parts.push(`Collection: ${truncate(archetype.collection_notes, 100)}`);
  }

  // Fallback to question-level forms
  if (parts.length <= 1) {
    const forms = question.evidence_requests?.[0]?.acceptable_forms;
    if (forms?.length) parts.push(`Acceptable forms: ${forms.join(', ')}`);
  }

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3) + '...';
}
