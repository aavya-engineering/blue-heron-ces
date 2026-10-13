// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-1 — demo pre-flight (critique P1-7 build-freshness, P1-8 port-free).
 *
 * A CES-wide demo runs compiled `dist/` across three modules (tenant-stacksim,
 * ces-stamper, ces-tester) and four single-writer servers (4390 stacksim, 5173
 * muster, 3000 stamper GUI, 4002 EO). A stale build silently serves old
 * behavior; a stray listener kills the boot. Pre-flight refuses to start a demo
 * unless every build is fresh and every port is free, so a live run cannot fail
 * for a reason the operator could have caught in two seconds.
 *
 * The IO edges (mtime walk, port probe) are injectable so the report-assembly
 * logic is unit-testable without a filesystem or sockets.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as net from 'node:net';

export interface ModuleBuild {
  readonly name: string;
  /** Directory of TypeScript sources (recursively scanned for newest mtime). */
  readonly srcDir: string;
  /** Directory of compiled output (recursively scanned for newest mtime). */
  readonly distDir: string;
}

export interface PortSpec {
  readonly name: string;
  readonly port: number;
}

export interface BuildFreshness {
  readonly name: string;
  readonly status: 'fresh' | 'stale' | 'missing-dist';
  readonly newestSrcMs: number | null;
  readonly newestDistMs: number | null;
}

export interface PortStatus {
  readonly name: string;
  readonly port: number;
  readonly status: 'free' | 'occupied';
}

export interface PreflightReport {
  readonly ok: boolean;
  readonly builds: BuildFreshness[];
  readonly ports: PortStatus[];
  /** Human-readable blocker lines (empty when ok). */
  readonly issues: string[];
}

/**
 * Pure freshness rule: dist is stale if it is absent, or if the newest source
 * file is newer than the newest compiled file. A 1s epsilon absorbs
 * same-second writes on coarse filesystem clocks (dist written right after src).
 */
export function isDistStale(newestSrcMs: number | null, newestDistMs: number | null): boolean {
  if (newestDistMs === null) return true; // missing dist
  if (newestSrcMs === null) return false; // no sources to be newer
  return newestSrcMs > newestDistMs + 1000;
}

export function classifyBuild(name: string, srcMs: number | null, distMs: number | null): BuildFreshness {
  const status: BuildFreshness['status'] =
    distMs === null ? 'missing-dist' : isDistStale(srcMs, distMs) ? 'stale' : 'fresh';
  return { name, status, newestSrcMs: srcMs, newestDistMs: distMs };
}

/** Recursively find the newest mtime (ms) under a directory, or null if none/absent. */
export async function newestMtimeMs(dir: string, exts: readonly string[]): Promise<number | null> {
  let newest: number | null = null;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null; // directory absent
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const sub = await newestMtimeMs(full, exts);
      if (sub !== null && (newest === null || sub > newest)) newest = sub;
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      try {
        const st = await fs.stat(full);
        if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {
        /* file vanished mid-walk — ignore */
      }
    }
  }
  return newest;
}

/**
 * The loopback addresses a port must be probed on. IPv4 alone is NOT enough:
 * Vite's dev server binds `::1` ONLY (dev-server.ts records the same finding —
 * it must talk to `localhost`, not `127.0.0.1`). GP-DEMO-3 M7 measured the
 * consequence live: an orphaned `ces-muster` vite held `::1:5173`, pre-flight
 * reported the port FREE, the demo's own `--strictPort` vite died on the
 * collision, and the Muster wizard leg then drove a DIFFERENT product's SPA to
 * a 30 s selector timeout. A port is occupied if EITHER loopback answers.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

/** Probe one loopback address; a connect error (ECONNREFUSED, EAFNOSUPPORT on a
 * host without IPv6) means nothing is listening there. */
function probePortOnHost(port: number, host: string, timeoutMs: number): Promise<'free' | 'occupied'> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (r: 'free' | 'occupied'): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('occupied'));
    socket.once('timeout', () => done('free'));
    socket.once('error', () => done('free')); // ECONNREFUSED etc.
    socket.connect(port, host);
  });
}

/** Combine per-host probe results: occupied if ANY loopback address answers. */
export function combinePortProbes(results: readonly ('free' | 'occupied')[]): 'free' | 'occupied' {
  return results.includes('occupied') ? 'occupied' : 'free';
}

/** Probe whether a TCP port is accepting connections on any loopback address. */
export async function probePort(port: number, timeoutMs = 500): Promise<'free' | 'occupied'> {
  const results = await Promise.all(LOOPBACK_HOSTS.map((h) => probePortOnHost(port, h, timeoutMs)));
  return combinePortProbes(results);
}

/**
 * Assemble a PreflightReport from already-resolved build + port facts. Pure —
 * the live command supplies real probes; tests supply fixtures.
 */
export function assemblePreflight(builds: BuildFreshness[], ports: PortStatus[]): PreflightReport {
  const issues: string[] = [];
  for (const b of builds) {
    if (b.status === 'stale') issues.push(`build STALE: ${b.name} — run its \`npm run build\` (dist older than src)`);
    if (b.status === 'missing-dist') issues.push(`build MISSING: ${b.name} — no dist/, run \`npm run build\``);
  }
  for (const p of ports) {
    if (p.status === 'occupied') issues.push(`port OCCUPIED: ${p.port} (${p.name}) — free it before the demo (or run \`demo:reset\`)`);
  }
  return { ok: issues.length === 0, builds, ports, issues };
}

export interface PreflightOptions {
  readonly modules: readonly ModuleBuild[];
  readonly ports: readonly PortSpec[];
  /** Test seam: override the mtime walk. */
  readonly newestMtime?: (dir: string, exts: readonly string[]) => Promise<number | null>;
  /** Test seam: override the port probe. */
  readonly probe?: (port: number) => Promise<'free' | 'occupied'>;
}

/** Run the live pre-flight: measure build freshness + port availability. */
export async function runPreflight(opts: PreflightOptions): Promise<PreflightReport> {
  const walk = opts.newestMtime ?? newestMtimeMs;
  const probe = opts.probe ?? ((p: number) => probePort(p));

  const builds: BuildFreshness[] = [];
  for (const m of opts.modules) {
    const [srcMs, distMs] = await Promise.all([walk(m.srcDir, ['.ts']), walk(m.distDir, ['.js'])]);
    builds.push(classifyBuild(m.name, srcMs, distMs));
  }

  const ports: PortStatus[] = [];
  for (const p of opts.ports) {
    ports.push({ name: p.name, port: p.port, status: await probe(p.port) });
  }

  return assemblePreflight(builds, ports);
}
