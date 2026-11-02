// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.2: per-source watermarks are forward only (a regression is refused, before the
 * record is written); overlap rows are de-duplicated by event id or the UAL's `Identity`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvidenceStore } from '../../../../src/eo/evidence/store/EvidenceStore';
import {
  Watermarks, WatermarkRegressionError, dedupeOverlap, nextWatermark, WATERMARKS_FILE,
} from '../../../../src/eo/evidence/store/Watermarks';
import type { AppendInput } from '../../../../src/eo/evidence/store/types';

const T = '00000000-0000-4000-8000-0000000002aa';

function input(over: Partial<AppendInput> = {}): AppendInput {
  return {
    tenantId: T, tenantSlug: 'wm', sourceId: 'directoryAudits',
    collector: { name: 'c', version: '1', identity: 'ces-eo/1@no-mgcontext' },
    host: 'graph.microsoft.us', endpoint: '/auditLogs/directoryAudits', query: 'GET x',
    window: { start: null, end: '2026-10-27T00:00:00.000Z' }, collectedAt: '2026-10-27T00:00:00.000Z',
    status: 'success', itemCount: 0, payload: { value: [] }, ...over,
  };
}

describe('Watermarks (W1.2)', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-wm-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('advances forward per source and persists to watermarks.json', () => {
    const wm = new Watermarks(tmp);
    wm.advance('directoryAudits', { lastWindowEnd: '2026-10-27T00:00:00.000Z' }, 'r1');
    wm.advance('directoryAudits', { lastWindowEnd: '2026-10-27T00:00:00.000Z' }, 'r2'); // equal is not a regression
    wm.advance('directoryAudits', { lastWindowEnd: '2026-10-27T01:00:00.000Z', lastEventTime: '2026-10-27T00:30:00Z', lastId: 'e9' }, 'r3');
    wm.advance('signInLogs', { lastWindowEnd: '2026-10-20T00:00:00.000Z' }, 'r4');
    const all = JSON.parse(fs.readFileSync(path.join(tmp, WATERMARKS_FILE), 'utf-8'));
    expect(all.directoryAudits).toMatchObject({ lastWindowEnd: '2026-10-27T01:00:00.000Z', lastEventTime: '2026-10-27T00:30:00Z', lastId: 'e9', recordId: 'r3', overlapMinutes: 15 });
    expect(all.signInLogs.lastWindowEnd).toBe('2026-10-20T00:00:00.000Z');
  });

  it('refuses a regression of lastWindowEnd or lastEventTime, and refuses clearing a set watermark', () => {
    const wm = new Watermarks(tmp);
    wm.advance('s', { lastWindowEnd: '2026-10-27T01:00:00.000Z', lastEventTime: '2026-10-27T00:30:00Z' }, 'r1');
    expect(() => wm.advance('s', { lastWindowEnd: '2026-10-27T00:59:59.000Z' }, 'r2')).toThrow(WatermarkRegressionError);
    expect(() => wm.advance('s', { lastEventTime: '2026-10-26T00:00:00Z' }, 'r2')).toThrow(/is before/);
    expect(() => wm.advance('s', { lastEventTime: null }, 'r2')).toThrow(/cannot clear/);
    expect(() => wm.advance('s', { lastWindowEnd: 'not-a-time' }, 'r2')).toThrow(/unparseable/);
    expect(wm.get('s')).toMatchObject({ lastWindowEnd: '2026-10-27T01:00:00.000Z', recordId: 'r1' });
  });

  it('a store append whose watermark would regress is refused before anything is written', () => {
    const store = EvidenceStore.forStorageRoot(tmp, T);
    store.append(input({ watermark: { lastWindowEnd: '2026-10-27T00:00:00.000Z' } }));
    expect(() => store.append(input({ collectedAt: '2026-10-26T00:00:00.000Z', watermark: { lastWindowEnd: '2026-10-26T00:00:00.000Z' } })))
      .toThrow(WatermarkRegressionError);
    expect(store.records()).toHaveLength(1);
    expect(store.readManifest()!.recordCount).toBe(1);
    expect(store.watermarks.get('directoryAudits')!.recordId).toBe(store.records()[0].recordId);
    expect(store.verify().ok).toBe(true);
  });

  it('de-duplicates the overlap span by event id', () => {
    const prev = { lastEventTime: '2026-10-27T10:00:00Z', overlapMinutes: 15, seenIds: ['e2', 'e3'] };
    const rows = [
      { id: 'e1', t: '2026-10-27T09:00:00Z' }, // before the overlap span: already collected
      { id: 'e2', t: '2026-10-27T09:50:00Z' }, // in the span, seen
      { id: 'e3', t: '2026-10-27T10:00:00Z' }, // in the span, seen
      { id: 'e4', t: '2026-10-27T10:00:00Z' }, // same time, new id
      { id: 'e5', t: '2026-10-27T10:05:00Z' },
      { id: 'e5', t: '2026-10-27T10:05:00Z' }, // duplicate within one page
    ];
    const fresh = dedupeOverlap(rows, prev, (r) => r.id, (r) => r.t);
    expect(fresh.map((r) => r.id)).toEqual(['e4', 'e5']);
    const next = nextWatermark(rows, { ...prev, lastId: 'e3' }, (r) => r.id, (r) => r.t);
    expect(next).toMatchObject({ lastEventTime: '2026-10-27T10:05:00Z', lastId: 'e5', overlapMinutes: 15 });
    expect(next.seenIds!.sort()).toEqual(['e2', 'e3', 'e4', 'e5']);
  });

  it('de-duplicates UAL rows by Identity (the seed rows re-date every hour)', () => {
    const prev = { lastEventTime: '2026-10-27T10:00:00Z', overlapMinutes: 15, seenIds: ['ual-7'] };
    const rows = [
      { Identity: 'ual-7', CreationDate: '2026-10-27T10:00:00Z' },
      { Identity: 'ual-7', CreationDate: '2026-10-27T11:00:00Z' }, // same row, re-dated an hour later
      { Identity: 'ual-8', CreationDate: '2026-10-27T11:00:00Z' },
    ];
    const fresh = dedupeOverlap(rows, prev, (r) => r.Identity, (r) => r.CreationDate);
    expect(fresh.map((r) => r.Identity)).toEqual(['ual-8']);
  });

  it('nextWatermark never moves earlier than the previous one', () => {
    const prev = { lastEventTime: '2026-10-27T10:00:00Z', lastId: 'e3', overlapMinutes: 15, seenIds: ['e3'] };
    const next = nextWatermark([{ id: 'old', t: '2026-10-01T00:00:00Z' }], prev, (r) => r.id, (r) => r.t);
    expect(next.lastEventTime).toBe('2026-10-27T10:00:00Z');
    expect(next.lastId).toBe('e3');
  });
});
