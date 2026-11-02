// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-13 P13-LV: AdminOps leaver-flow escalations (ces.db adminops_leaver_escalations, AO's collection) become
 * EO leaver findings on a collection-scheduler tick: once each (write-once), with a notice naming the open
 * POA&M items of PS.L2-3.9.2; another tenant's rows are ignored; a tick on a tenant with no session still
 * records them (the finding needs no tenant read); the route lists them. EO never writes AO's collection.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { CollectionScheduler, createCollectionScheduleRouter, SCHEDULER_COLLECTIONS, type SchedulerDeps } from '../../../src/eo/collect/collectionScheduler';
import { AO_LEAVER_ESCALATIONS, EO_LEAVER_FINDINGS, LEAVER_EFFECT, listLeaverFindings, recordLeaverFindings } from '../../../src/eo/collect/leaverEscalations';

const SLUG = 'p13lv-eo';
const TENANT_ID = '00000000-0000-4000-8000-00000000013a';

function aoEscalation(id: string, slug = SLUG, reason = 'unconfirmed_in_window') {
  return {
    schema: 'ces-ao/leaver-escalation@1', escalationId: id, flowId: `lvf-${id}`, tenantSlug: slug, tenantId: TENANT_ID,
    leaverUpn: `leaver-${id}@p13lv.example`, controlId: 'PS.L2-3.9.2', objectiveId: 'PS.L2-3.9.2[b]', reason,
    detail: 'no tenant administrator confirmed by 2026-11-04T12:00:00.000Z; the account keeps its access',
    flowCreatedAt: '2026-11-01T12:00:00.000Z', confirmBy: '2026-11-04T12:00:00.000Z', raisedAt: '2026-11-04T12:05:00.000Z',
  };
}

describe('EO leaver findings from AO leaver escalations (PH-13 P13-LV)', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  let scheduler: CollectionScheduler;
  let server: Server | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p13lv-eo-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    closeAllCesRepositories();
    const deps: SchedulerDeps = {
      storageRoot: path.join(tmp, 'eo-storage'),
      listTenants: async () => [SLUG],
      ensureSession: async () => ({ ok: false, tenantId: TENANT_ID, reason: 'no session in this test' }),
      runAssess: async () => ({ ok: false, error: 'not used' }),
      latestSnapshotId: () => null,
      readDrift: () => null,
      loadPoamLedger: () => ({
        poamId: 'poam-1',
        items: [
          { key: 'k-ps-b', controlId: 'PS.L2-3.9.2', objectiveId: 'PS.L2-3.9.2[b]', status: 'open', openedAt: '2026-10-01T00:00:00.000Z', history: [{ event: 'opened' }] },
          { key: 'k-ac', controlId: 'AC.L1-3.1.1', objectiveId: 'AC.L1-3.1.1[a]', status: 'open', openedAt: '2026-10-01T00:00:00.000Z', history: [] },
        ],
      }) as any,
      readEcFindings: async () => null,
      logger: { log: () => undefined, warn: () => undefined },
    };
    scheduler = new CollectionScheduler({ enabled: true, firstTickMs: 1, tickMs: 1000, assessIntervalMs: 60_000 }, deps);
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    closeAllCesRepositories();
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a tick records each escalation once, with a notice naming the PS.L2-3.9.2 POA&M item; AO rows untouched', async () => {
    const repo = getCesRepository();
    repo.put(AO_LEAVER_ESCALATIONS, { id: 'lve-1', ces: { tenantSlug: SLUG, tenantId: TENANT_ID }, data: aoEscalation('lve-1') });
    repo.put(AO_LEAVER_ESCALATIONS, { id: 'lve-2', ces: { tenantSlug: SLUG, tenantId: TENANT_ID }, data: aoEscalation('lve-2', SLUG, 'execution_failed') });
    repo.put(AO_LEAVER_ESCALATIONS, { id: 'lve-x', ces: { tenantSlug: 'other-tenant' }, data: aoEscalation('lve-x', 'other-tenant') });

    const t1 = await scheduler.tickTenant(SLUG);
    expect(t1!.mode).toBe('not_connected');
    expect(t1!.leaver).toEqual({ newFindings: 2 });
    const findings = listLeaverFindings(SLUG);
    expect(findings.map((f) => [f.aoEscalationId, f.code, f.objectiveId])).toEqual([
      ['lve-1', 'LEAVER_UNCONFIRMED', 'PS.L2-3.9.2[b]'],
      ['lve-2', 'LEAVER_TERMINATION_FAILED', 'PS.L2-3.9.2[b]'],
    ]);
    expect(findings[0]).toMatchObject({ source: 'ces-ao', effect: LEAVER_EFFECT, tenantId: TENANT_ID });
    const notices = scheduler.noticesFor(SLUG);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'leaver_unconfirmed', leaverFindingIds: ['eolf-lve-1', 'eolf-lve-2'] });
    expect(notices[0].poamItems).toEqual([{ key: 'k-ps-b', objectiveId: 'PS.L2-3.9.2[b]', openedAt: '2026-10-01T00:00:00.000Z', lastEvent: 'opened' }]);
    expect(notices[0].message).toMatch(/POA&M 1 open item/);

    const t2 = await scheduler.tickTenant(SLUG);
    expect(t2!.leaver).toBeUndefined();
    expect(listLeaverFindings(SLUG)).toHaveLength(2);
    expect(scheduler.noticesFor(SLUG)).toHaveLength(1);
    expect(repo.listAll(AO_LEAVER_ESCALATIONS)).toHaveLength(3);
    expect(listLeaverFindings('other-tenant')).toEqual([]);
    expect(repo.list(SCHEDULER_COLLECTIONS.ticks, { tenantSlug: SLUG })).toHaveLength(2);
  });

  it('no escalations: nothing recorded, no notice, no leaver field on the tick', async () => {
    const t = await scheduler.tickTenant(SLUG);
    expect(t!.leaver).toBeUndefined();
    expect(scheduler.noticesFor(SLUG)).toEqual([]);
    expect(getCesRepository().listAll(EO_LEAVER_FINDINGS)).toEqual([]);
  });

  it('recordLeaverFindings ignores another tenant\'s row and is write-once', () => {
    const now = '2026-11-04T13:00:00.000Z';
    expect(recordLeaverFindings([aoEscalation('a'), aoEscalation('b', 'other')], { tenantSlug: SLUG, tenantId: null }, now)).toHaveLength(1);
    expect(recordLeaverFindings([aoEscalation('a')], { tenantSlug: SLUG, tenantId: null }, now)).toEqual([]);
  });

  it('GET /api/collect/leaver-findings lists them', async () => {
    getCesRepository().put(AO_LEAVER_ESCALATIONS, { id: 'lve-r', ces: { tenantSlug: SLUG }, data: aoEscalation('lve-r') });
    await scheduler.tickTenant(SLUG);
    const app = express();
    app.use(createCollectionScheduleRouter({ scheduler, tenantExists: (s) => s === SLUG }));
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/collect/leaver-findings?tenant=${SLUG}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any[]).map((f) => f.aoEscalationId)).toEqual(['lve-r']);
    expect((await fetch(`${base}/api/collect/leaver-findings?tenant=nope`)).status).toBe(404);
  });
});
