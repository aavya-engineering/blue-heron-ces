// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * live.areas.test.ts — FC-MU-3 step 5 (founder decision 2026-09-28 #14): live
 * coverage beyond Graph. Exchange Online, Purview and Azure each get their OWN
 * device-code consent (one token per resource), each recorded with the
 * engagement and in the readiness record; the live discovery walk routes every
 * registry engine the sim covers for those areas to the session of its area.
 *
 * Fakes only: the device-code transport, the JWKS keys, and every area session
 * are injected. The production sessions are proven to refuse under vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createLiveRouter } from '../src/routes/live.js';
import { createDiscoveryRouter } from '../src/routes/discovery.js';
import { createHarvestRouter } from '../src/routes/harvest.js';
import { mintToken } from '../src/lib/jwt.js';
import {
  LIVE_AREAS,
  LiveConsentService,
  areaScopes,
  isAllowedAreaScope,
  prismaLiveAccessStore,
  type DeviceCodeTransport,
  type LiveArea,
  type LiveGate,
} from '../src/services/liveAccess.js';
import { ENGINE_AREA, buildLiveAreaSession, writeCommandReason } from '../src/services/liveDiscoveryRun.js';
import { translateAzCliRead } from '../src/services/liveAzTranslate.js';
import { defaultRegistryRoot } from '../src/services/simDiscoveryRun.js';
import type { DiscoverySession, RegistryGetEntry } from '../src/services/discoveryService.js';
import type { GraphClient } from '../src/lib/graphClient.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import { fakeJwks, makeSigningKey, signIdToken } from './helpers/idTokenKeys.js';

const SAAS = 't-live';
const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT_ID = 'public-client-fake';
const ADMIN = 'it-admin@customer.example';
const OPERATOR = mintToken({ sub: 'op-1', tenant_id: SAAS, party_id: null, role: 'bhd_operator' });
const PRIME = mintToken({ sub: 'prime-1', tenant_id: SAAS, party_id: null, role: 'prime' });
const KEY = makeSigningKey('kid-areas');
const AREAS: LiveArea[] = ['graph', 'exchange', 'purview', 'azure'];
const tokenFor = (a: LiveArea) => `fake-${a}-token`;
// FC-MU-5 step 1: non-Graph consents need Global Reader (the `wids` claim) and,
// for Azure, a subscription with read on it (a Reader-shaped fake ARM reply).
const GLOBAL_READER_WID = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451';
const SUBSCRIPTION = '99999999-8888-7777-6666-555555555555';
const bodyFor = (a: LiveArea) => ({ tenant_id: TENANT, area: a, ...(a === 'azure' ? { subscription_id: SUBSCRIPTION } : {}) });

// One registry entry per engine the sim covers, plus an az CLI entry (FC-MU-5:
// runs as its Azure PowerShell translation) and a Teams entry (unavailable
// here: this file grants no Teams consent — see live.teams.test.ts).
const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'g.ca', control_ids: ['AC.L2-3.1.1'], engine: 'mgraph', get_command: 'Get-MgIdentityConditionalAccessPolicy' },
  { entry_id: 'x.audit', control_ids: ['AU.L2-3.3.1'], engine: 'exchange', get_command: 'Get-AdminAuditLogConfig | Select-Object UnifiedAuditLogIngestionEnabled' },
  { entry_id: 'p.dlp', control_ids: ['AC.L2-3.1.3'], engine: 'ipps', get_command: 'Get-DlpCompliancePolicy | Select-Object Name,Mode' },
  { entry_id: 'a.nsg', control_ids: ['SC.L1-3.13.1'], engine: 'az', get_command: 'Get-AzNetworkSecurityGroup | Select-Object Name' },
  { entry_id: 'a.rest', control_ids: ['AU.L2-3.3.2'], engine: 'az', get_command: "Invoke-AzRestMethod -Method GET -Path '/subscriptions/x/providers/y?api-version=1'" },
  { entry_id: 'a.cli', control_ids: ['SI.L2-3.14.6'], engine: 'az', get_command: 'az advisor recommendation list --output json' },
  { entry_id: 't.fed', control_ids: ['AC.L2-3.1.20'], engine: 'teams', get_command: 'Get-CsExternalAccessPolicy -Identity Global' },
];

let db: MockDb;
let gate: LiveGate;
let engagementId: string;
let base: string;
let server: http.Server;
let workRoot: string;
let transportCalls: Array<{ url: string; form: Record<string, string> }>;
let sessionCalls: Array<{ area: string; engine: string; command: string; token: string; upn: string }>;
let graphCalls: string[];
/** The area the next device-code start is for (set by grant() / the scope test). */
let nextArea: LiveArea = 'graph';

