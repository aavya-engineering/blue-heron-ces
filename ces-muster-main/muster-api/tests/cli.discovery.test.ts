// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * cli.discovery.test.ts — unit tests for `mu discovery --sim`
 * (GP-DEMO-2, src/cli/discoveryCli.ts).
 *
 * Fully mocked/injected: no real PowerShell, no real stacksim sim, no real
 * Stamper registry checkout required. The live-sim end-to-end path is proven
 * separately by discovery.cli.live-sim.test.ts (self-gated, same pattern as
 * tests/discovery.live-sim.test.ts).
 */
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runDiscoveryCli, type DiscoveryCliDeps } from '../src/cli/discoveryCli.js';
import type { RegistryGetEntry, DiscoverySession, CaptureSink } from '../src/services/discoveryService.js';

function captureStreams() {
  let out = '';
  let err = '';
  return {
    stdout: { write: (s: string) => { out += s; } },
    stderr: { write: (s: string) => { err += s; } },
    getOut: () => out,
    getErr: () => err,
  };
}

const FAKE_ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'e1', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser' },
  { entry_id: 'e2', control_ids: ['AC.L2-3.1.6'], engine: 'mgraph', get_command: 'Get-MgGroup' },
];

const fakeSession: DiscoverySession = {
  async execute(_engine: string, command: string) {
    if (command === 'Get-MgUser') {
      return { stdout: 'row-data', stderr: '', exitCode: 0, durationMs: 1 };
    }
    return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
  },
};

function memoryCapture(): { sink: CaptureSink; writes: Array<{ entryId: string; stdout: string }> } {
  const writes: Array<{ entryId: string; stdout: string }> = [];
  return {
    writes,
    sink: {
      write(entryId: string, stdout: string) {
        writes.push({ entryId, stdout });
        return `captures/${entryId}.txt`;
      },
    },
  };
}

/** A hermetic, machine-independent baseline dep set: reachable sim, real
 * entries + session fakes, no-op fs, zero-writes assertion passes. */
function baseDeps(overrides: Partial<DiscoveryCliDeps> = {}): { deps: DiscoveryCliDeps; calls: Record<string, unknown> } {
  const streams = captureStreams();
  const calls: Record<string, unknown> = {};
  const writes: Array<{ path: string; data: string }> = [];
  calls.writes = writes;
  const capture = memoryCapture();
  calls.captureWrites = capture.writes;

  const deps: DiscoveryCliDeps = {
    stdout: streams.stdout,
    stderr: streams.stderr,
    probeLedger: async (url: string) => {
      calls.probedUrl = url;
      return true;
    },
    loadEntries: () => {
      calls.loadEntriesCalled = true;
      return FAKE_ENTRIES;
    },
    session: fakeSession,
    makeCapture: () => capture.sink,
    writeFile: (path: string, data: string) => {
      writes.push({ path, data });
    },
    mkdir: (path: string) => {
      calls.mkdirPath = path;
    },
    now: (() => {
      let n = 0;
      const times = ['2026-07-28T10:00:00.000Z', '2026-07-28T10:00:05.000Z'];
      return () => new Date(times[Math.min(n++, times.length - 1)]);
    })(),
    assertZeroWrites: async () => ({ ok: true }),
    registryRoot: '/no/such/registry/root/for-hermetic-tests',
    ...overrides,
  };

  calls.getOut = streams.getOut;
  calls.getErr = streams.getErr;
  return { deps, calls };
}

describe('mu discovery --sim — arg parsing', () => {
  it('missing --sim: exit 1, loud error, never probes the sim', async () => {
    const { deps, calls } = baseDeps();
    const code = await runDiscoveryCli(new Map(), deps);
    expect(code).toBe(1);
    const err = (calls.getErr as () => string)();
    expect(err).toContain('--sim');
    expect(calls.probedUrl).toBeUndefined();
  });

  it('--sim with a non-boolean value is not accepted as the flag', async () => {
    // mu's parseArgs only sets a flag to `true` when no following non-flag value
    // is present; a bare presence check (`!== true`) is what discoveryCli uses.
    const { deps } = baseDeps();
    const code = await runDiscoveryCli(new Map([['sim', 'yes']]), deps);
    expect(code).toBe(1);
  });

  it('default --out and --slug are used when not provided', async () => {
    const { deps, calls } = baseDeps();
    const code = await runDiscoveryCli(new Map([['sim', true]]), deps);
    expect(code).toBe(0);
    const writes = calls.writes as Array<{ path: string; data: string }>;
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('./discovery-result.json');
    const envelope = JSON.parse(writes[0].data);
    expect(envelope.manifest.tenant.slug).toBe('stacksim-local');
  });

  it('--out and --slug flags are honored', async () => {
    const { deps, calls } = baseDeps();
    const code = await runDiscoveryCli(
      new Map<string, string | boolean>([
        ['sim', true],
        ['out', 'runs/custom-result.json'],
        ['slug', 'my-tenant'],
      ]),
      deps
    );
    expect(code).toBe(0);
    const writes = calls.writes as Array<{ path: string; data: string }>;
    expect(writes[0].path).toBe('runs/custom-result.json');
    const envelope = JSON.parse(writes[0].data);
    expect(envelope.manifest.tenant.slug).toBe('my-tenant');
    expect(envelope.manifest.engagement_id).toBe('mu-discovery-my-tenant');
  });
});

