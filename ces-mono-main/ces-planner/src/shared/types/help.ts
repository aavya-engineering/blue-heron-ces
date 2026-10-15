// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Contextual help overlay types — loaded from help YAML files, merged onto question defs at runtime

export interface GlossaryEntry {
  term: string;
  definition: string;
  highlight_in_prompts?: boolean;
}

export interface RiskFlagLabels {
  [flagId: string]: string;
}

export interface StructuredGuidance {
  description?: string;
  why_it_matters?: string;
  implications?: string;
  common_pitfalls?: string[];
  btc_impact?: string; // CUI questions — downstream BTC impact
  evidence_guidance?: string; // BTC questions — what evidence to collect
}

export interface OptionHelp {
  description: string;
  implication?: string;
}

export interface QuestionHelpEntry {
  guidance?: StructuredGuidance;
  options?: Record<string, OptionHelp>;
}

export interface HelpOverlay {
  schema_version: string;
  module: string;
  questions: Record<string, QuestionHelpEntry>;
}

export interface GlossaryData {
  schema_version: string;
  glossary: GlossaryEntry[];
  risk_flag_labels: RiskFlagLabels;
}
