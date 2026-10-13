// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Vendored SUBSET of ces-planner src/features/tcp/types.ts — only the three
// types tcpProfileGenerator.ts consumes (TCPAnswer, TCPQuestionDef,
// TCPSectionDef). The wizard-state type and the help/guidance fields (which
// import ces-planner's help types) are omitted; every field kept is verbatim.

export interface TCPAnswer {
  question_id: string;
  answer_type:
    | 'multi_select'
    | 'single_select'
    | 'list'
    | 'number'
    | 'text'
    | 'guid'
    | 'upn_list'
    | 'boolean';
  raw_answer: string | number | boolean | string[];
  captured_at: string;
  provenance_class: string;
  notes?: string;
}

export interface TCPQuestionDef {
  id: string;
  section: string;
  prompt: string;
  answer_type: TCPAnswer['answer_type'];
  options: string[];
  required: boolean;
  help: string;
  recommended?: string | number | boolean | string[];
  roles: {
    primary_respondents: string[];
    validators: string[];
  };
  bindings: {
    tenant_config?: string;
  };
  risk_flags: string[];
}

export interface TCPSectionDef {
  id: string;
  name: string;
  questions: TCPQuestionDef[];
}
