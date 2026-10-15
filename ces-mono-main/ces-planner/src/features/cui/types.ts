// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CUI Boundary Definition types
import type { StructuredGuidance, OptionHelp } from '@/shared/types/help';

export interface CUIAnswer {
  question_id: string;
  answer_type: 'multi_select' | 'single_select' | 'list' | 'number' | 'text';
  raw_answer: string | number | string[];
  captured_at: string;
  provenance_class: string;
  notes?: string;
}

export interface CUIState {
  currentSectionIndex: number;
  currentQuestionIndex: number;
  answers: Record<string, CUIAnswer>;
  sectionCompletionMap: Record<string, boolean>;
  isComplete: boolean;
}

// Parsed from YAML
export interface CUIQuestionDef {
  id: string;
  section: string;
  prompt: string;
  answer_type: 'multi_select' | 'single_select' | 'list' | 'number' | 'text';
  options: string[];
  required: boolean;
  help: string;
  recommended?: string | number | string[];
  roles: {
    primary_respondents: string[];
    validators: string[];
  };
  bindings: {
    manifest?: Record<string, string>;
    policy?: Record<string, string>;
    evidence?: Record<string, string>;
  };
  risk_flags: string[];
  guidance?: StructuredGuidance;
  option_help?: Record<string, OptionHelp>;
}

export interface CUISectionDef {
  id: string;
  name: string;
  questions: CUIQuestionDef[];
}
