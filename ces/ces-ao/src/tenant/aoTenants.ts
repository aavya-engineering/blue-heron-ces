// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * AO's single integration point with the `ces-tenant` package
 * (G-TENANT-M5 cutover).
 *
 * Everything tenant-connection-shaped in ces-ao goes through here:
 *  - tenant-config resolution is the `ces-tenant` registry API exclusively
 *    (goal must-NOTs: no cwd-anchored `resolveTenantJsonPath` currying, no
 *    flat `~/.stamper/tenants/<slug>.json` probe — the A9 collision path);
 *  - sim mode is a request for a `kind: 'sim'` registry record plus
 *    `ces-tenant`'s `StacksimModeController` — AO does not hand-roll env
 *    mutation;
 *  - every request carries AO's consumer identity per the ratified
 *    2026-07-10 amendment (`ConsumerIdentity`: module + purpose).
 *
 * The ONE deliberate exception to "registry API exclusively" is
 * `seedRegistryFromRepoPlanData()`: a one-time forward migration of AO's own
 * legacy in-repo location (`<ces-ao>/plan-data/<slug>/<slug>.json`, the
 * pre-cutover cwd-anchored convention) INTO the registry root. `ces-tenant`'s
 * back-compat read order covers `CES_PIPELINE_ROOT/Stamper/plan-data/` and
 * `~/.stamper/tenants/` but cannot know AO's repo-internal layout, so AO
 * migrates that location forward itself — anchored on the PACKAGE root (this
 * module's own location), never `process.cwd()` — mirroring
 * `FileTenantRegistry`'s migrate-forward semantics (raw copy, secret refs
 * intact, `kind` stamped, source left in place). Runtime resolution never
 * reads the legacy location. Same pattern as ces-stamper's M1
 * `seedRegistryFromRepoPlanData()` (`ces-stamper/src/tenant/stamperTenants.ts`).
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FileTenantRegistry,
  StacksimEnvironment,
  getRegistryRoot,
  registryRecordPath,
  type ConsumerIdentity,
  type StacksimEnvironmentOptions,
  type TenantKind,
  type TenantRegistryLifecycle,
  type TenantRegistryRecord,
} from 'ces-tenant';
import type { TenantConfig } from 'ces-shared/config';
import { DEFAULT_SIM_TENANT_SLUG, createModuleTenantRegistry } from 'ces-shared/tenant/registry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ces-ao package root: two levels above this module (src/tenant/ or dist/tenant/). NOT process.cwd(). */
const AO_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/** Caller identity AO wires into every ces-tenant surface (ratified amendment 2026-07-10). */
export const AO_CONSUMER: ConsumerIdentity = {
  module: 'ces-ao',
  purpose: 'adminops tenant resolution/session',
};

/** Default slug for the sim tenant sim-mode requests when no `kind: 'sim'` record exists yet (ces-shared, DUP-2). */
export { DEFAULT_SIM_TENANT_SLUG };

/**
 * Registry singleton + one-time forward migration of
 * `<ces-ao>/plan-data/<slug>/<slug>.json` (the shared ces-shared
 * implementation, DUP-2). No directory names are skipped.
 */
export const {
  seedRegistryFromRepoPlanData,
  getTenantRegistry,
  resetTenantRegistryForTests,
} = createModuleTenantRegistry<FileTenantRegistry>({
  moduleName: 'aoTenants',
  defaultPlanDataRoot: () => path.join(AO_PACKAGE_ROOT, 'plan-data'),
  createRegistry: () => new FileTenantRegistry(),
  getRegistryRoot,
  registryRecordPath,
});

/** Query a single registry record by slug (live or sim), or undefined when unknown. */
export async function resolveTenantRecord(slug: string): Promise<TenantRegistryRecord | undefined> {
  return getTenantRegistry().get(slug);
}

/**
 * Load a tenant config by slug through the ces-tenant registry — the ONLY
 * slug-to-config path AO's three entry points (HTTP tenantLoader, CLI, MCP)
 * use post-cutover. A `TenantRegistryRecord` is a structural superset of
 * `ces-shared`'s `TenantConfig` (same field mapping, required-field checks,
 * and secret-ref resolution — `ces-tenant/src/impl/tenant-file.ts` is a
 * behavior-preserving port of `loadTenantConfig()`), plus the `kind`
 * discriminator.
 */
export async function loadTenantConfigBySlug(slug: string): Promise<TenantConfig & { kind: TenantKind }> {
  const record = await resolveTenantRecord(slug);
  if (!record) {
    throw new Error(
      `Tenant config not found for '${slug}' in the ces-tenant registry (root: ${getRegistryRoot()})`,
    );
  }
  return record;
}

/** Options seam for tests (injected env / PSHOME query / fetch / stacksim root); production callers pass nothing. */
export type RequestAoStacksimOptions = Pick<
  StacksimEnvironmentOptions,
  'env' | 'queryPsHomeModules' | 'fetchFn' | 'stacksimRoot'
> & {
  /**
   * Slug the caller intends to run against. When it has no registry record an
   * ephemeral `kind: 'sim'` record is created for it; when it resolves to a
   * LIVE record the request is REFUSED (A9 guard — sim env mutation must
   * never be armed for a live tenant).
   */
  preferredSlug?: string;
};

/**
 * AO's sim-mode entry (goal must-NOT: no hand-rolled StacksimMode): request a
 * `kind: 'sim'` tenant from the ces-tenant registry — creating an ephemeral
 * sim record if none exists — then enable stacksim mode through ces-tenant's
 * `StacksimModeController`, registry-verified and carrying AO's consumer
 * identity. Must run before the first PowerShell session spawns.
 */
export async function requestAoStacksimMode(
  serverUrl?: string,
  options: RequestAoStacksimOptions = {},
): Promise<TenantRegistryRecord> {
  const { preferredSlug, ...seams } = options;
  const registry: TenantRegistryLifecycle = getTenantRegistry();

  let simRecord: TenantRegistryRecord;
  if (preferredSlug) {
    const existing = await registry.get(preferredSlug);
    if (existing && existing.kind !== 'sim') {
      throw new Error(
        `[aoTenants] refusing stacksim mode: "${preferredSlug}" resolves to a kind "${existing.kind}" registry record, not "sim".`,
      );
    }
    simRecord =
      existing ?? (await registry.createEphemeralSimTenant(preferredSlug, undefined));
  } else {
    let sims = await registry.listByKind('sim');
    if (sims.length === 0) {
      console.log(
        `[aoTenants] no kind:'sim' registry record found -- creating ephemeral sim tenant "${DEFAULT_SIM_TENANT_SLUG}"`,
      );
      await registry.createEphemeralSimTenant(DEFAULT_SIM_TENANT_SLUG, undefined);
      sims = await registry.listByKind('sim');
    }
    simRecord = sims.find((r) => r.tenantSlug === DEFAULT_SIM_TENANT_SLUG) ?? sims[0];
  }

  // listByKind/createEphemeralSimTenant guarantee kind 'sim' (ces-tenant
  // interface invariant). Belt-and-braces guard anyway:
  if (simRecord.kind !== 'sim') {
    throw new Error(
      `[aoTenants] refusing stacksim mode: registry returned kind "${simRecord.kind}" for "${simRecord.tenantSlug}".`,
    );
  }

  const controller = new StacksimEnvironment({
    registry,
    consumer: AO_CONSUMER,
    ...seams,
  });
  await controller.enableStacksimMode(serverUrl);
  return simRecord;
}
