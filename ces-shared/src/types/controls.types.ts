// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface CmmcControl {
  control_id: string;       // "AC.L2-3.1.1"
  family: string;           // "AC"
  cmmc_level: number;       // 1 or 2
  nist_ref: string;         // "3.1.1"
  practice: string;         // requirement text
}

export type ControlStatus = 'met' | 'not_met' | 'partial' | 'not_assessed';

export type ControlClassification = 'automated' | 'manual' | 'nonstack';

export interface ControlAssessment {
  control_id: string;
  nist_ref: string;
  status: ControlStatus;
  classification: ControlClassification;
  sources: AssessmentSource[];
  implementation_narrative?: string;
  last_assessed: string;            // ISO-8601
  signals: import('./signal.types.js').SignalResult[];
  evidenceArtifactIds: string[];
  automationSource: 'graph' | 'powershell' | 'manual' | 'imported';
  lastFetchedAt: string;            // ISO-8601
  directiveMetadata?: import('./evidence.types.js').DirectiveMetadata;
}

export interface AssessmentSource {
  type: 'discovery' | 'blob_artifact' | 'ec_capture' | 'ec_drift' | 'manual' | 'policy_doc' | 'evidence_import' | 'adminops_execution';
  timestamp: string;
  detail: string;
  result: 'exists' | 'missing' | 'error' | 'no_query' | 'imported' | 'enforced';
  rawOutput?: string;
}

export interface AssessmentSnapshot {
  snapshotId: string;
  tenantId: string;
  /** G1/T2: CES identity (customer↔tenant lineage), when resolvable from CES config. */
  ces?: import('../config/cesConfig.contract.js').CesIdentity;
  generatedAt: string;
  controls: ControlAssessment[];
  sources_merged: string[];
  sprs_score: number;
  controls_met: number;
  controls_not_met: number;
  controls_partial: number;
  controls_not_assessed: number;
  liveAssessmentCount?: number;
}
