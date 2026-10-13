// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * The M6 stateful tenant service daemon (v1: AUTH-STATE-ONLY, founder
 * resolution 2026-07-11). Wraps the M1 LIBRARY implementations -- it does
 * not fork them (goal precondition: "the service wraps it, not forks it"):
 * registry reads/lifecycle go through `FileTenantRegistry`, token resolution
 * through `PlanDataTenantHttpKeyProvider`, launch-context through
 * `StacksimEnvironment`, and the activity ledger IS an
 * `InProcessTenantStatus` -- which in this process is the full cross-module
 * picture, because modules report into it over HTTP.
 *
 * Security posture (goal design requirement 5):
 * - binds 127.0.0.1 ONLY; the listen host is not configurable.
 * - No credential material in status/activity/registry responses:
 *   `evidenceStorage` is stripped from wire records, auth state is
 *   summarized with `holdsToken: boolean`. The single handover path is
 *   `POST /api/auth/claim`.
 * - Activity ledger is append-only: POST is the only mutation; PUT/PATCH/
 *   DELETE on /api/activity answer 405 `append_only`.
 * - Service-mode invariant (`consumer.ts`): mutating/connection-class
 *   requests without a `consumer: { module, purpose }` are REJECTED (400
 *   `consumer_required`), never silently logged like library mode.
 *
 * Zero new dependencies: plain `node:http`. No `child_process` import.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { ConsumerIdentity } from '../consumer.js';
import type { SessionType } from '../connection.js';
import type { TenantKind, TenantRegistryLifecycle, TenantRegistryRecord } from '../registry.js';
import type { TenantActivityFilter } from '../status-surface.js';

import { FileTenantRegistry, type FileTenantRegistryOptions } from '../impl/registry.js';
import {
  PlanDataTenantHttpKeyProvider,
  TenantKeysError,
  type PlanDataTenantHttpKeyProviderOptions,
} from '../impl/http-provider.js';
import { StacksimEnvironment, type StacksimEnvironmentOptions } from '../impl/stacksim.js';
import { InProcessTenantStatus } from '../impl/status.js';

import { AuthStateStore } from './auth-state.js';
import { renderStatusHtml } from './status-html.js';
import {
  TENANT_SERVICE_MODE,
  type ServiceHealthPayload,
  type ServiceStatusPayload,
  type ServiceStatusTenantRow,
  type TenantModuleActivitySummary,
  type WireActivityEntry,
  type WireError,
} from './protocol.js';

const SESSION_TYPES: readonly SessionType[] = ['graph', 'exchange', 'purview', 'azure', 'sharepoint', 'teams'];
const MAX_BODY_BYTES = 1024 * 1024;
const RECENT_ACTIVITY_LIMIT = 100;

/** Launch-context provider shape the daemon proxies (amended signature). */
interface LaunchContextLike {
  getSimLaunchEnv(tenantSlug: string, kind: TenantKind, consumer?: ConsumerIdentity): Promise<unknown>;
}

