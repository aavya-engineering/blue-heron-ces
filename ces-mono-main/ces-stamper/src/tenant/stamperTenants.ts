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

import * as fs from 'node:fs';
import * as path from 'node:path';

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

import { getPlanDataRoot } from '../config/paths.js';

/** Caller identity Stamper wires into every ces-tenant surface (ratified amendment 2026-07-10). */
export const STAMPER_CONSUMER: ConsumerIdentity = {
  module: 'ces-stamper',
  purpose: 'tenant session/config resolution',
};

/** Default slug for the sim tenant the `--stacksim` flag requests when no `kind: 'sim'` record exists yet. Matches the repo's historical sim config slug. */
export const DEFAULT_SIM_TENANT_SLUG = 'sim-m365-azure';

let registrySingleton: FileTenantRegistry | undefined;
let seeded = false;

/**
 * Detect the `kind` to stamp on a legacy repo-plan-data record, mirroring
 * `ces-tenant`'s own detection: an explicit valid `kind` wins; otherwise
 * tenant-stacksim's emitted marker `tenant.environment === 'gcc-high-sim'`
 * is the grounded sim-provenance signal; everything else is `'live'`.
 */
function detectLegacyKind(raw: Record<string, any>): TenantKind {
  if (raw.kind === 'live' || raw.kind === 'sim') return raw.kind;
  if (raw.tenant?.environment === 'gcc-high-sim') return 'sim';
  return 'live';
}

/**
 * One-time forward migration: copy each `<repo>/plan-data/<slug>/<slug>.json`
 * tenant config into the ces-tenant registry root (kind-namespaced, stamped),
 * unless the slug already has a registry record in either namespace. Source
 * files are left in place (reads-not-writes back-compat, same policy as
 * `FileTenantRegistry.migrateForward`). Evidence/plans/logs/state subdirs are
 * NOT touched — evidence storage stays outside ces-tenant's scope fence.
 */
export function seedRegistryFromRepoPlanData(
  planDataRoot: string = getPlanDataRoot(),
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
    if (!entry.isDirectory() || entry.name === 'dev') continue;
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
      console.log(`[stamperTenants] migrated legacy plan-data tenant "${slug}" -> ${dest} (kind: ${kind})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[stamperTenants] failed to migrate legacy tenant "${slug}": ${msg}`);
    }
  }
}

/** Stamper's process-wide ces-tenant registry (seeded from the legacy repo plan-data location on first use). */
export function getTenantRegistry(): FileTenantRegistry {
  if (!registrySingleton) {
    registrySingleton = new FileTenantRegistry();
  }
  if (!seeded) {
    seeded = true;
    seedRegistryFromRepoPlanData();
  }
  return registrySingleton;
}

/** Test-only: drop the singleton so a test can re-anchor via CES_TENANT_ROOT. */
export function resetTenantRegistryForTests(): void {
  registrySingleton = undefined;
  seeded = false;
}

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