/** Fake device-code transport: the token reply echoes the asked scopes and returns an area token. */
function fakeTransport(grantedScopeOverride?: (asked: string) => string): DeviceCodeTransport {
  const askedByCode = new Map<string, string>();
  const areaByCode = new Map<string, LiveArea>();
  let n = 0;
  return async (url, form) => {
    transportCalls.push({ url, form });
    if (url.endsWith('/devicecode')) {
      const code = `dc-${++n}`;
      askedByCode.set(code, form.scope);
      areaByCode.set(code, nextArea);
      return { status: 200, json: { device_code: code, user_code: `UC-${n}`, verification_uri: 'https://example.invalid', expires_in: 900, interval: 5 } };
    }
    const asked = askedByCode.get(form.device_code) ?? '';
    // Exchange and Purview share a resource, so the fake learns the area from the test.
    const area = areaByCode.get(form.device_code) ?? 'graph';
    return {
      status: 200,
      json: {
        access_token: tokenFor(area),
        expires_in: 3600,
        scope: grantedScopeOverride ? grantedScopeOverride(asked) : asked,
        id_token: signIdToken(KEY, { tid: TENANT, aud: CLIENT_ID, nowSec: Math.floor(Date.now() / 1000), preferred_username: ADMIN, extra: { wids: [GLOBAL_READER_WID] } }),
      },
    };
  };
}

