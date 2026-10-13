// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU-2 (MU-03 / MU-06 live, founder decision 2026-09-27) acceptance:
//   - flag off → the live path is refused (discovery, harvest, consent start);
//   - flag on + no consent → refused;
//   - flag on + consent (FAKE device-code flow) → reads via the live client
//     abstraction (faked) and the consent is recorded (engagement + readiness
//     record manifest.consent);
//   - scopes are read-only (asked AND granted);
//   - a refused / aborted consent leaves nothing behind;
//   - the sim path is unchanged.
//
// No test here reaches a Microsoft endpoint: the device-code transport, the
// Graph client and the discovery session are all fakes; the production
// defaults are proven to REFUSE under vitest (last describe block).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { createLiveRouter } from '../src/routes/live.js';
import { createDiscoveryRouter } from '../src/routes/discovery.js';
import { createHarvestRouter } from '../src/routes/harvest.js';
import { createApp } from '../src/app.js';
import { mintToken } from '../src/lib/jwt.js';
import { realGraphClient, type GraphClient } from '../src/lib/graphClient.js';
import {
  LIVE_READ_SCOPES,
  LiveConsentService,
  assertReadOnlyScopes,
  fetchTransport,
  isReadOnlyScope,
  prismaLiveAccessStore,
  type DeviceCodeTransport,
  type LiveGate,
} from '../src/services/liveAccess.js';
import { buildLiveGraphSession, readOnlySession, writeCommandReason } from '../src/services/liveDiscoveryRun.js';
import { buildDiscoveryReadinessResult } from '../src/services/discoveryEnvelope.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';
import type { DiscoverySession, RegistryGetEntry } from '../src/services/discoveryService.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import { fakeJwks, makeSigningKey, signIdToken } from './helpers/idTokenKeys.js';

const SAAS_TENANT = 't-live';
const CUSTOMER_TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER_TENANT = '99999999-8888-7777-6666-555555555555';
const OPERATOR = mintToken({ sub: 'op-1', tenant_id: SAAS_TENANT, party_id: null, role: 'bhd_operator' });
const PRIME = mintToken({ sub: 'prime-1', tenant_id: SAAS_TENANT, party_id: null, role: 'prime' });
const FAKE_TOKEN = 'fake-live-access-token';
const ADMIN = 'it-admin@customer.example';

// FC-MU-3 step 4: ID tokens are verified, so the fake flow issues tokens
// signed by a LOCAL key that a fake JWKS fetcher publishes (no network).
const CLIENT_ID = 'public-client-fake';
const SIGNING_KEY = makeSigningKey('kid-live-gate');
function signedIdToken(tid: string): string {
  return signIdToken(SIGNING_KEY, { tid, aud: CLIENT_ID, nowSec: Math.floor(Date.now() / 1000), preferred_username: ADMIN });
}

const GRANTED_SCOPE = [
  'https://graph.microsoft.us/Policy.Read.All',
  'https://graph.microsoft.us/Directory.Read.All',
  'https://graph.microsoft.us/DeviceManagementManagedDevices.Read.All',
  'https://graph.microsoft.us/DeviceManagementConfiguration.Read.All',
  'openid',
  'profile',
].join(' ');

type TokenReply = { status: number; json: Record<string, unknown> };
const PENDING: TokenReply = { status: 400, json: { error: 'authorization_pending' } };
const DECLINED: TokenReply = { status: 400, json: { error: 'authorization_declined' } };
const grantedReply = (over: Record<string, unknown> = {}, tid = CUSTOMER_TENANT): TokenReply => ({
  status: 200,
  json: {
    access_token: FAKE_TOKEN,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: GRANTED_SCOPE,
    id_token: signedIdToken(tid),
    ...over,
  },
});

/** A scripted fake device-code transport: records every call. */
function fakeTransport(tokenReplies: TokenReply[]) {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const transport: DeviceCodeTransport = async (url, form) => {
    calls.push({ url, form });
    if (url.endsWith('/devicecode')) {
      return {
        status: 200,
        json: {
          device_code: 'dc-fake',
          user_code: 'FAKE-CODE',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 900,
          interval: 5,
        },
      };
    }
    const next = tokenReplies.shift() ?? PENDING;
    return next;
  };
  return { transport, calls };
}

