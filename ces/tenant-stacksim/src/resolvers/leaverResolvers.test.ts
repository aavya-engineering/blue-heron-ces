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
import { loadScenario, applyScenario } from '../scenarios/ScenarioEngine.js';
import { ObjectStore } from '../store/ObjectStore.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable } from './ResolverTable.js';

/**
 * PH-13 P13-LV (2026-11-01) golden tests for AdminOps A-22, leaver access termination (ces-ao
 * TemplateRegistry.ts): the SET is A-22's call sequence, and the GET after it is the read the proposed
 * Stamper entry PS.L2-3.9.2.leaver-access-terminated makes (users whose employeeLeaveDateTime has passed),
 * which must then return enabledPastLeaverCount 0 and licensedPastLeaverCount 0.
 * Also: the MFA method delete resolver (leaverResolvers.ts) refuses the password method and unknown ids.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANCHOR_ISO = '2026-10-01T00:00:00.000Z';
const NOW = '2026-11-01T00:00:00Z';
type Row = Record<string, unknown>;

async function build(slug: string): Promise<{ dir: string; table: ResolverTable; store: ObjectStore }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-p13lv-${slug}-`));
  const tenantRoot = path.join(dir, 'tenant');
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  const prev = process.env.STACKSIM_FIXED_NOW;
  process.env.STACKSIM_FIXED_NOW = ANCHOR_ISO;
  try {
    await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
  } finally {
    if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
    else process.env.STACKSIM_FIXED_NOW = prev;
  }
  const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const asList = (v: unknown): Row[] => {
  if (Array.isArray(v)) return v as Row[];
  const val = (v as { value?: unknown } | null | undefined)?.value;
  if (Array.isArray(val)) return val as Row[];
  return v ? [v as Row] : [];
};
const typeOf = (o: Row): string => String(o['@odata.type'] ?? (o.AdditionalProperties as Row | undefined)?.['@odata.type'] ?? '');

/** ces-ao TemplateRegistry.ts A22_DELETABLE_METHOD_SEGMENTS (kept equal by hand). */
const SEGMENTS: Record<string, string> = {
  '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod': 'microsoftAuthenticatorMethods',
  '#microsoft.graph.phoneAuthenticationMethod': 'phoneMethods',
  '#microsoft.graph.fido2AuthenticationMethod': 'fido2Methods',
  '#microsoft.graph.softwareOathAuthenticationMethod': 'softwareOathMethods',
  '#microsoft.graph.emailAuthenticationMethod': 'emailMethods',
  '#microsoft.graph.windowsHelloForBusinessAuthenticationMethod': 'windowsHelloForBusinessMethods',
  '#microsoft.graph.temporaryAccessPassAuthenticationMethod': 'temporaryAccessPassMethods',
  '#microsoft.graph.platformCredentialAuthenticationMethod': 'platformCredentialMethods',
};

/** A-22's set, call for call (the cmdlet path the PowerShell shims post to /resolve). */
async function a22(table: ResolverTable, upn: string): Promise<{ groups: number; licences: number; methods: number }> {
  const u = asList(await table.resolveCmdlet('Get-MgUser', ['-Filter', `userPrincipalName eq '${upn}'`, '-Property', 'Id,UserPrincipalName,AccountEnabled,AssignedLicenses']))[0];
  expect(u, upn).toBeDefined();
  const id = String(u.id ?? u.Id);
  if (u.accountEnabled !== false) await table.resolveCmdlet('Update-MgUser', ['-UserId', id, '-AccountEnabled', false]);
  await table.resolveCmdlet('Revoke-MgUserSignInSession', ['-UserId', id]);
  const groups = asList(await table.resolveCmdlet('Get-MgUserMemberOf', ['-UserId', id, '-All', true])).filter((g) => typeOf(g) === '#microsoft.graph.group');
  for (const g of groups) await table.resolveCmdlet('Remove-MgGroupMemberByRef', ['-GroupId', String(g.id), '-DirectoryObjectId', id]);
  const skus = asList(u.assignedLicenses ?? u.AssignedLicenses).map((l) => String(l.skuId ?? l.SkuId ?? '')).filter(Boolean);
  if (skus.length) await table.resolveCmdlet('Set-MgUserLicense', ['-UserId', id, '-AddLicenses', [], '-RemoveLicenses', skus]);
  const methods = asList(await table.resolveCmdlet('Get-MgUserAuthenticationMethod', ['-UserId', id]));
  let deleted = 0;
  for (const m of methods) {
    const seg = SEGMENTS[typeOf(m)];
    if (!seg) continue;
    await table.resolveUri('DELETE', `/v1.0/users/${id}/authentication/${seg}/${String(m.id)}`);
    deleted++;
  }
  return { groups: groups.length, licences: skus.length, methods: deleted };
}

