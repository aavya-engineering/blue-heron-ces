// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Variable classification for security categorization.
 * Classifies variable names as SI (Sensitive Information), CUI (Controlled Unclassified Information),
 * or TCP (Technical Configuration Parameter).
 */

export type VariableCategory = 'si' | 'cui' | 'tcp';

const SI_PATTERNS = /password|secret|_key$|token|cert_path|cert_thumbprint|connection_string|credential|base64/i;
const CUI_PATTERNS = /tenant.?id|app.?id|^domain$|primary.?domain|subscription|resource.?group|workspace|client.?id|principal|^adminUserName$|^cuiGroupName$|^roleDefId$|^complianceRoleId$/i;

/**
 * Classifies a variable name into a security category.
 *
 * @param variableName - The variable name to classify
 * @returns 'si' for sensitive information, 'cui' for controlled unclassified information, 'tcp' for technical config
 *
 * @example
 * classifyVariable('password') // => 'si'
 * classifyVariable('tenantId') // => 'cui'
 * classifyVariable('location') // => 'tcp'
 */
export function classifyVariable(variableName: string): VariableCategory {
  if (SI_PATTERNS.test(variableName)) {
    return 'si';
  }
  if (CUI_PATTERNS.test(variableName)) {
    return 'cui';
  }
  return 'tcp';
}
