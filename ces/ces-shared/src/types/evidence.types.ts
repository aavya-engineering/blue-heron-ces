// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface DirectiveMetadata {
  control_id: string;
  directive: string;                   // 'implement' | 'validate' | 'manual' | 'document-absence' | 'document-prohibition' | 'skip'
  readiness: string;                   // 'met' | 'not-met' | 'unknown'
  platform_inherited: boolean;
  enforcement_verified: boolean;
  narrative_stub: string;
  reasoning_trace: string;
  evidence_artifacts: string[];
}

export interface ArtifactRecord {
  artifactId: string;
  capturedAt: string;
  tenantId: string;
  capturedBy: string;
  sourceEndpoint: string;
  checkId: string;
  controlIds: string[];
  rawValue: unknown;
  sha256: string;
  runId: string;
  source: 'stamp_capture' | 'drift_check' | 'evidence_collection' | 'manual' | 'graph_query';
}

export interface EvidenceManifest {
  manifestId: string;
  runId: string;
  tenantId: string;
  generatedAt: string;
  controls: Array<{
    controlId: string;
    artifactIds: string[];
    complianceStatus: 'compliant' | 'non_compliant' | 'unknown';
  }>;
  artifactCount: number;
  storageEndpoint: string;
}
