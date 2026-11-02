// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { loadTenantConfig, type TenantConfig } from 'ces-shared/config';
import { FileTenantRegistry, getRegistryRoot, registryRecordPath } from 'ces-tenant';

/**
 * Config validator for tenant migration (G-TENANT-M2 gate 2: resolves
 * exclusively through `ces-tenant`'s registry API -- this module no longer
 * constructs the deprecated legacy Stamper tenant-directory path itself; the
 * registry owns back-compat reads of that location and the one-time forward
 * migration into the neutral registry root).
 * Validates cert file exists at certPath.
 */
export async function validateOrMigrateTenantConfig(slug: string): Promise<TenantConfig> {
  const registry = new FileTenantRegistry();
  const record = await registry.get(slug);

  if (!record) {
    const [live, sim] = await Promise.all([registry.listByKind('live'), registry.listByKind('sim')]);
    const available = [...live, ...sim].map(r => r.tenantSlug);
    const availableStr = available.length > 0
      ? available.join(', ')
      : 'none found';

    throw new Error(
      `Tenant config not found for slug "${slug}" in the ces-tenant registry (root: ${getRegistryRoot()})\n` +
      `Available tenants: ${availableStr}\n` +
      `Register the tenant or use POST /api/tenant-config to set the active tenant.`
    );
  }

  // The registry's get() migrated any back-compat record forward, so the
  // canonical file now lives under the registry root in its kind namespace.
  const configPath = registryRecordPath(getRegistryRoot(), record.kind, slug);
  const tc = loadTenantConfig(configPath);

  // Validate cert file exists
  if (tc.certPath && !fs.existsSync(tc.certPath)) {
    console.warn(
      `[MigrationHelper] Certificate file not found at ${tc.certPath}. ` +
      `Graph API authentication will fail. Ensure the certificate is installed.`
    );
  }

  return tc;
}
