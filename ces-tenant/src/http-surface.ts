// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * HTTP token/endpoint provider surface, design §2.4 point 2.
 *
 * M0 — interface definition only, extracted from muster-api's CURRENT
 * `tenantKeysService.resolveTenantKeys()`
 * (`ces-muster/muster-api/src/services/tenantKeysService.ts:50-107`). Given a
 * tenant slug, returns resolved credentials-by-reference + endpoint URLs,
 * without spawning any process — the non-PowerShell client surface (design
 * §2.4 point 2).
 *
 * RATIFIED AMENDMENT (founder, 2026-07-10) — G-TENANT-1 addendum item 1:
 * `resolveTenantKeys()` (a token request) carries an optional trailing
 * `consumer: ConsumerIdentity`. INVARIANT: requests without a consumer are
 * REJECTED in service mode and LOGGED in library mode. See `consumer.ts`;
 * not a silent edit — logged in `docs/M1-RECORD.md`.
 */

import type { ConsumerIdentity } from './consumer.js';

/**
 * Result shape. Verbatim from `TenantKeys`,
 * `ces-muster/muster-api/src/services/tenantKeysService.ts:14-24`.
 */
export interface TenantKeys {
  /** `'tenant-config'` when resolved from a Stamper plan-data slug; `'env'` when resolved from `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID` env-var fallback (no slug). Source: `tenantKeysService.ts:15`, `:69`, `:97`. */
  source: 'tenant-config' | 'env';
  tenantId: string;
  appId: string;
  /** Loaded but not necessarily present — env fallback path never returns a thumbprint (`tenantKeysService.ts:97-105`). */
  certThumbprint?: string;
  endpoints: {
    graph: string;
    login: string;
    arm?: string;
  };
}

/**
 * Error discriminator. Verbatim from `TenantKeysError`,
 * `ces-muster/muster-api/src/services/tenantKeysService.ts:26-34`.
 * `'tenant_not_found'` — the slug's tenant JSON does not exist at the
 * resolved plan-data path. `'degraded'` — no slug given and the
 * `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID` env-var fallback is also unset.
 */
export type TenantKeysErrorCode = 'tenant_not_found' | 'degraded';

/**
 * HTTP token/endpoint provider surface contract. Source:
 * `resolveTenantKeys()`,
 * `ces-muster/muster-api/src/services/tenantKeysService.ts:50-107`.
 *
 * Behavior preserved as documented at the source (design §5, M0 = no
 * behavior change): given a slug, resolve `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json`
 * via `resolveTenantJsonPath`, load it via `loadTenantConfig` (secret-ref
 * resolution, honors `CES_STRICT_SECRETS`), and return
 * tenantId/appId/certThumbprint + endpoints, with per-field endpoint
 * fallback to `getActiveStackProvider` when the tenant JSON omits endpoints.
 * Missing file throws `TenantKeysErrorCode: 'tenant_not_found'`. Given no
 * slug, reads `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID` from env, with endpoints
 * from `GRAPH_BASE_URL` or the default stack provider; missing env throws
 * `TenantKeysErrorCode: 'degraded'`.
 *
 * Non-Windows-safe by construction: no PowerShell/`child_process` dependency
 * anywhere in the source implementation (design §7 — muster-api "is
 * confirmed pure Node/Express... no PowerShell dependency today").
 */
export interface TenantHttpKeyProvider {
  /**
   * Resolve tenant keys either from Stamper plan-data (slug given) or
   * env-var fallback (no slug). Throws an error carrying
   * `TenantKeysErrorCode` on failure (`tenant_not_found` for a missing slug
   * file, `degraded` for missing env fallback). SecretRef resolution errors
   * propagate uncaught (fail closed) — source:
   * `resolveTenantKeys()` doc comment, `tenantKeysService.ts:36-49`.
   *
   * AMENDMENT 2026-07-10: carries the caller's `consumer` identity
   * (per-request override of any construction-time binding; see
   * `ConsumerIdentity`'s invariant for missing-consumer handling).
   *
   * RATIFIED AMENDMENT (founder, 2026-07-11): returns `Promise<TenantKeys>`.
   * The original synchronous signature (verbatim from the muster-api source
   * port) could not be implemented by any HTTP transport, so the M6 service
   * client shipped an async mirror (docs/M6-RECORD.md deviation 1); the
   * founder resolved that split by making the RATIFIED signature async —
   * BREAKING for consumers (0.4.0), coordinated with the muster-api call
   * sites in the same change. The in-process implementation still does no
   * background work; it resolves immediately.
   */
  resolveTenantKeys(slug: string | undefined, consumer?: ConsumerIdentity): Promise<TenantKeys>;
}