export interface TenantServiceDaemonOptions {
  /** Port to bind on 127.0.0.1. Default `DEFAULT_TENANT_SERVICE_PORT`; pass 0 for an ephemeral port (tests). */
  port?: number;
  /** Environment for the wrapped library surfaces. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Wrapped registry instance. Default: `new FileTenantRegistry({ env, ...registryOptions })`. */
  registry?: TenantRegistryLifecycle;
  registryOptions?: FileTenantRegistryOptions;
  /**
   * Construction options for the wrapped key provider / launch-context
   * provider. Options (not instances) so the daemon can wire its OWN
   * activity ledger and registry into them -- that wiring is what makes the
   * daemon's ledger the cross-module picture.
   */
  keysOptions?: Omit<PlanDataTenantHttpKeyProviderOptions, 'activity' | 'consumer'>;
  launchOptions?: Omit<StacksimEnvironmentOptions, 'activity' | 'consumer' | 'registry'>;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class TenantServiceDaemon {
  readonly ledger: InProcessTenantStatus;
  private readonly authStore = new AuthStateStore();
  private readonly registry: TenantRegistryLifecycle;
  private readonly keys: PlanDataTenantHttpKeyProvider;
  private readonly launch: LaunchContextLike;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly port: number;
  private server: Server | undefined;
  private startedAt = new Date();

  constructor(options: TenantServiceDaemonOptions = {}) {
    const env = options.env ?? process.env;
    this.logger = options.logger ?? console;
    this.port = options.port ?? 4690;
    this.ledger = new InProcessTenantStatus();
    this.registry = options.registry ?? new FileTenantRegistry({ env, ...options.registryOptions });
    this.keys = new PlanDataTenantHttpKeyProvider({
      env,
      logger: this.logger,
      ...options.keysOptions,
      activity: this.ledger,
    });
    this.launch = new StacksimEnvironment({
      env,
      logger: this.logger,
      ...options.launchOptions,
      registry: this.registry,
      activity: this.ledger,
    });
  }

  /** Bind 127.0.0.1 (only) and start serving. Resolves with the actual port. */
  start(): Promise<number> {
    if (this.server) throw new Error('[TenantServiceDaemon] already started');
    this.startedAt = new Date();
    const server = createServer((req, res) => {
      this.route(req, res).catch((err) => {
        this.logger.error(`[TenantServiceDaemon] unhandled route error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) this.sendJson(res, 500, { error: 'internal error' } satisfies WireError);
        else res.end();
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : this.port;
        this.logger.log(`[TenantServiceDaemon] auth-state-only service listening on http://127.0.0.1:${port} (status: /status)`);
        resolve(port);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  // ---- Routing ----

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = (req.method ?? 'GET').toUpperCase();
    const parts = url.pathname.split('/').filter(Boolean);

    // Human status page + health.
    if (method === 'GET' && url.pathname === '/health') return this.handleHealth(res);
    if (method === 'GET' && url.pathname === '/status') return this.handleStatusHtml(res);

    if (parts[0] !== 'api') return this.sendJson(res, 404, { error: `no such route: ${url.pathname}` });

    switch (parts[1]) {
      case 'status':
        if (method === 'GET') return this.handleStatusJson(res);
        break;
      case 'activity':
        if (method === 'GET') return this.handleActivityGet(url, res);
        if (method === 'POST') return this.handleActivityPost(req, res);
        // Append-only: every other verb is refused loudly.
        return this.sendJson(res, 405, { error: 'the activity ledger is append-only', code: 'append_only' });
      case 'auth':
        if (method === 'POST' && parts[2] === 'register') return this.handleAuthRegister(req, res);
        if (method === 'POST' && parts[2] === 'claim') return this.handleAuthClaim(req, res);
        break;
      case 'keys':
        if (method === 'POST') return this.handleKeys(req, res);
        break;
      case 'launch-env':
        if (method === 'POST') return this.handleLaunchEnv(req, res);
        break;
      case 'tenants':
        if (method === 'GET' && parts.length === 2) return this.handleTenantsList(url, res);
        if (method === 'GET' && parts.length === 3) return this.handleTenantGet(parts[2], res);
        if (method === 'POST' && parts[2] === 'sim' && parts.length === 3) return this.handleSimCreate(req, res);
        if (method === 'DELETE' && parts[2] === 'sim' && parts.length === 4) return this.handleSimTeardown(parts[3], url, res);
        break;
    }
    return this.sendJson(res, 404, { error: `no such route: ${method} ${url.pathname}` });
  }

  // ---- Handlers ----

  private handleHealth(res: ServerResponse): void {
    const body: ServiceHealthPayload = { ok: true, mode: TENANT_SERVICE_MODE, startedAt: this.startedAt.toISOString() };
    this.sendJson(res, 200, body);
  }

  private async handleStatusJson(res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, await this.buildStatus());
  }

  private async handleStatusHtml(res: ServerResponse): Promise<void> {
    const status = await this.buildStatus();
    const recent = (await this.ledger.getActivity()).slice(-RECENT_ACTIVITY_LIMIT).map(toWireActivity);
    const html = renderStatusHtml(status, recent);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private async handleActivityGet(url: URL, res: ServerResponse): Promise<void> {
    const filter: TenantActivityFilter = {};
    const module = url.searchParams.get('module');
    const tenantSlug = url.searchParams.get('tenantSlug');
    const sessionType = url.searchParams.get('sessionType');
    if (module) filter.module = module;
    if (tenantSlug) filter.tenantSlug = tenantSlug;
    if (sessionType) filter.sessionType = sessionType as SessionType;
    const entries = await this.ledger.getActivity(filter);
    this.sendJson(res, 200, entries.map(toWireActivity));
  }

  private async handleActivityPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    if (typeof body.operation !== 'string' || (body.outcome !== 'ok' && body.outcome !== 'error')) {
      return this.sendJson(res, 400, { error: 'operation (string) and outcome (ok|error) are required' });
    }
    this.ledger.recordActivity({
      consumer,
      operation: body.operation,
      ...(typeof body.tenantSlug === 'string' ? { tenantSlug: body.tenantSlug } : {}),
      ...(typeof body.sessionType === 'string' ? { sessionType: body.sessionType as SessionType } : {}),
      outcome: body.outcome,
      ...(typeof body.detail === 'string' ? { detail: body.detail.substring(0, 500) } : {}),
    });
    this.sendJson(res, 201, { ok: true });
  }

  private async handleAuthRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    const VALID_STRATEGIES = ['cert', 'client-secret', 'bearer', 'sim'];
    if (typeof body.tenantSlug !== 'string' || !VALID_STRATEGIES.includes(body.strategyKind)) {
      return this.sendJson(res, 400, { error: 'tenantSlug and strategyKind (cert|client-secret|bearer|sim) are required' });
    }
    const summary = this.authStore.register(
      {
        tenantSlug: body.tenantSlug,
        strategyKind: body.strategyKind as import('../auth.js').AuthStrategyKind,
        ...(typeof body.sessionType === 'string' ? { sessionType: body.sessionType as SessionType } : {}),
        ...(typeof body.expiresAt === 'string' ? { expiresAt: body.expiresAt } : {}),
        ...(typeof body.bearerToken === 'string' ? { bearerToken: body.bearerToken } : {}),
      },
      consumer,
    );
    this.ledger.recordActivity({
      consumer,
      operation: 'registerAuthState',
      tenantSlug: body.tenantSlug,
      ...(typeof body.sessionType === 'string' ? { sessionType: body.sessionType as SessionType } : {}),
      outcome: 'ok',
      detail: `strategy: ${body.strategyKind}`,
    });
    this.sendJson(res, 201, summary);
  }

  private async handleAuthClaim(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    if (typeof body.tenantSlug !== 'string') {
      return this.sendJson(res, 400, { error: 'tenantSlug is required' });
    }
    const sessionType = typeof body.sessionType === 'string' ? (body.sessionType as SessionType) : undefined;
    const claim = this.authStore.claim(body.tenantSlug, sessionType, consumer);
    this.ledger.recordActivity({
      consumer,
      operation: 'claimAuthState',
      tenantSlug: body.tenantSlug,
      ...(sessionType !== undefined ? { sessionType } : {}),
      outcome: claim ? 'ok' : 'error',
      detail: claim ? `strategy: ${claim.strategyKind}` : 'no_auth_state',
    });
    if (!claim) return this.sendJson(res, 404, { error: `no live auth state for tenant "${body.tenantSlug}"`, code: 'no_auth_state' });
    this.sendJson(res, 200, claim);
  }

  private async handleKeys(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    const slug = typeof body.slug === 'string' ? body.slug : undefined;
    try {
      // The amended library provider records the ledger entry itself.
      const keys = await this.keys.resolveTenantKeys(slug, consumer);
      this.sendJson(res, 200, keys);
    } catch (err) {
      if (err instanceof TenantKeysError) {
        return this.sendJson(res, err.code === 'tenant_not_found' ? 404 : 503, { error: err.message, code: err.code });
      }
      throw err;
    }
  }

  private async handleLaunchEnv(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    if (typeof body.tenantSlug !== 'string' || (body.kind !== 'live' && body.kind !== 'sim')) {
      return this.sendJson(res, 400, { error: 'tenantSlug and kind (live|sim) are required' });
    }
    try {
      // The amended library provider records the ledger entry itself.
      const bundle = await this.launch.getSimLaunchEnv(body.tenantSlug, body.kind, consumer);
      this.sendJson(res, 200, bundle);
    } catch (err) {
      this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err), code: 'launch_env_refused' });
    }
  }

  private async handleTenantsList(url: URL, res: ServerResponse): Promise<void> {
    const kind = url.searchParams.get('kind');
    if (kind !== 'live' && kind !== 'sim') {
      return this.sendJson(res, 400, { error: 'query parameter kind=live|sim is required' });
    }
    const records = await this.registry.listByKind(kind);
    this.sendJson(res, 200, records.map(redactRecord));
  }

  private async handleTenantGet(slug: string, res: ServerResponse): Promise<void> {
    try {
      const record = await this.registry.get(slug);
      if (!record) return this.sendJson(res, 404, { error: `tenant "${slug}" not found`, code: 'tenant_not_found' });
      this.sendJson(res, 200, redactRecord(record));
    } catch (err) {
      this.sendJson(res, 409, { error: err instanceof Error ? err.message : String(err), code: 'registry_error' });
    }
  }

  private async handleSimCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const consumer = this.requireConsumer(body, res);
    if (!consumer) return;
    if (typeof body.slug !== 'string') return this.sendJson(res, 400, { error: 'slug is required' });
    try {
      const record = await this.registry.createEphemeralSimTenant(body.slug, body.seedRef);
      this.ledger.recordActivity({ consumer, operation: 'createEphemeralSimTenant', tenantSlug: body.slug, outcome: 'ok' });
      this.sendJson(res, 201, redactRecord(record));
    } catch (err) {
      this.ledger.recordActivity({
        consumer,
        operation: 'createEphemeralSimTenant',
        tenantSlug: body.slug,
        outcome: 'error',
        detail: (err instanceof Error ? err.message : String(err)).substring(0, 300),
      });
      this.sendJson(res, 409, { error: err instanceof Error ? err.message : String(err), code: 'registry_error' });
    }
  }

