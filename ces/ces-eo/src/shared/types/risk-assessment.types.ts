// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';

// --- Qualitative Score ---

export const NistQualitativeScoreSchema = z.enum([
  'very_low',
  'low',
  'moderate',
  'high',
  'very_high',
]);

export type NistQualitativeScore = z.infer<typeof NistQualitativeScoreSchema>;

// --- Threat Source Type ---

export const ThreatSourceTypeSchema = z.enum([
  'adversarial',
  'non_adversarial',
  'structural',
  'environmental',
]);

export type ThreatSourceType = z.infer<typeof ThreatSourceTypeSchema>;

// --- Treatment Recommendation ---

export const TreatmentRecommendationSchema = z.enum([
  'mitigate',
  'avoid',
  'transfer',
  'accept',
]);

export type TreatmentRecommendation = z.infer<typeof TreatmentRecommendationSchema>;

// --- Treatment Status ---

export const TreatmentStatusSchema = z.enum([
  'recommended',
  'in_progress',
  'mitigated',
  'accepted_residual',
  'transferred',
]);

export type TreatmentStatus = z.infer<typeof TreatmentStatusSchema>;

// --- Vulnerability Source ---

export const VulnerabilitySourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual'), description: z.string() }),
  z.object({ type: z.literal('defender_for_cloud'), alertId: z.string(), severity: z.string() }),
  z.object({ type: z.literal('secure_score'), controlName: z.string(), score: z.number().optional(), maxScore: z.number().optional() }),
  z.object({ type: z.literal('plan_output'), controlId: z.string(), status: z.string() }),
  // FC-EO-B defect fix: `severity` was missing here, so SecureScoreAutoScorer's
  // sentinel_alert scoring branch always read undefined and every Sentinel-sourced entry
  // silently scored moderate/moderate regardless of the incident's real severity.
  z.object({ type: z.literal('sentinel_alert'), incidentId: z.string(), title: z.string(), severity: z.string().optional() }),
]);

export type VulnerabilitySource = z.infer<typeof VulnerabilitySourceSchema>;

// --- Vulnerability Type ---

export const VulnerabilityTypeSchema = z.enum([
  'technical',
  'organizational',
  'environmental',
]);

export type VulnerabilityType = z.infer<typeof VulnerabilityTypeSchema>;

// --- Vulnerability Reference ---

export const VulnerabilityReferenceSchema = z.object({
  type: VulnerabilityTypeSchema,
  description: z.string(),
  externalReferenceId: z.string().optional(),
});

export type VulnerabilityReference = z.infer<typeof VulnerabilityReferenceSchema>;

// --- Risk Entry ---

export const RiskEntrySchema = z.object({
  id: z.string(),
  threatSource: ThreatSourceTypeSchema,
  threatEvent: z.string(),
  threatEventReference: z.string().optional(),
  vulnerability: VulnerabilityReferenceSchema,
  likelihood: NistQualitativeScoreSchema.optional(),
  impact: NistQualitativeScoreSchema.optional(),
  compositeRisk: NistQualitativeScoreSchema.optional(),
  affectedAssets: z.array(z.string()).default([]),
  affectedOperations: z.array(z.string()).default([]),
  treatmentRecommendation: TreatmentRecommendationSchema,
  treatmentStatus: TreatmentStatusSchema,
  treatmentReference: z.string().optional(),
  firstIdentified: z.string(),
  lastReviewed: z.string(),
  nextReviewDue: z.string(),
  source: VulnerabilitySourceSchema,
  sourceReference: z.string().optional(),
  notes: z.string().optional(),
});

export type RiskEntry = z.infer<typeof RiskEntrySchema>;

// --- Risk Register ---

export const RiskRegisterSchema = z.object({
  entries: z.array(RiskEntrySchema).default([]),
  lastUpdated: z.string(),
  lastFullReviewDate: z.string().optional(),
  nextReviewDue: z.string(),
});

export type RiskRegister = z.infer<typeof RiskRegisterSchema>;

// --- Annual Snapshot ---

export const AnnualSnapshotSchema = z.object({
  snapshotId: z.string(),
  assessmentYear: z.number(),
  reviewedDate: z.string(),
  reviewedBy: z.string(),
  signedOffBy: z.string(),
  signedOffDate: z.string(),
  registerSnapshot: RiskRegisterSchema,
  reportArtifactPath: z.string(),
  reviewNotes: z.string().optional(),
});

export type AnnualSnapshot = z.infer<typeof AnnualSnapshotSchema>;

// --- Threat Catalog Entry ---

export const ThreatCatalogEntrySchema = z.object({
  source: z.string(),
  events: z.array(z.string()),
});

export type ThreatCatalogEntry = z.infer<typeof ThreatCatalogEntrySchema>;

// --- Vulnerability Source Config ---

export const VulnerabilitySourceConfigSchema = z.object({
  defender_for_cloud: z.object({
    enabled: z.boolean().default(true),
    pull_frequency: z.string().default('per_pipeline_cycle'),
    severity_threshold: z.string().default('low'),
  }).default({}),
  microsoft_secure_score: z.object({
    enabled: z.boolean().default(true),
    pull_frequency: z.string().default('per_pipeline_cycle'),
  }).default({}),
  plan_output_not_met: z.object({
    enabled: z.boolean().default(true),
    treats_as: z.string().default('organizational_vulnerability'),
  }).default({}),
  sentinel_incidents: z.object({
    enabled: z.boolean().default(false),
  }).default({}),
});

export type VulnerabilitySourceConfig = z.infer<typeof VulnerabilitySourceConfigSchema>;

// --- NIST Scoring Scale ---

export const NistScoringScaleSchema = z.object({
  methodology: z.string(),
  likelihoodScale: z.array(NistQualitativeScoreSchema),
  impactScale: z.array(NistQualitativeScoreSchema),
  compositeRiskMatrix: z.record(z.record(NistQualitativeScoreSchema)),
});

export type NistScoringScale = z.infer<typeof NistScoringScaleSchema>;

// --- Authorizing Official ---

export const AuthorizingOfficialSchema = z.object({
  displayName: z.string(),
  upn: z.string(),
  role: z.string(),
});

export type AuthorizingOfficial = z.infer<typeof AuthorizingOfficialSchema>;

// --- Risk Assessment Config ---

export const RiskAssessmentConfigSchema = z.object({
  scopeStatement: z.string().default(''),
  frequencyMonths: z.number().default(12),
  methodology: z.string().default('nist_sp_800_30_rev1'),
  threatCatalog: z.object({
    adversarial: z.array(ThreatCatalogEntrySchema).default([]),
    non_adversarial: z.array(ThreatCatalogEntrySchema).default([]),
  }).default({}),
  vulnerabilitySources: VulnerabilitySourceConfigSchema.default({}),
  authorizingOfficial: AuthorizingOfficialSchema.optional(),
  scoringScale: NistScoringScaleSchema.optional(),
});

export type RiskAssessmentConfig = z.infer<typeof RiskAssessmentConfigSchema>;

// --- Annual Review State ---

export const AnnualReviewStateSchema = z.object({
  currentStep: z.number(),
  startedAt: z.string(),
  startedBy: z.string(),
  stepData: z.record(z.string(), z.any()).default({}),
});

export type AnnualReviewState = z.infer<typeof AnnualReviewStateSchema>;
