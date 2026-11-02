// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-ST2 / MS-R12: the built `dist/` (run by the `stamper` bin and by
// ces-tester's scenarios) must match `src/`. Pattern: ces-shared
// src/dist-freshness.test.ts. Answers ces-tester's REQ-STAMPER-DIST-STALE.
//
// If this suite fails with "dist/ is stale", run `npm run build`.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { findStaleDist, describeStale } from '../../src/utils/distFreshness';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const BUILT_TYPES = path.join(DIST, 'types', 'ces-artifacts.types.js');

function requireDist(): void {
  if (!fs.existsSync(BUILT_TYPES)) throw new Error('dist/ is missing — run `npm run build`.');
}

describe('dist freshness — built normalizeStamperAction', () => {
  it('dist carries the N-A-Capability-Absent mapping', () => {
    requireDist();
    expect(fs.readFileSync(BUILT_TYPES, 'utf-8')).toContain('nacapabilityabsent');
  });

  it('built normalizeStamperAction maps N-A-Capability-Absent and throws on unknown values', async () => {
    requireDist();
    const mod = await import('../../dist/types/ces-artifacts.types.js');
    expect(mod.normalizeStamperAction('N-A-Capability-Absent')).toBe('document-absence');
    expect(mod.normalizeStamperAction('Met-By-Prohibition')).toBe('document-prohibition');
    expect(mod.normalizeStamperAction('Inherited-FedRAMP')).toBe('inherit-fedramp');
    expect(() => mod.normalizeStamperAction('Not-A-Real-Action')).toThrow(/Unknown stamper_action/);
  });
});

describe('dist freshness — no src file newer than its build output', () => {
  it('every src/**/*.ts has a dist .js at least as new', () => {
    requireDist();
    const stale = findStaleDist(ROOT);
    if (stale.length > 0) throw new Error(describeStale(stale, ROOT));
    expect(stale).toEqual([]);
  });
});

describe('findStaleDist (checker behaviour, temp tree)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-dist-fresh-'));
    fs.mkdirSync(path.join(tmp, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'dist', 'a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a', 'x.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(tmp, 'src', 'a', 'types.d.ts'), 'export type T = 1;');
    fs.writeFileSync(path.join(tmp, 'dist', 'a', 'x.js'), 'export const x = 1;');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const setMtime = (p: string, ms: number) => fs.utimesSync(p, new Date(ms), new Date(ms));

  it('fresh when dist is newer than src (d.ts ignored)', () => {
    setMtime(path.join(tmp, 'src', 'a', 'x.ts'), 1_000_000);
    setMtime(path.join(tmp, 'dist', 'a', 'x.js'), 2_000_000);
    expect(findStaleDist(tmp)).toEqual([]);
  });

  it('stale when a src file is touched after the build', () => {
    setMtime(path.join(tmp, 'dist', 'a', 'x.js'), 1_000_000);
    setMtime(path.join(tmp, 'src', 'a', 'x.ts'), 2_000_000);
    const stale = findStaleDist(tmp);
    expect(stale.map(s => s.reason)).toEqual(['older']);
  });

  it('stale when a src file was never built', () => {
    fs.writeFileSync(path.join(tmp, 'src', 'a', 'y.ts'), 'export const y = 2;');
    setMtime(path.join(tmp, 'src', 'a', 'x.ts'), 1_000_000);
    setMtime(path.join(tmp, 'dist', 'a', 'x.js'), 2_000_000);
    const stale = findStaleDist(tmp);
    expect(stale.map(s => [path.basename(s.src), s.reason])).toEqual([['y.ts', 'missing']]);
  });
});