  private async handleSimTeardown(slug: string, url: URL, res: ServerResponse): Promise<void> {
    const module = url.searchParams.get('module');
    const purpose = url.searchParams.get('purpose');
    if (!module || !purpose) {
      return this.sendJson(res, 400, {
        error: 'consumer identity required: pass ?module=&purpose= (service mode rejects unattributed requests)',
        code: 'consumer_required',
      });
    }
    const consumer: ConsumerIdentity = { module, purpose };
    try {
      await this.registry.teardownEphemeralSimTenant(slug);
      this.ledger.recordActivity({ consumer, operation: 'teardownEphemeralSimTenant', tenantSlug: slug, outcome: 'ok' });
      res.writeHead(204).end();
    } catch (err) {
      this.ledger.recordActivity({
        consumer,
        operation: 'teardownEphemeralSimTenant',
        tenantSlug: slug,
        outcome: 'error',
        detail: (err instanceof Error ? err.message : String(err)).substring(0, 300),
      });
      this.sendJson(res, 409, { error: err instanceof Error ? err.message : String(err), code: 'registry_error' });
    }
  }

  // ---- Status matrix ----

  private async buildStatus(): Promise<ServiceStatusPayload> {
    const connectionRows = await this.ledger.getConnectionStatus();
    const activity = await this.ledger.getActivity();

    // Row universe: anything the ledger saw + anything holding auth state.
    const slugs = new Set<string>();
    for (const row of connectionRows) if (row.tenantSlug) slugs.add(row.tenantSlug);
    for (const slug of this.authStore.tenantSlugs()) slugs.add(slug);

    const tenants: ServiceStatusTenantRow[] = [];
    for (const slug of [...slugs].sort()) {
      const conn = connectionRows.find((r) => r.tenantSlug === slug);
      let kind: TenantKind | undefined = conn?.kind;
      if (kind === undefined) {
        try {
          kind = (await this.registry.get(slug))?.kind;
        } catch {
          /* ambiguous/mis-stamped registry entries must not break the status page */
        }
      }
      const slugActivity = activity.filter((e) => e.tenantSlug === slug);
      tenants.push({
        tenantSlug: slug,
        ...(kind !== undefined ? { kind } : {}),
        sessions: (conn?.sessions ?? []).map((s) => ({
          type: s.type,
          connected: s.connected,
          connectedAt: s.connectedAt?.toISOString() ?? null,
          lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
          tokenExpiresAt: s.tokenExpiresAt?.toISOString() ?? null,
        })),
        lastActivityAt: slugActivity.length ? slugActivity[slugActivity.length - 1].at.toISOString() : null,
        authState: this.authStore.list(slug),
        modules: summarizeModules(slugActivity),
      });
    }

    return { mode: TENANT_SERVICE_MODE, startedAt: this.startedAt.toISOString(), tenants, activitySource: 'self-reported' };
  }

