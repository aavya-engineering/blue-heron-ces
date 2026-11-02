// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * One module-parameterized tenant registry singleton + legacy repo plan-data
 * seed (DUP-2, gap-closure plan §4 G-DUP). Replaces the duplicated bodies in
 * `ces-stamper/src/tenant/stamperTenants.ts` and `ces-ao/src/tenant/aoTenants.ts`.
 *
 * ces-shared does not depend on `ces-tenant`, so the caller injects the three
 * ces-tenant touchpoints (registry constructor, `getRegistryRoot`,
 * `registryRecordPath`). Semantics are unchanged: raw copy, secret refs
 * intact, `kind` stamped, source left in place, slugs already in either
 * namespace skipped.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Structural mirror of ces-tenant's `TenantKind`. */
export type LegacyTenantKind = 'live' | 'sim';

/** Default slug for the sim tenant sim-mode requests when no `kind: 'sim'` record exists yet. */
export const DEFAULT_SIM_TENANT_SLUG = 'sim-m365-azure';

/**
 * Detect the `kind` to stamp on a legacy repo-plan-data record, mirroring
 * `ces-tenant`'s own detection: an explicit valid `kind` wins; otherwise
 * tenant-stacksim's emitted marker `tenant.environment === 'gcc-high-sim'`
 * is the grounded sim-provenance signal; everything else is `'live'`.
 */
export function detectLegacyKind(raw: Record<string, any>): LegacyTenantKind {
  if (raw.kind === 'live' || raw.kind === 'sim') return raw.kind;
  if (raw.tenant?.environment === 'gcc-high-sim') return 'sim';
  return 'live';
}

export interface ModuleTenantRegistryOptions<R> {
  /** Log prefix, e.g. `stamperTenants` -> `[stamperTenants] ...`. */
  moduleName: string;
  /** Default legacy plan-data root, evaluated at call time. */
  defaultPlanDataRoot: () => string;
  /** Directory names under the plan-data root never treated as tenant slugs. */
  skipDirNames?: readonly string[];
  /** ces-tenant `new FileTenantRegistry()`. */
  createRegistry: () => R;
  /** ces-tenant `getRegistryRoot`. */
  getRegistryRoot: () => string;
  /** ces-tenant `registryRecordPath`. */
  registryRecordPath: (root: string, kind: LegacyTenantKind, slug: string) => string;
}

export interface ModuleTenantRegistry<R> {
  seedRegistryFromRepoPlanData(planDataRoot?: string, registryRoot?: string): void;
  getTenantRegistry(): R;
  resetTenantRegistryForTests(): void;
}

export function createModuleTenantRegistry<R>(
  options: ModuleTenantRegistryOptions<R>,
): ModuleTenantRegistry<R> {
  const { moduleName, defaultPlanDataRoot, createRegistry, getRegistryRoot, registryRecordPath } = options;
  const skip = new Set(options.skipDirNames ?? []);

  let registrySingleton: R | undefined;
  let seeded = false;

  function seedRegistryFromRepoPlanData(
    planDataRoot: string = defaultPlanDataRoot(),
    registryRoot: string = getRegistryRoot(),
  ): void {
    if (!fs.existsSync(planDataRoot)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(planDataRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      const slug = entry.name;
      const legacyJson = path.join(planDataRoot, slug, `${slug}.json`);
      if (!fs.existsSync(legacyJson)) continue;
      const inLive = fs.existsSync(registryRecordPath(registryRoot, 'live', slug));
      const inSim = fs.existsSync(registryRecordPath(registryRoot, 'sim', slug));
      if (inLive || inSim) continue; // registry already knows this slug
      try {
        const raw = JSON.parse(fs.readFileSync(legacyJson, 'utf-8')) as Record<string, any>;
        const kind = detectLegacyKind(raw);
        const stamped = { ...raw, kind };
        const dest = registryRecordPath(registryRoot, kind, slug);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(stamped, null, 2) + '\n', 'utf-8');
        console.log(`[${moduleName}] migrated legacy plan-data tenant "${slug}" -> ${dest} (kind: ${kind})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[${moduleName}] failed to migrate legacy tenant "${slug}": ${msg}`);
      }
    }
  }

  function getTenantRegistry(): R {
    if (!registrySingleton) {
      registrySingleton = createRegistry();
    }
    if (!seeded) {
      seeded = true;
      seedRegistryFromRepoPlanData();
    }
    return registrySingleton;
  }

  function resetTenantRegistryForTests(): void {
    registrySingleton = undefined;
    seeded = false;
  }

  return { seedRegistryFromRepoPlanData, getTenantRegistry, resetTenantRegistryForTests };
}