// Registry slice for the live walk: a Graph read, a Graph read whose output is
// empty, a non-Graph engine (EXO), a MALICIOUS "get" that is really a write, and
// a manual entry. Every entry carries a set_command sentinel the walk must never run.
const SET_SENTINEL = 'New-MgSentinelWrite -Evil';
const ENTRIES: Array<RegistryGetEntry & { set_command: string }> = [
  { entry_id: 'lv.ca', control_ids: ['AC.L2-3.1.1'], engine: 'mgraph', get_command: 'Get-MgIdentityConditionalAccessPolicy', set_command: SET_SENTINEL },
  { entry_id: 'lv.users', control_ids: ['AC.L2-3.1.5'], engine: 'mgraph', get_command: "(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/users').value", set_command: SET_SENTINEL },
  { entry_id: 'lv.exo', control_ids: ['AU.L2-3.3.1'], engine: 'exchange', get_command: 'Get-AdminAuditLogConfig', set_command: SET_SENTINEL },
  { entry_id: 'lv.evil', control_ids: ['CM.L2-3.4.1'], engine: 'mgraph', get_command: 'Get-MgUser | Remove-MgUser', set_command: SET_SENTINEL },
  { entry_id: 'lv.post', control_ids: ['CM.L2-3.4.2'], engine: 'mgraph', get_command: "Invoke-MgGraphRequest -Method POST -Uri '/v1.0/groups'", set_command: SET_SENTINEL },
  { entry_id: 'lv.manual', control_ids: ['PE.L2-3.10.1'], engine: 'manual_gate', manual_only: true, set_command: SET_SENTINEL },
];

let db: MockDb;
let gate: LiveGate;
let transportCalls: Array<{ url: string; form: Record<string, string> }>;
let tokenReplies: TokenReply[];
let sessionCalls: Array<{ engine: string; command: string; token: string }>;
let graphCalls: Array<{ path: string; token: string }>;
let workRoot: string;
let simRuns: number;
let base: string;
let server: http.Server;
let engagementId: string;

