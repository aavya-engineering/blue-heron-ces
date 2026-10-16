// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Path-resolution helpers for the registry read path (design 2.1) and the
 * HTTP key provider (design 2.4 point 2). Every convention here is a port of
 * an existing resolver, cited inline; the only NEW path is the registry root
 * itself (design 2.1 migration plan point 1, open decision 8.1 -- default
 * picked at M1, logged as a deviation in docs/M1-RECORD.md).
 */

import * as path from 'node:path';
import * as os from 'node:os';

import type { TenantKind } from '../registry.js';

/** Env var that overrides the pipeline storage root on all platforms. Port of `ces-shared/src/storage/contract.ts:13`. */
export const CES_PIPELINE_ROOT_ENV = 'CES_PIPELINE_ROOT';

/**
 * Env var that overrides the NEW tenant-registry root. NEW-SCOPE naming
 * (no prior art -- the root itself is new, design 2.1 point 1).
 */
export const CES_TENANT_ROOT_ENV = 'CES_TENANT_ROOT';

/**
 * Pipeline-root resolution, port of `ces-shared/src/storage/node.ts:14-21`
 * (`getCesPipelineRoot()`): `CES_PIPELINE_ROOT` env override, else
 * `C:\CES_Pipeline` on Windows / `<cwd>/ces-pipeline` on POSIX
 * (`ces-shared/src/storage/contract.ts:16-19`).
 */
export function getCesPipelineRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fallback =
    process.platform === 'win32' ? 'C:\\CES_Pipeline' : path.join(process.cwd(), 'ces-pipeline');
  return path.resolve(env[CES_PIPELINE_ROOT_ENV] || fallback);
}

/**
 * M1 default for open decision 8.1: home-dir-anchored `~/.ces/tenants/`,
 * overridable via `CES_TENANT_ROOT`. Rationale (logged as a deviation): the
 * founder's 2026-07-10 direction moved Stamper's canonical configs to
 * repo-anchored plan-data and away from the `C:\CES_Pipeline` default, so
 * anchoring the NEW neutral root on `CES_PIPELINE_ROOT` would couple it to a
 * convention already being retired; `~/.ces/` mirrors the oldest operator
 * convention (`~/.stamper/`) without the Stamper-specific name.
 */
export function getRegistryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CES_TENANT_ROOT_ENV];
  return override ? path.resolve(override) : path.join(os.homedir(), '.ces', 'tenants');
}

/**
 * A9 structural fix (design 2.1 hazard note): sim and live records live in
 * PHYSICALLY separate namespaces under the registry root, so a collision is
 * structurally impossible, not just metadata-tagged.
 */
export function registryRecordPath(registryRoot: string, kind: TenantKind, slug: string): string {
  return path.join(registryRoot, kind, `${slug}.json`);
}

/** Back-compat read (b): current Stamper convention, `ces-shared/src/storage/node.ts:53-59` shape. */
export function planDataTenantJsonPath(cesPipelineRoot: string, slug: string): string {
  return path.join(cesPipelineRoot, 'Stamper', 'plan-data', slug, `${slug}.json`);
}

/**
 * Back-compat read (c), flat variant: the legacy path named by the gate and
 * by the A9 hazard (`tenant-stacksim/src/config/SimTenantConfig.ts:160-162`,
 * `flatTenantConfigPath()`; `TenantProbe.psm1` convention).
 */
export function legacyFlatTenantJsonPath(homeDir: string, slug: string): string {
  return path.join(homeDir, '.stamper', 'tenants', `${slug}.json`);
}

/**
 * Back-compat read (c), nested variant: the legacy layout
 * `resolveTenantJsonPath()` falls back to
 * (`ces-shared/src/config/TenantConfig.ts:148`) and Stamper's own
 * `migrateToTenantTree()` migrates from (`GuiServer.ts:110-125`). Checked
 * after the flat variant; both are "legacy" in the gate's read order.
 */
export function legacyNestedTenantJsonPath(homeDir: string, slug: string): string {
  return path.join(homeDir, '.stamper', 'tenants', slug, `${slug}.json`);
}

export function defaultHomeDir(): string {
  return os.homedir();
}