describe('mu discovery --sim — loud-fail-when-sim-down', () => {
  it('sim unreachable: exit 1, clear message, never loads registries or runs the walk', async () => {
    const { deps, calls } = baseDeps({
      probeLedger: async () => false,
    });
    const code = await runDiscoveryCli(new Map([['sim', true]]), deps);
    expect(code).toBe(1);
    const err = (calls.getErr as () => string)();
    expect(err).toContain('127.0.0.1:4390');
    expect(err).toContain('not reachable');
    expect(err).not.toContain('undefined');
    expect(calls.loadEntriesCalled).toBeUndefined();
  });

  it('empty registry entries: exit 1, clear message', async () => {
    const { deps, calls } = baseDeps({
      loadEntries: () => [],
    });
    const code = await runDiscoveryCli(new Map([['sim', true]]), deps);
    expect(code).toBe(1);
    const err = (calls.getErr as () => string)();
    expect(err).toContain('registry');
  });
});

describe('mu discovery --sim — read-only guarantee', () => {
  it('ledger records a create/mutate during the walk: exit 1, loud, out file still written or not — must fail', async () => {
    const { deps, calls } = baseDeps({
      assertZeroWrites: async () => ({ ok: false, offenders: [{ type: 'create', id: 'x' }] }),
    });
    const code = await runDiscoveryCli(new Map([['sim', true]]), deps);
    expect(code).toBe(1);
    const err = (calls.getErr as () => string)();
    expect(err).toContain('READ-ONLY guarantee violated');
    const writes = calls.writes as Array<{ path: string; data: string }>;
    expect(writes).toHaveLength(0);
  });
});

describe('mu discovery --sim — happy path envelope', () => {
  it('produces a schema-valid readiness-result with control_id + derived_posture + confidence, and prints a summary', async () => {
    const { deps, calls } = baseDeps();
    const code = await runDiscoveryCli(new Map([['sim', true]]), deps);
    expect(code).toBe(0);

    const writes = calls.writes as Array<{ path: string; data: string }>;
    const envelope = JSON.parse(writes[0].data);

    const schemaPath = resolve('..', 'public', 'schemas', 'readiness-result.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const validate = new Ajv({ strict: true }).compile(schema);
    const ok = validate(envelope);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);

    expect(envelope.observations).toHaveLength(2);
    for (const obs of envelope.observations) {
      expect(typeof obs.control_id).toBe('string');
      expect(['met', 'not_met', 'partial', 'unknown']).toContain(obs.derived_posture);
      expect(['high', 'medium', 'low', 'unknown']).toContain(obs.confidence);
    }
    const met = envelope.observations.find((o: { control_id: string }) => o.control_id === 'AC.L1-3.1.1');
    expect(met.derived_posture).toBe('met');
    expect(met.raw_capture_ref).toBe('captures/e1.txt');
    const unknown = envelope.observations.find((o: { control_id: string }) => o.control_id === 'AC.L2-3.1.6');
    expect(unknown.derived_posture).toBe('unknown');

    const captureWrites = calls.captureWrites as Array<{ entryId: string }>;
    expect(captureWrites.map((w) => w.entryId)).toEqual(['e1']);

    const out = (calls.getOut as () => string)();
    const summary = JSON.parse(out.trim());
    expect(summary.ok).toBe(true);
    expect(summary.postures).toEqual({ met: 1, unknown: 1, not_met: 0 });
    expect(summary.stats.ran).toBe(2);
  });
});
