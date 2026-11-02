// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { searchUnifiedAuditLog } from '../../src/resolvers/semantics.js';
import { QueryServer } from '../../src/http/QueryServer.js';
import { b20UalId } from '../../src/seed/sets/eoCollectionB20.js';
import { Ledger } from '../../src/ledger/Ledger.js';
import { DirectoryAuditWriter } from '../../src/audit/DirectoryAuditWriter.js';

/**
 * EO-collection B20 (2026-10-27): the muster-partial log-record seed, the URI
 * $filter date operators, the identity-protection / PIM URI handlers, the
 * advanced-hunting table routing and Search-UnifiedAuditLog windows.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAY = 86400000;
const HOUR = 3600000;
const SCENARIO_USERS = [1, 2, 3, 4, 5].map((n) => `sim.user${n}@simtenant.onmicrosoft.us`);

type Row = Record<string, unknown>;

describe('B20 muster-partial collector seed and sim reads', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;
  let seedCounts: Record<string, number>;
  let builtAt: number;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-b20-'));
    const tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', 'muster-partial.json'));
    builtAt = Date.now();
    const result = await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    seedCounts = result.seedCounts;
    store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const iso = (ms: number) => new Date(ms).toISOString();
  const get = async (uri: string) => ((await table.resolveUri('GET', uri)) as { value: Row[] }).value;

  it('seeds the B20 inventory into muster-partial', async () => {
    expect(seedCounts).toMatchObject({
      unifiedAuditLog: 30,
      securityIncidents: 1,
      alerts: 2,
      riskyUsers: 1,
      riskDetections: 2,
      roleAssignmentScheduleRequests: 1,
    });
    const ual = (await store.list('unifiedAuditLog')) as Row[];
    expect(new Set(ual.map((r) => r.id)).size).toBe(30);
    for (const r of ual) {
      expect(SCENARIO_USERS).toContain(r.UserIds);
      expect(r).not.toHaveProperty('ageMinutes');
    }
    const workloads = new Set(ual.map((r) => (JSON.parse(String(r.AuditData)) as Row).Workload));
    for (const w of ['Exchange', 'SharePoint', 'AzureActiveDirectory', 'MicrosoftTeams']) expect(workloads).toContain(w);
    const cutoff = builtAt - 30 * DAY;
    expect(ual.filter((r) => Date.parse(String(r.CreationDate)) >= cutoff)).toHaveLength(28);
    expect(ual.filter((r) => Date.parse(String(r.CreationDate)) < cutoff)).toHaveLength(2);
  });

  it('Search-UnifiedAuditLog honours -StartDate/-EndDate and returns stable Identity values (no hourly re-dating)', async () => {
    const last30 = (await table.resolveCmdlet('Search-UnifiedAuditLog', [
      '-StartDate', iso(builtAt - 30 * DAY), '-EndDate', iso(builtAt + HOUR), '-ResultSize', 5000,
    ])) as Row[];
    expect(last30).toHaveLength(28);
    const week = (await table.resolveCmdlet('Search-UnifiedAuditLog', [
      '-StartDate', iso(builtAt - 7 * DAY), '-EndDate', iso(builtAt + HOUR), '-ResultSize', 5000,
    ])) as Row[];
    expect(week.length).toBeGreaterThan(0);
    expect(week.length).toBeLessThan(28);
    const all = (await table.resolveCmdlet('Search-UnifiedAuditLog', [
      '-StartDate', iso(builtAt - 60 * DAY), '-EndDate', iso(builtAt + HOUR), '-ResultSize', 5000,
    ])) as Row[];
    expect(all).toHaveLength(30);
    expect(all.map((r) => r.Identity).sort()).toEqual(Array.from({ length: 30 }, (_, i) => b20UalId(i + 1)).sort());

    // Read again "three hours later": identical Identity and CreationDate per row.
    const args = ['-StartDate', iso(builtAt - 60 * DAY), '-EndDate', iso(builtAt + 4 * HOUR), '-ResultSize', 5000];
    const a = (await searchUnifiedAuditLog(store, args, builtAt)) as Row[];
    const b = (await searchUnifiedAuditLog(store, args, builtAt + 3 * HOUR)) as Row[];
    expect(b.map((r) => [r.Identity, r.CreationDate])).toEqual(a.map((r) => [r.Identity, r.CreationDate]));
    const pim = a.filter((r) => r.Operations === 'Add member to role completed (PIM activation)');
    expect(pim).toHaveLength(1);
  });

  it('serves riskDetections, riskyUsers and roleAssignmentScheduleRequests by URI, with date filters', async () => {
    const since90 = iso(builtAt - 90 * DAY);
    const detections = await get(`/v1.0/identityProtection/riskDetections?$filter=detectedDateTime%20ge%20${since90}`);
    expect(detections.map((d) => d.id).sort()).toEqual(['riskDetection-1', 'riskDetection-b20-2']);
    for (const d of detections) expect(d).toMatchObject({ userId: 'user-3', riskState: 'atRisk' });
    expect(await get(`/v1.0/identityProtection/riskDetections?$filter=detectedDateTime%20ge%20${iso(builtAt)}`)).toHaveLength(0);

    const risky = await get('/v1.0/identityProtection/riskyUsers');
    expect(risky).toHaveLength(1);
    expect(risky[0]).toMatchObject({ id: 'user-3', riskLevel: 'high', riskState: 'atRisk' });

    const requests = await get(
      `/v1.0/roleManagement/directory/roleAssignmentScheduleRequests?$filter=createdDateTime%20ge%20${iso(builtAt - 7 * DAY)}`,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ action: 'selfActivate', principalId: 'user-1', status: 'Provisioned' });
    expect(
      await get(`/v1.0/roleManagement/directory/roleAssignmentScheduleRequests?$filter=createdDateTime%20ge%20${iso(builtAt - DAY)}`),
    ).toHaveLength(0);
  });

  it('applies lastUpdateDateTime / createdDateTime windows to alerts_v2 and incidents', async () => {
    const alerts = await get('/v1.0/security/alerts_v2');
    expect(alerts).toHaveLength(2);
    for (const a of alerts) expect(a).toMatchObject({ incidentId: 'incident-b20-1' });
    const recent = await get(`/v1.0/security/alerts_v2?$filter=lastUpdateDateTime%20ge%20${iso(builtAt - 36 * HOUR)}`);
    expect(recent.map((a) => a.id)).toEqual(['alert-2']);

    const incidents = await get(`/v1.0/security/incidents?$expand=alerts&$filter=createdDateTime%20ge%20${iso(builtAt - 90 * DAY)}`);
    expect(incidents).toHaveLength(1);
    expect((incidents[0].alerts as Row[]).map((a) => a.id)).toEqual(['alert-1', 'alert-2']);
    const sources = new Set((incidents[0].alerts as Row[]).map((a) => a.serviceSource));
    expect(sources.size).toBe(2);
    expect(await get(`/v1.0/security/incidents?$filter=lastUpdateDateTime%20gt%20${iso(builtAt)}`)).toHaveLength(0);
  });

  it('applies activityDateTime / createdDateTime windows to directoryAudits and signIns', async () => {
    // A mutation through a fully-wired table writes a directoryAudits row, as under `stacksim serve`.
    const wired = new ResolverTable(store, new StackShapeGate('m365_azure'), undefined,
      new DirectoryAuditWriter(store, new Ledger(path.join(dir, 'tenant', 'ledger.jsonl'))));
    await wired.resolveCmdlet('Enable-OrganizationCustomization', []);
    const audits = await get(`/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%20${iso(builtAt - 30 * DAY)}`);
    expect(audits.length).toBeGreaterThan(0);
    expect(await get(`/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20gt%20${iso(Date.now() + HOUR)}`)).toHaveLength(0);
    const signIns = await get(`/v1.0/auditLogs/signIns?$filter=createdDateTime%20ge%20${iso(builtAt - 30 * DAY)}`);
    expect(signIns).toHaveLength(2);
    expect(await get(`/v1.0/auditLogs/signIns?$filter=createdDateTime%20lt%20${iso(builtAt - 30 * DAY)}`)).toHaveLength(0);
  });

  it('rejects an unsupported $filter with HTTP 400 on /resolve and on the Graph REST facade', async () => {
    const server = new QueryServer({ resolverTable: table });
    const port = await server.start(0);
    try {
      const base = `http://127.0.0.1:${port}`;
      const viaResolve = await fetch(`${base}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'uri', method: 'GET', uri: "/v1.0/auditLogs/signIns?$filter=startswith(userPrincipalName,'sim')" }),
      });
      expect(viaResolve.status).toBe(400);
      expect(((await viaResolve.json()) as { error: string }).error).toMatch(/^Request_BadRequest: Invalid filter clause/);

      const viaRest = await fetch(`${base}/v1.0/security/alerts_v2?$filter=${encodeURIComponent("severity eq 'high' or severity eq 'medium'")}`);
      expect(viaRest.status).toBe(400);

      const ok = await fetch(`${base}/v1.0/security/alerts_v2?$filter=${encodeURIComponent(`lastUpdateDateTime ge ${iso(builtAt - 36 * HOUR)}`)}`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { value: Row[] }).value.map((a) => a.id)).toEqual(['alert-2']);
    } finally {
      await server.stop();
    }
  });

  it('routes advanced hunting by the KQL table', async () => {
    const hunt = async (Query: string) =>
      (await table.resolveUri('POST', '/v1.0/security/runHuntingQuery', { Query })) as { schema: Row[]; results: Row[] };
    const tvm = await hunt('DeviceTvmSoftwareVulnerabilities | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName');
    const gathering = await hunt('DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName');
    expect(tvm.schema.map((c) => c.name)).toEqual(['DeviceId', 'DeviceName', 'LastAssessed']);
    expect(gathering).toEqual(tvm);

    const info = await hunt('AlertInfo | where Timestamp > ago(7d)');
    expect(info.results.map((r) => r.AlertId)).toEqual(['alert-1', 'alert-2']);
    expect(info.results.map((r) => r.ServiceSource)).toEqual(['microsoftDefenderForOffice365', 'azureAdIdentityProtection']);
    const evidence = await hunt('AlertEvidence | where EntityType == "User"');
    expect(evidence.results).toHaveLength(3);
    expect(evidence.results.filter((r) => r.EntityType === 'User').every((r) => r.AccountUpn === SCENARIO_USERS[2])).toBe(true);

    const other = await hunt('EmailEvents | take 10');
    expect(other).toEqual({ schema: [], results: [] });
  });
});
