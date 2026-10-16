// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Wire protocol for the M6 stateful tenant service
 * (`docs/goals/G-TENANT-M6.md`). v1 mode is AUTH-STATE-ONLY (founder
 * resolution 2026-07-11): the daemon holds auth state and observability;
 * modules run their own engine worker processes. The daemon serves the SAME
 * ratified TenantManager interfaces over localhost HTTP (design
 * requirement 1); these types are the JSON shapes on the wire (Dates travel
 * as ISO strings and are revived by the client).
 *
 * Security posture (design requirement 5): the service binds 127.0.0.1
 * only; bearer material is handed over ONLY by `POST /api/auth/claim` --
 * status, activity, and registry responses are redacted by construction
 * (`AuthStateSummary.holdsToken` is a boolean, never the token;
 * `evidenceStorage` never leaves the daemon).
 */

import type { AuthStrategyKind } from '../auth.js';
import type { ConsumerIdentity } from '../consumer.js';
import type { SessionType } from '../connection.js';
import type { TenantKind } from '../registry.js';

/**
 * Default port. Deliberately adjacent-but-distinct from tenant-stacksim's
 * 4390 (`SimTenantConfig.ts:6`) -- same local-single-writer family, no
 * collision when both run.
 */
export const DEFAULT_TENANT_SERVICE_PORT = 4690;

/** Env var consumers use to point at a non-default service URL. */
export const TENANT_SERVICE_URL_ENV = 'CES_TENANT_SERVICE_URL';

/** v1 delivery mode marker, reported by /health and /api/status. */
export const TENANT_SERVICE_MODE = 'auth-state-only';

export function defaultTenantServiceUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env[TENANT_SERVICE_URL_ENV] ?? `http://127.0.0.1:${DEFAULT_TENANT_SERVICE_PORT}`;
}

/** Error body every non-2xx JSON response carries. */
export interface WireError {
  error: string;
  /** Machine-readable discriminator, e.g. 'consumer_required', 'tenant_not_found', 'degraded', 'no_auth_state', 'append_only'. */
  code?: string;
}

/** `TenantActivityEntry` on the wire (`at` as ISO string). */
export interface WireActivityEntry {
  at: string;
  consumer: ConsumerIdentity | null;
  operation: string;
  tenantSlug?: string;
  sessionType?: SessionType;
  outcome: 'ok' | 'error';
  detail?: string;
}

/** Body of `POST /api/auth/register` (plus `consumer`). */
export interface AuthStateRegistration {
  tenantSlug: string;
  /** Which grounded auth family this state belongs to (`auth.ts`). */
  strategyKind: AuthStrategyKind;
  /** Engine service the state is scoped to; absent = tenant-wide. */
  sessionType?: SessionType;
  /** ISO timestamp after which the state is no longer claimable. */
  expiresAt?: string;
  /**
   * Raw bearer/token material the daemon HOLDS on behalf of modules
   * (auth-state-only v1: "tokens, certificate context, device-code
   * sessions"). Never echoed by status/activity/registry responses; handed
   * over only via `POST /api/auth/claim`.
   */
  bearerToken?: string;
}

/** Body of a successful `POST /api/auth/claim` -- the ONE credential-handover path. */
export interface AuthStateClaim {
  tenantSlug: string;
  strategyKind: AuthStrategyKind;
  sessionType?: SessionType;
  expiresAt?: string;
  bearerToken?: string;
  registeredBy: ConsumerIdentity;
  registeredAt: string;
}

/** REDACTED auth-state view used by status responses: token presence as a boolean, never the material. */
export interface AuthStateSummary {
  tenantSlug: string;
  strategyKind: AuthStrategyKind;
  sessionType?: SessionType;
  expiresAt?: string;
  registeredBy: ConsumerIdentity;
  registeredAt: string;
  claimCount: number;
  holdsToken: boolean;
}

/** One session-state cell on the wire. */
export interface WireSessionState {
  type: SessionType;
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  tokenExpiresAt: string | null;
}

/** Per-module aggregation for one tenant row (the module dimension of the matrix). */
export interface TenantModuleActivitySummary {
  module: string;
  operations: number;
  lastAt: string;
  lastOperation: string;
}

/** One tenant row of `GET /api/status`: tenant x engine service x module. */
export interface ServiceStatusTenantRow {
  tenantSlug?: string;
  kind?: TenantKind;
  sessions: WireSessionState[];
  lastActivityAt: string | null;
  authState: AuthStateSummary[];
  modules: TenantModuleActivitySummary[];
}

/** Body of `GET /api/status`. */
export interface ServiceStatusPayload {
  mode: typeof TENANT_SERVICE_MODE;
  startedAt: string;
  tenants: ServiceStatusTenantRow[];
  /** v1 honesty marker (goal resolution 2026-07-11): activity is self-reported by modules via the caller-identity amendment, not centrally enforced. */
  activitySource: 'self-reported';
}

/** Body of `GET /health`. */
export interface ServiceHealthPayload {
  ok: true;
  mode: typeof TENANT_SERVICE_MODE;
  startedAt: string;
}
