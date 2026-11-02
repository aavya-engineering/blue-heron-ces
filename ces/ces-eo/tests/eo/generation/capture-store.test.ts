// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.4: every read of one fetch is recorded in the store once, whatever its status,
 * with the request actually sent (host, query, window) and the collector identity
 * (`ces-eo/<version>@<ClientId>`, the ClientId read once per session). Drives the real
 * ComplianceSignalFetcher over a scripted session; no PowerShell, no sim.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import { ComplianceSignalFetcher, GRAPH_HOST } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { recordFetchedSignals, windowOf, itemCountOf } from '../../../src/eo/evidence/store/recordFetchedSignals';
import {
  resolveCollectorIdentity, parseClientId, CLIENT_ID_PROBE, NO_MGCONTEXT, EO_VERSION,
} from '../../../src/eo/evidence/store/collectorIdentity';

const TENANT = '00000000-0000-4000-8000-0000000003aa';
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class ScriptedSession {
  calls: string[] = [];
  async execute(_engine: string, cmd: string): Promise<{ stdout: string }> {
    this.calls.push(cmd);
    if (cmd === CLIENT_ID_PROBE) return { stdout: `Welcome banner\n${CLIENT}\nEO_EXECUTION_SUCCESS` };
    if (cmd.includes('directoryAudits')) {
      return { stdout: JSON.stringify({ value: [{ id: 'd1', activityDateTime: '2026-10-26T10:00:00Z' }, { id: 'd2', activityDateTime: '2026-10-26T11:00:00Z' }] }) };
    }
    if (cmd.includes('signIns')) throw new Error('Graph returned 403 Forbidden');
    if (cmd.includes('riskDetections')) throw new Error('no resolver registered for URI');
    if (cmd.includes('Get-MgPolicyCrossTenantAccessPolicyDefault')) return { stdout: '{}' };
    throw new Error(`unscripted: ${cmd}`);
  }
}

function assessmentsFor(signals: SignalResult[]) {
  const by = (id: string) => signals.filter((s) => s.signalId === id);
  return [
    { control_id: 'AU.L2-3.3.2', signals: [...by('directoryAudits'), ...by('signInLogs')] },
    { control_id: 'CM.L2-3.4.3', signals: by('directoryAudits') },
    { control_id: 'SI.L2-3.14.6', signals: by('riskDetections') },
    { control_id: 'AC.L1-3.1.20', signals: by('crossTenantPolicy') },
  ] as any[];
}

