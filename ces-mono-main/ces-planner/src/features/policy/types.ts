// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { StructuredGuidance, OptionHelp } from '@/shared/types/help';

// ---------------------------------------------------------------------------
// Policy Inputs Output — the artifact stored in IndexedDB
// ---------------------------------------------------------------------------
export interface PolicyInputsOutput {
  ces: {
    artifact: 'policy_inputs_output';
    version: string;
    generated_on: string;
    tool: 'policy_inputs';
    policy_bank_version: string;
  };
  organization: {
    legal_name: string;
    address: { street: string; city: string; state: string; zip: string };
    cage_code?: string;
    duns_number?: string;
    org_type: 'prime' | 'subcontractor' | 'vendor' | 'other';
    industry?: string;
    naics_code?: string;
    parent_company?: string;
  };
  personnel: Array<{
    role_id: string;
    role_title: string;
    name: string;
    title?: string;
    email?: string;
    phone?: string;
  }>;
  odps: Record<string, string | number>;
  governance: {
    policy_effective_date: string;
    review_cycle_months: number;
    fiscal_year_start_month: number;
  };
  physical_security?: {
    facility_addresses: string[];
    access_control_system?: string;
    visitor_management?: string;
  };
}

// ---------------------------------------------------------------------------
// Policy Inputs Wizard Answer
// ---------------------------------------------------------------------------
export interface PolicyAnswer {
  question_id: string;
  answer_type:
    | 'multi_select'
    | 'single_select'
    | 'list'
    | 'number'
    | 'text'
    | 'boolean';
  raw_answer: string | number | boolean | string[];
  captured_at: string;
  provenance_class: string;
  notes?: string;
}

export interface PolicyState {
  currentSectionIndex: number;
  currentQuestionIndex: number;
  answers: Record<string, PolicyAnswer>;
  sectionCompletionMap: Record<string, boolean>;
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Policy Question Bank definitions (matches YAML structure)
// ---------------------------------------------------------------------------
export interface PolicyQuestionDef {
  id: string;
  section: string;
  prompt: string;
  answer_type: PolicyAnswer['answer_type'];
  options: string[];
  required: boolean;
  help: string;
  recommended?: string | number | boolean | string[];
  roles: {
    primary_respondents: string[];
    validators: string[];
  };
  bindings: {
    policy_inputs?: string;
  };
  risk_flags: string[];
  guidance?: StructuredGuidance;
  option_help?: Record<string, OptionHelp>;
}

export interface PolicySectionDef {
  id: string;
  name: string;
  questions: PolicyQuestionDef[];
}
