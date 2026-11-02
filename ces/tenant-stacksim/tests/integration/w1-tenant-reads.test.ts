// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario, type ScenarioFile } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { QueryServer } from '../../src/http/QueryServer.js';

/**
 * synthetic-customer W1 (2026-10-28, PLAN §2.2 known gaps): the tenant reads
 * Muster's harvest makes - GET /v1.0/me, /v1.0/organization,
 * /v1.0/subscribedSkus, roleEligibilitySchedules and
 * roleEligibilityScheduleInstances - on muster-partial and on S1 (s1-mach).
 * Each is a single `value` page (no @odata.nextLink) except /me (one user
 * object), and honours the URI $filter grammar (unsupported input = 400).
 *
 * S1 is built with the default day-floor anchor (no STACKSIM_FIXED_NOW), so
 * its eligibility windows (anchor - 300 d .. anchor + 65 d and later) hold
 * "now" on any day the test runs.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_DOMAIN = 'simtenant.onmicrosoft.us';
/** Muster harvestService SKU_RULES' G5 rule (TCP.LIC.001 = m365_g5). */
const MUSTER_G5_RULE = /^SPE_E5_USGOV|M365_G5/i;

type Row = Record<string, unknown>;

interface Built {
  dir: string;
  store: ObjectStore;
  table: ResolverTable;
  scenario: ScenarioFile;
}

async function build(slug: string): Promise<Built> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w1-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, scenario, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const page = async (t: ResolverTable, uri: string) => {
  const out = (await t.resolveUri('GET', uri)) as Row;
  expect(out).not.toHaveProperty('@odata.nextLink');
  return out.value as Row[];
};
const q = (expr: string) => `?$filter=${encodeURIComponent(expr)}`;
const ELIG = '/v1.0/roleManagement/directory/roleEligibilitySchedules';
const INST = '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances';

describe('W1 tenant reads on muster-partial', () => {
  let b: Built;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 120000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('GET /v1.0/me returns the sim.user1 operator (no pointer seeded)', async () => {
    expect(await b.store.read('signedInUser', 'me')).toBeUndefined();
    const me = (await b.table.resolveUri('GET', '/v1.0/me')) as Row;
    expect(me).toMatchObject({ id: 'user-1', userPrincipalName: `sim.user1@${BASE_DOMAIN}` });
    expect(me).toEqual(await b.store.read('users', 'user-1'));
  });

  it('GET /v1.0/organization returns the tenant id and verified domains', async () => {
    const org = await page(b.table, '/v1.0/organization');
    expect(org).toHaveLength(1);
    expect(org[0]).toMatchObject({ id: 'sim-tenant-muster-partial', displayName: 'Sim Tenant' });
    const domains = org[0].verifiedDomains as Row[];
    expect(domains.find((d) => d.isDefault === true)?.name).toBe(`muster-partial.${BASE_DOMAIN}`);
    expect(domains.find((d) => d.isInitial === true)?.name).toBe(BASE_DOMAIN);
    // Every user's UPN suffix is a verified domain.
    const names = new Set(domains.map((d) => d.name));
    for (const u of (await b.store.list('users')) as Row[]) expect(names).toContain(String(u.userPrincipalName).split('@')[1]);
    expect(await page(b.table, `/v1.0/organization${q("id eq 'sim-tenant-muster-partial'")}`)).toHaveLength(1);
    expect(await page(b.table, `/v1.0/organization${q("id eq 'other'")}`)).toHaveLength(0);
  });

  it('GET /v1.0/subscribedSkus returns the default G5 SKU, consumed = licensed users', async () => {
    const skus = await page(b.table, '/v1.0/subscribedSkus');
    expect(skus).toHaveLength(1);
    const users = (await b.store.list('users')) as Row[];
    const licensed = users.filter((u) => ((u.assignedLicenses as Row[] | undefined) ?? []).some((l) => l.skuId === 'sim-sku-g5'));
    expect(users).toHaveLength(5);
    expect(licensed).toHaveLength(5);
    expect(skus[0]).toMatchObject({ skuId: 'sim-sku-g5', skuPartNumber: 'SIM_M365_G5_GCCHIGH', prepaidUnits: { enabled: 25 }, consumedUnits: 5 });
    expect(MUSTER_G5_RULE.test(String(skus[0].skuPartNumber))).toBe(true);
    expect(await page(b.table, `/v1.0/subscribedSkus${q('consumedUnits ge 5')}`)).toHaveLength(1);
    expect(await page(b.table, `/v1.0/subscribedSkus${q("skuPartNumber eq 'OTHER'")}`)).toHaveLength(0);
  });

  it('serves no PIM eligibility (the seed has none) until an adminAssign request adds one', async () => {
    expect(await page(b.table, ELIG)).toHaveLength(0);
    expect(await page(b.table, INST)).toHaveLength(0);
    await b.table.resolveUri('POST', '/v1.0/roleManagement/directory/roleEligibilityScheduleRequests', {
      action: 'adminAssign',
      principalId: 'user-1',
      roleDefinitionId: '62e90394-69f5-4237-9190-012177145e10',
      directoryScopeId: '/',
      scheduleInfo: { startDateTime: new Date(Date.now() - 60000).toISOString(), expiration: { type: 'noExpiration' } },
    });
    const sched = await page(b.table, ELIG);
    expect(sched).toHaveLength(1);
    const inst = await page(b.table, INST);
    expect(inst).toHaveLength(1);
    expect(inst[0]).toMatchObject({ principalId: 'user-1', roleEligibilityScheduleId: sched[0].id, endDateTime: null });
    expect(await page(b.table, `${INST}${q("principalId eq 'user-1'")}`)).toHaveLength(1);
    expect(await page(b.table, `${INST}${q("principalId eq 'user-2'")}`)).toHaveLength(0);
  });
});

