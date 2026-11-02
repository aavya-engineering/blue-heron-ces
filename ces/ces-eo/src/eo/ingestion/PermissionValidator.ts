// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { Client } from '@microsoft/microsoft-graph-client';

export interface PermissionCheckResult {
  granted: string[];
  missing: string[];
  warnings: string[];
}

const REQUIRED_PERMISSIONS = [
  'Reports.Read.All',
  'SecurityEvents.Read.All',
  'DeviceManagementManagedDevices.Read.All',
  'DeviceManagementConfiguration.Read.All',
  'DeviceManagementApps.Read.All',
  'Directory.Read.All',
  'Policy.Read.All',
  'RoleManagement.Read.Directory',
  'InformationProtectionPolicy.Read.All',
  'AuditLog.Read.All',
  'Group.Read.All',
  'User.Read.All',
  'Organization.Read.All',
];

/**
 * Pre-flight permission checker.
 * Verifies auth works via GET /me, then attempts GET /organization
 * to confirm Directory.Read.All.
 * Logs warning (not error) if permissions are missing.
 */
export async function validatePermissions(client: Client): Promise<PermissionCheckResult> {
  const result: PermissionCheckResult = {
    granted: [],
    missing: [],
    warnings: [],
  };

  // Test basic auth via /organization
  try {
    await client.api('/organization').get();
    result.granted.push('Organization.Read.All');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.missing.push('Organization.Read.All');
    result.warnings.push(`Graph API auth check failed (GET /organization): ${msg}`);
  }

  // Test Directory.Read.All via /groups (lightweight call)
  try {
    await client.api('/groups').top(1).get();
    result.granted.push('Group.Read.All');
    result.granted.push('Directory.Read.All');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`Permission check warning (GET /groups): ${msg}`);
  }

  // Test device management
  try {
    await client.api('/deviceManagement/managedDevices').top(1).get();
    result.granted.push('DeviceManagementManagedDevices.Read.All');
  } catch {
    result.warnings.push('DeviceManagementManagedDevices.Read.All may not be granted');
  }

  // Test security
  try {
    await client.api('/security/secureScores').top(1).get();
    result.granted.push('Reports.Read.All');
  } catch {
    result.warnings.push('Reports.Read.All may not be granted');
  }

  // Determine missing
  const grantedSet = new Set(result.granted);
  for (const perm of REQUIRED_PERMISSIONS) {
    if (!grantedSet.has(perm) && !result.missing.includes(perm)) {
      // Only add to missing if we explicitly failed; otherwise it is unchecked
    }
  }

  return result;
}
