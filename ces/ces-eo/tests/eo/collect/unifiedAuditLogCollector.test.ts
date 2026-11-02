// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2 C1a (B17): the unified audit log through Search-UnifiedAuditLog on the Exchange
 * Online session, 24-hour windows, 15-minute overlap, de-duplicated by `Identity`. Real fetcher and
 * real W1 store over a scripted Exchange session that honours -StartDate/-EndDate (as the sim does).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { runCollector, unifiedAuditLogCollector, COLLECTED, computeWindows, isoTime } from '../../../src/eo/collect/index';
import { ScriptedTenant, CLIENT } from './scriptedTenant';

const TENANT = '00000000-0000-4000-8000-0000000001a1';
const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('C1a unified-audit-log collector', () => {
  let tmp: string;
  let tenant: ScriptedTenant;
  let store: EvidenceStore;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ual-'));
    tenant = new ScriptedTenant();
    store = EvidenceStore.forStorageRoot(tmp, TENANT);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const ctx = () => ({
    storageRoot: tmp, tenantId: TENANT, tenantSlug: 'ual-test',
    reader: new ComplianceSignalFetcher(tenant as any, {} as any), identity: collectorInfo(CLIENT),
  });
  const run = (nowMs: number) => runCollector(unifiedAuditLogCollector, store, ctx(), nowMs);

  it('first run: seven 24-hour windows back from now, one Search-UnifiedAuditLog read and one record each, on the Exchange session', async () => {
    const r = await run(NOW);
    expect(r.windows).toHaveLength(7);
    expect(r.windows[0]).toEqual({ start: '2026-10-20T12:00:00.000Z', end: '2026-10-21T12:00:00.000Z' });
    expect(r.windows[6]).toEqual({ start: '2026-10-26T12:00:00.000Z', end: '2026-10-27T12:00:00.000Z' });
    const calls = tenant.ualCalls();
    expect(calls).toHaveLength(7);
    expect(tenant.calls.every((c) => c.engine === 'exchange')).toBe(true);
    expect(calls[0]).toContain("Search-UnifiedAuditLog -StartDate '2026-10-20T12:00:00.000Z' -EndDate '2026-10-21T12:00:00.000Z'");
    expect(calls[0]).toContain('-SessionCommand ReturnLargeSet -ResultSize 5000');
    expect(calls[0]).not.toMatch(/Connect-ExchangeOnline/);

    const recs = store.records();
    expect(recs).toHaveLength(7);
    expect(recs.map((x) => x.itemCount)).toEqual([1, 0, 1, 0, 0, 2, 1]);
    expect(recs.map((x) => x.status)).toEqual(['success', 'empty', 'success', 'empty', 'empty', 'success', 'success']);
    expect(recs[0]).toMatchObject({
      sourceId: 'collect.unifiedAuditLog', endpoint: 'Search-UnifiedAuditLog', host: 'powershell:exchange-online-gcch',
      window: r.windows[0], collector: { name: 'ces-eo/collect/C1a' },
    });
    expect(recs[0].query).toMatch(/^Search-UnifiedAuditLog -StartDate '2026-10-20T12:00:00\.000Z' -EndDate '2026-10-21T12:00:00\.000Z' -SessionId '[^']+' -SessionCommand ReturnLargeSet -ResultSize 5000$/);
    // W5 cycle 8: AC.L1-3.1.22 (anonymous sharing links) also routes the unified audit log in the source registry.
    expect(recs[0].controlIds).toEqual(['AC.L1-3.1.22', 'AU.L2-3.3.1', 'AU.L2-3.3.6']);
    expect(r.newItems).toBe(5);
    expect(store.watermarks.get(COLLECTED.UNIFIED_AUDIT_LOG)).toMatchObject({
      lastEventTime: '2026-10-27T03:00:00.000Z', lastId: 'ual-0005', lastWindowEnd: '2026-10-27T12:00:00.000Z',
    });
  });

  it('second run: one window from the watermark less 15 minutes; rows re-dated by the hour keep their Identity and are not new', async () => {
    tenant.ual.push({ ...tenant.ual[0], Identity: 'ual-0006', CreationDate: '2026-10-27T11:50:00.000Z' });
    expect((await run(NOW)).newItems).toBe(6);
    // The sim re-dates rolling rows to the top of each hour: same Identity, CreationDate +1 h.
    tenant.ual = tenant.ual.map((row) => ({ ...row, CreationDate: new Date(Date.parse(String(row.CreationDate)) + HOUR).toISOString() }));
    const r2 = await run(NOW + HOUR);
    expect(r2.windows).toEqual([{ start: '2026-10-27T11:45:00.000Z', end: '2026-10-27T13:00:00.000Z' }]);
    expect(r2).toMatchObject({ status: 'empty', newItems: 0 });
    const wm = store.watermarks.get(COLLECTED.UNIFIED_AUDIT_LOG)!;
    // The re-dated row moves the event watermark forward (never back); it is not collected twice.
    expect(wm.lastEventTime).toBe('2026-10-27T12:50:00.000Z');
    expect(store.verify().ok).toBe(true);
  });

  it('a watermark 8 days back is read as a backfill; a window that fails twice is a gap record and the watermark stays', async () => {
    await run(NOW - 8 * DAY);
    const wmBefore = store.watermarks.get(COLLECTED.UNIFIED_AUDIT_LOG)!;
    expect(wmBefore.lastWindowEnd).toBe('2026-10-19T12:00:00.000Z');
    const seqBefore = store.records().length;
    tenant.calls = [];

    tenant.ualFailures = 2;
    const r = await run(NOW);
    expect(r.windows).toHaveLength(9); // 8 days plus the 15-minute overlap, in 24-hour windows
    expect(r.windows[0].start).toBe('2026-10-19T11:45:00.000Z');
    expect(tenant.ualCalls()).toHaveLength(2); // the first window, read twice, then stop
    expect(r.status).toBe('gap');
    const gap = store.records()[seqBefore];
    expect(gap).toMatchObject({ status: 'gap', itemCount: 0, window: r.windows[0] });
    expect(gap.error).toMatch(/backfill read failed twice/);
    expect(store.records()).toHaveLength(seqBefore + 1);
    expect(store.watermarks.get(COLLECTED.UNIFIED_AUDIT_LOG)).toEqual(wmBefore);

    // The next run backfills the same span.
    const again = await run(NOW + 60_000);
    expect(again.windows[0].start).toBe('2026-10-19T11:45:00.000Z');
    expect(again.status).toBe('success');
    expect(Date.parse(store.watermarks.get(COLLECTED.UNIFIED_AUDIT_LOG)!.lastWindowEnd!)).toBe(NOW + 60_000);
  });

  it('a single-window failure that is not a backfill is an error record (read once); a 403 is not_assessed naming the role', async () => {
    await run(NOW);
    tenant.ualFailures = 1;
    const e = await run(NOW + HOUR);
    expect(e.status).toBe('error');
    expect(store.records().at(-1)!.error).toMatch(/^read failed: .*timed out/);
    tenant.ualDenied = true;
    const d = await run(NOW + 2 * HOUR);
    expect(d.status).toBe('not_assessed');
    expect(store.records().at(-1)!.error).toMatch(/missing permission \(Exchange Online View-Only Audit Logs role/);
  });

  it('window arithmetic and time parsing', () => {
    const c = { initialLookbackMinutes: 60, maxWindowMinutes: 30, overlapMinutes: 15 };
    expect(computeWindows(c, undefined, NOW)).toEqual([
      { start: '2026-10-27T11:00:00.000Z', end: '2026-10-27T11:30:00.000Z' },
      { start: '2026-10-27T11:30:00.000Z', end: '2026-10-27T12:00:00.000Z' },
    ]);
    // the later of the two watermark times wins
    expect(computeWindows(c, { lastEventTime: '2026-10-27T11:00:00.000Z', lastWindowEnd: '2026-10-27T11:40:00.000Z' }, NOW))
      .toEqual([{ start: '2026-10-27T11:25:00.000Z', end: '2026-10-27T11:55:00.000Z' }, { start: '2026-10-27T11:55:00.000Z', end: '2026-10-27T12:00:00.000Z' }]);
    expect(isoTime('/Date(1793102400000)/')).toBe('2026-10-27T12:00:00.000Z');
    expect(isoTime('2026-10-27T12:00:00')).toBe('2026-10-27T12:00:00.000Z');
    expect(isoTime('2026-10-27T07:00:00-05:00')).toBe('2026-10-27T12:00:00.000Z');
    expect(isoTime('not a date')).toBe('');
  });
});