  // ---- Plumbing ----

  /** Service-mode invariant: reject requests without `consumer: { module, purpose }`. */
  private requireConsumer(body: Record<string, any>, res: ServerResponse): ConsumerIdentity | undefined {
    const c = body.consumer;
    if (c && typeof c.module === 'string' && c.module.length > 0 && typeof c.purpose === 'string' && c.purpose.length > 0) {
      return { module: c.module, purpose: c.purpose };
    }
    this.sendJson(res, 400, {
      error: 'consumer identity { module, purpose } is required (service mode rejects unattributed requests -- ratified amendment 2026-07-10)',
      code: 'consumer_required',
    });
    return undefined;
  }

  private readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, any> | undefined> {
    return new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          this.sendJson(res, 413, { error: 'request body too large' });
          req.destroy();
          resolve(undefined);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.headersSent) return resolve(undefined);
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          this.sendJson(res, 400, { error: 'invalid JSON body' });
          resolve(undefined);
        }
      });
      req.on('error', () => resolve(undefined));
    });
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
}

/**
 * Wire view of a registry record. `evidenceStorage` is STRIPPED: it can
 * carry resolved secret material (account_key) and is outside TenantManager
 * scope anyway (design 3 / registry.ts field doc) -- it never crosses the
 * service boundary.
 */
