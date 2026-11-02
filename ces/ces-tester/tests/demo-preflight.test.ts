// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1: demo pre-flight — build-freshness (P1-7) + port-free (P1-8).
// IO edges are injected so the report logic is tested without fs/sockets.
import { describe, it, expect } from 'vitest';
import {
  isDistStale,
  classifyBuild,
  assemblePreflight,
  runPreflight,
  combinePortProbes,
  type BuildFreshness,
  type PortStatus,
} from '../src/demo/preflight.js';

describe('isDistStale', () => {
  it('missing dist is always stale', () => {
    expect(isDistStale(1000, null)).toBe(true);
    expect(isDistStale(null, null)).toBe(true);
  });
  it('src newer than dist (beyond 1s epsilon) is stale', () => {
    expect(isDistStale(10_000, 5_000)).toBe(true);
  });
  it('dist newer than or equal to src is fresh', () => {
    expect(isDistStale(5_000, 10_000)).toBe(false);
    expect(isDistStale(5_000, 5_000)).toBe(false);
  });
  it('same-second write within the 1s epsilon is fresh (dist written right after src)', () => {
    expect(isDistStale(5_500, 5_000)).toBe(false); // 500ms newer → tolerated
    expect(isDistStale(6_100, 5_000)).toBe(true); // 1.1s newer → stale
  });
  it('no sources means nothing can be stale', () => {
    expect(isDistStale(null, 5_000)).toBe(false);
  });
});

describe('classifyBuild', () => {
  it('maps mtimes to fresh/stale/missing-dist', () => {
    expect(classifyBuild('a', 1000, null).status).toBe('missing-dist');
    expect(classifyBuild('b', 9000, 1000).status).toBe('stale');
    expect(classifyBuild('c', 1000, 9000).status).toBe('fresh');
  });
});

describe('assemblePreflight', () => {
  it('ok only when every build fresh and every port free', () => {
    const builds: BuildFreshness[] = [{ name: 'x', status: 'fresh', newestSrcMs: 1, newestDistMs: 2 }];
    const ports: PortStatus[] = [{ name: 'stacksim', port: 4390, status: 'free' }];
    expect(assemblePreflight(builds, ports).ok).toBe(true);
  });
  it('collects a blocker line per stale build and per occupied port', () => {
    const builds: BuildFreshness[] = [
      { name: 'stale-mod', status: 'stale', newestSrcMs: 9, newestDistMs: 1 },
      { name: 'nodist', status: 'missing-dist', newestSrcMs: 9, newestDistMs: null },
    ];
    const ports: PortStatus[] = [{ name: 'muster', port: 5173, status: 'occupied' }];
    const r = assemblePreflight(builds, ports);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(3);
    expect(r.issues.some((i) => i.includes('STALE') && i.includes('stale-mod'))).toBe(true);
    expect(r.issues.some((i) => i.includes('MISSING') && i.includes('nodist'))).toBe(true);
    expect(r.issues.some((i) => i.includes('5173'))).toBe(true);
  });
});

describe('runPreflight (injected probes)', () => {
  it('threads injected mtime + port probes into a report', async () => {
    const report = await runPreflight({
      modules: [{ name: 'ces-tester', srcDir: '/src', distDir: '/dist' }],
      ports: [{ name: 'stacksim', port: 4390 }],
      newestMtime: async (dir) => (dir === '/src' ? 100 : 200), // dist newer → fresh
      probe: async () => 'free',
    });
    expect(report.ok).toBe(true);
    expect(report.builds[0].status).toBe('fresh');
    expect(report.ports[0].status).toBe('free');
  });

  it('flags a stale build + occupied port through the live path', async () => {
    const report = await runPreflight({
      modules: [{ name: 'ces-tester', srcDir: '/src', distDir: '/dist' }],
      ports: [{ name: 'eo', port: 4002 }],
      newestMtime: async (dir) => (dir === '/src' ? 9000 : 1000), // src newer → stale
      probe: async () => 'occupied',
    });
    expect(report.ok).toBe(false);
    expect(report.builds[0].status).toBe('stale');
    expect(report.ports[0].status).toBe('occupied');
    expect(report.issues).toHaveLength(2);
  });
});

// GP-DEMO-3 M7 (live finding): probePort must consider BOTH loopback families.
// An orphaned Vite dev server bound `::1:5173` only; the IPv4-only probe called
// the port free, and the demo's Muster leg then drove a foreign SPA. `probePort`
// now probes 127.0.0.1 and ::1 and combines them here.
describe('combinePortProbes', () => {
  it('is free only when EVERY loopback address refused', () => {
    expect(combinePortProbes(['free', 'free'])).toBe('free');
  });
  it('is occupied when the IPv6 loopback alone is listening (the M7 case)', () => {
    expect(combinePortProbes(['free', 'occupied'])).toBe('occupied');
  });
  it('is occupied when the IPv4 loopback alone is listening', () => {
    expect(combinePortProbes(['occupied', 'free'])).toBe('occupied');
  });
  it('is occupied when both answer', () => {
    expect(combinePortProbes(['occupied', 'occupied'])).toBe('occupied');
  });
});
