// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Service-transport client for the M6 daemon. Implements the SAME ratified
 * TenantManager interfaces over localhost HTTP wherever their signatures
 * allow a drop-in (goal design requirement 1):
 *
 * - `TenantRegistryLifecycle`  -- exact (all methods async).
 * - `TenantLaunchContextProvider` -- exact (async, amended signature).
 * - `TenantStatusSurface` + `TenantActivityRecorder` -- exact; here the
 *   daemon's CROSS-PROCESS picture lights up behind the same interface.
 * - `TenantHttpKeyProvider` -- exact since the 2026-07-11 ratified
 *   amendment made `resolveTenantKeys` Promise-based (it began here as an
 *   async mirror of the then-synchronous signature; the founder resolved
 *   the split in favor of async -- see docs/M6-RECORD.md deviation 1
 *   resolution). Includes `TenantKeysError` rehydration from wire codes.
 *
 * Consumer identity is REQUIRED at construction: the daemon rejects
 * unattributed requests (service-mode invariant, `consumer.ts`).
 *
 * No `child_process` import -- safe for any consumer, any platform.
 */

import type { ConsumerIdentity } from '../consumer.js';
import type { SessionType } from '../connection.js';
import type { TenantHttpKeyProvider, TenantKeys } from '../http-surface.js';
import type { SimLaunchEnv, TenantLaunchContextProvider } from '../launch-context.js';
import type { TenantKind, TenantRegistryLifecycle, TenantRegistryRecord } from '../registry.js';
import type {
  TenantActivityEntry,
  TenantActivityFilter,
  TenantActivityInput,
  TenantActivityRecorder,
  TenantConnectionStatusEntry,
  TenantStatusSurface,
} from '../status-surface.js';

import { TenantKeysError } from '../impl/http-provider.js';
import {
  defaultTenantServiceUrl,
  type AuthStateClaim,
  type AuthStateRegistration,
  type AuthStateSummary,
  type ServiceStatusPayload,
  type WireActivityEntry,
} from './protocol.js';

