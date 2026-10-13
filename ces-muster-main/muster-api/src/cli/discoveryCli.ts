// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryCli.ts — `mu discovery --sim` (GP-DEMO-2, founder-directed 2026-07-28).
// Pure wiring of the existing DISCOVERY-1 executor behind a CLI command so
// ces-tester can run Muster's tenant evaluation against a live stacksim sim and
// get the readiness-result file. NO new discovery logic — this module only:
//   1. probes the already-running sim (fails loud if absent; NEVER boots or
//      resets tenants — the caller owns seeding + serving)
//   2. loads the Stamper registry get-entries (discoveryWiring.loadRegistryGetEntries)
//   3. runs the walk (discoveryService.runDiscovery) over a live-sim session that
//      mirrors tests/discovery.live-sim.test.ts's proven per-command PowerShell
//      recipe exactly (services/liveSimSession.ts)
//   4. assembles + schema-validates a readiness-result.v1 envelope
//      (services/discoveryEnvelope.ts — mirrors the SPA's buildReadinessResult
//      shape; see that module's header for why it isn't imported directly)
//   5. writes it to --out and prints a run summary
//
// READ-ONLY guarantee: runDiscovery only ever calls entry.get_command — there is
// no set_command code path in discoveryService.ts (see that file's own header).
// This CLI additionally ASSERTS zero ledger create/mutate entries after the walk
// (the same check tests/discovery.live-sim.test.ts's GATE 5 makes) before
// declaring success, so a correctness regression in the executor would fail the
// run loudly rather than silently producing a result file.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RegistryGetEntry, DiscoverySession, CaptureSink } from '../services/discoveryService.js';
import { runSimDiscovery } from '../services/simDiscoveryRun.js';

export interface DiscoveryCliStream {
  write(s: string): void;
}

export interface DiscoveryCliDeps {
  probeLedger?: (url: string) => Promise<boolean>;
  loadEntries?: () => RegistryGetEntry[];
  session?: DiscoverySession;
  makeCapture?: (outDir: string) => CaptureSink;
  writeFile?: (path: string, data: string) => void;
  mkdir?: (path: string) => void;
  now?: () => Date;
  stdout?: DiscoveryCliStream;
  stderr?: DiscoveryCliStream;
  /** Injectable for tests. Default queries the real sim ledger for GATE-5-style
   * zero-writes assertion (create/mutate entries since the walk started). */
  assertZeroWrites?: (simUrl: string, since: string) => Promise<{ ok: boolean; offenders?: unknown[] }>;
  /** Injectable registry root for registry_versions provenance. */
  registryRoot?: string;
}

const DEFAULT_OUT = './discovery-result.json';
const DEFAULT_SLUG = 'stacksim-local';

/**
 * `mu discovery --sim [--out <file>] [--slug <slug>]`. Returns a process exit
 * code (0 success, 1 execution failure). `flags` is the same parsed Map runMu's
 * argv parser already produces (--sim is a boolean flag, --out/--slug are
 * string-valued). W4-MU2: the run itself is services/simDiscoveryRun.ts, shared
 * with POST /api/discovery/run.
 */
export async function runDiscoveryCli(
  flags: Map<string, string | boolean>,
  deps: DiscoveryCliDeps = {}
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const writeFile = deps.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, 'utf-8'));

  function emitErr(msg: string): void {
    stderr.write(JSON.stringify({ error: msg }) + '\n');
  }

  if (flags.get('sim') !== true) {
    emitErr(
      'mu discovery requires --sim (this CLI only ever targets a live stacksim sim — ' +
        'FD-LIVE-SMOKE safety, non-negotiable). Usage: mu discovery --sim [--out <file>] [--slug <slug>]'
    );
    return 1;
  }

  const outPath = (flags.get('out') as string | undefined) ?? DEFAULT_OUT;
  const slug = (flags.get('slug') as string | undefined) ?? DEFAULT_SLUG;

  const outcome = await runSimDiscovery(
    { slug, outDir: dirname(resolve(outPath)) },
    {
      probeLedger: deps.probeLedger,
      loadEntries: deps.loadEntries,
      session: deps.session,
      makeCapture: deps.makeCapture,
      mkdir: deps.mkdir,
      now: deps.now,
      assertZeroWrites: deps.assertZeroWrites,
      registryRoot: deps.registryRoot,
    }
  );
  if (!outcome.ok) {
    emitErr(outcome.message);
    return 1;
  }

  writeFile(outPath, JSON.stringify(outcome.envelope, null, 2));

  stdout.write(
    JSON.stringify({
      ok: true,
      out: outPath,
      stats: outcome.stats,
      postures: outcome.postures,
    }) + '\n'
  );
  return 0;
}
