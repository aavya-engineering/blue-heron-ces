// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Connection status + activity read surface.
 *
 * RATIFIED AMENDMENT (founder, 2026-07-10) — G-TENANT-1 addendum item 2,
 * motivated by G-TENANT-M6 (`docs/goals/G-TENANT-M6.md` design requirement
 * 6): a queryable surface for connection status and activity, dimensioned
 * per tenant x engine service x module, with APPEND-ONLY activity entries.
 *
 * Delivery-mode contract: the LIBRARY implementation
 * (`impl/status.ts`'s `InProcessTenantStatus`) may return only its own
 * process's view; M6's stateful service lights up the full cross-process
 * picture behind this SAME interface — consumers wire it once and never
 * rework when flipping to service transport.
 */

import type { ConsumerIdentity } from './consumer.js';
import type { SessionType } from './connection.js';
import type { SessionState } from './session-surface.js';
import type { TenantKind } from './registry.js';

/**
 * One append-only activity ledger entry: who (module), did what (operation),
 * against which tenant, over which engine service, when, and how it ended.
 * Entries are immutable once recorded — the ledger has no update/delete
 * surface (M6 requirement: "activity ledger append-only"; same provenance
 * discipline tenant-stacksim applies to sim traffic).
 */
export interface TenantActivityEntry {
  /** When the request was recorded (own-process clock in library mode). */
  at: Date;

  /**
   * Caller identity carried by the request, or `null` when the request
   * arrived without one (library mode logs and records `null`; service mode
   * rejects such requests before they would ever be recorded — see
   * `ConsumerIdentity`'s invariant).
   */
  consumer: ConsumerIdentity | null;

  /** Request-surface operation name, e.g. `'execute'`, `'ensureConnected'`, `'resolveTenantKeys'`, `'getSimLaunchEnv'`. */
  operation: string;

  /** Tenant the request targeted, when the surface knows it (session factories are constructed per tenant; token requests carry a slug). */
  tenantSlug?: string;

  /** Engine service (session type) dimension — absent for non-session requests such as HTTP token resolution. */
  sessionType?: SessionType;

  /** How the request ended. */
  outcome: 'ok' | 'error';

  /** Optional short detail (e.g. truncated command text or error message). Never raw credential material. */
  detail?: string;
}

/** Recorder-side input: everything but the timestamp, which the ledger stamps on append. */
export type TenantActivityInput = Omit<TenantActivityEntry, 'at'>;

/**
 * Write half of the surface — what the request-carrying implementations
 * (`PersistentSessionFactory`, `PlanDataTenantHttpKeyProvider`,
 * `StacksimEnvironment`) call to append an entry. Append-only by
 * construction: this is the ONLY mutation the surface exposes.
 */
export interface TenantActivityRecorder {
  recordActivity(entry: TenantActivityInput): void;
}

/** Optional filter for `TenantStatusSurface.getActivity()` — each present field must match exactly. */
export interface TenantActivityFilter {
  /** Match `consumer.module` (entries with `consumer: null` never match a module filter). */
  module?: string;
  sessionType?: SessionType;
  tenantSlug?: string;
}

/**
 * One tenant's connection status row: the tenant, its kind, and the
 * per-engine-service session states (the engine-service dimension; the
 * module dimension lives in the activity ledger).
 */
export interface TenantConnectionStatusEntry {
  /** Tenant slug, when known to the reporting source. */
  tenantSlug?: string;

  /** Sim/live discriminator, when known to the reporting source. */
  kind?: TenantKind;

  /** Per engine service: connected-ness, connectedAt, lastUsedAt, token expiry. */
  sessions: SessionState[];

  /** Timestamp of the most recent activity entry touching this tenant, or `null` if none recorded. */
  lastActivityAt: Date | null;
}

/**
 * Read surface for connection status and activity.
 *
 * Library mode: own-process view only (whatever this process's surfaces
 * recorded/registered). Service mode (M6): the daemon's full picture —
 * every module's connections and activity — behind this same interface.
 * Both methods are async so the service-transport implementation can be a
 * drop-in (the in-process one resolves immediately).
 */
export interface TenantStatusSurface {
  /** Connection status per tenant x engine service (see `TenantConnectionStatusEntry`). */
  getConnectionStatus(): Promise<TenantConnectionStatusEntry[]>;

  /**
   * The append-only activity ledger, oldest first, optionally filtered.
   * Returned entries are snapshots — mutating the returned array (or its
   * entries) must not affect the ledger.
   */
  getActivity(filter?: TenantActivityFilter): Promise<TenantActivityEntry[]>;
}
