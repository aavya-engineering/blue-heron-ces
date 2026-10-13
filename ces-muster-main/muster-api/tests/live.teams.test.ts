// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * live.teams.test.ts — FC-MU-5 step 3 (founder decision 2026-09-28, round 4):
 * Teams is a fifth live area. It gets its own read-only device-code consent,
 * recorded like the others (engagement row + readiness record), and the live
 * discovery walk routes the registry's `teams` engine to it.
 *
 * Fakes only: device-code transport, JWKS keys, ARM GET and every area session
 * are injected (tests/helpers/liveAreasHarness.ts). The production Teams
 * session is proven to refuse under vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LIVE_AREAS,
  LIVE_AREA_NAMES,
  areaScopes,
  isAllowedAreaScope,
  type LiveArea,
} from '../src/services/liveAccess.js';
import { ENGINE_AREA, buildLiveAreaSession, writeCommandReason } from '../src/services/liveDiscoveryRun.js';
import { defaultRegistryRoot } from '../src/services/simDiscoveryRun.js';
import type { RegistryGetEntry } from '../src/services/discoveryService.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import {
  ADMIN,
  CLIENT_ID,
  OPERATOR,
  TENANT,
  buildHarness,
  consentFor,
  tokenFor,
  waitJob,
  type Harness,
} from './helpers/liveAreasHarness.js';

const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'g.ca', control_ids: ['AC.L2-3.1.1'], engine: 'mgraph', get_command: 'Get-MgIdentityConditionalAccessPolicy' },
  { entry_id: 't.fed', control_ids: ['AC.L2-3.1.20'], engine: 'teams', get_command: 'Get-CsExternalAccessPolicy -Identity Global' },
  { entry_id: 't.meet', control_ids: ['AC.L2-3.1.22'], engine: 'teams', get_command: 'Get-CsTeamsMeetingPolicy -Identity Global | Select-Object AllowAnonymousUsersToJoinMeeting' },
  { entry_id: 't.set', control_ids: ['AC.L2-3.1.22'], engine: 'teams', get_command: 'Set-CsTeamsMeetingPolicy -Identity Global -AllowAnonymousUsersToJoinMeeting $false' },
];

let db: MockDb;
let h: Harness;
let engagementId: string;
let workRoot: string;
const row = () => db.engagement._records.find((e: any) => e.id === engagementId) as Record<string, any>;

beforeEach(async () => {
  db = createMockDb();
  const e = await db.engagement.create({ data: { tenant_id: 't-live', engagement_kind: 'prime_and_subs' } });
  engagementId = e.id as string;
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mu5-teams-'));
  h = buildHarness(db, workRoot, { entries: ENTRIES });
  await h.call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
});

afterEach(() => {
  h?.server.close();
  fs.rmSync(workRoot, { recursive: true, force: true });
});

