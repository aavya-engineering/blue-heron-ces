// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ControlStatus } from './controls.types.js';
import type { CesIdentity } from '../config/cesConfig.contract.js';

export interface SystemSecurityPlan {
  sspId: string;
  generatedAt: string;
  tenantId: string;
  /** G1/T2: CES identity (customer↔tenant lineage), when resolvable from CES config. */
  ces?: CesIdentity;
  systemName: string;
  systemDescription: string;

  organizationName?: string;
  cageCode?: string;
  ueiNumber?: string;
  systemIdentifier?: string;
  authorizingOfficial?: { name: string; title: string; email: string };
  isso?: { name: string; title: string; email: string };
  preparedBy?: { name: string; title: string; email: string };
  revisionHistory?: Array<{
    version: string;
    date: string;
    author: string;
    description: string;
    approvalSignatures?: Array<{ name: string; role: string; date: string }>;
  }>;

  /** SSP document identifier (e.g., SSP-001) */
  documentId?: string;

  /** CUI types table: type, category, marking, volume */
  cuiCategorization?: Array<{ type: string; category: string; marking: string; volume: string }>;

  /** Operational status narrative */
  operationalStatus?: string;

  /** System type: "Minor Application", "Major Application", or "GSS" */
  systemType?: string;

  /** Responsible parties table (9 roles) */
  responsibleParties?: Array<{ role: string; name: string; title: string; contact: string }>;

  /** CUI data flow ingress/egress paths */
  cuiDataFlows?: { ingress: string[]; egress: string; description: string };

  /** Cloud Responsibility Matrix summary */
  sharedResponsibilityMatrix?: {
    totalControls: number;
    inherited: number;
    shared: number;
    customer: number;
    byFamily: Array<{ family: string; inherited: number; shared: number; customer: number }>;
  };

  /** Continuous monitoring activities table */
  continuousMonitoringActivities?: Array<{ activity: string; frequency: string; owner: string; output: string }>;

  /** Continuous monitoring metrics/KPIs narrative */
  continuousMonitoringMetrics?: string;

  /** Change-triggered reassessment triggers narrative */
  changeTriggeredReassessment?: string;

  /** Appendices metadata list */
  appendices?: Array<{ id: string; documentId: string; title: string; summary: string }>;

  authorizationBoundary: BoundarySection;
  systemComponents: ComponentInventory;
  networkTopology: NetworkSection;
  interconnections: InterconnectionEntry[];
  rolesAndResponsibilities: RoleEntry[];
  hostingModel: HostingSection;

  controlImplementations: ControlImplementation[];

  version: string;
  lastUpdatedBy: string;
  sourceArtifacts: string[];
  poamSummary?: {
    totalItems: number;
    totalWeightOnPoam: number;
    projectedScoreAfterPoam: number;
    certificationPath: 'full' | 'conditional' | 'blocked';
  };
  riskAssessment?: {
    summary: string;
    methodology: string;
  };
  continuousMonitoring?: {
    strategy: string;
    tools: string[];
    frequency: string;
    responsibleParty: string;
  };
  incidentResponse?: {
    procedures: string;
    contacts: Array<{ role: string; name: string; email: string }>;
    escalationPath: string;
  };
}

export interface BoundarySection {
  description: string;
  zones: string[];
  diagramPath?: string;
}

export interface ComponentInventory {
  sections: ComponentSection[];
}

export interface ComponentSection {
  name: string;
  components: string[];
}

export interface NetworkSection {
  description: string;
  topology: string[];
  diagramPath?: string;
}

export interface InterconnectionEntry {
  name: string;
  type: string;
  description: string;
}

export interface RoleEntry {
  role: string;
  responsibilities: string[];
  controlIds: string[];
}

export interface HostingSection {
  model: string;
  environment: string;
  techStack: string;
}

export interface OdpEntry {
  parameter: string;
  value: string;
  source: string;
}

export interface ObjectiveStatus {
  objectiveId: string;
  description: string;
  status: 'satisfied' | 'other_than_satisfied' | 'not_assessed';
  /**
   * NIST SP 800-171A assessment methods for this objective (examine / interview / test).
   * Optional + additive: surfaces assessor-grade method guidance inline without
   * altering existing objective fields. Populated by SspGenerator from the
   * assessment-objectives reference data.
   */
  methods?: string[];
}

export interface ControlImplementation {
  control_id: string;
  nist_ref: string;
  family: string;
  practice: string;
  status: ControlStatus;
  classification: 'automated' | 'manual' | 'nonstack';
  weight: number;
  implementationNarrative: string;
  technologyUsed: string[];
  responsibleRole: string;
  evidenceReferences: string[];
  relatedPolicies: Array<{ title: string; excerpt: string }> | string[];
  odpValues: OdpEntry[];
  assessmentObjectives: ObjectiveStatus[];
}

// --- Manifest types for data-driven SSP generation ---

export interface TenantManifest {
  manifest_id: string;
  tech_stack_id: string;
  tenant_identity: { tenantId: string; domain: string; system_name?: string; description?: string; display_name?: string };
  normative_controls: NormativeControl[];
  config_intents: ConfigIntent[];
}

export interface NormativeControl {
  control_id: string;
  required_state: string;
  verification: VerificationCheck[];
  evidence_artifacts: string[];
}

export interface VerificationCheck {
  id: string;
  description: string;
  method: string;
  expected: string;
  on_fail: string;
}

export interface ConfigIntent {
  id: string;
  title: string;
  control_ids: string[];
  desired_config: Record<string, unknown>;
  source_of_truth: string;
  query_method: string;
}

export interface InfraManifest {
  identity: InfraResource[];
  logging: InfraResource[];
  security: InfraResource[];
  storage: InfraResource[];
  network: InfraResource[];
  automation: InfraResource[];
  diagnostics: InfraResource[];
}

export interface InfraResource {
  resource_id: string;
  resource_type: string;
  name: string;
  control_ids: string[];
  properties: Record<string, unknown>;
  depends_on: string[];
  provenance?: Provenance[];
}

export interface Provenance {
  field: string;
  value: unknown;
  source: 'policy_odp' | 'tcp' | 'convention' | 'default';
  rule: string;
}

export interface MissionPlan {
  steps: MissionPlanStep[];
}

export interface MissionPlanStep {
  id: string;
  title: string;
  task_type: string;
  control_coverage: Array<{ control_id: string; support_type: string; gap_rationale: string }>;
  what_to_do: string[];
  how_to_verify: string[];
  expected_artifacts: Array<{ artifact_id: string; description: string; storage_location_ref: string }>;
}

export interface EvidenceArtifactEntry {
  path: string;
  source: 'missionPlan' | 'infraManifest';
}

export interface ControlNarrative {
  implementationDescription: string;
  technologyStack: string[];
  odpValues: OdpEntry[];
  evidenceArtifacts: EvidenceArtifactEntry[];
  verificationMethod: string;
  isManualGate: boolean;
  mergedOdpValues?: Record<string, string>;
  infraResources?: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }>;
}

export interface AllManifests {
  tenantManifest?: TenantManifest;
  infraManifest?: InfraManifest;
  missionPlan?: MissionPlan;
}
