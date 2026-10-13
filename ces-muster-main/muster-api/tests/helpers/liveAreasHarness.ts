// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveAreasHarness.ts — FC-MU-5 test helper: the live consent + discovery
// routes wired to FAKES only (device-code transport, JWKS keys, ARM GET, area
// sessions). Nothing here can reach a Microsoft endpoint: every production
// transport/session refuses under vitest, and each seam below is injected.
import http from 'node:http';
import express from 'express';
import { createLiveRouter } from '../../src/routes/live.js';
import { createDiscoveryRouter } from '../../src/routes/discovery.js';
import { mintToken } from '../../src/lib/jwt.js';
import {
  LiveConsentService,
  prismaLiveAccessStore,
  type ArmGet,
  type DeviceCodeTransport,
  type LiveArea,
  type LiveGate,
} from '../../src/services/liveAccess.js';
import type { DiscoverySession, RegistryGetEntry } from '../../src/services/discoveryService.js';
import type { MockDb } from './mockDb.js';
import { fakeJwks, makeSigningKey, signIdToken } from './idTokenKeys.js';

export const SAAS = 't-live';
export const TENANT = '11111111-2222-3333-4444-555555555555';
export const SUBSCRIPTION = '99999999-8888-7777-6666-555555555555';
export const CLIENT_ID = 'public-client-fake';
export const ADMIN = 'it-admin@customer.example';
/** The Entra Global Reader role template id (as carried in the `wids` claim). */
export const GLOBAL_READER_WID = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451';
/** Global Administrator template id — a write role, NOT Global Reader. */
export const GLOBAL_ADMIN_WID = '62e90394-69f5-4237-9190-012177145e10';
export const OPERATOR = mintToken({ sub: 'op-1', tenant_id: SAAS, party_id: null, role: 'bhd_operator' });
export const PRIME = mintToken({ sub: 'prime-1', tenant_id: SAAS, party_id: null, role: 'prime' });
const KEY = makeSigningKey('kid-fcmu5');
export const tokenFor = (a: LiveArea) => `fake-${a}-token`;

export interface HarnessOptions {
  /** Extra ID-token claims per area (default: wids = [Global Reader]). */
  claims?: (area: LiveArea) => Record<string, unknown>;
  /** The fake ARM GET (default: Reader-shaped `*\/read` permissions). */
  armGet?: ArmGet;
  entries?: RegistryGetEntry[];
}

export interface SessionCall {
  area: string;
  engine: string;
  command: string;
  token: string;
  graphToken?: string;
}

export interface Harness {
  base: string;
  gate: LiveGate;
  server: http.Server;
  transportCalls: Array<{ url: string; form: Record<string, string> }>;
  armCalls: Array<{ url: string; token: string }>;
  sessionCalls: SessionCall[];
  setNextArea(a: LiveArea): void;
  call(method: string, url: string, token: string, body?: unknown): Promise<{ status: number; body: Record<string, any> }>;
}

/** Reader-shaped subscription permissions (the Azure `Reader` role's effective actions). */
export const READER_PERMISSIONS = { value: [{ actions: ['*/read'], notActions: [], dataActions: [], notDataActions: [] }] };

export function defaultArmGet(armCalls: Harness['armCalls'], json: unknown = READER_PERMISSIONS, status = 200): ArmGet {
  return async (url, token) => {
    armCalls.push({ url, token });
    return { status, json };
  };
}

export function buildHarness(db: MockDb, workRoot: string, opts: HarnessOptions = {}): Harness {
  const transportCalls: Harness['transportCalls'] = [];
  const armCalls: Harness['armCalls'] = [];
  const sessionCalls: SessionCall[] = [];
  let nextArea: LiveArea = 'graph';
  const areaByCode = new Map<string, LiveArea>();
  const askedByCode = new Map<string, string>();
  let n = 0;
  const claims = opts.claims ?? (() => ({ wids: [GLOBAL_READER_WID] }));
  const transport: DeviceCodeTransport = async (url, form) => {
    transportCalls.push({ url, form });
    if (url.endsWith('/devicecode')) {
      const code = `dc-${++n}`;
      askedByCode.set(code, form.scope);
      areaByCode.set(code, nextArea);
      return { status: 200, json: { device_code: code, user_code: `UC-${n}`, verification_uri: 'https://example.invalid', expires_in: 900, interval: 5 } };
    }
    const area = areaByCode.get(form.device_code) ?? 'graph';
    return {
      status: 200,
      json: {
        access_token: tokenFor(area),
        expires_in: 3600,
        scope: askedByCode.get(form.device_code) ?? '',
        id_token: signIdToken(KEY, {
          tid: TENANT,
          aud: CLIENT_ID,
          nowSec: Math.floor(Date.now() / 1000),
          preferred_username: ADMIN,
          extra: claims(area),
        }),
      },
    };
  };
  const store = prismaLiveAccessStore(db);
  const gate: LiveGate = {
    store,
    consent: new LiveConsentService(store, {
      clientId: CLIENT_ID,
      transport,
      fetchKeys: fakeJwks([KEY.jwk]).fetchKeys,
      armGet: opts.armGet ?? defaultArmGet(armCalls),
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/live', createLiveRouter(gate));
  app.use(
    '/api/discovery',
    createDiscoveryRouter({
      live: gate,
      workRoot,
      runLiveDeps: {
        loadEntries: () => opts.entries ?? [],
        registryRoot: '/no/registry/for/hermetic/test',
        makeSession: (token: string, ctx): DiscoverySession => ({
          async execute(engine, command) {
            sessionCalls.push({ area: ctx.area, engine, command, token, ...(ctx.graphAccessToken ? { graphToken: ctx.graphAccessToken } : {}) });
            return { stdout: 'Name\nrow', stderr: '', exitCode: 0, durationMs: 1 };
          },
        }),
      },
    })
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    base,
    gate,
    server,
    transportCalls,
    armCalls,
    sessionCalls,
    setNextArea: (a) => (nextArea = a),
    async call(method, url, token, body) {
      const res = await fetch(`${base}${url}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    },
  };
}

/** Start + poll one area's consent; returns the poll outcome and the consent id. */
export async function consentFor(
  h: Harness,
  engagementId: string,
  area: LiveArea,
  extra: Record<string, unknown> = {}
): Promise<{ id: string; start: { status: number; body: Record<string, any> }; poll: Record<string, any> }> {
  h.setNextArea(area);
  const body = { tenant_id: TENANT, area, ...(area === 'azure' ? { subscription_id: SUBSCRIPTION } : {}), ...extra };
  const start = await h.call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, body);
  if (start.status !== 202) return { id: '', start, poll: {} };
  const r = await h.call('GET', `/api/live/consent/${start.body.consent_id}`, PRIME);
  return { id: start.body.consent_id as string, start, poll: r.body };
}

export async function waitJob(h: Harness, id: string): Promise<Record<string, any>> {
  for (let i = 0; i < 200; i++) {
    const r = await h.call('GET', `/api/discovery/run/${id}`, OPERATOR);
    if (r.body.status !== 'running') return r.body;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('job did not finish');
}
