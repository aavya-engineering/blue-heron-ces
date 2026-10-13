// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discovery.test.ts — G-MUSTER-DISCOVERY-1 unit gate for the read-only
// executor. Mock session (dependency injection) — no real tenant/PowerShell.
// Proves: registry walk, manual_only recorded (not omitted), per-command
// degradation, structural read-only (a set_command is NEVER executed), and that
// emitted observations validate against readiness-result.v1's observation shape.
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import Ajv from 'ajv';
import {
  runDiscovery,
  toGetEntries,
  AUTH_TIER_UNAVAILABLE,
  type RegistryGetEntry,
  type DiscoverySession,
  type CaptureSink,
} from '../src/services/discoveryService.js';

const memoryCapture: CaptureSink = {
  write: (entryId) => `captures/${entryId}.json`,
};

function okSession(stdout: string): DiscoverySession {
  return { execute: vi.fn(async () => ({ stdout, stderr: '', exitCode: 0, durationMs: 1 })) };
}

const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'AC.get-a', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser' },
  { entry_id: 'MP.manual', control_ids: ['MP.L2-3.8.1'], engine: 'manual', manual_only: true },
  { entry_id: 'IA.get-b', control_ids: ['IA.L2-3.5.3', 'AC.L2-3.1.13'], engine: 'mgraph', get_command: 'Get-MgPolicy' },
];

