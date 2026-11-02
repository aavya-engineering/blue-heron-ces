// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2 part 2: the security-monitoring collectors (C5a risk detections, C5b risky users,
 * C6a alerts, C6b incidents, C7a TVM recency, C7b TVM vulnerabilities, C8 Secure Score, C9 Intune
 * compliance), through the real ComplianceSignalFetcher and the real W1 store, on recorded fixtures.
 * Each: the window comes from the watermark; the record carries source, endpoint, host, query and
 * controls; a second run appends zero new rows and moves the watermark only forward; a 403 is a
 * not_assessed record naming the permission. Versioned sources record a later state as a new row.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import {
  runCollector, viewSignal, COLLECTED, OBSERVED_FIELD,
  riskDetectionsCollector, riskyUsersCollector, securityAlertsCollector, securityIncidentsCollector,
  tvmRecencyCollector, tvmVulnerabilitiesCollector, secureScoresCollector, secureScoreProfilesCollector, deviceComplianceCollector,
  type Collector,
} from '../../../src/eo/collect/index';
import { ScriptedTenant, CLIENT } from './scriptedTenant';

const TENANT = '00000000-0000-4000-8000-0000000002c5';
const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

describe('security-monitoring collectors (C5–C9)', () => {
  let tmp: string;
  let tenant: ScriptedTenant;
  let store: EvidenceStore;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-collect-sec-'));
    tenant = new ScriptedTenant();
    store = EvidenceStore.forStorageRoot(tmp, TENANT);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const ctx = () => ({
    storageRoot: tmp, tenantId: TENANT, tenantSlug: 'collect-sec-test',
    reader: new ComplianceSignalFetcher(tenant as any, {} as any), identity: collectorInfo(CLIENT),
  });
  const run = (c: Collector, nowMs: number) => runCollector(c, store, ctx(), nowMs);
  const recordsOf = (c: Collector) => store.records().filter((r) => r.sourceId === c.sourceId);
  const payload = (c: Collector, i = 0) => store.readPayload(recordsOf(c)[i]) as any[];

  // [collector, first-run query, controls the registry routes the endpoint to, new rows on the first run]
  // W2 part 3 (B15 extension): /security/incidents now also reaches IR.L2-3.6.1, /security/secureScores
  // also SI.L2-3.14.3; C8b (Secure Score control profiles) is emitted under /security/secureScores.
  const graphCases: Array<[Collector, string, string[], number]> = [
    [riskDetectionsCollector, `GET /v1.0/identityProtection/riskDetections?$filter=detectedDateTime%20ge%20${iso(NOW - 90 * DAY)}`, ['SI.L2-3.14.6', 'SI.L2-3.14.7'], 2],
    [riskyUsersCollector, `GET /v1.0/identityProtection/riskyUsers?$filter=riskLastUpdatedDateTime%20ge%20${iso(NOW - 90 * DAY)}`, [], 1],
    [securityAlertsCollector, `GET /v1.0/security/alerts_v2?$filter=lastUpdateDateTime%20ge%20${iso(NOW - 30 * DAY)}`, ['IR.L2-3.6.1', 'SI.L2-3.14.3', 'SI.L2-3.14.6', 'SI.L2-3.14.7'], 3],
    [securityIncidentsCollector, `GET /v1.0/security/incidents?$expand=alerts&$filter=lastUpdateDateTime%20ge%20${iso(NOW - 90 * DAY)}`, ['AU.L2-3.3.5', 'IR.L2-3.6.1'], 2],
    [secureScoresCollector, 'GET /v1.0/security/secureScores?$top=90', ['SI.L2-3.14.3', 'SI.L2-3.14.6'], 2],
    [secureScoreProfilesCollector, 'GET /v1.0/security/secureScoreControlProfiles', ['SI.L2-3.14.3', 'SI.L2-3.14.6'], 3],
    [deviceComplianceCollector, 'GET /v1.0/deviceManagement/managedDevices?$select=id,deviceName,operatingSystem,complianceState,lastSyncDateTime', ['CM.L2-3.4.1', 'CM.L2-3.4.2', 'RA.L2-3.11.2', 'SI.L1-3.14.1'], 3],
  ];

  const named = graphCases.map((g) => [g[0].planId, ...g] as const);

  it.each(named)('%s: first window, exact query, record fields, controls and rows', async (_id, c, query, controls, n) => {
    const r = await run(c, NOW);
    expect(r).toMatchObject({ planId: c.planId, sourceId: c.sourceId, status: 'success', newItems: n, watermarkBefore: null });
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0].end).toBe(iso(NOW));
    const [rec] = recordsOf(c);
    expect(rec).toMatchObject({
      endpoint: c.endpoint, host: 'graph.microsoft.us', query, status: 'success', itemCount: n,
      collector: { name: `ces-eo/collect/${c.planId}`, identity: expect.stringContaining(`@${CLIENT}`) },
    });
    for (const id of controls) expect(rec.controlIds).toContain(id);
    if (controls.length === 0) expect(rec.controlIds).toEqual([]);
    expect(store.watermarks.get(c.sourceId)!.lastWindowEnd).toBe(iso(NOW));
  });

  it.each(named)('%s: a second run starts at the watermark less 15 minutes and appends zero new rows', async (_id, c) => {
    await run(c, NOW);
    const wm1 = store.watermarks.get(c.sourceId)!;
    const r2 = await run(c, NOW + 5 * MIN);
    const start = Math.max(Date.parse(wm1.lastEventTime ?? wm1.lastWindowEnd!), Date.parse(wm1.lastWindowEnd!)) - 15 * MIN;
    expect(r2.windows).toEqual([{ start: iso(start), end: iso(NOW + 5 * MIN) }]);
    expect(r2).toMatchObject({ status: 'empty', newItems: 0 });
    const wm2 = store.watermarks.get(c.sourceId)!;
    expect(Date.parse(wm2.lastWindowEnd!)).toBeGreaterThan(Date.parse(wm1.lastWindowEnd!));
    expect(Date.parse(wm2.lastEventTime ?? '0')).toBeGreaterThanOrEqual(Date.parse(wm1.lastEventTime ?? '0'));
    expect(store.verify().ok).toBe(true);
  });

  it('C6a: a later state of an alert is collected once as a new version; the view keeps both versions', async () => {
    await run(securityAlertsCollector, NOW);
    tenant.graph.alerts_v2 = (tenant.graph.alerts_v2 as any[]).map((a) => (a.id === 'alert-0001'
      ? { ...a, status: 'resolved', classification: 'truePositive', lastUpdateDateTime: '2026-10-27T11:50:00.000Z' } : a));
    const r2 = await run(securityAlertsCollector, NOW + 10 * MIN);
    expect(r2).toMatchObject({ status: 'success', newItems: 1 });
    expect(payload(securityAlertsCollector, 1)).toEqual([expect.objectContaining({ id: 'alert-0001', status: 'resolved' })]);
    expect((await run(securityAlertsCollector, NOW + 20 * MIN)).newItems).toBe(0);
    const view = viewSignal(securityAlertsCollector, store, r2, NOW + 10 * MIN);
    const rows = (view.rawData as { value: any[] }).value;
    expect(rows.filter((a) => a.id === 'alert-0001').map((a) => a.status).sort()).toEqual(['new', 'resolved']);
    expect(view).toMatchObject({ signalId: COLLECTED.SECURITY_ALERTS, source: 'graph', endpoint: '/security/alerts_v2', status: 'success' });
  });

  it('C6b: incidents carry their alerts inline; a rows-older-than-the-view incident is not in the view', async () => {
    const r = await run(securityIncidentsCollector, NOW);
    expect(payload(securityIncidentsCollector).map((i) => [i.id, i.alerts.length])).toEqual([['inc-0002', 1], ['inc-0001', 2]]);
    tenant.graph.incidents = [...tenant.graph.incidents, { id: 'inc-old', status: 'resolved', createdDateTime: '2026-06-01T00:00:00.000Z', lastUpdateDateTime: '2026-06-02T00:00:00.000Z', alerts: [] }];
    const view = viewSignal(securityIncidentsCollector, store, r, NOW);
    expect((view.rawData as { value: any[] }).value.map((i) => i.id)).toEqual(['inc-0001', 'inc-0002']);
  });

  it('C7a: the KQL carries the window start; rows assessed before the window are not collected', async () => {
    tenant.hunting.DeviceTvmInfoGathering = [
      ...tenant.hunting.DeviceTvmInfoGathering,
      { DeviceId: 'dev-0009', DeviceName: 'wks-009', LastAssessed: '2026-08-01T00:00:00.000Z' },
    ];
    const r = await run(tvmRecencyCollector, NOW);
    const [rec] = recordsOf(tvmRecencyCollector);
    expect(rec.query).toBe(`POST /v1.0/security/runHuntingQuery DeviceTvmInfoGathering | where Timestamp >= datetime(${iso(NOW - 30 * DAY)}) | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName`);
    expect(rec.controlIds).toEqual(expect.arrayContaining(['RA.L2-3.11.2', 'RA.L2-3.11.3']));
    expect(r.newItems).toBe(2);
    expect(payload(tvmRecencyCollector).map((d) => d.DeviceId)).toEqual(['dev-0002', 'dev-0001']);
    const cmd = tenant.calls.find((c) => c.cmd.includes('runHuntingQuery'))!.cmd;
    expect(cmd).toContain("Invoke-MgGraphRequest -Method POST -Uri '/v1.0/security/runHuntingQuery'");
    expect((await run(tvmRecencyCollector, NOW + 5 * MIN)).newItems).toBe(0);
  });

  it('C7b: a state table with no time; rows are stamped with the window end and collected once per state', async () => {
    await run(tvmVulnerabilitiesCollector, NOW);
    const [rec] = recordsOf(tvmVulnerabilitiesCollector);
    expect(rec.query).toBe('POST /v1.0/security/runHuntingQuery DeviceTvmSoftwareVulnerabilities');
    expect(payload(tvmVulnerabilitiesCollector).every((v) => v[OBSERVED_FIELD] === iso(NOW))).toBe(true);
    expect(rec.itemCount).toBe(3);
    expect((await run(tvmVulnerabilitiesCollector, NOW + DAY)).newItems).toBe(0);
    tenant.hunting.DeviceTvmSoftwareVulnerabilities = (tenant.hunting.DeviceTvmSoftwareVulnerabilities as any[])
      .map((v) => (v.CveId === 'CVE-2026-00001' ? { ...v, CveMitigationStatus: 'applied' } : v));
    const r3 = await run(tvmVulnerabilitiesCollector, NOW + 2 * DAY);
    expect(r3.newItems).toBe(1);
    expect(payload(tvmVulnerabilitiesCollector, 2)).toEqual([expect.objectContaining({ CveId: 'CVE-2026-00001', CveMitigationStatus: 'applied', [OBSERVED_FIELD]: iso(NOW + 2 * DAY) })]);
  });

  it('C8: scores dated before the window start are not collected (the read has no $filter)', async () => {
    tenant.graph.secureScores = [...tenant.graph.secureScores, { id: 'fixture-tenant_2026-06-01', currentScore: 40, createdDateTime: '2026-06-01T00:00:00.000Z' }];
    const r = await run(secureScoresCollector, NOW);
    expect(r.newItems).toBe(2);
    expect(payload(secureScoresCollector).map((s) => s.id)).toEqual(['fixture-tenant_2026-10-26', 'fixture-tenant_2026-10-27']);
  });

  it('C8b: profiles are stamped with the window end; a profile whose implementation status changes is collected again', async () => {
    await run(secureScoreProfilesCollector, NOW);
    expect(payload(secureScoreProfilesCollector).map((p) => [p.id, p[OBSERVED_FIELD]])).toEqual(
      expect.arrayContaining([['mdo_safelinksforemail', iso(NOW)], ['MFARegistrationV2', iso(NOW)]]));
    tenant.graph.secureScoreControlProfiles = (tenant.graph.secureScoreControlProfiles as any[])
      .map((p) => (p.id === 'mdo_safelinksforemail' ? { ...p, implementationStatus: 'Implemented' } : p));
    const r2 = await run(secureScoreProfilesCollector, NOW + DAY);
    expect(r2.newItems).toBe(1);
    expect(payload(secureScoreProfilesCollector, 1)).toEqual([expect.objectContaining({ id: 'mdo_safelinksforemail', implementationStatus: 'Implemented', [OBSERVED_FIELD]: iso(NOW + DAY) })]);
  });

  it('C9: a device whose compliance state changes is collected again; an unchanged one is not', async () => {
    await run(deviceComplianceCollector, NOW);
    tenant.graph.managedDevices = (tenant.graph.managedDevices as any[]).map((d) => (d.id === 'md-0002' ? { ...d, complianceState: 'compliant' } : d));
    const r2 = await run(deviceComplianceCollector, NOW + DAY);
    expect(r2.newItems).toBe(1);
    expect(payload(deviceComplianceCollector, 1)).toEqual([expect.objectContaining({ id: 'md-0002', complianceState: 'compliant', [OBSERVED_FIELD]: iso(NOW + DAY) })]);
  });

  it.each([
    [riskDetectionsCollector, 'riskDetections', 'IdentityRiskEvent.Read.All'],
    [securityAlertsCollector, 'alerts_v2', 'SecurityAlert.Read.All'],
    [securityIncidentsCollector, 'incidents', 'SecurityIncident.Read.All'],
    [tvmVulnerabilitiesCollector, 'runHuntingQuery', 'ThreatHunting.Read.All'],
    [secureScoresCollector, 'secureScores', 'SecurityEvents.Read.All'],
    [secureScoreProfilesCollector, 'secureScoreControlProfiles', 'SecurityEvents.Read.All'],
    [deviceComplianceCollector, 'managedDevices', 'DeviceManagementManagedDevices.Read.All'],
  ].map((x) => [(x[0] as Collector).planId, ...x]))('403 on %s: a not_assessed record naming the permission; the watermark does not move', async (_id, c, name, permission) => {
    tenant.denied.add(name as string);
    const r = await run(c as Collector, NOW);
    expect(r.status).toBe('not_assessed');
    const [rec] = recordsOf(c as Collector);
    expect(rec).toMatchObject({ status: 'not_assessed', itemCount: 0 });
    expect(rec.error).toContain(`missing permission (${permission})`);
    expect(store.watermarks.get((c as Collector).sourceId)).toBeUndefined();
    expect(viewSignal(c as Collector, store, r, NOW)).toMatchObject({ status: 'not_assessed', rawData: null });
  });

  it('no resolver (a sim without the collection): an error record and an error view, no watermark', async () => {
    tenant.missing.add('secureScores');
    const r = await run(secureScoresCollector, NOW);
    expect(r.status).toBe('error');
    expect(recordsOf(secureScoresCollector)[0]).toMatchObject({ status: 'error', itemCount: 0 });
    expect(store.watermarks.get(COLLECTED.SECURE_SCORES)).toBeUndefined();
    expect(viewSignal(secureScoresCollector, store, r, NOW)).toMatchObject({ status: 'error', rawData: null });
  });
});
