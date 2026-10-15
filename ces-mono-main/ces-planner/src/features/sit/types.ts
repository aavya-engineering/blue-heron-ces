// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SIT-specific types

export interface SITAnswer {
  question_id: string;
  answer_type: 'string' | 'number' | 'enum' | 'array' | 'multi_select' | 'structured_object' | 'boolean';
  raw_answer: string | number | string[] | Record<string, unknown> | boolean;
  captured_at: string;
  provenance_class: 'client_assertion' | 'operator_observation' | 'operator_inference' | 'assumption' | 'system_observation' | 'system_recommendation' | 'previous_run';
  notes?: string;
}

export interface SITState {
  currentStep: number;
  answers: Record<string, SITAnswer>;
  questionBank: any | null;
  isComplete: boolean;
}

export interface EnumOption {
  value: string;
  description?: string;
  cmmc_attainment_impact?: string;
  advisor_notes?: string;
}

export interface StructuredFieldDefinition {
  type: 'enum' | 'text' | 'integer' | 'date';
  options?: string[];
}

export interface QuestionDefinition {
  question_id: string;
  question_text: string;
  description?: string;
  answer_type: 'string' | 'number' | 'enum' | 'array' | 'boolean' | 'multi_select' | 'structured_object';
  enum_values?: EnumOption[];
  structured_schema?: Record<string, StructuredFieldDefinition>;
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
  advisor_guidance?: {
    description?: string;
    reason?: string;
    pitfalls?: string[];
    implications?: string;
    rr_implications?: string[];
    mpt_gate_implications?: string[];
  };
  baseline_mapping?: {
    target_fields?: string[];
    field_path?: string;
    transform?: string;
  };
  recommended?: string | number | boolean | string[];
  applies_to_levels?: string[];
  provenance?: {
    primary?: string;
    validation_in_rrt?: boolean;
    may_reference_sources?: string[];
  };
}