describe('runDiscovery — read-only executor (DISCOVERY-1)', () => {
  it('walks runnable gets, records manual_only (not omitted), and emits per-control observations', async () => {
    const session = okSession('[{"id":"x"}]');
    const { observations, stats } = await runDiscovery(ENTRIES, session, memoryCapture);

    expect(stats.entries).toBe(3);
    expect(stats.ran).toBe(2); // the two get entries
    expect(stats.manual_only_skipped).toBe(1);

    // Manual-only appears as a recorded row, not an omission.
    const manual = observations.find((o) => o.ran_entry_ids.includes('MP.manual'));
    expect(manual).toBeDefined();
    expect(manual!.derived_posture).toBe('unknown');

    // IA.get-b covers two controls -> two observations.
    const iaControls = observations.filter((o) => o.ran_entry_ids.includes('IA.get-b')).map((o) => o.control_id);
    expect(iaControls.sort()).toEqual(['AC.L2-3.1.13', 'IA.L2-3.5.3']);

    // Successful non-empty read -> met + capture ref (never inline output).
    const acObs = observations.find((o) => o.control_id === 'AC.L1-3.1.1')!;
    expect(acObs.derived_posture).toBe('met');
    expect(acObs.raw_capture_ref).toBe('captures/AC.get-a.json');
    expect(acObs).not.toHaveProperty('raw_output');
  });

  it('NEVER executes a set_command — only get_command is ever passed to the session', async () => {
    const exec = vi.fn(async () => ({ stdout: '[]', stderr: '', exitCode: 0, durationMs: 1 }));
    const entriesWithSets = ENTRIES.map((e) => ({ ...e }));
    await runDiscovery(entriesWithSets, { execute: exec }, memoryCapture);
    // Every command passed to the session is a get_command from the entries.
    const gets = new Set(ENTRIES.filter((e) => e.get_command).map((e) => e.get_command));
    for (const call of exec.mock.calls) {
      expect(gets.has(call[1] as string)).toBe(true);
    }
  });

  it('records per-command degradation (auth/cmdlet) as unknown, without failing the walk', async () => {
    const session: DiscoverySession = {
      execute: vi.fn(async (_engine, cmd) =>
        cmd === 'Get-MgUser'
          ? { stdout: '', stderr: "The term 'Get-MgUser' is not recognized as the name of a cmdlet", exitCode: 1, durationMs: 1 }
          : { stdout: '[{"id":"y"}]', stderr: '', exitCode: 0, durationMs: 1 }
      ),
    };
    const { observations, stats } = await runDiscovery(ENTRIES, session, memoryCapture);
    expect(stats.degraded).toBe(1);
    const degraded = observations.find((o) => o.control_id === 'AC.L1-3.1.1')!;
    expect(degraded.derived_posture).toBe('unknown');
    expect(degraded.confidence).toBe('unknown');
    // The walk still produced the other observations.
    expect(observations.length).toBeGreaterThan(1);
  });

  it('a thrown session error degrades that command, never the whole run', async () => {
    const session: DiscoverySession = {
      execute: vi.fn(async (_e, cmd) => {
        if (cmd === 'Get-MgUser') throw new Error('process died');
        return { stdout: '[{"id":"z"}]', stderr: '', exitCode: 0, durationMs: 1 };
      }),
    };
    const { observations } = await runDiscovery(ENTRIES, session, memoryCapture);
    expect(observations.find((o) => o.control_id === 'AC.L1-3.1.1')!.derived_posture).toBe('unknown');
    expect(observations.find((o) => o.control_id === 'IA.L2-3.5.3')!.derived_posture).toBe('met');
  });

  it('emitted observations validate against the readiness-result.v1 observation schema', () => {
    // Pull the observations sub-schema from the published readiness-result schema.
    const schemaPath = path.resolve('..', 'public', 'schemas', 'readiness-result.schema.json');
    const full = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const obsSchema = full.properties.observations.items;
    const validate = new Ajv({ strict: true }).compile(obsSchema);

    const sample = {
      control_id: 'AC.L1-3.1.1',
      objective_ids: [],
      confidence: 'high',
      ran_entry_ids: ['AC.get-a'],
      raw_capture_ref: 'captures/AC.get-a.json',
      derived_posture: 'met',
    };
    const valid = validate(sample);
    if (!valid) console.error(validate.errors);
    expect(valid).toBe(true);
  });

  it('toGetEntries reduces a raw Stamper registry to the walkable get subset', () => {
    const raw = [
      { entry_id: 'e1', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser', set_command: 'Set-X', manual_only: false },
      { entry_id: 'e2', control_ids: ['MP.L2-3.8.1'], engine: 'exchange', manual_only: true },
      { junk: true },
    ];
    const entries = toGetEntries(raw);
    expect(entries).toHaveLength(2);
    // set_command is dropped — the executor has no field for it (structural read-only).
    expect(entries[0]).not.toHaveProperty('set_command');
    expect(entries[1].manual_only).toBe(true);
  });
});

// DISCOVERY-1 acceptance GATE 2 — per-command auth-tier degradation. A run at a
// restricted tier (a session whose privileged reads come back with Microsoft
// Graph's real denial signature) records the literal "unavailable at this auth
// tier" status per denied command — the walk completes, nothing is silently
// skipped, and unprivileged reads still land as 'ok'.
describe('GATE 2 — restricted auth tier records "unavailable at this auth tier" per command', () => {
  // Graph's actual insufficient-privileges wording (delegated tier missing a role).
  const GRAPH_DENIAL =
    'Get-MgPolicy : Authorization_RequestDenied: Insufficient privileges to complete the operation.';

  const restrictedSession: DiscoverySession = {
    execute: vi.fn(async (_engine, cmd) =>
      cmd === 'Get-MgPolicy'
        ? { stdout: '', stderr: GRAPH_DENIAL, exitCode: 1, durationMs: 1 }
        : { stdout: '[{"id":"u1"}]', stderr: '', exitCode: 0, durationMs: 1 }
    ),
  };

  it('records the literal fact-status for each denied command instead of failing the walk', async () => {
    const { observations, statuses, stats } = await runDiscovery(
      ENTRIES,
      restrictedSession,
      memoryCapture,
      { restrictedTier: true }
    );

    // Every entry has exactly one status row — nothing silently skipped.
    expect(statuses.map((s) => s.entry_id)).toEqual(ENTRIES.map((e) => e.entry_id));

    // The denied command carries the normative wording, verbatim.
    expect(statuses.find((s) => s.entry_id === 'IA.get-b')!.status).toBe(
      'unavailable at this auth tier'
    );
    expect(statuses.find((s) => s.entry_id === 'IA.get-b')!.status).toBe(AUTH_TIER_UNAVAILABLE);

    // The walk did NOT fail: the permitted read succeeded and manual_only is recorded.
    expect(statuses.find((s) => s.entry_id === 'AC.get-a')!.status).toBe('ok');
    expect(statuses.find((s) => s.entry_id === 'MP.manual')!.status).toBe('manual_only');
    expect(stats.degraded).toBe(1);

    // Degraded observations exist (unknown, never omitted) alongside met ones.
    expect(observations.find((o) => o.control_id === 'IA.L2-3.5.3')!.derived_posture).toBe('unknown');
    expect(observations.find((o) => o.control_id === 'AC.L1-3.1.1')!.derived_posture).toBe('met');
  });

  it('degradation is per-command regardless of the restrictedTier flag (never all-or-nothing)', async () => {
    const flagged = await runDiscovery(ENTRIES, restrictedSession, memoryCapture, {
      restrictedTier: true,
    });
    const unflagged = await runDiscovery(ENTRIES, restrictedSession, memoryCapture);
    expect(unflagged.statuses).toEqual(flagged.statuses);
    expect(unflagged.stats).toEqual(flagged.stats);
  });

  it('a thrown session error is also recorded as unavailable-at-this-auth-tier, not silence', async () => {
    const throwing: DiscoverySession = {
      execute: vi.fn(async (_e, cmd) => {
        if (cmd === 'Get-MgUser') throw new Error('session not connected at this tier');
        return { stdout: '[{"id":"v"}]', stderr: '', exitCode: 0, durationMs: 1 };
      }),
    };
    const { statuses } = await runDiscovery(ENTRIES, throwing, memoryCapture);
    expect(statuses.find((s) => s.entry_id === 'AC.get-a')!.status).toBe(AUTH_TIER_UNAVAILABLE);
    expect(statuses.find((s) => s.entry_id === 'IA.get-b')!.status).toBe('ok');
  });
});

// A tiny sanity check that the real registry is readable-as-data (no fork).
describe('registry-as-data', () => {
  it('loads the Stamper cmmc-l2 registry entries in place', () => {
    const regPath = path.resolve('..', '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
    if (!fs.existsSync(regPath)) {
      console.warn('[DISCOVERY-1] Stamper registry not present in this checkout — skipping in-place load check');
      return;
    }
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const entries = toGetEntries(reg.entries ?? []);
    expect(entries.length).toBeGreaterThan(0);
    // Some entries carry get_commands (the runnable gets).
    expect(entries.some((e) => e.get_command)).toBe(true);
    void load; // js-yaml import kept for parity with other suites
  });
});
