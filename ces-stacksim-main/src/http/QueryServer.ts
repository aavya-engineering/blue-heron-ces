// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolverTable } from '../resolvers/ResolverTable.js';
import type { Ledger } from '../ledger/Ledger.js';
import type { LedgerQuery } from '../ledger/LedgerTypes.js';
import type { EvidenceQuery, EvidenceQueryFilter } from '../evidence/EvidenceQuery.js';
import { FaultInjector, faultHttpResponse, validateFaultRules, type FaultCall } from './FaultInjector.js';
import { buildInspectorData, INSPECTOR_HTML, type InspectorTenantInfo } from './inspector.js';
import type { ObjectStore } from '../store/ObjectStore.js';

export interface ResolveCmdletRequestBody {
  kind: 'cmdlet';
  cmdlet: string;
  args?: unknown;
}

export interface ResolveUriRequestBody {
  kind: 'uri';
  method: string;
  uri: string;
  /** M4: PATCH/POST body (Invoke-MgGraphRequest -Body), forwarded to ResolverTable.resolveUri(). */
  body?: unknown;
}

export type ResolveRequestBody = ResolveCmdletRequestBody | ResolveUriRequestBody;

export interface QueryServerOptions {
  resolverTable: ResolverTable;
  /** backlog-S5: deterministic fault injection consulted before every /resolve and Graph-facade dispatch. Optional. */
  faultInjector?: FaultInjector;
  /** Inspector (2026-07-11): read-only visual surface at GET /. Both optional — headless callers unaffected. */
  store?: ObjectStore;
  tenantInfo?: InspectorTenantInfo;
  /** M5: backs the /ledger route. Optional so M2-M4 call sites/tests are unaffected. */
  ledger?: Ledger;
  /** M5: backs the /evidence route. Optional so M2-M4 call sites/tests are unaffected. */
  evidenceQuery?: EvidenceQuery;
}

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void | Promise<void>;

/**
 * HTTP surface for the sim's single-writer server process (Core Design (f)
 * — `stacksim serve` is the sole owner of store.json/ledger.jsonl; all other
 * access is an HTTP client of this server).
 *
 * `/resolve` (M2) is used by the generated fake PowerShell modules' wrapper
 * functions (Core Design (d)). `/ledger` and `/evidence` (M5) are HTTP
 * query surfaces for `stacksim query-ledger`/`stacksim query-evidence`
 * (Core Design (f): those CLI commands are HTTP clients of this server,
 * never direct store.json/ledger.jsonl readers) — extending this class
 * rather than replacing it, as designed at M2.
 */
export class QueryServer {
  private server: http.Server | undefined;
  private readonly routes = new Map<string, RouteHandler>();

  constructor(private readonly opts: QueryServerOptions) {
    this.routes.set('POST /resolve', (req, res, body) => this.handleResolve(res, body));
    this.routes.set('POST /ledger', (req, res, body) => this.handleLedger(res, body));
    this.routes.set('POST /evidence', (req, res, body) => this.handleEvidence(res, body));
    // backlog-S5: runtime fault-table admin route (body: FaultRule[]; [] clears).
    // Underscore prefix keeps it out of the Graph/OAuth path namespaces.
    this.routes.set('POST /_faults', (req, res, body) => this.handleSetFaults(res, body));
    // Inspector (read-only visual surface).
    this.routes.set('GET /', (req, res) => this.handleInspectorPage(res));
    this.routes.set('GET /_inspector', (req, res) => this.handleInspectorPage(res));
    this.routes.set('GET /_inspector/data', (req, res) => this.handleInspectorData(res));
  }