function build(grantedScopeOverride?: (asked: string) => string) {
  const store = prismaLiveAccessStore(db);
  gate = {
    store,
    consent: new LiveConsentService(store, {
      clientId: CLIENT_ID,
      transport: fakeTransport(grantedScopeOverride),
      fetchKeys: fakeJwks([KEY.jwk]).fetchKeys,
      armGet: async () => ({ status: 200, json: { value: [{ actions: ['*/read'], notActions: [] }] } }),
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
        loadEntries: () => ENTRIES,
        registryRoot: '/no/registry/for/hermetic/test',
        makeSession: (token: string, ctx): DiscoverySession => ({
          async execute(engine, command) {
            sessionCalls.push({ area: ctx.area, engine, command, token, upn: ctx.consent.consented_by });
            return { stdout: 'Name\nrow', stderr: '', exitCode: 0, durationMs: 1 };
          },
        }),
      },
    })
  );
  const fakeGraph = (token: string): GraphClient => ({
    async get(p: string) {
      graphCalls.push(`${token} ${p}`);
      return { value: [] };
    },
  });
  app.use('/api/harvest', createHarvestRouter(undefined, async () => false, { live: gate, liveClient: fakeGraph }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function grant(area: LiveArea): Promise<string> {
  nextArea = area;
  const s = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, bodyFor(area));
  expect(s.status, `${area} start`).toBe(202);
  const r = await call('GET', `/api/live/consent/${s.body.consent_id}`, PRIME);
  expect(r.body.status, `${area} poll ${JSON.stringify(r.body)}`).toBe('granted');
  return s.body.consent_id as string;
}

async function waitJob(id: string): Promise<Record<string, any>> {
  for (let i = 0; i < 200; i++) {
    const r = await call('GET', `/api/discovery/run/${id}`, OPERATOR);
    if (r.body.status !== 'running') return r.body;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('job did not finish');
}

const row = () => db.engagement._records.find((e: any) => e.id === engagementId) as Record<string, any>;

beforeEach(async () => {
  db = createMockDb();
  const e = await db.engagement.create({ data: { tenant_id: SAAS, engagement_kind: 'prime_and_subs' } });
  engagementId = e.id as string;
  transportCalls = [];
  sessionCalls = [];
  graphCalls = [];
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mu3-areas-'));
});

afterEach(() => {
  server?.close();
  fs.rmSync(workRoot, { recursive: true, force: true });
});

describe('FC-MU-3 step 5 — one device-code consent per area', () => {
  beforeEach(async () => {
    build();
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
  });

  it('each area asks for its own resource scope only (no .default, no offline_access, no secret)', async () => {
    for (const a of AREAS) await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, bodyFor(a));
    const asked = transportCalls.filter((c) => c.url.endsWith('/devicecode'));
    expect(asked).toHaveLength(4);
    for (const [i, a] of AREAS.entries()) {
      const scopes = asked[i].form.scope.split(' ');
      expect(scopes, a).toEqual(areaScopes(a));
      expect(scopes.filter((s) => s.includes('://')).every((s) => s.startsWith(LIVE_AREAS[a].resource + '/')), a).toBe(true);
      expect(scopes.some((s) => s.endsWith('/.default') || s === 'offline_access'), a).toBe(false);
      expect(asked[i].form).not.toHaveProperty('client_secret');
    }
    expect(areaScopes('exchange')).toContain('https://outlook.office365.us/Exchange.Manage');
    expect(areaScopes('azure')).toContain('https://management.usgovcloudapi.net/user_impersonation');
  });

  it('an unknown area is refused before any call', async () => {
    const r = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: TENANT, area: 'sharepoint' });
    expect(r.status).toBe(400);
    expect(transportCalls).toEqual([]);
  });

  it('every area consent is recorded with the engagement (graph stays in live_consent)', async () => {
    for (const a of AREAS) await grant(a);
    expect(row().live_consent).toMatchObject({ area: 'graph', consented_by: ADMIN, tenant_id: TENANT });
    for (const a of ['exchange', 'purview', 'azure'] as const) {
      expect(row().live_area_consents[a], a).toMatchObject({ area: a, consented_by: ADMIN, tenant_id: TENANT, auth_tier: 'device-code' });
      expect(row().live_area_consents[a].scopes, a).toEqual(areaScopes(a));
    }
    const access = await call('GET', `/api/live/engagements/${engagementId}/access`, PRIME);
    expect(Object.keys(access.body.consents).sort()).toEqual([...AREAS].sort());
    expect(JSON.stringify(db.engagement._records)).not.toMatch(/fake-(graph|exchange|purview|azure)-token/);
  });

  it('live discovery with all four consents covers Graph, Exchange, Purview and Azure; each area uses its own token', async () => {
    const ids = [];
    for (const a of AREAS) ids.push(await grant(a));
    const start = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: ids, tenant_slug: 'customer-live' });
    expect(start.status).toBe(202);
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe('done');

    // FC-MU-5 step 2: the registry az CLI read (a.cli) now reaches the Azure
    // session as its Azure PowerShell translation.
    const ran = (e: RegistryGetEntry) => translateAzCliRead(e.get_command) ?? e.get_command;
    const byEntry = Object.fromEntries(sessionCalls.map((c) => [ENTRIES.find((e) => ran(e) === c.command)!.entry_id, c]));
    expect(Object.keys(byEntry).sort()).toEqual(['a.cli', 'a.nsg', 'a.rest', 'g.ca', 'p.dlp', 'x.audit']);
    expect(byEntry['a.cli'].command).not.toMatch(/^az /);
    for (const c of sessionCalls) {
      expect(c.token, c.command).toBe(tokenFor(c.area as LiveArea));
      expect(c.area, c.command).toBe(ENGINE_AREA[c.engine]);
      expect(c.upn).toBe(ADMIN);
      expect(writeCommandReason(c.command, c.engine)).toBeNull();
    }
    const env = job.envelope;
    expect(env.schema_version).toBe('readiness-result/1.1.0');
    expect(env.manifest.consent.area).toBe('graph');
    expect(env.manifest.consents.map((c: any) => c.area).sort()).toEqual([...AREAS].sort());
    const posture = (id: string) => env.observations.find((o: any) => o.ran_entry_ids.includes(id))?.derived_posture;
    // FC-MU-5: the az CLI read runs translated; Teams was not consented in this run.
    expect(posture('a.cli')).not.toBe('unknown');
    expect(posture('t.fed')).toBe('unknown');
    expect(JSON.stringify(env)).not.toMatch(/fake-(graph|exchange|purview|azure)-token/);
  });

  it('with only the Graph consent, Exchange / Purview / Azure entries stay unavailable (no session call)', async () => {
    const g = await grant('graph');
    const start = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: g });
    const job = await waitJob(start.body.job_id);
    expect(job.status).toBe('done');
    expect(sessionCalls.map((c) => c.area)).toEqual(['graph']);
    expect(job.envelope.manifest.consents.map((c: any) => c.area)).toEqual(['graph']);
  });

  it('a consent id from another engagement, or a pending one, is refused', async () => {
    const x = await grant('exchange');
    const other = await db.engagement.create({ data: { tenant_id: SAAS, engagement_kind: 'prime_and_subs', live_access_enabled: true } });
    const r = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: other.id, consent_ids: [x] });
    expect(r).toEqual({ status: 403, body: { error: 'consent_required' } });
    const s = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, bodyFor('azure')); // never polled
    const r2 = await call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [x, s.body.consent_id] });
    expect(r2).toEqual({ status: 403, body: { error: 'consent_required' } });
    expect(sessionCalls).toEqual([]);
  });

  it('live harvest (a Graph read) needs the Graph consent: an Exchange consent is refused', async () => {
    const x = await grant('exchange');
    const r = await call('POST', '/api/harvest/run', OPERATOR, { live: true, engagement_id: engagementId, consent_id: x });
    expect(r).toEqual({ status: 403, body: { error: 'consent_required' } });
    expect(graphCalls).toEqual([]);
  });
});

