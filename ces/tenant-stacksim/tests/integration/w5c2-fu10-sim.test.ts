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
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';

/**
 * synthetic-customer W5 cycle 2, follow-up 10 (2026-10-28): the EvidenceOps
 * coverage reads (LOG-W5c4-eo-coverage.md §6, SIM-W4c1..W4c7) at the exact
 * paths that log names; S1 seeded, muster-partial routes only (empty).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const G = 'https://graph.microsoft.us';
const DAY = 86400000;
type Row = Record<string, any>;
const asList = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v ? [v as Row] : []);

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-w5c2-fu10-${slug}-`));
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
  const store = new ObjectStore(path.join(dir, 'tenant', 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}
const get = (t: ResolverTable, uri: string) => t.resolveUri('GET', uri) as Promise<Row>;
const page = async (t: ResolverTable, uri: string) => (await get(t, uri)).value as Row[];

describe('W5c2 follow-up 10: S1 coverage reads', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('s1-mach');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('SIM-W4c1: windowsProtectionState per Windows device; the 2 unencrypted workstations are overdue; iOS has none', async () => {
    const devices = await page(b.table, '/v1.0/deviceManagement/managedDevices');
    const win = devices.filter((d) => d.operatingSystem === 'Windows');
    expect(win.length).toBeGreaterThan(40);
    let overdue = 0;
    for (const d of win) {
      const s = await get(b.table, `${G}/beta/deviceManagement/managedDevices/${d.id}/windowsProtectionState`);
      expect(s).toMatchObject({ malwareProtectionEnabled: true, realTimeProtectionEnabled: true, deviceState: 'clean' });
      expect(Date.parse(s.lastFullScanDateTime)).toBeLessThan(Date.parse(s.lastReportedDateTime));
      expect(Date.now() - Date.parse(s.lastFullScanDateTime)).toBeLessThan(15 * DAY);
      if (s.signatureUpdateOverdue) overdue++;
    }
    expect(overdue).toBe(2);
    const ios = devices.find((d) => d.operatingSystem === 'iOS')!;
    await expect(get(b.table, `/beta/deviceManagement/managedDevices/${ios.id}/windowsProtectionState`)).rejects.toThrow(/no Windows protection state/);
    await expect(get(b.table, '/beta/deviceManagement/managedDevices/nope/windowsProtectionState')).rejects.toThrow(/no managed device/);
    const mal = await page(b.table, `${G}/beta/deviceManagement/windowsMalwareInformation`);
    expect(mal.map((m) => [m.category, m.severity])).toEqual([['potentiallyUnwantedSoftware', 'low']]);
    const states = await page(b.table, `/beta/deviceManagement/windowsMalwareInformation/${mal[0].id}/deviceMalwareStates`);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ threatState: 'quarantined', detectionCount: 1 });
  });

  it('SIM-W4c2: terms-of-use acceptances of the CUI System Access Notice by every person and admin account', async () => {
    const agreements = await page(b.table, `${G}/v1.0/identityGovernance/termsOfUse/agreements`);
    expect(agreements.map((a) => a.displayName)).toEqual(['CUI System Access Notice']);
    const acc = await page(b.table, `/v1.0/identityGovernance/termsOfUse/agreements/${agreements[0].id}/acceptances`);
    expect(acc).toHaveLength(49);
    expect(acc.every((a) => a.state === 'accepted' && a.agreementId === agreements[0].id && /@s1-mach\.simtenant\.onmicrosoft\.us$/.test(a.userPrincipalName))).toBe(true);
    const one = await page(b.table, `/v1.0/identityGovernance/termsOfUse/agreements/${agreements[0].id}/acceptances?$filter=userId eq 'user-46'`);
    expect(one).toHaveLength(1);
  });

  it('SIM-W4c3: one quarterly privileged-role access review, its completed instance and one decision per privileged assignment', async () => {
    const defs = await page(b.table, `${G}/v1.0/identityGovernance/accessReviews/definitions`);
    expect(defs.map((d) => d.displayName)).toEqual(['S1 Quarterly privileged role review']);
    expect(defs[0].settings.recurrence.pattern).toMatchObject({ type: 'absoluteMonthly', interval: 3 });
    const inst = await page(b.table, `/v1.0/identityGovernance/accessReviews/definitions/${defs[0].id}/instances`);
    expect(inst.map((i) => i.status)).toEqual(['Completed']);
    const dec = await page(b.table, `/v1.0/identityGovernance/accessReviews/definitions/${defs[0].id}/instances/${inst[0].id}/decisions`);
    expect(dec).toHaveLength(9); // 7 PIM eligibilities (W7-SIM: + the operator's Global Administrator) + 2 standing break-glass Global Administrators
    expect(dec.every((d) => d.decision === 'Approve' && d.applyResult === 'AppliedSuccessfully')).toBe(true);
    // Nobody reviews their own access (the ISSM's admin account is reviewed by the ISSO).
    expect(dec.every((d) => d.reviewedBy.id !== d.principal.id)).toBe(true);
    const ownerOfReviewed = new Set(dec.filter((d) => d.principal.id === 'user-46').map((d) => d.reviewedBy.id));
    expect(ownerOfReviewed.size).toBe(1);
  });

  it('SIM-W4c4: Get-ProtectionAlert lists the alert policies, including the audit-logging alert', async () => {
    const pol = asList(await b.table.resolveCmdlet('Get-ProtectionAlert', []));
    expect(pol).toHaveLength(5);
    const audit = pol.find((p) => /Audit logging/.test(p.Name))!;
    expect(audit).toMatchObject({ Severity: 'High', Disabled: false, IsSystemRule: false, Operation: ['Set-AdminAuditLogConfig'] });
    expect(audit.NotifyUser).toEqual(['security@s1-mach.simtenant.onmicrosoft.us']); // W5c2 follow-up 12: the TCP.MU.007 security mailbox
  });

  it('SIM-W4c5: the NTP settings-catalog policy on the configurationPolicies read', async () => {
    const pols = await page(b.table, `${G}/beta/deviceManagement/configurationPolicies?$expand=settings,assignments`);
    const ntp = pols.find((p) => /NTP/.test(p.name))!;
    expect(ntp.assignments).toHaveLength(1);
    expect(JSON.stringify(ntp.settings)).toMatch(/time\.windows\.com,0x9/);
    expect(JSON.stringify(ntp.settings)).toMatch(/w32time_policy_enable_ntpclient_1/);
  });

  it('SIM-W4c6: remoteActionAudits (wipe, retire) and the matching Intune audit events', async () => {
    const ra = await page(b.table, `${G}/beta/deviceManagement/remoteActionAudits`);
    expect(ra.map((r) => [r.action, r.actionState, r.deviceDisplayName])).toEqual([['factoryReset', 'done', 'S1-WS-RET-01'], ['retire', 'done', 'S1-IOS-RET-01']]);
    const ev = asList(await b.table.resolveCmdlet('Get-MgDeviceManagementAuditEvent', ['-All'])).filter((e) => /ManagedDevice$/.test(e.activityType));
    expect(ev.map((e) => e.activityType).sort()).toEqual(['Retire ManagedDevice', 'Wipe ManagedDevice']);
    expect(ev.map((e) => e.resources[0].displayName).sort()).toEqual(['S1-IOS-RET-01', 'S1-WS-RET-01']);
  });

  it('SIM-W4c7: /v1.0/sites/{id}/permissions on the enclave site (by Graph id or Sim id)', async () => {
    const site = asList(await b.table.resolveCmdlet('Get-SPOSite', []))[0];
    const perms = await page(b.table, `${G}/v1.0/sites/${encodeURIComponent(site.GraphSiteId)}/permissions`);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toMatchObject({ roles: ['write'] });
    expect(perms[0].grantedToIdentitiesV2[0].application.displayName).toBe('S1 Drawing Sync (FICTIONAL)');
    expect(await page(b.table, `/v1.0/sites/${site.id}/permissions`)).toHaveLength(1);
  });
});

describe('W5c2 follow-up 10: muster-partial serves the routes with empty collections', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('muster-partial');
  }, 60_000);
  afterAll(async () => {
    await fs.rm(b.dir, { recursive: true, force: true });
  });

  it('lists are empty; per-object reads are 404s', async () => {
    for (const uri of ['/beta/deviceManagement/remoteActionAudits', '/beta/deviceManagement/windowsMalwareInformation', '/v1.0/identityGovernance/accessReviews/definitions']) {
      expect(await page(b.table, uri), uri).toEqual([]);
    }
    expect(asList(await b.table.resolveCmdlet('Get-ProtectionAlert', []))).toEqual([]);
    const agreements = await page(b.table, '/v1.0/identityGovernance/termsOfUse/agreements');
    expect(agreements.map((a) => a.id)).toEqual(['touAgreement-1']);
    expect(await page(b.table, '/v1.0/identityGovernance/termsOfUse/agreements/touAgreement-1/acceptances')).toEqual([]);
    await expect(get(b.table, '/beta/deviceManagement/managedDevices/managedDevice-1/windowsProtectionState')).rejects.toThrow(/no Windows protection state/);
    await expect(get(b.table, '/v1.0/sites/anything/permissions')).rejects.toThrow(/no SharePoint site/);
  });
});