describe('W1 tenant reads on S1 (s1-mach)', () => {
  let b: Built;
  let ctx: {
    slug: string;
    domain: string;
    operatorSeedId: string;
    organization: { displayName: string };
    accounts: Array<{ seedId: string; upn: string; kind: string }>;
    pim: { eligible: Array<{ principalSeedId: string; roleTemplateId: string }> };
  };
  beforeAll(async () => {
    b = await build('s1-mach');
    ctx = (b.scenario.seedContext as Record<string, typeof ctx>)['customer-history'];
  }, 120000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('GET /v1.0/me returns the administrator admin account user-48', async () => {
    expect(ctx.operatorSeedId).toBe('user-48');
    const op = ctx.accounts.find((a) => a.seedId === 'user-48')!;
    expect(op.kind).toBe('admin');
    const me = (await b.table.resolveUri('GET', '/v1.0/me')) as Row;
    expect(me).toMatchObject({ id: 'user-48', userPrincipalName: op.upn });
    expect(String(me.userPrincipalName)).toMatch(/^adm\./);
  });

  it('GET /v1.0/organization returns sim-tenant-s1-mach, the legal name and the S1 domain as default', async () => {
    const org = await page(b.table, '/v1.0/organization');
    expect(org).toHaveLength(1);
    expect(org[0]).toMatchObject({ id: 'sim-tenant-s1-mach', displayName: ctx.organization.displayName });
    expect(String(org[0].displayName)).toMatch(/\(FICTIONAL\)$/);
    const domains = org[0].verifiedDomains as Row[];
    expect(domains.find((d) => d.isDefault === true)?.name).toBe(ctx.domain);
    expect(domains.find((d) => d.isInitial === true)?.name).toBe(BASE_DOMAIN);
    expect(await page(b.table, `/v1.0/organization${q("displayName eq 'Sim Tenant'")}`)).toHaveLength(0);
  });

  it('GET /v1.0/subscribedSkus returns the customer G5 SKU: 50 prepaid, 44 consumed', async () => {
    const skus = await page(b.table, '/v1.0/subscribedSkus');
    expect(skus).toHaveLength(1);
    expect(skus[0]).toMatchObject({ skuId: 'sim-sku-g5-gcchigh', prepaidUnits: { enabled: 50 }, consumedUnits: 44 });
    const licensed = ((await b.store.list('users')) as Row[]).filter((u) => ((u.assignedLicenses as Row[] | undefined) ?? []).length > 0);
    expect(licensed).toHaveLength(44);
    expect(MUSTER_G5_RULE.test(String(skus[0].skuPartNumber))).toBe(true);
    expect(await page(b.table, `/v1.0/subscribedSkus${q('consumedUnits gt 44')}`)).toHaveLength(0);
  });

  // W5c2 follow-up 6 (SIM-A4): + Compliance Administrator for the ISSM's admin account (user-46).
  // W7-SIM: + Global Administrator for the operator's admin account (user-48).
  it('GET roleEligibilitySchedules returns the 7 eligible roles on the admin accounts', async () => {
    const sched = await page(b.table, ELIG);
    expect(sched).toHaveLength(7);
    expect(new Set(sched.map((s) => s.roleDefinitionId))).toEqual(new Set([...ctx.pim.eligible.map((e) => e.roleTemplateId), '17315797-102d-40b4-93e0-432062caca18']));
    const admins = new Set(ctx.accounts.filter((a) => a.kind === 'admin').map((a) => a.seedId));
    for (const s of sched) expect(admins).toContain(s.principalId);
    expect(await page(b.table, `${ELIG}${q("principalId eq 'user-46'")}`)).toHaveLength(3);
    expect(await page(b.table, `${ELIG}${q("principalId eq 'user-46' and roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'")}`)).toHaveLength(1);
  });

  it('GET roleEligibilityScheduleInstances projects the 7 schedules and drops an expired one', async () => {
    const sched = await page(b.table, ELIG);
    const inst = await page(b.table, INST);
    expect(inst).toHaveLength(7);
    for (const i of inst) {
      const s = sched.find((x) => x.id === i.roleEligibilityScheduleId)!;
      expect(i).toMatchObject({ principalId: s.principalId, roleDefinitionId: s.roleDefinitionId, directoryScopeId: '/', memberType: 'Direct' });
    }
    expect(await page(b.table, `${INST}${q("principalId eq 'user-46'")}`)).toHaveLength(3);
    expect(await page(b.table, `${INST}${q(`endDateTime gt ${new Date().toISOString()}`)}`)).toHaveLength(7);
    await b.store.create('roleEligibilitySchedules', {
      id: 'roleEligibilitySchedule-expired',
      principalId: 'user-49',
      roleDefinitionId: '62e90394-69f5-4237-9190-012177145e10',
      directoryScopeId: '/',
      memberType: 'Direct',
      status: 'Provisioned',
      scheduleInfo: { startDateTime: '2025-01-01T00:00:00.000Z', expiration: { type: 'afterDateTime', endDateTime: '2025-06-01T00:00:00.000Z' } },
    });
    expect(await page(b.table, ELIG)).toHaveLength(8);
    expect(await page(b.table, INST)).toHaveLength(7);
    await b.store.delete('roleEligibilitySchedules', 'roleEligibilitySchedule-expired');
  });

  it('rejects an unsupported $filter with 400 on each new collection read', async () => {
    for (const uri of ['/v1.0/organization', '/v1.0/subscribedSkus', ELIG, INST]) {
      await expect(b.table.resolveUri('GET', `${uri}${q("startswith(id,'a')")}`)).rejects.toThrow(/Invalid filter clause/);
    }
  });

  it('serves /me and /organization through the Graph REST facade', async () => {
    const server = new QueryServer({ resolverTable: b.table });
    const port = await server.start(0);
    try {
      const base = `http://127.0.0.1:${port}`;
      const me = await fetch(`${base}/v1.0/me`);
      expect(me.status).toBe(200);
      expect(((await me.json()) as Row).id).toBe('user-48');
      const org = await fetch(`${base}/v1.0/organization`);
      expect(org.status).toBe(200);
      expect(((await org.json()) as { value: Row[] }).value[0].id).toBe('sim-tenant-s1-mach');
      const inst = await fetch(`${base}${INST}${q("principalId eq 'user-48'")}`);
      expect(inst.status).toBe(200);
      expect(((await inst.json()) as { value: Row[] }).value).toHaveLength(2);
      const bad = await fetch(`${base}${INST}${q("principalId eq 'a' or principalId eq 'b'")}`);
      expect(bad.status).toBe(400);
    } finally {
      await server.stop();
    }
  });
});