const fakeSessionFactory = (token: string): DiscoverySession => ({
  async execute(engine, command) {
    sessionCalls.push({ engine, command, token });
    return command.startsWith('Get-MgIdentity')
      ? { stdout: 'Id DisplayName State\n1 Require MFA enabled', stderr: '', exitCode: 0, durationMs: 1 }
      : { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
  },
});

const fakeGraphFactory = (token: string): GraphClient => ({
  async get(p: string) {
    graphCalls.push({ path: p, token });
    if (p === '/identity/conditionalAccess/policies') {
      return { value: [{ state: 'enabled', grantControls: { builtInControls: ['mfa'] } }] };
    }
    if (p === '/deviceManagement/managedDevices') return { value: [{ id: 'd1' }] };
    return { value: [] };
  },
});

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function waitJob(jobId: string): Promise<Record<string, any>> {
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', `/api/discovery/run/${jobId}`, OPERATOR);
    if (r.body.status !== 'running') return r.body;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('job did not finish');
}

/** Drive the fake device-code flow to a granted consent; returns the consent id. */
async function grantConsent(): Promise<string> {
  tokenReplies.push(PENDING, grantedReply());
  const started = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
  expect(started.status).toBe(202);
  expect(started.body.user_code).toBe('FAKE-CODE');
  const id = started.body.consent_id as string;
  expect((await call('GET', `/api/live/consent/${id}`, PRIME)).body.status).toBe('pending');
  const done = await call('GET', `/api/live/consent/${id}`, PRIME);
  expect(done.body.status).toBe('granted');
  return id;
}

function engagementRow(): Record<string, any> {
  return db.engagement._records.find((e: any) => e.id === engagementId) as Record<string, any>;
}

beforeEach(async () => {
  db = createMockDb();
  const eng = await db.engagement.create({ data: { tenant_id: SAAS_TENANT, engagement_kind: 'prime_and_subs' } });
  engagementId = eng.id as string;
  tokenReplies = [];
  const fake = fakeTransport(tokenReplies);
  transportCalls = fake.calls;
  sessionCalls = [];
  graphCalls = [];
  simRuns = 0;
  const store = prismaLiveAccessStore(db);
  gate = {
    store,
    consent: new LiveConsentService(store, {
      clientId: CLIENT_ID,
      transport: fake.transport,
      fetchKeys: fakeJwks([SIGNING_KEY.jwk]).fetchKeys,
    }),
  };
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mu2-live-'));
  const app = express();
  app.use(express.json());
  app.use('/api/live', createLiveRouter(gate));
  app.use(
    '/api/discovery',
    createDiscoveryRouter({
      live: gate,
      workRoot,
      runLiveDeps: {
        loadEntries: () => ENTRIES,
        makeSession: fakeSessionFactory,
        registryRoot: '/no/registry/for/hermetic/test',
      },
      run: async () => {
        simRuns++;
        return { ok: false, code: 'sim_unreachable', message: 'sim seam' };
      },
    })
  );
  app.use('/api/harvest', createHarvestRouter(undefined, async () => false, { live: gate, liveClient: fakeGraphFactory }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(() => {
  server.close();
  fs.rmSync(workRoot, { recursive: true, force: true });
});

describe('FC-MU-2 live gate — flag OFF (the default) refuses the live path', () => {
  it('a new engagement is off; discovery, harvest and consent start are all refused', async () => {
    const access = await call('GET', `/api/live/engagements/${engagementId}/access`, PRIME);
    expect(access.body.live_access_enabled).toBe(false);

    const disc = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: 'x' });
    expect(disc).toEqual({ status: 403, body: { error: 'live_access_disabled' } });
    const harv = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: 'x' });
    expect(harv).toEqual({ status: 403, body: { error: 'live_access_disabled' } });
    const consent = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
    expect(consent).toEqual({ status: 403, body: { error: 'live_access_disabled' } });

    expect(transportCalls).toEqual([]);
    expect(sessionCalls).toEqual([]);
    expect(graphCalls).toEqual([]);
    expect(fs.readdirSync(workRoot)).toEqual([]); // no job, no captures dir
    expect(engagementRow().live_consent).toBeUndefined();
  });

  it('only a bhd_operator may turn the flag on; who + when are recorded with the engagement', async () => {
    expect((await call('PUT', `/api/live/engagements/${engagementId}/access`, PRIME, { enabled: true })).status).toBe(403);
    expect(engagementRow().live_access_enabled).toBeUndefined();
    const on = await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
    expect(on.status).toBe(200);
    expect(engagementRow().live_access_enabled).toBe(true);
    expect(engagementRow().live_access_set_by).toBe('op-1');
    expect(engagementRow().live_access_set_at).toBeInstanceOf(Date);
  });

  it('an engagement of another SaaS tenant is not found', async () => {
    const other = mintToken({ sub: 'op-2', tenant_id: 't-other', party_id: null, role: 'bhd_operator' });
    expect((await call('PUT', `/api/live/engagements/${engagementId}/access`, other, { enabled: true })).status).toBe(404);
    expect((await call('POST', '/api/discovery/run', other, { live: true, engagement_id: engagementId, consent_id: 'x' })).status).toBe(404);
  });

  it('the production app wiring (createApp) refuses live by default too', async () => {
    const app = createApp({ live: gate });
    const s = app.listen(0);
    const b = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
    try {
      for (const route of ['/api/discovery/run', '/api/harvest/run']) {
        const r = await fetch(`${b}${route}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPERATOR}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ live: true, engagement_id: engagementId, consent_id: 'x' }),
        });
        expect(r.status, route).toBe(403);
        expect(await r.json(), route).toEqual({ error: 'live_access_disabled' });
      }
    } finally {
      s.close();
    }
  });

  it('a bare access_token no longer reaches a tenant (no flag, no consent)', async () => {
    const r = await call('POST', '/api/harvest/run', OPERATOR, { access_token: 'someone-elses-token' });
    expect(r).toEqual({ status: 403, body: { error: 'live_path_requires_engagement_consent' } });
    expect(graphCalls).toEqual([]);
  });
});

describe('FC-MU-2 live gate — flag ON, no consent → refused', () => {
  beforeEach(async () => {
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
  });

  it('no consent id, an unknown one, or a still-pending one: consent_required', async () => {
    for (const consent_id of [undefined, 'not-a-consent']) {
      const d = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id });
      expect(d).toEqual({ status: 403, body: { error: 'consent_required' } });
      const h = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id });
      expect(h).toEqual({ status: 403, body: { error: 'consent_required' } });
    }
    tokenReplies.push(PENDING);
    const started = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
    const pendingId = started.body.consent_id;
    expect((await call('GET', `/api/live/consent/${pendingId}`, PRIME)).body.status).toBe('pending');
    const d = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: pendingId });
    expect(d).toEqual({ status: 403, body: { error: 'consent_required' } });
    expect(sessionCalls).toEqual([]);
    expect(graphCalls).toEqual([]);
    expect(engagementRow().live_consent).toBeUndefined();
  });

  it('the sign-in is tenant-scoped and asks for read-only scopes only (no offline_access)', async () => {
    tokenReplies.push(PENDING);
    await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0].url).toBe(`https://login.microsoftonline.us/${CUSTOMER_TENANT}/oauth2/v2.0/devicecode`);
    const asked = transportCalls[0].form.scope.split(' ');
    expect(asked).toEqual([...LIVE_READ_SCOPES]);
    expect(asked.every(isReadOnlyScope)).toBe(true);
    expect(asked).not.toContain('offline_access');
    expect(transportCalls[0].form).not.toHaveProperty('client_secret');
    // a non-GUID tenant is refused before any call
    const bad = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: 'common' });
    expect(bad.status).toBe(400);
    expect(transportCalls).toHaveLength(1);
  });
});

describe('FC-MU-2 live gate — flag ON + consent (fake device-code flow)', () => {
  beforeEach(async () => {
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
  });

  it('records the consent (who, when, scopes, tenant) with the engagement', async () => {
    await grantConsent();
    const c = engagementRow().live_consent;
    expect(c.consented_by).toBe(ADMIN);
    expect(new Date(c.consented_at).toISOString()).toBe(c.consented_at);
    expect(c.tenant_id).toBe(CUSTOMER_TENANT);
    expect(c.auth_tier).toBe('device-code');
    expect(c.scopes).toEqual(GRANTED_SCOPE.split(' '));
    expect(c.scopes.every(isReadOnlyScope)).toBe(true);
    // the token is never persisted
    expect(JSON.stringify(db.engagement._records)).not.toContain(FAKE_TOKEN);
    const access = await call('GET', `/api/live/engagements/${engagementId}/access`, PRIME);
    expect(access.body.consent.consented_by).toBe(ADMIN);
  });

  it('live discovery reads through the (fake) live session, read-only, and the readiness record carries the consent', async () => {
    const consentId = await grantConsent();
    const start = await call('POST', '/api/discovery/run', OPERATOR, {
      live: true,
      engagement_id: engagementId,
      consent_id: consentId,
      tenant_slug: 'customer-live',
    });
    expect(start.status).toBe(202);
    expect(start.body.tenant_kind).toBe('live');
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe('done');
    expect(simRuns).toBe(0);

    // Reads went through the live session with the consent's token, Graph only.
    expect(sessionCalls.map((c) => c.command)).toEqual([
      'Get-MgIdentityConditionalAccessPolicy',
      "(Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/users').value",
    ]);
    expect(sessionCalls.every((c) => c.token === FAKE_TOKEN && c.engine === 'mgraph')).toBe(true);
    // Read-only guarantee: no set_command, no write verb, no non-Graph engine reached the session.
    for (const c of sessionCalls) {
      expect(c.command).not.toBe(SET_SENTINEL);
      expect(writeCommandReason(c.command)).toBeNull();
    }

    const env = job.envelope;
    expect(env.manifest.tenant).toEqual({ slug: 'customer-live', kind: 'live' });
    expect(env.manifest.auth_tier).toBe('device-code');
    expect(env.manifest.engagement_id).toBe(engagementId);
    expect(env.manifest.consent).toEqual(engagementRow().live_consent);
    const byEntry = (id: string) => env.observations.filter((o: any) => o.ran_entry_ids.includes(id));
    expect(byEntry('lv.ca')[0].derived_posture).toBe('met');
    for (const refused of ['lv.exo', 'lv.evil', 'lv.post']) {
      expect(byEntry(refused)[0].derived_posture, refused).toBe('unknown');
    }
    expect(JSON.stringify(env)).not.toContain(FAKE_TOKEN);
  });

  it('live harvest reads through the (fake) live Graph client and returns the consent', async () => {
    const consentId = await grantConsent();
    const r = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: consentId });
    expect(r.status).toBe(200);
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls.every((g) => g.token === FAKE_TOKEN)).toBe(true);
    expect(r.body.tenant_kind).toBe('live');
    expect(r.body.consent.consented_by).toBe(ADMIN);
    const iam = r.body.facts.find((f: any) => f.question_id === 'iam-001');
    expect(iam.answer).toBe('yes');
  });

  it('a consent is bound to its engagement', async () => {
    const consentId = await grantConsent();
    const other = await db.engagement.create({ data: { tenant_id: SAAS_TENANT, engagement_kind: 'prime_and_subs', live_access_enabled: true } });
    const r = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: other.id, consent_id: consentId });
    expect(r).toEqual({ status: 403, body: { error: 'consent_required' } });
  });

  it('turning the flag off revokes the in-memory consent; re-enabling does not resurrect it', async () => {
    const consentId = await grantConsent();
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: false });
    const off = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: consentId });
    expect(off).toEqual({ status: 403, body: { error: 'live_access_disabled' } });
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
    const again = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: consentId });
    expect(again).toEqual({ status: 403, body: { error: 'consent_required' } });
    expect(graphCalls).toEqual([]);
  });
});

