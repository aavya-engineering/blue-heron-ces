// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Stamper's single integration point with the `ces-tenant` package
 * (G-TENANT-M1 cutover).
 *
 * Everything tenant-connection-shaped in Stamper goes through here:
 *  - tenant-config resolution is the `ces-tenant` registry API exclusively
 *    (goal must-NOT: no `plan-data/` path construction via
 *    `src/config/paths.ts` for tenant configs post-cutover);
 *  - stacksim launch mode is a request for a `kind: 'sim'` registry entry
 *    plus `ces-tenant`'s `StacksimModeController` — NOT a direct call into a
 *    Stamper-owned env-mutation function;
 *  - every request carries Stamper's consumer identity per the ratified
 *    2026-07-10 amendment (`ConsumerIdentity`: module + purpose).
 *
 * The ONE deliberate exception to "registry API exclusively" is
 * `seedRegistryFromRepoPlanData()`: a one-time forward migration of
 * Stamper's own legacy location (`<repo>/plan-data/<slug>/<slug>.json`, the
 * 2026-07-10 pre-cutover convention) INTO the registry root. `ces-tenant`'s
 * back-compat read order covers `CES_PIPELINE_ROOT/Stamper/plan-data/` and
 * `~/.stamper/tenants/` but cannot know Stamper's repo-internal layout, so
 * Stamper migrates that location forward itself, mirroring
 * `FileTenantRegistry`'s own migrate-forward semantics (raw copy, secret
 * refs intact, `kind` stamped, source left in place). Runtime resolution
 * never reads the legacy location.
 */

import {
  FileTenantRegistry,
  StacksimEnvironment,
  getRegistryRoot,
  registryRecordPath,
  type ConsumerIdentity,
  type StacksimEnvironmentOptions,
  type TenantRegistryLifecycle,
  type TenantRegistryRecord,
} from 'ces-tenant';
import { DEFAULT_SIM_TENANT_SLUG, createModuleTenantRegistry } from 'ces-shared/tenant/registry';

import { getPlanDataRoot } from '../config/paths.js';

/** Caller identity Stamper wires into every ces-tenant surface (ratified amendment 2026-07-10). */
export const STAMPER_CONSUMER: ConsumerIdentity = {
  module: 'ces-stamper',
  purpose: 'tenant session/config resolution',
};

/** Default slug for the sim tenant the `--stacksim` flag requests when no `kind: 'sim'` record exists yet (ces-shared, DUP-2). */
export { DEFAULT_SIM_TENANT_SLUG };

/**
 * Registry singleton + one-time forward migration of
 * `<repo>/plan-data/<slug>/<slug>.json` (the shared ces-shared implementation,
 * DUP-2). `dev` is skipped. Evidence/plans/logs/state subdirs are NOT touched.
 */
export const {
  seedRegistryFromRepoPlanData,
  getTenantRegistry,
  resetTenantRegistryForTests,
} = createModuleTenantRegistry<FileTenantRegistry>({
  moduleName: 'stamperTenants',
  defaultPlanDataRoot: () => getPlanDataRoot(),
  skipDirNames: ['dev'],
  createRegistry: () => new FileTenantRegistry(),
  getRegistryRoot,
  registryRecordPath,
});

/**
 * Resolve the on-disk path of a tenant's registry record. Registry-backed:
 * `registry.get()` performs ces-tenant's back-compat read order and forward
 * migration, so after this call the record (if the tenant exists anywhere)
 * lives at the returned kind-namespaced registry path. When the tenant is
 * unknown, the would-be `live` path is returned so callers' existing
 * `fs.existsSync` not-found handling keeps working unchanged.
 */
export async function resolveTenantRecordPath(slug: string): Promise<string> {
  const registry = getTenantRegistry();
  // Collision / mis-stamp errors from get() are real config problems — let them surface.
  const record: TenantRegistryRecord | undefined = await registry.get(slug);
  return registryRecordPath(getRegistryRoot(), record?.kind ?? 'live', slug);
}

/** All registry records (live + sim), each with its on-disk record path. */
export async function listTenantRecordsWithPaths(): Promise<
  Array<{ record: TenantRegistryRecord; path: string }>
> {
  const registry = getTenantRegistry();
  const root = getRegistryRoot();
  const live = await registry.listByKind('live');
  const sim = await registry.listByKind('sim');
  return [...live, ...sim].map((record) => ({
    record,
    path: registryRecordPath(root, record.kind, record.tenantSlug),
  }));
}

/** Options seam for tests (injected env / PSHOME query / fetch); production callers pass nothing. */
export type RequestStacksimOptions = Pick<
  StacksimEnvironmentOptions,
  'env' | 'queryPsHomeModules' | 'fetchFn' | 'stacksimRoot'
>;

/**
 * The `--stacksim` flag's cutover target (goal must-NOT: no direct
 * `enableStacksimMode()` call): request a `kind: 'sim'` tenant from the
 * ces-tenant registry — creating the default ephemeral sim record if none
 * exists — then enable stacksim mode through ces-tenant's
 * `StacksimModeController`, registry-verified and carrying Stamper's
 * consumer identity.
 */
export async function requestStacksimMode(
  serverUrl?: string,
  options: RequestStacksimOptions = {},
): Promise<TenantRegistryRecord> {
  const registry: TenantRegistryLifecycle = getTenantRegistry();

  let sims = await registry.listByKind('sim');
  if (sims.length === 0) {
    console.log(
      `[stamperTenants] no kind:'sim' registry record found -- creating ephemeral sim tenant "${DEFAULT_SIM_TENANT_SLUG}"`,
    );
    await registry.createEphemeralSimTenant(DEFAULT_SIM_TENANT_SLUG, undefined);
    sims = await registry.listByKind('sim');
  }
  const simRecord = sims.find((r) => r.tenantSlug === DEFAULT_SIM_TENANT_SLUG) ?? sims[0];

  // listByKind filters strictly on the stamped `kind` field (ces-tenant
  // interface invariant), so simRecord is registry-verified sim — never a
  // live tenant. Belt-and-braces guard anyway:
  if (simRecord.kind !== 'sim') {
    throw new Error(
      `[stamperTenants] refusing stacksim mode: registry returned kind "${simRecord.kind}" for "${simRecord.tenantSlug}".`,
    );
  }

  const controller = new StacksimEnvironment({
    registry,
    consumer: STAMPER_CONSUMER,
    ...options,
  });
  await controller.enableStacksimMode(serverUrl);
  return simRecord;
}
