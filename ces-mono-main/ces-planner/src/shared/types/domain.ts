// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Domain data types for CMMC requirements, evidence archetypes, etc.

export interface CMMCRequirement {
  requirement_id: string;
  level: 'L1' | 'L2' | 'L3';
  domain: string;
  title: string;
  requirement_text: string;
  references: {
    cmmc_practice_id: string;
    nist_800_171_id: string;
    far_clause_52_204_21_id?: string;
    other?: string[];
  };
  assessment_objectives: Array<{
    id: string;
    text: string;
    methods: string[];
    evidence_archetypes: string[];
    source_ids: string[];
  }>;
  design_for_assessment: Array<{
    id: string;
    title: string;
    constraint: string;
    verification: string;
    evidence_archetypes: string[];
  }>;
  scoping_impacts?: Array<{
    id: string;
    summary: string;
    in_scope_when: any;
    affected_scoping_categories: string[];
    design_implications: string[];
    source_ids: string[];
  }>;
  evidence_minimum: {
    must_have: string[];
    nice_to_have: string[];
  };
  operationalization_notes?: string;
  common_pitfalls?: string[];
  ui_help?: {
    advisor_description: string;
    why_it_matters: string;
    attainment_impact: string;
  };
  tag?: 'FACT' | 'INFERENCE' | 'OPEN_QUESTION';
  source_ids?: string[];
}

export interface CMMCRequirementsStore {
  ces?: {
    requirements: CMMCRequirement[];
  };
  metadata?: {
    name: string;
    version: string;
    source: string;
  };
  requirements?: CMMCRequirement[];
}

export interface EvidenceArchetype {
  archetype_id: string;
  name: string;
  description: string;
  collection_methods: string[];
  typical_sources: string[];
  retention_guidance?: string;
}

export interface EvidenceArchetypeCatalog {
  metadata?: {
    name: string;
    version: string;
  };
  archetypes?: EvidenceArchetype[];
  evidence_archetypes?: EvidenceArchetype[];
}

export interface AssessorApproach {
  approach_id: string;
  requirement_id: string;
  assessment_procedure: string;
  what_to_look_for: string[];
  common_deficiencies: string[];
  recommended_evidence: string[];
}

export interface AssessorKnowledgeBase {
  metadata: {
    name: string;
    version: string;
  };
  approaches: AssessorApproach[];
}

export interface EvidenceMatrixEntry {
  requirement_id: string;
  evidence_archetype_ids: string[];
  minimum_count: number;
  sufficiency_notes?: string;
}

export interface EvidenceMatrix {
  metadata: {
    name: string;
    version: string;
  };
  mappings: EvidenceMatrixEntry[];
}

export interface VendorCapability {
  vendor_id: string;
  product_name: string;
  capability_type: string;
  covers_requirements: string[];
  configuration_tasks: string[];
  cost_model?: {
    type: 'per_user' | 'per_device' | 'flat_rate';
    base_cost?: number;
  };
}

export interface TechStackMapping {
  metadata: {
    name: string;
    version: string;
  };
  vendors: VendorCapability[];
}

// ---------------------------------------------------------------------------
// Capability Taxonomy
// ---------------------------------------------------------------------------
export interface CapabilityTaxonomy {
  ces: { artifact: string; version: string; generated_on: string };
  capabilities: CapabilityEntry[];
}

export interface CapabilityEntry {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  cmmc_domains: string[];
  vendor_stack_components: Record<string, string[]>;
  practices: { id: string; title: string; capability_role: string }[];
}

// ---------------------------------------------------------------------------
// Implementation Patterns
// ---------------------------------------------------------------------------
export interface ImplementationPatterns {
  ces: { artifact: string; version: string; generated_on: string };
  patterns: PatternEntry[];
}

export interface PatternEntry {
  practice_id: string;
  capability: string;
  pattern_id: string;
  pattern_name: string;
  actions: PatternAction[];
}

export interface PatternAction {
  id: string;
  action: string;
  action_type: string;
  evidence_outputs: string[];
}

// ---------------------------------------------------------------------------
// Vendor Playbook
// ---------------------------------------------------------------------------
export interface VendorPlaybook {
  ces: {
    artifact: string;
    vendor: string;
    version: string;
    generated_on: string;
    license_requirements?: string[];
  };
  playbook: PlaybookEntry[];
}

export interface PlaybookEntry {
  action_id: string;
  signal: 'configure' | 'customize' | 'manual';
  m365_service: string;
  implementation: string;
  portal_path?: string;
  powershell?: string[];
  graph_api?: string[];
  evidence_commands: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Microsoft Technical Reference Guide for CMMC L2
// ---------------------------------------------------------------------------

export interface TechRefParagraph {
  text: string;
  text_with_links: string;
  links: Array<{ text: string; url: string }>;
}

export interface TechRefServiceSection {
  service_name: string;
  paragraphs: TechRefParagraph[];
}

export interface TechRefControl {
  control_id: string;
  family: string;
  cmmc_level: number;
  nist_sp_800_171_ref: string;
  nist_sp_800_53_mapping: string;
  practice: string;
  assessment_objectives: Array<{ id: string; text: string }>;
  primary_services: string[];
  secondary_services: string[];
  implementation_by_service: TechRefServiceSection[];
  customer_responsibilities?: {
    azure?: TechRefParagraph[];
    gcch?: TechRefParagraph[];
  };
  note?: string;
}

export interface TechRefControlFamily {
  abbreviation: string;
  name: string;
  control_count: number;
  controls: TechRefControl[];
}

export interface TechRefCMMCL2 {
  document_title: string;
  total_controls: number;
  control_families: TechRefControlFamily[];
  service_to_control_mapping: {
    description: string;
    total_services: number;
    services: Record<string, string[]>;
  };
}