describe('FC-MU-2 live gate — refused / aborted consent leaves nothing behind', () => {
  beforeEach(async () => {
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
  });

  const refusals: Array<[string, TokenReply]> = [
    ['the customer declines', DECLINED],
    ['the code expires', { status: 400, json: { error: 'expired_token' } }],
    ['a write scope is granted', grantedReply({ scope: `${GRANTED_SCOPE} https://graph.microsoft.us/Policy.ReadWrite.ConditionalAccess` })],
    ['the account is from another tenant', grantedReply({}, OTHER_TENANT)],
  ];
  for (const [name, reply] of refusals) {
    it(`${name} → refused, no consent recorded, no token held`, async () => {
      tokenReplies.push(reply);
      const started = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
      const id = started.body.consent_id;
      const r = await call('GET', `/api/live/consent/${id}`, PRIME);
      expect(r.body.status).toBe('refused');
      expect(engagementRow().live_consent).toBeUndefined();
      expect(gate.consent.size).toBe(0);
      expect((await call('GET', `/api/live/consent/${id}`, PRIME)).status).toBe(404);
      const d = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: id });
      expect(d).toEqual({ status: 403, body: { error: 'consent_required' } });
      expect(fs.readdirSync(workRoot)).toEqual([]);
    });
  }

  it('an aborted sign-in is dropped and records nothing', async () => {
    tokenReplies.push(grantedReply());
    const started = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: CUSTOMER_TENANT });
    const id = started.body.consent_id;
    expect((await call('POST', `/api/live/consent/${id}/abort`, PRIME)).body.status).toBe('aborted');
    expect(gate.consent.size).toBe(0);
    expect((await call('GET', `/api/live/consent/${id}`, PRIME)).status).toBe(404);
    expect(engagementRow().live_consent).toBeUndefined();
    // the token endpoint was never polled after the abort
    expect(transportCalls.filter((c) => c.url.endsWith('/token'))).toEqual([]);
  });
});