  private handleInspectorPage(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INSPECTOR_HTML);
  }

  private async handleInspectorData(res: http.ServerResponse): Promise<void> {
    try {
      const data = await buildInspectorData({
        store: this.opts.store,
        ledger: this.opts.ledger,
        faultInjector: this.opts.faultInjector,
        tenantInfo: this.opts.tenantInfo,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  /** backlog-S5: consult the fault table; if a directive fires, answer with the fault and return true. */
  private applyFault(res: http.ServerResponse, call: FaultCall): boolean {
    const directive = this.opts.faultInjector?.check(call);
    if (!directive) return false;
    const fault = faultHttpResponse(directive);
    res.writeHead(fault.status, fault.headers);
    res.end(fault.body);
    return true;
  }

  private handleSetFaults(res: http.ServerResponse, body: string): void {
    try {
      if (!this.opts.faultInjector) {
        throw new Error('QueryServer: this server was started without a fault injector');
      }
      const rules = validateFaultRules(JSON.parse(body || '[]'));
      this.opts.faultInjector.setRules(rules);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rules }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  /** Starts listening; returns the actual bound port (useful with port 0 in tests). */
  async start(port = 0, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server = server;
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address() as AddressInfo;
        resolve(address.port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const key = `${req.method} ${req.url}`;
    let handler = this.routes.get(key);

    // G-STACKSIM-3: Graph REST facade. Real Graph REST clients (scre-muster's
    // harvest realGraphClient among them) speak `GET {GRAPH_BASE_URL}{path}`,
    // not the sim's POST /resolve protocol. Every /v1.0|/beta URI already
    // resolves through ResolverTable.resolveUri (same patterns the fake
    // Invoke-MgGraphRequest uses), so this route only adapts the transport:
    // the response is the raw Graph-shaped payload (OData `{value:[...]}`
    // for envelope entries), NOT the /resolve `{data}` wrapper. Bearer
    // tokens are ignored — the sim has no auth surface (PLAN.md Out of Scope).
    const urlPath = (req.url ?? '').split('?')[0];
    const method = req.method ?? '';
    if (
      !handler &&
      (urlPath.startsWith('/v1.0/') || urlPath.startsWith('/beta/')) &&
      ['GET', 'POST', 'PATCH', 'DELETE'].includes(method)
    ) {
      handler = (_req, r, body) => this.handleGraphRest(r, method, urlPath, body);
    }

    // 2026-07-10 (auth-surface scope change, recorded in the session log):
    // fake OAuth2 token endpoint, same path shape as
    // login.microsoftonline.us — POST /{tenantId}/oauth2/v2.0/token. Real
    // clients that authenticate before calling Graph (scre-muster's
    // consentService.exchangeCode above all) can point their login base at
    // the sim and run unmodified. Every grant type/credential is accepted
    // without validation — the sim still has no real auth: this endpoint
    // exists so real token-acquisition CODE PATHS execute, not to test
    // authentication itself. The issued token is deterministic and is NOT
    // checked by any other route (Bearer stays ignored).
    const tokenMatch = urlPath.match(/^\/([^/]+)\/oauth2\/v2\.0\/token$/);
    if (!handler && method === 'POST' && tokenMatch) {
      const tenantId = tokenMatch[1];
      handler = (_req, r, body) => this.handleOAuthToken(r, tenantId, body);
    }

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `QueryServer: no route for ${key}` }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      void handler(req, res, body);
    });
  }

  /** Fake OAuth2 client-credentials/authorization-code token endpoint (see handleRequest comment). */
  private handleOAuthToken(res: http.ServerResponse, tenantId: string, body: string): void {
    const form = new URLSearchParams(body);
    const grantType = form.get('grant_type') ?? 'client_credentials';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        token_type: 'Bearer',
        expires_in: 3599,
        access_token: `sim-access-token-${tenantId}`,
        // Echoed for caller visibility only — nothing validates these.
        scope: form.get('scope') ?? '',
        sim_grant_type: grantType,
      }),
    );
  }

  /** G-STACKSIM-3: transport adapter — Graph REST verb+path onto resolveUri. */
  private async handleGraphRest(
    res: http.ServerResponse,
    method: string,
    urlPath: string,
    body: string,
  ): Promise<void> {
    try {
      // backlog-S5: fault check before resolution.
      if (this.applyFault(res, { uri: urlPath })) return;
      const parsedBody = body ? (JSON.parse(body) as unknown) : undefined;
      const data = await this.opts.resolverTable.resolveUri(method, urlPath, parsedBody);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data ?? null));
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes('StackShapeGate')
        ? 403
        : message.includes('no resolver registered') || message.includes('Request_ResourceNotFound')
          ? 404
          : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async handleResolve(res: http.ServerResponse, body: string): Promise<void> {
    try {
      const parsed = JSON.parse(body || '{}') as Partial<ResolveRequestBody>;
      // backlog-S5: fault check before resolution — cmdlet calls match by
      // name, uri calls by normalized path prefix.
      const faultCall: FaultCall =
        parsed.kind === 'cmdlet' ? { cmdlet: parsed.cmdlet } : { uri: (parsed as Partial<ResolveUriRequestBody>).uri };
      if (this.applyFault(res, faultCall)) return;
      const data = dedupeCaseKeys(await this.dispatchResolve(parsed));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes('StackShapeGate')
        ? 403
        : message.includes('no resolver registered') || message.includes('Request_ResourceNotFound')
          ? 404
          : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async dispatchResolve(body: Partial<ResolveRequestBody>): Promise<unknown> {
    if (body.kind === 'cmdlet') {
      if (!body.cmdlet) {
        throw new Error('QueryServer: /resolve cmdlet request missing "cmdlet"');
      }
      return this.opts.resolverTable.resolveCmdlet(body.cmdlet, body.args);
    }
    if (body.kind === 'uri') {
      if (!body.method || !body.uri) {
        throw new Error('QueryServer: /resolve uri request missing "method"/"uri"');
      }
      return this.opts.resolverTable.resolveUri(body.method, body.uri, body.body);
    }
    throw new Error(`QueryServer: unknown /resolve request kind "${String((body as { kind?: unknown }).kind)}"`);
  }

  /** M5: HTTP surface for `stacksim query-ledger` (Core Design (a)/(f)). */
  private async handleLedger(res: http.ServerResponse, body: string): Promise<void> {
    try {
      if (!this.opts.ledger) {
        throw new Error('QueryServer: /ledger route requires a ledger to be configured');
      }
      const filter = JSON.parse(body || '{}') as LedgerQuery;
      const data = await this.opts.ledger.query(filter);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }

  /** M5: HTTP surface for `stacksim query-evidence` (Core Design (c)/(f)). */
  private async handleEvidence(res: http.ServerResponse, body: string): Promise<void> {
    try {
      if (!this.opts.evidenceQuery) {
        throw new Error('QueryServer: /evidence route requires an evidenceQuery to be configured');
      }
      const filter = JSON.parse(body || '{}') as EvidenceQueryFilter;
      const data = await this.opts.evidenceQuery.query(filter);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }
}

/**
 * SIMFIX FIX-S2: Windows PowerShell 5.1's ConvertFrom-Json (used by
 * Invoke-RestMethod in every shim) REJECTS an object whose keys differ only
 * by case - the whole response then deserializes to nothing. The store keys
 * every object by `id`, while Az objects carry their ARM `Id`; a real Az
 * object has only `Id`. For each object with case-duplicate keys, keep the
 * PascalCase key (the SDK's own casing) and drop the other, recursively.
 */
export function dedupeCaseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dedupeCaseKeys);
  if (!v || typeof v !== 'object') return v;
  const src = v as Record<string, unknown>;
  const byLc = new Map<string, string>();
  for (const k of Object.keys(src)) {
    const lc = k.toLowerCase();
    const prev = byLc.get(lc);
    if (prev === undefined || (/^[A-Z]/.test(k) && !/^[A-Z]/.test(prev))) byLc.set(lc, k);
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) if (byLc.get(k.toLowerCase()) === k) out[k] = dedupeCaseKeys(src[k]);
  return out;
}
