// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Variable resolver for output_target paths.
 * Supported variables ONLY: {date}, {change_id}, {control_id}, {tenant_name}.
 * Throws if unknown variable encountered.
 */

export interface SubstitutionContext {
  date: string;
  change_id?: string;
  control_id?: string;
  tenant_name?: string;
}

const SUPPORTED_VARIABLES = new Set(['date', 'change_id', 'control_id', 'tenant_name']);

export class VariableSubstitutionEngine {
  substituteVariables(template: string, context: SubstitutionContext): string {
    return template.replace(/\{(\w+)\}/g, (_match, varName: string) => {
      return this.resolveVariable(varName, context);
    });
  }

  resolveVariable(varName: string, context: SubstitutionContext): string {
    if (!SUPPORTED_VARIABLES.has(varName)) {
      throw new Error(
        `Unknown variable '{${varName}}' in output_target. ` +
        `Supported variables: {date}, {change_id}, {control_id}, {tenant_name}.`
      );
    }

    switch (varName) {
      case 'date':
        return context.date;
      case 'change_id':
        return context.change_id ?? '';
      case 'control_id':
        return context.control_id ?? '';
      case 'tenant_name':
        return context.tenant_name ?? '';
      default:
        throw new Error(`Unknown variable '{${varName}}'`);
    }
  }
}
