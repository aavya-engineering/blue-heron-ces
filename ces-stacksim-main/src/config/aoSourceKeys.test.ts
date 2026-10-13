// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSimTenantConfig } from './SimTenantConfig.js';
import { AO_SOURCE_TO_TENANT_KEY, AO_SOURCES_NOT_APPLICABLE, readPath } from './aoSourceKeys.js';
import { buildSeedSet, G5_IDS } from '../seed/sets/gccHighG5.js';
import { generateGroups } from '../seed/generators/identity.js';
import { generateCaPolicies, generateNamedLocations } from '../seed/generators/caPolicies.js';
import { generateFirewalls } from '../seed/generators/azureResources.js';

/**
 * SIMFIX FIX-S2 / GOAL M1 exit criterion: every AO registry `source` maps to
 * a NON-EMPTY value in the m365_azure tenant object, and every id/name value
 * names an object the seed actually creates. Reads ces-ao's registry
 * read-only (sibling root); skips loudly if it is not checked out beside us.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, '..', '..', '..', 'ces-ao', 'src', 'registry', 'ao-commands.registry.json');

describe('AO registry sources -> sim tenant object', () => {
  const cfg = buildSimTenantConfig({ slug: 'ao-src', tenantStance: 'm365_azure' });

  it.skipIf(!existsSync(REGISTRY))('every AO registry source maps to a non-empty tenant-object value (or is listed N/A)', () => {
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as Array<{ id: string; parameters: Array<{ source?: string }> }>;
    const sources = new Set(registry.flatMap((c) => c.parameters.map((p) => p.source).filter((s): s is string => !!s)));
    const missing: string[] = [];
    for (const src of sources) {
      if (AO_SOURCES_NOT_APPLICABLE[src]) continue;
      const key = AO_SOURCE_TO_TENANT_KEY[src];
      const v = key ? readPath(cfg, key) : undefined;
      if (typeof v !== 'string' || v.length === 0) missing.push(`${src} -> ${key ?? '(no mapping)'}`);
    }
    expect(missing).toEqual([]);
  });

  it('id/name values name objects the seed creates (no parallel literals)', () => {
    const set = buildSeedSet('gcc-high-g5');
    const ids = (c: string, base: Array<{ id: string }> = []) => new Set([...base, ...(set.add[c] ?? [])].map((o) => o.id));
    const r = cfg.resources ?? {};
    const groups = ids('groups', generateGroups(3));
    for (const k of ['base_group_id', 'loa_group_id', 'admin_group_id', 'cui_group_id', 'training_enforcement_group_id']) {
      expect(groups.has(r[k]), k).toBe(true);
    }
    expect(ids('caPolicies', generateCaPolicies(3)).has(r.device_compliance_ca_policy_id)).toBe(true);
    expect(ids('caPolicies', generateCaPolicies(3)).has(r.admin_portal_ca_policy_id)).toBe(true);
    expect(ids('namedLocations', generateNamedLocations(2)).has(r.named_location_id)).toBe(true);
    expect(ids('androidManagedAppProtections').has(r.android_app_protection_policy_id)).toBe(true);
    expect(ids('iosManagedAppProtections').has(r.ios_app_protection_policy_id)).toBe(true);
    expect(ids('subscribedSkus').has(r.m365_license_sku_id)).toBe(true);
    expect(set.add.spoSites.some((s) => s.Url === r.cui_site_id)).toBe(true);
    expect(generateFirewalls(1).some((f) => f.Name === r.firewall_name)).toBe(true);
    expect(set.add.publicIpAddresses.some((p) => p.Name === r.public_ip_name)).toBe(true);
    expect(existsSync(r.training_roster_path)).toBe(true);
    expect(r.cui_group_name).toBe(G5_IDS.cuiGroupName);
  });

  it('SKU display name and units come from the Stamper tenant-object licensing fields (OD-6)', () => {
    const sku = buildSeedSet('gcc-high-g5').add.subscribedSkus[0] as Record<string, unknown>;
    expect(sku.displayName).toBe(cfg.resources?.m365_primary_sku);
    expect((sku.prepaidUnits as { enabled: number }).enabled).toBe(Number(cfg.resources?.m365_license_count));
  });
});
