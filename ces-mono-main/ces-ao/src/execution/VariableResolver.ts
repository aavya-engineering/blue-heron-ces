// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 6: Variable Resolver
// Extracts required variables from AO command parameters

import type { AoCommand } from '../types/AoCommand.js';

/**
 * Extract variables_required for CommandEntry.
 * Parses aoCommand.parameters array, converts parameters with `source` field
 * to uppercase with underscores.
 *
 * Example: { name: "tenantId", source: "tenantId" } → "TENANT_ID"
 *
 * Returns string array for CommandEntry.variables_required.
 */
export function extractVariablesRequired(aoCommand: AoCommand): string[] {
  const variables: string[] = [];

  for (const param of aoCommand.parameters) {
    if (param.source) {
      // Convert to uppercase with underscores
      // "tenantId" → "TENANT_ID"
      // "endpoints.graph" → "ENDPOINTS_GRAPH"
      const variableName = param.source
        .replace(/\./g, '_')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase();
      variables.push(variableName);
    }
  }

  return variables;
}