describe('FC-MU-3 step 5 — area scope policy', () => {
  it('a grant carrying a scope outside the area allowlist is refused and records nothing', async () => {
    build((asked) => `${asked} https://graph.microsoft.us/Directory.ReadWrite.All`);
    await call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
    const s = await call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: TENANT, area: 'exchange' });
    const r = await call('GET', `/api/live/consent/${s.body.consent_id}`, PRIME);
    expect(r.body).toMatchObject({ status: 'refused', reason: 'non_area_scope_granted' });
    expect(row().live_area_consents).toBeUndefined();
    expect(gate.consent.size).toBe(0);
  });

  it('each area admits exactly its allowlist (plus identity scopes); nothing else', () => {
    expect(isAllowedAreaScope('exchange', 'https://outlook.office365.us/Exchange.Manage')).toBe(true);
    expect(isAllowedAreaScope('exchange', 'https://outlook.office365.us/.default')).toBe(false);
    expect(isAllowedAreaScope('exchange', 'https://graph.microsoft.us/Policy.Read.All')).toBe(false);
    expect(isAllowedAreaScope('azure', 'https://management.usgovcloudapi.net/user_impersonation')).toBe(true);
    expect(isAllowedAreaScope('azure', 'offline_access')).toBe(false);
    expect(isAllowedAreaScope('graph', 'https://outlook.office365.us/Exchange.Manage')).toBe(false);
    expect(isAllowedAreaScope('graph', 'https://graph.microsoft.us/Policy.Read.All')).toBe(true);
    expect(isAllowedAreaScope('purview', 'openid')).toBe(true);
  });
});

describe('FC-MU-3 step 5 — read-only command gate for the new areas', () => {
  it('Az PowerShell reads and Invoke-AzRestMethod GET pass; writes, non-GET REST and az CLI are refused', () => {
    expect(writeCommandReason('Get-AzNetworkSecurityGroup | Select-Object Name', 'az')).toBeNull();
    expect(writeCommandReason("Invoke-AzRestMethod -Method GET -Path '/subscriptions/x'", 'az')).toBeNull();
    expect(writeCommandReason("Invoke-AzRestMethod -Method PUT -Path '/subscriptions/x' -Payload '{}'", 'az')).not.toBeNull();
    expect(writeCommandReason('Set-AzNetworkSecurityGroup -NetworkSecurityGroup $n', 'az')).not.toBeNull();
    expect(writeCommandReason("az rest --method GET --url 'https://management.usgovcloudapi.net/x'", 'az')).toMatch(/az CLI/);
    expect(writeCommandReason('az advisor recommendation list --output json', 'az')).toMatch(/az CLI/);
    expect(writeCommandReason('Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date)', 'exchange')).toBeNull();
    expect(writeCommandReason('Set-OrganizationConfig -AuditDisabled $false', 'exchange')).not.toBeNull();
  });

  it('against the real Stamper registries: every Exchange / Purview / Azure set_command is refused; the get_commands pass except az CLI', () => {
    const root = defaultRegistryRoot();
    const all: Array<{ entry_id: string; engine: string; get_command?: string; set_command?: string }> = [];
    for (const f of ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json']) {
      const j = JSON.parse(readFileSync(path.join(root, f), 'utf8'));
      const arr = Array.isArray(j) ? j : (j.commands ?? j.entries ?? Object.values(j).find(Array.isArray));
      all.push(...arr);
    }
    const scoped = all.filter((e) => ['exchange', 'ipps', 'az'].includes(e.engine));
    expect(scoped.length).toBeGreaterThan(90);
    const setsPassing = scoped.filter((e) => e.set_command?.trim() && writeCommandReason(e.set_command, e.engine) === null).map((e) => e.entry_id);
    expect(setsPassing).toEqual([]);
    const getsRefused = scoped.filter((e) => e.get_command?.trim() && writeCommandReason(e.get_command, e.engine) !== null);
    // Only Azure CLI invocations are refused (7 today): the CLI cannot take the delegated token.
    expect(getsRefused.length).toBeGreaterThan(0);
    for (const e of getsRefused) {
      expect(e.engine, e.entry_id).toBe('az');
      expect(writeCommandReason(e.get_command!, e.engine), e.entry_id).toMatch(/az CLI/);
    }
  });
});

describe('FC-MU-3 step 5 — production area sessions refuse under vitest', () => {
  it('Exchange, Purview and Azure sessions cannot be built in a test', () => {
    const consent = { consented_by: ADMIN, consented_at: 'x', scopes: ['openid'], tenant_id: TENANT, auth_tier: 'device-code' as const, client_id: CLIENT_ID };
    for (const a of ['exchange', 'purview', 'azure'] as const) {
      expect(() => buildLiveAreaSession(a, 'tok', { ...consent, area: a }), a).toThrow(/refused under test/);
    }
  });
});
