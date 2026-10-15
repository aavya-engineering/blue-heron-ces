// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// BTC (Boundary Topology Confirmation) types
import type { BTCEvidenceRef, BTCRiskFlag, BTCDecisionLogEntry } from '@/shared/types/artifacts';
import type { StructuredGuidance, OptionHelp } from '@/shared/types/help';

export type { BTCEvidenceRef, BTCRiskFlag, BTCDecisionLogEntry };

// Activation rule (matches YAML structure)
export interface ActivationRule {
  id: string;
  description: string;
  priority: number;
  when: { all: PredicateCondition[] };
  then: { actions: RuleAction[] };
}

export interface PredicateCondition {
  source: 'si' | 'cui';
  path: string;
  op: 'eq' | 'in';
  value: string | string[];
}

export interface RuleAction {
  type: 'enable_section' | 'set_question_mode' | 'require_question' | 'add_risk_flag';
  target: string;
  mode?: 'full' | 'minimal' | 'substitute';
  substitute_with?: string;
  risk_flag?: string;
}

// BTC bank question (matches YAML)
export interface BTCQuestionDef {
  id: string;
  section: string;
  prompt: string;
  answer_type: 'boolean' | 'single_select';
  options: string[];
  required: boolean;
  help: string;
  recommended?: string | boolean;
  roles: {
    primary_respondents: string[];
    validators: string[];
  };
  validations: Array<{
    rule: string;
    evidence_type?: string;
    source?: string;
  }>;
  risk_flags: string[];
  bindings: {
    evidence?: Record<string, string>;
    btc?: Record<string, string>;
  };
  activation: { default_mode: string };
  aliases?: string[];
  guidance?: StructuredGuidance;
  option_help?: Record<string, OptionHelp>;
}

export interface BTCSectionDef {
  id: string;
  name: string;
  activation: { default_mode: string; gating: boolean };
  questions: BTCQuestionDef[];
}

// Runlist
export interface RunlistEntry {
  question_id: string;
  section_id: string;
  domain: string;
  mode: 'full' | 'minimal' | 'substitute';
  substitute_source_id?: string;
  required: boolean;
  evidence_required: boolean;
  evidence_type?: string;
  evidence_source?: string;
  enabled: boolean;
  activated_by_rules: string[];
  question: BTCQuestionDef;
}

export interface Runlist {
  entries: RunlistEntry[];
  risk_flags: BTCRiskFlag[];
  decision_log: BTCDecisionLogEntry[];
}

export interface BTCAnswer {
  question_id: string;
  raw_answer: string | boolean;
  mode: 'full' | 'minimal' | 'substitute';
  evidence_ids: string[];
  captured_at: string;
  notes?: string;
  provenance_class?: 'client_assertion' | 'operator_inference' | 'system_recommendation' | 'previous_run';
}

export interface BTCState {
  currentRunlistIndex: number;
  answers: Record<string, BTCAnswer>;
  evidenceItems: BTCEvidenceRef[];
  runlist: Runlist | null;
  isComplete: boolean;
}
