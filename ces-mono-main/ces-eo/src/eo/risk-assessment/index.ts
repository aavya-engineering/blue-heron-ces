// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export { RiskAssessmentStore } from './RiskAssessmentStore.js';
export { RiskAssessmentBlobReplicator } from './RiskAssessmentBlobReplicator.js';
export { VulnerabilityIngestionService } from './VulnerabilityIngestionService.js';
export { computeCompositeRisk, NIST_SP_800_30_SCALE } from './NistScoringMatrix.js';
export type { IngestionReport, IngestionResult } from './ingestion.types.js';
export type { FindingStoreAdapter } from './VulnerabilityIngestionService.js';
export type {
  NistQualitativeScore,
  ThreatSourceType,
  TreatmentRecommendation,
  TreatmentStatus,
  VulnerabilitySource,
  VulnerabilityType,
  VulnerabilityReference,
  RiskEntry,
  RiskRegister,
  AnnualSnapshot,
  ThreatCatalogEntry,
  VulnerabilitySourceConfig,
  NistScoringScale,
  AuthorizingOfficial,
  RiskAssessmentConfig,
} from '../../shared/types/risk-assessment.types.js';
