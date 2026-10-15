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

import * as fs from 'node:fs';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ces-ao package root: two levels above this module (src/tenant/ or dist/tenant/). NOT process.cwd(). */
const AO_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/** Caller identity AO wires into every ces-tenant surface (ratified amendment 2026-07-10). */
export const AO_CONSUMER: ConsumerIdentity = {
  module: 'ces-ao',
  purpose: 'adminops tenant resolution/session',
};

/** Default slug for the sim tenant sim-mode requests when no `kind: 'sim'` record exists yet. Matches the family's historical sim config slug. */
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
 * One-time forward migration: copy each `<ces-ao>/plan-data/<slug>/<slug>.json`
 * tenant config into the ces-tenant registry root (kind-namespaced, stamped),
 * unless the slug already has a registry record in either namespace. Source
 * files are left in place (reads-not-writes back-compat, same policy as
 * `FileTenantRegistry.migrateForward`).
 */
export function seedRegistryFromRepoPlanData(
  planDataRoot: string = path.join(AO_PACKAGE_ROOT, 'plan-data'),
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
    if (!entry.isDirectory()) continue;
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
      console.log(`[aoTenants] migrated legacy plan-data tenant "${slug}" -> ${dest} (kind: ${kind})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[aoTenants] failed to migrate legacy tenant "${slug}": ${msg}`);
    }
  }
}

/** AO's process-wide ces-tenant registry (seeded from the legacy repo plan-data location on first use). */
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
