// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extract variable placeholders from command templates.
 * Used by assess.routes.ts to determine minimal required vars for get_command execution.
 */

/**
 * Parse command template and extract variable placeholders.
 * @param template - Command string with {variableName} placeholders
 * @returns Array of unique variable names (deduplicated)
 * @example
 * extractVariablesFromTemplate("Get-AzVirtualNetwork -Name {vnetName} -ResourceGroupName {resourceGroup}")
 * // Returns: ["vnetName", "resourceGroup"]
 */
export function extractVariablesFromTemplate(template: string): string[] {
  const regex = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    matches.push(match[1]);
  }

  // Deduplicate using Set
  return [...new Set(matches)];
}
