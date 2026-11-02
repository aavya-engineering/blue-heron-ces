// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export type EvalOperator =
  | 'exists'
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'arrayNotEmpty'
  | 'greaterThan'
  | 'lessThan'
  | 'matchesRegex';

export interface EvalRule {
  /** JSONPath dot notation. "$" = root result. "$.State" = result.State */
  field: string;
  operator: EvalOperator;
  /** Expected value. Omit for 'exists' and 'arrayNotEmpty'. */
  value?: string | boolean | number | string[];
  /** Human-readable label for evidence/finding output. */
  description: string;
}

export interface CommandEvalSpec {
  commandId: string;
  /** All rules must pass for COMPLIANT (AND logic). Set anyOf=true for OR. */
  eval: EvalRule[];
  anyOf?: boolean;
}

export interface EvalResult {
  commandId: string;
  compliant: boolean;
  ruleResults: Array<{
    rule: EvalRule;
    passed: boolean;
    actualValue: unknown;
  }>;
}

export interface EvalRulesFile {
  version: string;
  rules: Record<string, { eval: EvalRule[]; anyOf?: boolean }>;
}
