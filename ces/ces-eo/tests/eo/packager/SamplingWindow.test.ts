// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** EO-collection W4.2: the sampling window per control family, from the evidence-store records. */
import { describe, it, expect } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { familyOf, samplingWindowsByFamily, type WindowRecord } from '../../../src/eo/packager/SamplingWindow.js';

const rec = (over: Partial<WindowRecord>): WindowRecord => ({
  sourceId: 's', status: 'success', itemCount: 1, controlIds: ['AC.L1-3.1.1'],
  window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-28T00:00:00.000Z' }, collectedAt: '2026-10-28T00:00:00.000Z', ...over,
});

describe('samplingWindowsByFamily', () => {
  it('spans the earliest start to the latest end; counts returned reads and their rows; failed reads apart', () => {
    const w = samplingWindowsByFamily([
      rec({ sourceId: 'collect.signIns', itemCount: 2 }),
      rec({ sourceId: 'collect.signIns', status: 'empty', itemCount: 0, window: { start: '2026-10-27T23:45:00.000Z', end: '2026-10-28T01:00:00.000Z' } }),
      rec({ sourceId: 'conditionalAccess', itemCount: 3, window: { start: null, end: '2026-10-28T00:30:00.000Z' } }),
      rec({ sourceId: 'collect.directoryAudits', status: 'error', itemCount: 0, window: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-29T00:00:00.000Z' } }),
    ]);
    expect(w).toEqual([{
      family: 'AC', window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z' },
      sampleCount: 3, itemCount: 5, pointInTimeCount: 1, failedCount: 1, sources: ['collect.signIns', 'conditionalAccess'],
    }]);
  });

  it('a record counts once in each family it names; families are sorted; a point-in-time-only family has no start', () => {
    const w = samplingWindowsByFamily([
      rec({ controlIds: ['SI.L2-3.14.6', 'AU.L2-3.3.1', 'AU.L2-3.3.2'], itemCount: 4 }),
      rec({ controlIds: ['IA.L1-3.5.1'], window: { start: null, end: '2026-10-28T00:00:00.000Z' } }),
    ]);
    expect(w.map(x => [x.family, x.sampleCount, x.itemCount, x.window.start])).toEqual([
      ['AU', 1, 4, '2026-10-01T00:00:00.000Z'], ['IA', 1, 1, null], ['SI', 1, 4, '2026-10-01T00:00:00.000Z'],
    ]);
    expect(familyOf('AC.L2-3.1.20')).toBe('AC');
  });

  it('run 25: twelve families, windows from the collectors\' lookbacks (30 d, 90 d), 190 records', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/evidence-index/run25-inputs.json'), 'utf-8'));
    expect(fx.records).toHaveLength(190);
    const w = samplingWindowsByFamily(fx.records);
    const by = Object.fromEntries(w.map(x => [x.family, x]));
    expect(Object.keys(by)).toEqual(['AC', 'AT', 'AU', 'CM', 'IA', 'IR', 'MA', 'MP', 'PS', 'RA', 'SC', 'SI']);
    expect(by.AC.window).toEqual({ start: '2026-09-28T02:44:45.503Z', end: '2026-10-28T02:46:30.714Z' });
    expect(by.AU.window.start).toBe('2026-07-30T02:44:45.503Z');
    expect(by.AC.failedCount).toBe(4);
    expect(by.IA.window.start).toBeNull();
    for (const x of w) {
      expect(x.sampleCount).toBeGreaterThan(0);
      expect(x.sampleCount).toBeGreaterThanOrEqual(x.pointInTimeCount);
    }
  });
});