describe('FC-MU-2 read-only scopes and commands', () => {
  it('every scope the live path asks for is read-only; write-capable scopes are rejected', () => {
    expect(() => assertReadOnlyScopes(LIVE_READ_SCOPES)).not.toThrow();
    for (const s of [
      'https://graph.microsoft.us/.default',
      'offline_access',
      'https://graph.microsoft.us/Policy.ReadWrite.ConditionalAccess',
      'https://graph.microsoft.us/Directory.AccessAsUser.All',
      'Directory.ReadWrite.All',
      'User.Invite.All',
    ]) {
      expect(isReadOnlyScope(s), s).toBe(false);
      expect(() => assertReadOnlyScopes([s]), s).toThrow(/read-only/);
    }
    expect(() => new LiveConsentService(gate.store, { scopes: [...LIVE_READ_SCOPES, 'offline_access'] })).toThrow(/read-only/);
  });

  it('readOnlySession refuses writes and non-Graph engines before the inner session', async () => {
    const seen: string[] = [];
    const s = readOnlySession({ async execute(_e, c) { seen.push(c); return { stdout: 'x', stderr: '', exitCode: 0, durationMs: 0 }; } });
    for (const [engine, cmd] of [
      ['mgraph', 'Set-MgPolicy -Id 1'],
      ['mgraph', 'Get-MgUser | ForEach-Object { Remove-MgUser -UserId $_.Id }'],
      ['mgraph', "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/x'"],
      ['mgraph', "Invoke-MgGraphRequest -Uri '/v1.0/x' -Body @{a=1}"],
      ['exchange', 'Get-OrganizationConfig'],
      ['az', 'Get-AzResourceGroup'],
    ]) {
      await expect(s.execute(engine, cmd), cmd).rejects.toThrow(/read-only/);
    }
    await s.execute('mgraph', "Invoke-MgGraphRequest -Method GET -Uri '/v1.0/x'");
    expect(seen).toEqual(["Invoke-MgGraphRequest -Method GET -Uri '/v1.0/x'"]);
  });

  it("against Stamper's real registry: every Graph get_command passes the guard; no Graph set_command does", () => {
    const root = process.env.STAMPER_REGISTRY_ROOT ?? path.resolve(__dirname, '..', '..', '..', 'ces-stamper', 'src', 'registry');
    const files = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'].map((f) => path.join(root, f));
    if (!files.every((f) => fs.existsSync(f))) {
      if (process.env.CI) return; // sibling checkout absent in single-repo CI
      throw new Error(`ces-stamper registry missing at ${root}`);
    }
    const gets = loadRegistryGetEntries(root).filter((e) => e.engine === 'mgraph' && e.get_command);
    expect(gets.length).toBeGreaterThan(20);
    const falseRefusals = gets.filter((e) => writeCommandReason(e.get_command!) !== null).map((e) => e.entry_id);
    expect(falseRefusals).toEqual([]);
    const sets = files
      .flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).entries as Array<Record<string, any>>)
      .filter((e) => e.engine === 'mgraph' && typeof e.set_command === 'string' && e.set_command.trim());
    expect(sets.length).toBeGreaterThan(10);
    const passed = sets.filter((e) => writeCommandReason(e.set_command) === null).map((e) => e.entry_id);
    expect(passed).toEqual([]);
  });
});

