// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Question bank types for SI and RR

export type AnswerType = 'boolean' | 'enum' | 'string' | 'number' | 'array' | 'object';
export type ProvenanceClass =
  | 'client_assertion'
  | 'operator_observation'
  | 'operator_inference'
  | 'assumption'
  | 'system_observation'
  | 'auto_collected'
  | 'tool_output'
  | 'document_reference'
  | 'not_applicable';

export interface SIQuestion {
  question_id: string;
  question_text: string;
  answer_type: AnswerType;
  enum_values?: string[];
  default_value?: unknown;
  baseline_field_mapping?: string; // Path like "si_baseline.target.target_cmmc_level"
  description?: string;
  reason?: string; // Why we ask this
  pitfalls?: string[]; // Common mistakes
  implications?: string[]; // What this affects downstream
  advisor_guidance?: string;
  required?: boolean;
  depends_on?: {
    question_id: string;
    answer_value: unknown;
  };
}

export interface SIQuestionBank {
  metadata: {
    name: string;
    version: string;
    description: string;
  };
  questions: SIQuestion[];
}

export interface RRQuestion {
  question_id: string;
  question_text: string;
  answer_type: AnswerType;
  enum_values?: string[];
  expected_evidence_archetypes?: string[];
  mapped_requirements?: string[];
  provenance_class_hint?: ProvenanceClass;
  guidance?: string;
  required?: boolean;
}

export interface RRActivity {
  activity_id: string;
  activity_name: string;
  purpose: string;
  applicability_conditions?: {
    target_level?: string[];
    cui_presence?: string[];
    boundary_strategy?: string[];
    deployment_posture?: string[];
  };
  questions: RRQuestion[];
  mapped_requirements: string[];
}

export interface RRQuestionBank {
  metadata: {
    name: string;
    version: string;
    description: string;
  };
  activities: RRActivity[];
}

// Answer capture types
export interface SIAnswer {
  question_id: string;
  value: unknown;
  answered_at: string;
  provenance?: string;
}

export interface RRAnswer {
  question_id: string;
  activity_id: string;
  value: unknown;
  provenance_class: ProvenanceClass;
  evidence_refs?: string[];
  answered_at: string;
  notes?: string;
}

export interface AnswerSession {
  session_id: string;
  started_at: string;
  completed_at?: string;
  answers: (SIAnswer | RRAnswer)[];
}
