// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';

export const SspGenerateRequestSchema = z.object({
  tenantSlug: z.string().min(1),
  assessmentId: z.string().min(1),
});

export const PoamGenerateRequestSchema = z.object({
  tenantSlug: z.string().min(1),
  assessmentId: z.string().min(1),
});

export const PolicyDocumentSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  lastUpdated: z.string().optional(),
});

export const PolicyImportRequestSchema = z.array(PolicyDocumentSchema);

export { PersonnelCreateRequestSchema, PersonnelUpdateRequestSchema, LifecycleEventCreateSchema, PersonnelConfigSchema, TrainingCatalogSchema } from '../../shared/types/personnel.types.js';

// ── Training Route Schemas ──

export const TrainingAssignRequestSchema = z.object({
  courseIds: z.array(z.string().min(1)).min(1, 'At least one courseId is required'),
});

export const TrainingCompleteRequestSchema = z.object({
  courseId: z.string().min(1, 'courseId is required'),
  completedDate: z.string().min(1, 'completedDate is required'),
  expiryDate: z.string().optional(),
});

export const TrainingEmailRequestSchema = z.object({
  courseIds: z.array(z.string().min(1)).min(1, 'At least one courseId is required'),
});

// ── Offboarding Wizard Schemas ──

export const OffboardingStepCompleteSchema = z.object({
  attestor: z.string().min(1, 'attestor is required').trim(),
  notes: z.string().optional(),
  evidenceArtifactId: z.string().optional(),
});

export const OffboardingFinalizeSchema = z.object({
  attestor: z.string().min(1, 'attestor is required').trim(),
});

// ── Screening Route Schemas ──

export const ScreeningElementUpdateRequestSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed']),
  data: z.record(z.unknown()).nullable().optional(),
});

// ── Risk Assessment Schemas ──

const NistQualitativeScoreEnum = z.enum(['very_low', 'low', 'moderate', 'high', 'very_high']);
const ThreatSourceTypeEnum = z.enum(['adversarial', 'non_adversarial', 'structural', 'environmental']);
const TreatmentRecommendationEnum = z.enum(['mitigate', 'avoid', 'transfer', 'accept']);
const TreatmentStatusEnum = z.enum(['recommended', 'in_progress', 'mitigated', 'accepted_residual', 'transferred']);

const VulnerabilitySourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual'), description: z.string() }),
  z.object({ type: z.literal('defender_for_cloud'), alertId: z.string(), severity: z.string() }),
  z.object({ type: z.literal('secure_score'), controlName: z.string(), score: z.number() }),
  z.object({ type: z.literal('plan_output'), controlId: z.string(), status: z.string() }),
  // FC-EO-B defect fix: keep in sync with shared/types/risk-assessment.types.ts's
  // VulnerabilitySourceSchema -- without `severity` here, Zod strips it from any
  // POSTed risk-entry body before it ever reaches the store.
  z.object({ type: z.literal('sentinel_alert'), incidentId: z.string(), title: z.string(), severity: z.string().optional() }),
]);

const VulnerabilityReferenceSchema = z.object({
  type: z.enum(['technical', 'organizational', 'environmental']),
  description: z.string().min(1),
  externalReferenceId: z.string().optional(),
});

export const RiskAssessmentConfigUpdateSchema = z.object({
  scopeStatement: z.string().optional(),
  frequencyMonths: z.number().optional(),
  methodology: z.string().optional(),
  threatCatalog: z.object({
    adversarial: z.array(z.object({ source: z.string(), events: z.array(z.string()) })).optional(),
    non_adversarial: z.array(z.object({ source: z.string(), events: z.array(z.string()) })).optional(),
  }).optional(),
  vulnerabilitySources: z.object({
    defender_for_cloud: z.object({ enabled: z.boolean(), pull_frequency: z.string().optional(), severity_threshold: z.string().optional() }).optional(),
    microsoft_secure_score: z.object({ enabled: z.boolean(), pull_frequency: z.string().optional() }).optional(),
    plan_output_not_met: z.object({ enabled: z.boolean(), treats_as: z.string().optional() }).optional(),
    sentinel_incidents: z.object({ enabled: z.boolean() }).optional(),
  }).optional(),
  authorizingOfficial: z.object({ displayName: z.string(), upn: z.string(), role: z.string() }).optional(),
});

export const RiskEntryCreateSchema = z.object({
  threatSource: ThreatSourceTypeEnum,
  threatEvent: z.string().min(1),
  threatEventReference: z.string().optional(),
  vulnerability: VulnerabilityReferenceSchema,
  likelihood: NistQualitativeScoreEnum.optional(),
  impact: NistQualitativeScoreEnum.optional(),
  compositeRisk: NistQualitativeScoreEnum.optional(),
  affectedAssets: z.array(z.string()).optional(),
  affectedOperations: z.array(z.string()).optional(),
  treatmentRecommendation: TreatmentRecommendationEnum,
  treatmentStatus: TreatmentStatusEnum,
  treatmentReference: z.string().optional(),
  lastReviewed: z.string(),
  nextReviewDue: z.string(),
  source: VulnerabilitySourceSchema,
  sourceReference: z.string().optional(),
  notes: z.string().optional(),
});

export const RiskEntryUpdateSchema = z.object({
  threatSource: ThreatSourceTypeEnum.optional(),
  threatEvent: z.string().min(1).optional(),
  threatEventReference: z.string().optional(),
  vulnerability: VulnerabilityReferenceSchema.optional(),
  likelihood: NistQualitativeScoreEnum.optional(),
  impact: NistQualitativeScoreEnum.optional(),
  compositeRisk: NistQualitativeScoreEnum.optional(),
  affectedAssets: z.array(z.string()).optional(),
  affectedOperations: z.array(z.string()).optional(),
  treatmentRecommendation: TreatmentRecommendationEnum.optional(),
  treatmentStatus: TreatmentStatusEnum.optional(),
  treatmentReference: z.string().optional(),
  lastReviewed: z.string().optional(),
  nextReviewDue: z.string().optional(),
  source: VulnerabilitySourceSchema.optional(),
  sourceReference: z.string().optional(),
  notes: z.string().optional(),
});

export const DirectiveMetadataSchema = z.object({
  control_id: z.string(),
  directive: z.string(),
  readiness: z.string(),
  platform_inherited: z.boolean(),
  enforcement_verified: z.boolean(),
  narrative_stub: z.string(),
  reasoning_trace: z.string(),
  evidence_artifacts: z.array(z.string()),
});

export function validateRequest<T>(schema: z.ZodSchema<T>, body: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
