// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2: the Graph log collectors, C2 directory audits, C3 sign-ins and C4 PIM
 * activation requests, through the real ComplianceSignalFetcher and the real W1 store, on recorded
 * fixtures. Each: the window comes from the watermark; records carry the right source, endpoint,
 * host and query; a second run collects zero new rows (the sim returns everything, the ids are
 * known); the watermark only moves forward; a 403 is a not_assessed record naming the permission.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import {
  runCollector, runCollectors, directoryAuditsCollector, signInsCollector, pimActivationsCollector, COLLECTED,
  type Collector,
} from '../../../src/eo/collect/index';
import { ScriptedTenant, CLIENT, fixture } from './scriptedTenant';

const TENANT = '00000000-0000-4000-8000-0000000002c2';
const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const MIN = 60_000;

describe('Graph log collectors (C2, C3, C4)', () => {
  let tmp: string;
  let tenant: ScriptedTenant;
  let store: EvidenceStore;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-collect-'));
    tenant = new ScriptedTenant();
    store = EvidenceStore.forStorageRoot(tmp, TENANT);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const ctx = () => ({
    storageRoot: tmp, tenantId: TENANT, tenantSlug: 'collect-test',
    reader: new ComplianceSignalFetcher(tenant as any, {} as any), identity: collectorInfo(CLIENT),
  });
  const run = (c: Collector, nowMs: number) => runCollector(c, store, ctx(), nowMs);

  it('C2: first window from the 30-day lookback; one record with source, endpoint, host, query, controls and the rows', async () => {
    const r = await run(directoryAuditsCollector, NOW);
    expect(r.windows).toEqual([{ start: '2026-09-27T12:00:00.000Z', end: '2026-10-27T12:00:00.000Z' }]);
    expect(r).toMatchObject({ planId: 'C2', sourceId: COLLECTED.DIRECTORY_AUDITS, status: 'success', newItems: 4, watermarkBefore: null });
    const [rec] = store.records();
    expect(rec).toMatchObject({
      sourceId: 'collect.directoryAudits',
      endpoint: '/auditLogs/directoryAudits',
      host: 'graph.microsoft.us',
      query: 'GET /v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%202026-09-27T12:00:00.000Z',
      window: { start: '2026-09-27T12:00:00.000Z', end: '2026-10-27T12:00:00.000Z' },
      status: 'success',
      itemCount: 4,
      collector: { name: 'ces-eo/collect/C2', identity: expect.stringContaining(`@${CLIENT}`) },
    });
    expect(rec.controlIds).toEqual(expect.arrayContaining(['AU.L2-3.3.2', 'CM.L2-3.4.3']));
    expect(rec.objectiveIds.length).toBeGreaterThan(0);
    expect((store.readPayload(rec) as any[]).map((d) => d.id)).toEqual(['da-0001', 'da-0002', 'da-0003', 'da-0004']);
    expect(store.watermarks.get(COLLECTED.DIRECTORY_AUDITS)).toMatchObject({
      lastEventTime: '2026-10-27T08:00:00.000Z', lastId: 'da-0004', lastWindowEnd: '2026-10-27T12:00:00.000Z', overlapMinutes: 15,
    });
  });

  it('C2: a second run starts at the watermark less the overlap, collects zero new rows, and only moves the watermark forward', async () => {
    await run(directoryAuditsCollector, NOW);
    const wm1 = store.watermarks.get(COLLECTED.DIRECTORY_AUDITS)!;
    const r2 = await run(directoryAuditsCollector, NOW + 5 * MIN);
    expect(r2.windows).toEqual([{ start: '2026-10-27T11:45:00.000Z', end: '2026-10-27T12:05:00.000Z' }]);
    expect(r2.records[0].query).toBe('GET /v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%202026-10-27T11:45:00.000Z');
    expect(r2).toMatchObject({ status: 'empty', newItems: 0 });
    expect(store.records()[1]).toMatchObject({ status: 'empty', itemCount: 0 });
    const wm2 = store.watermarks.get(COLLECTED.DIRECTORY_AUDITS)!;
    expect(wm2.lastEventTime).toBe(wm1.lastEventTime);
    expect(Date.parse(wm2.lastWindowEnd!)).toBeGreaterThan(Date.parse(wm1.lastWindowEnd!));

    // E8F shape: rows added after the watermark are collected exactly once.
    tenant.graph.directoryAudits = [...tenant.graph.directoryAudits, ...fixture('directory-audits-added.json').value];
    const r3 = await run(directoryAuditsCollector, NOW + 90 * MIN);
    expect(r3.newItems).toBe(1);
    expect((store.readPayload(store.records()[2]) as any[]).map((d) => d.id)).toEqual(['da-0005']);
    const wm3 = store.watermarks.get(COLLECTED.DIRECTORY_AUDITS)!;
    expect(wm3).toMatchObject({ lastEventTime: '2026-10-27T13:10:00.000Z', lastId: 'da-0005' });
    const r4 = await run(directoryAuditsCollector, NOW + 95 * MIN);
    expect(r4.newItems).toBe(0);
    expect(store.verify().ok).toBe(true);
  });

  it('C2: a 403 is a not_assessed record naming the permission; the watermark does not move', async () => {
    await run(directoryAuditsCollector, NOW);
    const before = store.watermarks.get(COLLECTED.DIRECTORY_AUDITS);
    tenant.denied.add('directoryAudits');
    const r = await run(directoryAuditsCollector, NOW + 15 * MIN);
    expect(r.status).toBe('not_assessed');
    const rec = store.records()[1];
    expect(rec).toMatchObject({ status: 'not_assessed', itemCount: 0, sourceId: 'collect.directoryAudits' });
    expect(rec.error).toMatch(/missing permission \(AuditLog\.Read\.All\)/);
    expect(store.watermarks.get(COLLECTED.DIRECTORY_AUDITS)).toEqual(before);
  });

  it('C3: sign-ins windowed on createdDateTime; second run zero new', async () => {
    const r1 = await run(signInsCollector, NOW);
    expect(r1.records[0].query).toBe('GET /v1.0/auditLogs/signIns?$filter=createdDateTime%20ge%202026-09-27T12:00:00.000Z');
    expect(r1).toMatchObject({ planId: 'C3', status: 'success', newItems: 2 });
    expect(store.records()[0]).toMatchObject({ sourceId: 'collect.signIns', endpoint: '/auditLogs/signIns' });
    expect(store.records()[0].controlIds).toEqual(expect.arrayContaining(['AU.L2-3.3.2', 'AC.L2-3.1.12']));
    expect(store.watermarks.get(COLLECTED.SIGN_INS)).toMatchObject({ lastEventTime: '2026-10-26T16:40:00.000Z', lastId: 'si-0002' });
    const r2 = await run(signInsCollector, NOW + 5 * MIN);
    expect(r2.records[0].query).toBe('GET /v1.0/auditLogs/signIns?$filter=createdDateTime%20ge%202026-10-27T11:45:00.000Z');
    expect(r2.newItems).toBe(0);
  });

  it('C4: PIM activation requests windowed on createdDateTime, mapped to AC.L2-3.1.7; second run zero new', async () => {
    const r1 = await run(pimActivationsCollector, NOW);
    expect(r1.records[0].query).toBe('GET /v1.0/roleManagement/directory/roleAssignmentScheduleRequests?$filter=createdDateTime%20ge%202026-09-27T12:00:00.000Z');
    expect(r1).toMatchObject({ planId: 'C4', status: 'success', newItems: 2 });
    expect(store.records()[0]).toMatchObject({ sourceId: 'collect.pimActivations', endpoint: '/roleManagement/directory/roleAssignmentScheduleRequests', controlIds: ['AC.L2-3.1.7'] });
    expect((await run(pimActivationsCollector, NOW + 5 * MIN)).newItems).toBe(0);
  });

  it('C4: no resolver in the sim (before the B20 seed) is an error record and an error view; nothing else breaks', async () => {
    tenant.missing.add('roleAssignmentScheduleRequests');
    const out = await runCollectors({ ...ctx(), nowMs: NOW, collectors: [pimActivationsCollector, signInsCollector] });
    expect(out.results.map((r) => [r.planId, r.status])).toEqual([['C4', 'error'], ['C3', 'success']]);
    expect(store.records()[0]).toMatchObject({ status: 'error', itemCount: 0 });
    expect(store.records()[0].error).toMatch(/read failed: no resolver registered/);
    expect(store.watermarks.get(COLLECTED.PIM_ACTIVATIONS)).toBeUndefined();
    expect(out.signals.map((s) => [s.signalId, s.status])).toEqual([['collect.pimActivations', 'error'], ['collect.signIns', 'success']]);
  });
});