describe('FC-MU-5 step 3 — Teams is a fifth live area', () => {
  it('teams is a live area with its own resource scope (no .default, no offline_access, no secret)', async () => {
    expect(LIVE_AREA_NAMES).toContain('teams');
    expect(LIVE_AREAS.teams.readOnlyBasis).toBe('command-gate');
    expect(ENGINE_AREA.teams).toBe('teams');
    const s = await consentFor(h, engagementId, 'teams');
    expect(s.start.status).toBe(202);
    const asked = h.transportCalls.find((c) => c.url.endsWith('/devicecode'))!;
    expect(asked.form.scope.split(' ')).toEqual(areaScopes('teams'));
    expect(areaScopes('teams')).toContain(`${LIVE_AREAS.teams.resource}/user_impersonation`);
    expect(asked.form.scope).not.toMatch(/\.default|offline_access/);
    expect(asked.form).not.toHaveProperty('client_secret');
    expect(isAllowedAreaScope('teams', `${LIVE_AREAS.teams.resource}/user_impersonation`)).toBe(true);
    expect(isAllowedAreaScope('teams', 'https://graph.microsoft.us/Policy.Read.All')).toBe(false);
    expect(isAllowedAreaScope('graph', `${LIVE_AREAS.teams.resource}/user_impersonation`)).toBe(false);
  });

  it('a granted Teams consent is recorded with the engagement like the other areas', async () => {
    const s = await consentFor(h, engagementId, 'teams');
    expect(s.poll.status, JSON.stringify(s.poll)).toBe('granted');
    expect(row().live_area_consents.teams).toMatchObject({ area: 'teams', consented_by: ADMIN, tenant_id: TENANT, auth_tier: 'device-code', client_id: CLIENT_ID });
    expect(row().live_area_consents.teams.scopes).toEqual(areaScopes('teams'));
    const access = await h.call('GET', `/api/live/engagements/${engagementId}/access`, OPERATOR);
    expect(access.body.consents.teams).toMatchObject({ area: 'teams' });
    expect(JSON.stringify(db.engagement._records)).not.toMatch(/fake-teams-token/);
  });

  it('discovery routes Teams checks to the Teams session (Teams token + the Graph token); writes stay refused', async () => {
    const g = await consentFor(h, engagementId, 'graph');
    const t = await consentFor(h, engagementId, 'teams');
    const start = await h.call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [g.id, t.id] });
    expect(start.status).toBe(202);
    const job = await waitJob(h, start.body.job_id);
    expect(job.status, JSON.stringify(job.outcome ?? job)).toBe('done');
    const teamsCalls = h.sessionCalls.filter((c) => c.engine === 'teams');
    expect(teamsCalls.map((c) => c.command).sort()).toEqual([ENTRIES[1].get_command, ENTRIES[2].get_command].sort());
    for (const c of teamsCalls) {
      expect(c.area).toBe('teams');
      expect(c.token).toBe(tokenFor('teams'));
      expect(c.graphToken).toBe(tokenFor('graph'));
    }
    const env = job.envelope;
    expect(env.manifest.consents.map((c: any) => c.area).sort()).toEqual(['graph', 'teams']);
    const posture = (id: string) => env.observations.find((o: any) => o.ran_entry_ids.includes(id))?.derived_posture;
    expect(posture('t.fed')).not.toBe('unknown');
    expect(posture('t.set')).toBe('unknown'); // the write never reached a session
    expect(JSON.stringify(env)).not.toMatch(/fake-(graph|teams)-token/);
  });

  it('without a Teams consent, Teams checks stay unavailable (no Teams session call)', async () => {
    const g = await consentFor(h, engagementId, 'graph');
    const start = await h.call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [g.id] });
    const job = await waitJob(h, start.body.job_id);
    expect(job.status).toBe('done');
    expect(h.sessionCalls.map((c) => c.area)).toEqual(['graph']);
  });

  it('a Teams consent without the Graph consent: Teams checks stay unavailable (the Teams module needs both tokens)', async () => {
    const t = await consentFor(h, engagementId, 'teams');
    const start = await h.call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [t.id] });
    const job = await waitJob(h, start.body.job_id);
    expect(job.status).toBe('done');
    expect(h.sessionCalls).toEqual([]);
    expect(job.envelope.manifest.consents.map((c: any) => c.area)).toEqual(['teams']);
  });

  it('against the real Stamper registries: every Teams set_command is refused, every Teams get_command passes the gate', () => {
    const root = defaultRegistryRoot();
    const all: Array<{ entry_id: string; engine: string; get_command?: string; set_command?: string }> = [];
    for (const f of ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json']) {
      const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
      all.push(...(j.entries ?? []));
    }
    const teams = all.filter((e) => e.engine === 'teams');
    expect(teams.length).toBeGreaterThan(0);
    expect(teams.filter((e) => e.set_command?.trim() && writeCommandReason(e.set_command, e.engine) === null).map((e) => e.entry_id)).toEqual([]);
    expect(teams.filter((e) => e.get_command?.trim() && writeCommandReason(e.get_command, e.engine) !== null).map((e) => e.entry_id)).toEqual([]);
  });

  it('the production Teams session cannot be built in a test', () => {
    const consent = { consented_by: ADMIN, consented_at: 'x', scopes: ['openid'], tenant_id: TENANT, auth_tier: 'device-code' as const, client_id: CLIENT_ID, area: 'teams' as LiveArea };
    expect(() => buildLiveAreaSession('teams', 'tok', consent, { graphAccessToken: 'g' })).toThrow(/refused under test/);
  });
});