describe('FC-MU-2 sim path unchanged', () => {
  it('a request without live:true takes the sim run, never the live gate', async () => {
    const r = await call('POST', '/api/discovery/run', OPERATOR, { tenant_slug: 'stacksim-local' });
    expect(r.status).toBe(202);
    expect(r.body.tenant_kind).toBe('sim');
    await waitJob(r.body.job_id);
    expect(simRuns).toBe(1);
    expect(sessionCalls).toEqual([]);
    expect(transportCalls).toEqual([]);
  });

  it('the sim envelope is byte-identical in shape: kind sim, cert-app-only, no consent', () => {
    const env = buildDiscoveryReadinessResult({
      observations: [],
      slug: 'stacksim-local',
      startedAt: '2026-09-28T00:00:00.000Z',
      completedAt: '2026-09-28T00:00:01.000Z',
      registryVersions: {},
    }) as { manifest: Record<string, unknown> };
    expect(env.manifest).toEqual({
      mode: 'independent',
      auth_tier: 'cert-app-only',
      tenant: { slug: 'stacksim-local', kind: 'sim' },
      operator: { name: 'ces-tester', role: 'orchestrator' },
      engagement_id: 'mu-discovery-stacksim-local',
      party_id: 'mu-discovery-stacksim-local',
      engagement_kind: 'prime_and_subs',
      started_at: '2026-09-28T00:00:00.000Z',
      completed_at: '2026-09-28T00:00:01.000Z',
    });
  });
});

describe('FC-MU-2 test safety: the production live defaults refuse under vitest', () => {
  it('device-code transport, Graph client and PowerShell session all refuse a real Microsoft endpoint', async () => {
    await expect(fetchTransport(`https://login.microsoftonline.us/${CUSTOMER_TENANT}/oauth2/v2.0/devicecode`, {})).rejects.toThrow(
      /refused under test/
    );
    await expect(realGraphClient('t').get('/users')).rejects.toThrow(/refused under test/);
    await expect(realGraphClient('t', 'https://graph.microsoft.us/v1.0').get('/users')).rejects.toThrow(/refused under test/);
    expect(() => buildLiveGraphSession(FAKE_TOKEN)).toThrow(/refused under test/);
  });

  it('the default consent service (no injected transport) cannot reach Microsoft', async () => {
    const svc = new LiveConsentService(gate.store, { clientId: 'public-client-fake' });
    await expect(svc.start(SAAS_TENANT, engagementId, CUSTOMER_TENANT)).rejects.toThrow(/refused under test/);
    expect(svc.size).toBe(0);
  });
});
