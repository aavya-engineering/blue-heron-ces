// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import {
  FileTenantRegistry,
  StacksimEnvironment,
  type ConsumerIdentity,
  type SimLaunchEnv,
  type TenantRegistryLifecycle,
  type TenantRegistryRecord,
} from 'ces-tenant';

/**
 * docs/goals/G-TENANT-ADOPT.md: ces-tester consumes `ces-tenant`'s ratified
 * interfaces for sim-tenant lifecycle and Stamper launch-context, rather
 * than growing its own variant (design doc §6's per-consumer requirement,
 * quoted in the goal doc: "the test orchestrator consumes the registry from
 * day one rather than growing its own variant... Must not pre-build bespoke
 * session/auth/config-path logic — consuming these interfaces IS its tenant
 * story"). ADDENDUM 2026-07-11: ces-tester OWNS sim-tenant registration —
 * every ephemeral sim tenant this repo touches is created/queried/torn down
 * through `TenantRegistryLifecycle`, never by writing tenant config files by
 * hand or invoking stacksim's `init-tenant` direct-write path.
 *
 * This module is ces-tester's single integration point with `ces-tenant`,
 * mirroring the pattern `ces-stamper/src/tenant/stamperTenants.ts` already
 * established for its own G-TENANT-M1 cutover (one place that owns the
 * registry singleton + this repo's `ConsumerIdentity`, so every call site in
 * `src/stacksim-client/`, `src/stamper-launcher/`, `src/cli/` goes through
 * the same instance rather than each constructing its own).
 */

/** Caller identity ces-tester wires into every ces-tenant surface (ratified amendment 2026-07-10). */
export const CES_TESTER_CONSUMER: ConsumerIdentity = {
  module: 'ces-tester',
  purpose: 'scenario run: sim-tenant lifecycle + Stamper launch-context',
};

export interface TenantRegistryOptions {
  /** Overrides the registry root (`CES_TENANT_ROOT` env / `~/.ces/tenants` default). Test-only seam. */
  registryRoot?: string;
  /** Overrides the tenant-stacksim checkout root passed to `StacksimEnvironment`. */
  stacksimRoot?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Constructs a fresh `FileTenantRegistry` for one scenario run. NOT a
 * process-wide singleton (unlike Stamper's `getTenantRegistry()`) — each
 * `run-m2`/`run` invocation is its own short-lived CLI process, so there is
 * no cross-call state to share; a fresh instance per run keeps the registry
 * root/env overrides explicit and test-injectable.
 */
export function createTenantRegistry(opts: TenantRegistryOptions = {}): FileTenantRegistry {
  return new FileTenantRegistry({
    registryRoot: opts.registryRoot,
    env: opts.env,
  });
}

/**
 * PLAN.md M1 task 2 / M2 task 4's ephemeral per-scenario sim tenant, created
 * through the registry (G-TENANT-ADOPT Acceptance Gate item 1) — replaces
 * the direct `stacksim init-tenant --plan-data-root <stamperRoot>` CLI
 * invocation this repo used before this goal (that path is "now-deprecated-
 * for-orchestrated-use" per the goal's ADDENDUM). `seedRef` is opaque to
 * `ces-tenant` (interface doc: "TenantManager only needs a reference to it,
 * not its shape") — this repo passes its own `StacksimSeedBlock` through
 * unexamined by the registry.
 */
export async function createEphemeralSimTenant(
  registry: TenantRegistryLifecycle,
  slug: string,
  seedRef: unknown,
): Promise<TenantRegistryRecord> {
  return registry.createEphemeralSimTenant(slug, seedRef);
}

/**
 * PLAN.md M1 task 4's manual-cleanup step, now a first-class registry
 * operation (G-TENANT-ADOPT Acceptance Gate item 1: "teardown leaves no
 * residue — a torn-down slug must not appear in a subsequent
 * `listByKind('sim')` call"). Replaces `stamper-launcher/tenant-cleanup.ts`'s
 * `cleanupSimTenantFlatConfig()`.
 */
export async function teardownEphemeralSimTenant(
  registry: TenantRegistryLifecycle,
  slug: string,
): Promise<void> {
  return registry.teardownEphemeralSimTenant(slug);
}

/**
 * G-TENANT-ADOPT Acceptance Gate item 2: the orchestrator's cleanup/reset
 * pass must use `listByKind('sim')` exclusively, never a naming-convention
 * or directory-location heuristic, so a `kind: 'live'` record can never be
 * swept up by a sim-only pass.
 */
export async function listSimTenants(registry: TenantRegistryLifecycle): Promise<TenantRegistryRecord[]> {
  return registry.listByKind('sim');
}

/**
 * G-TENANT-ADOPT Acceptance Gate item 4: the launch-context env bundle
 * `stamper-launcher` injects when spawning Stamper, sourced from
 * `TenantLaunchContextProvider.getSimLaunchEnv()` — replaces
 * `stamper-launcher/env.ts`'s hand-rolled `buildStacksimChildEnv()`
 * (PSModulePath/Path/STACKSIM_SERVER_URL mutation, the exact duplication of
 * `StacksimMode.ts:118-125` the goal's Must-NOTs name).
 */
export async function getSimLaunchEnv(
  registry: TenantRegistryLifecycle,
  tenantSlug: string,
  opts: TenantRegistryOptions = {},
): Promise<SimLaunchEnv> {
  const provider = new StacksimEnvironment({
    registry,
    stacksimRoot: opts.stacksimRoot,
    env: opts.env,
    consumer: CES_TESTER_CONSUMER,
  });
  return provider.getSimLaunchEnv(tenantSlug, 'sim', CES_TESTER_CONSUMER);
}