export interface TenantServiceClientOptions {
  /** REQUIRED: the daemon rejects requests without it (service-mode invariant). */
  consumer: ConsumerIdentity;
  /** Service base URL. Default: `CES_TENANT_SERVICE_URL` env, else `http://127.0.0.1:4690`. */
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  /** Health-probe timeout. Default 1500 ms -- fast enough that library fallback feels instant when the daemon is down. */
  healthTimeoutMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class TenantServiceClient
  implements
    TenantRegistryLifecycle,
    TenantHttpKeyProvider,
    TenantLaunchContextProvider,
    TenantStatusSurface,
    TenantActivityRecorder
{
  private readonly consumer: ConsumerIdentity;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly healthTimeoutMs: number;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private activityQueue: Promise<void> = Promise.resolve();

  constructor(options: TenantServiceClientOptions) {
    this.consumer = options.consumer;
    this.baseUrl = (options.baseUrl ?? defaultTenantServiceUrl(options.env ?? process.env)).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
    this.logger = options.logger ?? console;
  }

  /** Liveness probe used for transport selection (degrade, never block). */
  async isUp(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
      const res = await this.fetchFn(`${this.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      const body: any = await res.json();
      return body?.ok === true;
    } catch {
      return false;
    }
  }

  // ---- TenantRegistryLifecycle (exact) ----

  async get(slug: string): Promise<TenantRegistryRecord | undefined> {
    const res = await this.request('GET', `/api/tenants/${encodeURIComponent(slug)}`);
    if (res.status === 404) return undefined;
    return (await this.okJson(res)) as TenantRegistryRecord;
  }

  async listByKind(kind: TenantKind): Promise<TenantRegistryRecord[]> {
    const res = await this.request('GET', `/api/tenants?kind=${kind}`);
    return (await this.okJson(res)) as TenantRegistryRecord[];
  }

  async createEphemeralSimTenant(slug: string, seedRef: unknown): Promise<TenantRegistryRecord> {
    const res = await this.request('POST', '/api/tenants/sim', { slug, seedRef, consumer: this.consumer });
    return (await this.okJson(res)) as TenantRegistryRecord;
  }

  async teardownEphemeralSimTenant(slug: string): Promise<void> {
    const query = `module=${encodeURIComponent(this.consumer.module)}&purpose=${encodeURIComponent(this.consumer.purpose)}`;
    const res = await this.request('DELETE', `/api/tenants/sim/${encodeURIComponent(slug)}?${query}`);
    if (res.status !== 204) await this.okJson(res);
  }

  // ---- TenantHttpKeyProvider (exact since the 2026-07-11 async amendment) ----

  async resolveTenantKeys(slug: string | undefined, consumer?: ConsumerIdentity): Promise<TenantKeys> {
    const res = await this.request('POST', '/api/keys', { slug, consumer: consumer ?? this.consumer });
    if (!res.ok) {
      const body = await this.safeErrorBody(res);
      if (body?.code === 'tenant_not_found' || body?.code === 'degraded') {
        throw new TenantKeysError(body.code, body.error);
      }
      throw new Error(body?.error ?? `tenant service error ${res.status}`);
    }
    return (await res.json()) as TenantKeys;
  }

  // ---- TenantLaunchContextProvider (exact) ----

  async getSimLaunchEnv(tenantSlug: string, kind: TenantKind, consumer?: ConsumerIdentity): Promise<SimLaunchEnv> {
    const res = await this.request('POST', '/api/launch-env', { tenantSlug, kind, consumer: consumer ?? this.consumer });
    return (await this.okJson(res)) as SimLaunchEnv;
  }

  // ---- TenantStatusSurface (exact; the daemon's cross-process picture) ----

  async getConnectionStatus(): Promise<TenantConnectionStatusEntry[]> {
    const status = await this.getStatus();
    return status.tenants.map((row) => ({
      ...(row.tenantSlug !== undefined ? { tenantSlug: row.tenantSlug } : {}),
      ...(row.kind !== undefined ? { kind: row.kind } : {}),
      sessions: row.sessions.map((s) => ({
        type: s.type,
        connected: s.connected,
        connectedAt: s.connectedAt ? new Date(s.connectedAt) : null,
        lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt) : null,
        tokenExpiresAt: s.tokenExpiresAt ? new Date(s.tokenExpiresAt) : null,
      })),
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt) : null,
    }));
  }

  async getActivity(filter?: TenantActivityFilter): Promise<TenantActivityEntry[]> {
    const params = new URLSearchParams();
    if (filter?.module) params.set('module', filter.module);
    if (filter?.tenantSlug) params.set('tenantSlug', filter.tenantSlug);
    if (filter?.sessionType) params.set('sessionType', filter.sessionType);
    const qs = params.toString();
    const res = await this.request('GET', `/api/activity${qs ? `?${qs}` : ''}`);
    const wire = (await this.okJson(res)) as WireActivityEntry[];
    return wire.map((e) => ({
      at: new Date(e.at),
      consumer: e.consumer,
      operation: e.operation,
      ...(e.tenantSlug !== undefined ? { tenantSlug: e.tenantSlug } : {}),
      ...(e.sessionType !== undefined ? { sessionType: e.sessionType as SessionType } : {}),
      outcome: e.outcome,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
    }));
  }

  // ---- TenantActivityRecorder (exact; posts are queued fire-and-forget) ----

  recordActivity(entry: TenantActivityInput): void {
    this.activityQueue = this.activityQueue
      .then(async () => {
        const res = await this.request('POST', '/api/activity', { ...entry, consumer: entry.consumer ?? this.consumer });
        if (!res.ok) {
          const body = await this.safeErrorBody(res);
          this.logger.warn(`[TenantServiceClient] activity report rejected: ${body?.error ?? res.status}`);
        }
      })
      .catch((err) => {
        this.logger.warn(`[TenantServiceClient] activity report failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  /** Await all queued `recordActivity` posts (tests / graceful shutdown). */
  flushActivity(): Promise<void> {
    return this.activityQueue;
  }

  // ---- Auth state (the v1 service-only surface) ----

  async registerAuthState(registration: AuthStateRegistration): Promise<AuthStateSummary> {
    const res = await this.request('POST', '/api/auth/register', { ...registration, consumer: this.consumer });
    return (await this.okJson(res)) as AuthStateSummary;
  }

  /** Claim auth state for a tenant; `undefined` when the daemon holds none (caller falls back to its own connect). */
  async claimAuthState(tenantSlug: string, sessionType?: SessionType): Promise<AuthStateClaim | undefined> {
    const res = await this.request('POST', '/api/auth/claim', { tenantSlug, sessionType, consumer: this.consumer });
    if (res.status === 404) return undefined;
    return (await this.okJson(res)) as AuthStateClaim;
  }

  async getStatus(): Promise<ServiceStatusPayload> {
    const res = await this.request('GET', '/api/status');
    return (await this.okJson(res)) as ServiceStatusPayload;
  }

  // ---- Plumbing ----

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  }

  private async okJson(res: Response): Promise<unknown> {
    if (!res.ok) {
      const body = await this.safeErrorBody(res);
      throw new Error(body?.error ?? `tenant service error ${res.status}`);
    }
    return res.json();
  }

  private async safeErrorBody(res: Response): Promise<{ error?: string; code?: string } | undefined> {
    try {
      return (await res.json()) as { error?: string; code?: string };
    } catch {
      return undefined;
    }
  }
}
