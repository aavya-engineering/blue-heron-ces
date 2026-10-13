// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * live.readerRole.test.ts — FC-MU-5 step 1 (founder decision 2026-09-28,
 * round 4): Exchange, Purview, Azure (and Teams, same command-gate basis)
 * publish no read-only delegated scope, so a live consent for them is recorded
 * ONLY when the signed-in admin holds Entra Global Reader (the verified ID
 * token's `wids` role claim) — and, for Azure, read on the whole subscription
 * (the Azure Reader role's `*\/read`, or a role that includes it), checked with
 * the consent's own ARM token. A refusal leaves nothing behind: no engagement
 * write, no in-memory token.
 *
 * Fakes only: device-code transport, JWKS keys and the ARM GET are injected;
 * the production ARM GET is proven to refuse under vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  GLOBAL_READER_ROLE_ID,
  LIVE_AREAS,
  fetchArmGet,
  type LiveArea,
} from '../src/services/liveAccess.js';
import type { RegistryGetEntry } from '../src/services/discoveryService.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import {
  GLOBAL_ADMIN_WID,
  GLOBAL_READER_WID,
  OPERATOR,
  PRIME,
  SUBSCRIPTION,
  TENANT,
  buildHarness,
  consentFor,
  defaultArmGet,
  tokenFor,
  waitJob,
  type Harness,
  type HarnessOptions,
} from './helpers/liveAreasHarness.js';

const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'a.nsg', control_ids: ['SC.L1-3.13.1'], engine: 'az', get_command: 'Get-AzNetworkSecurityGroup | Select-Object Name' },
];

let db: MockDb;
let h: Harness;
let engagementId: string;
let workRoot: string;
const row = () => db.engagement._records.find((e: any) => e.id === engagementId) as Record<string, any>;

async function setup(opts: HarnessOptions = {}) {
  h = buildHarness(db, workRoot, { entries: ENTRIES, ...opts });
  await h.call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
}

/** Nothing recorded, nothing held in memory. */
function expectNothingLeft() {
  expect(row().live_area_consents).toBeUndefined();
  expect(row().live_consent).toBeUndefined();
  expect(h.gate.consent.size).toBe(0);
}

beforeEach(async () => {
  db = createMockDb();
  const e = await db.engagement.create({ data: { tenant_id: 't-live', engagement_kind: 'prime_and_subs' } });
  engagementId = e.id as string;
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mu5-reader-'));
});

afterEach(() => {
  h?.server.close();
  fs.rmSync(workRoot, { recursive: true, force: true });
});

const COMMAND_GATE_AREAS: LiveArea[] = ['exchange', 'purview', 'teams'];

describe('FC-MU-5 step 1 — Global Reader is required for command-gate areas', () => {
  it('the Global Reader role id is the Entra template id', () => {
    expect(GLOBAL_READER_ROLE_ID).toBe(GLOBAL_READER_WID);
  });

  it('with Global Reader in the verified token, Exchange / Purview / Teams consents are recorded with the role', async () => {
    await setup();
    for (const a of COMMAND_GATE_AREAS) {
      const r = await consentFor(h, engagementId, a);
      expect(r.poll.status, `${a} ${JSON.stringify(r.poll)}`).toBe('granted');
      expect(row().live_area_consents[a].reader_roles, a).toEqual(['Global Reader']);
    }
  });

  it('no role claim in the token → refused (reader_role_unverifiable); nothing recorded', async () => {
    await setup({ claims: () => ({}) });
    for (const a of COMMAND_GATE_AREAS) {
      const r = await consentFor(h, engagementId, a);
      expect(r.poll, a).toEqual({ status: 'refused', reason: 'reader_role_unverifiable' });
    }
    expectNothingLeft();
  });

  it('a Global Administrator without Global Reader → refused (global_reader_required); nothing recorded', async () => {
    await setup({ claims: () => ({ wids: [GLOBAL_ADMIN_WID] }) });
    for (const a of COMMAND_GATE_AREAS) {
      const r = await consentFor(h, engagementId, a);
      expect(r.poll, a).toEqual({ status: 'refused', reason: 'global_reader_required' });
    }
    expectNothingLeft();
  });

  it('Graph keeps its read-scope basis: no role claim is needed there', async () => {
    await setup({ claims: () => ({}) });
    const r = await consentFor(h, engagementId, 'graph');
    expect(r.poll.status).toBe('granted');
    expect(row().live_consent.reader_roles).toBeUndefined();
  });
});