/** The read of the proposed Stamper entry PS.L2-3.9.2.leaver-access-terminated, computed as its PowerShell does. */
async function leaverInventory(table: ResolverTable) {
  const u = asList(await table.resolveUri('GET', `/v1.0/users?$filter=employeeLeaveDateTime le ${NOW}&$select=id,userPrincipalName,accountEnabled,employeeLeaveDateTime,assignedLicenses`));
  const enabled = u.filter((x) => x.accountEnabled === true);
  return {
    displayName: 'CES leaver access inventory',
    pastLeaverCount: u.length,
    enabledPastLeaverCount: enabled.length,
    licensedPastLeaverCount: u.filter((x) => asList(x.assignedLicenses).length > 0).length,
    enabledPastLeavers: enabled.map((x) => x.userPrincipalName),
  };
}

const CASES = [
  ['s1-mach', 'merrin.hollinmere@s1-mach.simtenant.onmicrosoft.us'],
  ['s2-eng', 'ext.calvane.heathford@s2-eng.simtenant.onmicrosoft.us'],
] as const;

for (const [slug, upn] of CASES) {
  describe(`P13-LV A-22 on ${slug}`, () => {
    let b: Awaited<ReturnType<typeof build>>;
    beforeAll(async () => {
      b = await build(slug);
    }, 180_000);
    afterAll(async () => {
      await fs.rm(b.dir, { recursive: true, force: true });
    });

    it('before: the open leaver is enabled, so the leaver read is NOT_SAT (enabledPastLeaverCount 1)', async () => {
      const inv = await leaverInventory(b.table);
      expect(inv.pastLeaverCount).toBeGreaterThanOrEqual(1);
      expect(inv.enabledPastLeaverCount).toBe(1);
      expect(inv.enabledPastLeavers).toEqual([upn]);
    });

    it('SET (A-22) then GET: disabled, sessions revoked, no groups, no licences, only the password method left; the leaver read returns 0 enabled and 0 licensed', async () => {
      const before = Date.now();
      const r = await a22(b.table, upn);
      expect(r.groups).toBeGreaterThan(0);
      expect(r.licences).toBeGreaterThan(0);
      expect(r.methods).toBeGreaterThan(0);
      const u = asList(await b.table.resolveCmdlet('Get-MgUser', ['-Filter', `userPrincipalName eq '${upn}'`]))[0];
      expect(u.accountEnabled).toBe(false);
      expect(Date.parse(String(u.signInSessionsValidFromDateTime))).toBeGreaterThanOrEqual(before - 1000);
      expect(asList(u.assignedLicenses)).toEqual([]);
      const id = String(u.id);
      expect(asList(await b.table.resolveCmdlet('Get-MgUserMemberOf', ['-UserId', id]))).toEqual([]);
      const left = asList(await b.table.resolveCmdlet('Get-MgUserAuthenticationMethod', ['-UserId', id]));
      expect(left.map(typeOf)).toEqual(['#microsoft.graph.passwordAuthenticationMethod']);
      const inv = await leaverInventory(b.table);
      expect(inv.enabledPastLeaverCount).toBe(0);
      expect(inv.licensedPastLeaverCount).toBe(0);
      expect(inv.pastLeaverCount).toBeGreaterThanOrEqual(1);
    });

    it('a re-run finds nothing left to remove (idempotent; only the sessions are revoked again)', async () => {
      const r = await a22(b.table, upn);
      expect(r).toEqual({ groups: 0, licences: 0, methods: 0 });
    });
  });
}

describe('P13-LV MFA method delete refusals (leaverResolvers.ts)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 180_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('the password method cannot be deleted (400); an unknown method, a wrong kind or an unknown user is 404; the store is unchanged', async () => {
    const methods = (await b.store.list('authMethods')).filter((m) => (m as Row).userId === 'user-7');
    const pw = methods.find((m) => (m as Row).methodType === 'password')!;
    await expect(b.table.resolveUri('DELETE', `/v1.0/users/user-7/authentication/passwordMethods/${pw.id}`)).rejects.toThrow(/cannot be deleted/);
    await expect(b.table.resolveUri('DELETE', '/v1.0/users/user-7/authentication/fido2Methods/no-such-id')).rejects.toThrow(/no fido2 authentication method/);
    await expect(b.table.resolveUri('DELETE', '/v1.0/users/nobody@nowhere.invalid/authentication/fido2Methods/x')).rejects.toThrow(/no users object/);
    const authn = methods.find((m) => (m as Row).methodType === 'microsoftAuthenticator')!;
    await expect(b.table.resolveUri('DELETE', `/v1.0/users/user-7/authentication/fido2Methods/${authn.id}`)).rejects.toThrow(/no fido2 authentication method/);
    expect((await b.store.list('authMethods')).filter((m) => (m as Row).userId === 'user-7')).toHaveLength(methods.length);
  });

  it('S3: two past leavers stay enabled when nobody confirms (the read is NOT_SAT; nothing is written)', async () => {
    const s3 = await build('s3-def');
    try {
      const inv = await leaverInventory(s3.table);
      expect(inv.enabledPastLeaverCount).toBe(2);
    } finally {
      await fs.rm(s3.dir, { recursive: true, force: true });
    }
  }, 180_000);
});
