// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Auth-strategy interface (strategy pattern), design §2.3.
 *
 * M0 — interface definition only. Grounded strategies observed across the
 * four researched repos (Stamper, ces-eo, muster-api, tenant-stacksim);
 * strategies not grounded in current code (e.g. device-code) are explicitly
 * NOT modeled here per design §2.3 ("If the founder wants device-code as a
 * strategy, it is new scope, not extracted from existing code").
 */

import type { SessionType } from './connection.js';

/**
 * Discriminator for the auth families actually observed. `'cert'` is the
 * only mechanism `SessionManager`/ces-eo's `SessionManager` use
 * (`ces-stamper/src/core/SessionManager.ts:403-427`, `-CertificateThumbprint`
 * on every `Connect-*` cmdlet). `'client-secret'` and `'bearer'` are
 * muster-api-only (design §2.3). `'sim'` is StacksimMode's env-mutation
 * non-auth (design §2.3, "the closest existing analog; it doesn't
 * authenticate at all").
 */
export type AuthStrategyKind = 'cert' | 'client-secret' | 'bearer' | 'sim';

/**
 * Cert app-only strategy. Source:
 * `ces-stamper/src/core/SessionManager.ts:403-427`
 * (`buildConnectCommand()` — every case passes
 * `-CertificateThumbprint "${ct}"`). Only `certThumbprint` is consulted;
 * `certPath` (`ces-shared/src/config/TenantConfig.ts:19`, from
 * `auth.cert_path`) is present in the schema but not read by
 * `SessionManager` itself — cert lookup is delegated to each PowerShell
 * module's own `CurrentUser\My` cert-store resolution (doc comment,
 * `SessionManager.ts` ~418-423).
 */
export interface CertAuthStrategy {
  kind: 'cert';
  tenantId: string;
  appId: string;
  certThumbprint: string;
  /** Present in the schema, not consumed by `SessionManager` today — see interface doc above. */
  certPath?: string;
}

/**
 * Client-secret / OAuth strategy, muster-api only. Source:
 * `ces-muster/muster-api/src/services/consentService.ts:58-94` — an
 * authorization-code exchange against
 * `login.microsoftonline.us/<tenant>/oauth2/v2.0/token` using
 * `client_secret`. Note (design §2.3): this is a DIFFERENT auth family from
 * cert-based despite `tenantKeysService.ts` also loading `certThumbprint`
 * for the same tenant record — that field is loaded but never consumed for
 * token minting in muster-api today (explicit code comments,
 * `tenantKeysService.ts:3-7`, `harvest.ts:94,113`: "cert-assertion token
 * minting not implemented in muster-api").
 */
export interface ClientSecretAuthStrategy {
  kind: 'client-secret';
  tenantId: string;
  /** `client_secret` sourced from `GRAPH_CLIENT_SECRET` env var at request time — never persisted to tenant JSON (design §2.3). */
  clientSecretEnvVar: string;
  tokenEndpoint: string;
}

/**
 * Bearer passthrough, muster-api only. Source:
 * `ces-muster/muster-api/src/routes/harvest.ts:154-193` —
 * `POST /harvest/run` accepts an already-minted `access_token` directly from
 * the caller, bypassing tenant resolution for auth entirely (design §2.3).
 */
export interface BearerPassthroughAuthStrategy {
  kind: 'bearer';
  accessToken: string;
}

/**
 * Sim non-auth strategy. Source:
 * `ces-stamper/src/core/StacksimMode.ts:103-131`
 * (`enableStacksimMode()`) — does not authenticate at all; it mutates
 * `process.env.PSModulePath` / `Path` / `STACKSIM_SERVER_URL` before the
 * first `SessionManager` spawn so cmdlets resolve against fake same-named
 * modules instead of reaching real Microsoft endpoints (design §2.3, §2.4).
 */
export interface SimAuthStrategy {
  kind: 'sim';
  serverUrl: string;
}

/** Union of all grounded auth strategies. No device-code member — not found anywhere in the researched repos (design §2.3). */
export type AuthStrategy =
  | CertAuthStrategy
  | ClientSecretAuthStrategy
  | BearerPassthroughAuthStrategy
  | SimAuthStrategy;

/**
 * Strategy-pattern contract: given a session type and an auth strategy,
 * produce whatever the client surface needs to authenticate. Modeled from
 * the shape of `SessionManager.buildConnectCommand()`
 * (`ces-stamper/src/core/SessionManager.ts:392-432`, returns a PowerShell
 * command string per session type) generalized so the HTTP surface's
 * analogous `tenantKeysService.resolveTenantKeys()`
 * (`ces-muster/muster-api/src/services/tenantKeysService.ts:50-107`, returns
 * a `TenantKeys` object) can implement the same interface. The concrete
 * per-surface return shape is defined by each client surface
 * (`session-surface.ts`, `http-surface.ts`), not here — this interface only
 * fixes the input contract every strategy implementation must accept.
 */
export interface AuthStrategyResolver<TResult> {
  /**
   * Resolve credentials-by-reference (and, for the PowerShell surface, a
   * connect command) for one session type under the given strategy. Must
   * never resolve to raw secret material (design §2.3, "Store credential
   * references only... nowhere in the researched TenantConfig schema or
   * config loaders does a raw secret get persisted to the tenant JSON
   * files").
   */
  resolve(sessionType: SessionType, strategy: AuthStrategy): TResult;
}
