// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discovery.cli.live-sim.test.ts — GP-DEMO-2: `mu discovery --sim` end-to-end
// against a LIVE tenant-stacksim sim server. The CLI-level counterpart to
// tests/discovery.live-sim.test.ts (which proves the executor directly); here
// runDiscoveryCli is driven exactly as the `mu discovery --sim` command would
// be, minus process.exit — production fs/session deps, injected only where the
// test needs to observe results (writeFile capture) or keep the run bounded to
// a deterministic slice of the registry.
//
// Self-booting + infra-gated, same pattern as discovery.live-sim.test.ts:
// reuse-don't-own a stacksim serve on 127.0.0.1:4390 (probe POST /ledger
// first), skip cleanly when the sibling tenant-stacksim/ces-stamper checkouts
// are absent.
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv from 'ajv';

import { runDiscoveryCli } from '../src/cli/discoveryCli.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';
import { buildLiveSimSession, simAvailable, SIM_URL } from '../src/services/liveSimSession.js';
import type { RegistryGetEntry } from '../src/services/discoveryService.js';

const SIM_AVAILABLE = simAvailable();

/**
 * Same bounded, deterministic subset of the real registry that
 * discovery.live-sim.test.ts uses (graph-engine, placeholder-free, single-cmdlet
 * Get-Mg* gets) — the CLI itself runs the full registry in production; bounding
 * here only keeps this smoke test fast and deterministic, same rationale as the
 * executor-level GATE 1 test.
 */
function boundedGraphGets(n: number): RegistryGetEntry[] {
  return loadRegistryGetEntries()
    .filter(
      (e) =>
        e.engine === 'mgraph' &&
        !!e.get_command &&
        !/\{[a-zA-Z]/.test(e.get_command) &&
        !e.get_command.includes('$') &&
        /^Get-Mg/.test(e.get_command.trim())
    )
    .slice(0, n);
}

async function ledgerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SIM_URL}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!SIM_AVAILABLE)('mu discovery --sim — GP-DEMO-2 CLI live-sim smoke', () => {
  let server: ChildProcess | undefined;
  let bootedHere = false;
  const outDir = path.join(process.cwd(), '.tmp-discovery-cli-smoke');
  const outPath = path.join(outDir, 'discovery-result.json');

  beforeAll(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    if (await ledgerReachable()) return; // a server is already up — use it, don't own it.
    const simRoot = path.resolve(process.cwd(), '..', '..', 'tenant-stacksim');
    server = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], {
      cwd: simRoot,
      stdio: 'ignore',
    });
    bootedHere = true;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await ledgerReachable()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('stacksim sim server did not come up within 15s');
  }, 30000);

  afterAll(() => {
    if (bootedHere && server && !server.killed) server.kill();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('runs end-to-end and writes a schema-valid readiness-result.json with observation stats', async () => {
    const bounded = boundedGraphGets(5);
    expect(bounded.length).toBeGreaterThan(0);

    let written: string | undefined;
    const code = await runDiscoveryCli(
      new Map<string, string | boolean>([
        ['sim', true],
        ['out', outPath],
        ['slug', 'gp-demo-2-smoke'],
      ]),
      {
        loadEntries: () => bounded,
        session: buildLiveSimSession(),
        writeFile: (p, data) => {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, data, 'utf-8');
          written = data;
        },
      }
    );

    expect(code).toBe(0);
    expect(written).toBeDefined();
    const envelope = JSON.parse(written!);

    const schemaPath = path.resolve('..', 'public', 'schemas', 'readiness-result.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = new Ajv({ strict: true }).compile(schema);
    const ok = validate(envelope);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);

    expect(envelope.observations.length).toBeGreaterThanOrEqual(bounded.length);
    const met = envelope.observations.filter((o: { derived_posture: string }) => o.derived_posture === 'met');
    const unknown = envelope.observations.filter(
      (o: { derived_posture: string }) => o.derived_posture === 'unknown'
    );
    // Real reads happened against the live sim — at least one MET from real data.
    expect(met.length).toBeGreaterThan(0);
    expect(met[0].raw_capture_ref).toMatch(/^captures\//);
    expect(met[0]).not.toHaveProperty('raw_output');

    console.log(
      `discovery.cli.live-sim smoke observation stats: met=${met.length} unknown=${unknown.length} total=${envelope.observations.length}`
    );
  }, 60000);
});