describe('capture via the store (W1.4)', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-cap-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('records every read once per fetch, any status, with host, query, window, identity and objectives', async () => {
    const session = new ScriptedSession();
    const fetcher = new ComplianceSignalFetcher(session as any, {} as any);
    const nowMs = Date.parse('2026-10-27T12:00:00.000Z');
    const signals = await fetcher.fetchAuditSignals(nowMs);
    const collector = await resolveCollectorIdentity(session);
    expect(collector).toEqual({ name: 'ces-eo/ComplianceSignalFetcher', version: EO_VERSION, identity: `ces-eo/${EO_VERSION}@${CLIENT}` });

    const res = recordFetchedSignals(signals, assessmentsFor(signals), {
      storageRoot: tmp, tenantId: TENANT, tenantSlug: 'cap', collector, describe: (s) => fetcher.describeRead(s),
    });
    expect(res).toEqual({ recorded: 4, errors: [] });

    const store = EvidenceStore.forStorageRoot(tmp, TENANT);
    const recs = store.records();
    expect(recs.map((r) => [r.sourceId, r.status, r.itemCount])).toEqual([
      ['directoryAudits', 'success', 2],
      ['signInLogs', 'not_assessed', 0],
      ['riskDetections', 'error', 0],
      ['crossTenantPolicy', 'empty', 0],
    ]);
    for (const r of recs) {
      expect(r.tenantId).toBe(TENANT);
      expect(r.host).toBe(GRAPH_HOST);
      expect(r.collector.identity).toBe(`ces-eo/${EO_VERSION}@${CLIENT}`);
      expect(r.retainUntil).toBeDefined();
    }
    const da = recs[0];
    expect(da.query).toBe('GET /v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%202026-09-27T12:00:00.000Z');
    expect(da.window).toEqual({ start: '2026-09-27T12:00:00.000Z', end: da.collectedAt });
    expect(da.endpoint).toBe('/auditLogs/directoryAudits');
    expect(da.controlIds).toEqual(['AU.L2-3.3.2', 'CM.L2-3.4.3']);
    expect(da.objectiveIds).toEqual(expect.arrayContaining(['AU.L2-3.3.2[a]', 'CM.L2-3.4.3[a]']));
    expect(store.readPayload(da)).toEqual({ value: [{ id: 'd1', activityDateTime: '2026-10-26T10:00:00Z' }, { id: 'd2', activityDateTime: '2026-10-26T11:00:00Z' }] });
    expect(recs[1].error).toMatch(/Missing permissions/);
    expect(recs[2].error).toMatch(/no resolver registered/);
    expect(recs[2].window.start).toBe('2026-07-29T12:00:00.000Z'); // 90 days
    expect(recs[3].query).toBe('Get-MgPolicyCrossTenantAccessPolicyDefault');
    expect(recs[3].window.start).toBeNull();

    // Watermarks move only on reads that succeeded (success or empty).
    expect(store.watermarks.get('directoryAudits')!.lastWindowEnd).toBe(da.collectedAt);
    expect(store.watermarks.get('crossTenantPolicy')).toBeDefined();
    expect(store.watermarks.get('signInLogs')).toBeUndefined();
    expect(store.watermarks.get('riskDetections')).toBeUndefined();
    expect(store.verify().ok).toBe(true);
  });

  it('a second fetch appends (never rewrites), the chain verifies, watermarks only move forward, identity read once', async () => {
    const session = new ScriptedSession();
    const fetcher = new ComplianceSignalFetcher(session as any, {} as any);
    const ctx = async () => ({
      storageRoot: tmp, tenantId: TENANT, tenantSlug: 'cap', collector: await resolveCollectorIdentity(session),
      describe: (s: SignalResult) => fetcher.describeRead(s),
    });
    const s1 = await fetcher.fetchAuditSignals(Date.parse('2026-10-27T12:00:00Z'));
    recordFetchedSignals(s1, assessmentsFor(s1), await ctx());
    const store = EvidenceStore.forStorageRoot(tmp, TENANT);
    const wm1 = store.watermarks.get('directoryAudits')!.lastWindowEnd!;
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await fetcher.fetchAuditSignals(Date.parse('2026-10-27T13:00:00Z'));
    recordFetchedSignals(s2, assessmentsFor(s2), await ctx());
    expect(store.records()).toHaveLength(8);
    expect(store.verify()).toMatchObject({ ok: true, recordCount: 8 });
    expect(Date.parse(store.watermarks.get('directoryAudits')!.lastWindowEnd!)).toBeGreaterThanOrEqual(Date.parse(wm1));
    // identical payloads share one payload file
    const da = store.query({ sourceId: 'directoryAudits' });
    expect(da[0].payloadSha256).toBe(da[1].payloadSha256);
    expect(session.calls.filter((c) => c === CLIENT_ID_PROBE)).toHaveLength(1);
  });

  it('a read whose watermark would go backwards is still recorded, without moving the watermark', async () => {
    const store = EvidenceStore.forStorageRoot(tmp, TENANT);
    store.watermarks.advance('directoryAudits', { lastWindowEnd: '2030-01-01T00:00:00.000Z' }, 'seed');
    const sig: SignalResult = { signalId: 'directoryAudits', source: 'graph', endpoint: '/auditLogs/directoryAudits', timestamp: '2026-10-27T00:00:00.000Z', rawData: { value: [] }, status: 'success' };
    const res = recordFetchedSignals([sig], [], {
      storageRoot: tmp, tenantId: TENANT, tenantSlug: 'cap', collector: { name: 'n', version: 'v', identity: 'i' },
      describe: () => ({ host: GRAPH_HOST, query: 'GET x' }),
    });
    expect(res.recorded).toBe(1);
    expect(store.watermarks.get('directoryAudits')!.lastWindowEnd).toBe('2030-01-01T00:00:00.000Z');
  });

  it('identity: no session or an unreadable context gives no-mgcontext; never throws', async () => {
    expect((await resolveCollectorIdentity(null)).identity).toBe(`ces-eo/${EO_VERSION}@${NO_MGCONTEXT}`);
    const failing = { execute: async () => { throw new Error('not connected'); } };
    expect((await resolveCollectorIdentity(failing)).identity).toBe(`ces-eo/${EO_VERSION}@${NO_MGCONTEXT}`);
    expect(parseClientId('nothing here\nEO_EXECUTION_SUCCESS')).toBe(NO_MGCONTEXT);
    expect(parseClientId(`${CLIENT.toUpperCase()}\r\n`)).toBe(CLIENT);
    expect(EO_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('helpers: item counts and windows', () => {
    expect(itemCountOf(null)).toBe(0);
    expect(itemCountOf({ value: [1, 2, 3] })).toBe(3);
    expect(itemCountOf([1])).toBe(1);
    expect(itemCountOf({})).toBe(0);
    expect(itemCountOf({ id: 'x' })).toBe(1);
    expect(windowOf('GET /x?$filter=createdDateTime ge 2026-10-01T00:00:00Z', 'E')).toEqual({ start: '2026-10-01T00:00:00Z', end: 'E' });
    expect(windowOf('Get-MgGroup', 'E')).toEqual({ start: null, end: 'E' });
  });
});
