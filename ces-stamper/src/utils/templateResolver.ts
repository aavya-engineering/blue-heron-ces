// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Template variable resolver
 * Replaces {variableName} placeholders with values from a variables object.
 */

export interface TemplateResolverOptions {
  /**
   * If true, throws an error when a variable is referenced but not found.
   * If false (default), leaves unresolved placeholders as-is.
   */
  strict?: boolean;
}

/**
 * Resolves {variableName} placeholders in a template string.
 *
 * @param template - String containing {variableName} placeholders
 * @param variables - Record mapping variable names to values
 * @param options - Configuration options (strict mode, etc.)
 * @returns Resolved string with placeholders replaced
 *
 * @example
 * resolveTemplate('Hello {name}', { name: 'World' }) // => 'Hello World'
 * resolveTemplate('{count} items', { count: 42 }) // => '42 items'
 * resolveTemplate('{missing}', {}, { strict: true }) // => throws Error
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, any>,
  options: TemplateResolverOptions = {}
): string {
  // Use \w+ (word characters only) instead of [^}]+ to avoid matching PowerShell
  // script blocks like `if (...) { New-AzCmd -Param {variable} }` where the if-block
  // `{` would greedily consume through to the next `}`, swallowing the variable.
  return template.replace(/\{(\w+)\}/g, (match, varName) => {
    if (varName in variables) {
      const value = variables[varName];
      // Only resolve scalar values (string, number, boolean)
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      // Non-scalar values are left unresolved
      return match;
    }
    if (options.strict) {
      throw new Error(`Missing variable: ${varName}`);
    }
    // Leave unresolved if not strict
    return match;
  });
}