function redactRecord(record: TenantRegistryRecord): Omit<TenantRegistryRecord, 'evidenceStorage'> {
  const { evidenceStorage: _evidenceStorage, ...rest } = record;
  return rest;
}

function toWireActivity(e: { at: Date; consumer: ConsumerIdentity | null; operation: string; tenantSlug?: string; sessionType?: SessionType; outcome: 'ok' | 'error'; detail?: string }): WireActivityEntry {
  return {
    at: e.at.toISOString(),
    consumer: e.consumer,
    operation: e.operation,
    ...(e.tenantSlug !== undefined ? { tenantSlug: e.tenantSlug } : {}),
    ...(e.sessionType !== undefined ? { sessionType: e.sessionType } : {}),
    outcome: e.outcome,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
  };
}

function summarizeModules(entries: Array<{ consumer: ConsumerIdentity | null; operation: string; at: Date }>): TenantModuleActivitySummary[] {
  const byModule = new Map<string, TenantModuleActivitySummary>();
  for (const e of entries) {
    if (!e.consumer) continue;
    const existing = byModule.get(e.consumer.module);
    if (existing) {
      existing.operations++;
      existing.lastAt = e.at.toISOString();
      existing.lastOperation = e.operation;
    } else {
      byModule.set(e.consumer.module, {
        module: e.consumer.module,
        operations: 1,
        lastAt: e.at.toISOString(),
        lastOperation: e.operation,
      });
    }
  }
  return [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module));
}