describe('FC-MU-5 step 1 — Azure also needs read on the subscription', () => {
  it('an Azure consent without subscription_id is refused before any call', async () => {
    await setup();
    const s = await h.call('POST', `/api/live/engagements/${engagementId}/consent`, PRIME, { tenant_id: TENANT, area: 'azure' });
    expect(s.status).toBe(400);
    expect(h.transportCalls).toEqual([]);
  });

  it('Global Reader + Reader on the subscription → recorded with the subscription and both roles', async () => {
    await setup();
    const r = await consentFor(h, engagementId, 'azure');
    expect(r.poll.status, JSON.stringify(r.poll)).toBe('granted');
    expect(h.armCalls).toEqual([
      {
        url: `${LIVE_AREAS.azure.resource}/subscriptions/${SUBSCRIPTION}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`,
        token: tokenFor('azure'),
      },
    ]);
    expect(row().live_area_consents.azure).toMatchObject({
      area: 'azure',
      subscription_id: SUBSCRIPTION,
      reader_roles: ['Global Reader', 'Azure Reader (subscription)'],
    });
  });

  it('a role that includes */read (Owner-like "*") also passes; the observed basis is still recorded', async () => {
    const armCalls: Harness['armCalls'] = [];
    await setup({ armGet: defaultArmGet(armCalls, { value: [{ actions: ['*'], notActions: [] }] }) });
    const r = await consentFor(h, engagementId, 'azure');
    expect(r.poll.status).toBe('granted');
  });

  const refusals: Array<[string, unknown, number]> = [
    ['only a narrow read (one provider)', { value: [{ actions: ['Microsoft.Storage/*/read'], notActions: [] }] }, 200],
    ['*/read removed by notActions', { value: [{ actions: ['*'], notActions: ['*/read'] }] }, 200],
    ['no permissions at all', { value: [] }, 200],
    ['ARM refuses the check (403)', { error: { code: 'AuthorizationFailed' } }, 403],
  ];
  for (const [label, json, status] of refusals) {
    it(`Azure: ${label} → refused (azure_reader_required); nothing recorded`, async () => {
      const armCalls: Harness['armCalls'] = [];
      await setup({ armGet: defaultArmGet(armCalls, json, status) });
      const r = await consentFor(h, engagementId, 'azure');
      expect(r.poll).toEqual({ status: 'refused', reason: 'azure_reader_required' });
      expect(armCalls).toHaveLength(1);
      expectNothingLeft();
    });
  }

  it('Azure without Global Reader is refused before the subscription check', async () => {
    const armCalls: Harness['armCalls'] = [];
    await setup({ claims: () => ({ wids: [GLOBAL_ADMIN_WID] }), armGet: defaultArmGet(armCalls) });
    const r = await consentFor(h, engagementId, 'azure');
    expect(r.poll).toEqual({ status: 'refused', reason: 'global_reader_required' });
    expect(armCalls).toEqual([]);
    expectNothingLeft();
  });

  it('a live run with the reader-checked Azure consent builds a valid readiness record carrying the roles', async () => {
    await setup();
    const r = await consentFor(h, engagementId, 'azure');
    const start = await h.call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [r.id] });
    const job = await waitJob(h, start.body.job_id);
    expect(job.status, JSON.stringify(job.outcome ?? job)).toBe('done');
    expect(job.envelope.manifest.consents[0]).toMatchObject({ area: 'azure', subscription_id: SUBSCRIPTION, reader_roles: ['Global Reader', 'Azure Reader (subscription)'] });
  });

  it('the production ARM GET refuses under vitest', async () => {
    await expect(fetchArmGet('https://management.usgovcloudapi.net/subscriptions/x', 'tok')).rejects.toThrow(/refused under test/);
  });
});
