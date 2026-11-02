// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO1 (2026-09-27) — get-then-set records REAL pre/post state.
//
// Unit level (production GetThenSetExecutor, a scripted adapter standing in
// for PowerShell). The stacksim-backed proof is
// test/integration/realState.stacksim.test.ts.

import { describe, it, expect } from 'vitest';
import {
  executeGetThenSet,
  readOnlyViolation,
  buildStateCaptureCommand,
  extractStateSnapshot,
  StateReadRefusedError,
  STATE_BEGIN_MARKER,
  STATE_END_MARKER,
} from '../src/execution/GetThenSetExecutor.js';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
import type { AoCommand } from '../src/types/AoCommand.js';

const COMMANDS = registry as unknown as AoCommand[];

type Call = { command: string; dryRun: boolean };

/** A tiny stateful "tenant": state reads return the current value; the set flips it. */
function scriptedAdapter(initial: string, setChangesState: boolean) {
  let state = initial;
  const calls: Call[] = [];
  return {
    calls,
    async execute(task: any, _vars: Record<string, string>, dryRun: boolean) {
      const command: string = task.action.command;
      calls.push({ command, dryRun });
      if (command.includes(STATE_BEGIN_MARKER)) {
        return { success: true, stdout: `banner\r\n${STATE_BEGIN_MARKER}\r\n${state}\r\n${STATE_END_MARKER}\r\nSTAMPER_EXECUTION_SUCCESS\r\n`, stderr: '', exit_code: 0 };
      }
      if (setChangesState) state = `${state}-changed`;
      return { success: true, stdout: 'set ok', stderr: '', exit_code: 0 };
    },
  };
}

const entry: any = {
  entry_id: 'T.X-01',
  engine: 'mgraph',
  control_ids: [],
  idempotency: 'get-then-set',
  get_command: "Get-MgUser -Filter \"userPrincipalName eq '{upn}'\"",
  set_command: "Update-MgUser -UserId '{upn}' -AccountEnabled:$false",
};

describe('W4-AO1 read-only guard for state reads', () => {
  it('every get-then-set command in the registry has a get_command the guard accepts', () => {
    const offenders: string[] = [];
    for (const cmd of COMMANDS) {
      const e = translateAoCommandToCommandEntry(cmd);
      if (!e.set_command || !e.get_command) continue;
      const v = readOnlyViolation(e.get_command);
      if (v) offenders.push(`${cmd.id}: ${v}`);
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    ["Set-MgUser -UserId x -AccountEnabled:$false", /mutating cmdlet/],
    ["Get-MgUser | ForEach-Object { Remove-MgUser -UserId $_.Id }", /mutating cmdlet/],
    ["$x = New-MgGroup -DisplayName g", /mutating cmdlet/],
    ["Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy'", /non-GET REST/],
    ["Invoke-AzRestMethod -Method DELETE -Path '/x'", /non-GET REST/],
    ["Invoke-MgDismissRiskyUser -UserIds @('u')", /Graph action/],
  ])('refuses %s', (cmd, why) => {
    expect(readOnlyViolation(cmd)).toMatch(why);
  });

  it.each([
    "Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/authorizationPolicy'",
    "Search-UnifiedAuditLog -Operations New-ComplianceCase,Set-ComplianceCase | Where-Object { $_.Operations -match 'New-ComplianceCase|Set-ComplianceCase' }",
    "Get-MgUser -All | Select-Object Id",
  ])('accepts read-only %s', (cmd) => {
    expect(readOnlyViolation(cmd)).toBeUndefined();
  });
});

describe('W4-AO1 state capture wrapper', () => {
  it('wraps the get in marker-delimited compact JSON and extracts only the snapshot', () => {
    const wrapped = buildStateCaptureCommand("Get-MgUser -UserId '{upn}'");
    expect(wrapped).toContain('ConvertTo-Json -Depth 8 -Compress');
    expect(wrapped).toContain("{upn}"); // placeholder left for the adapter's interpolation
    expect(extractStateSnapshot(`noise\r\n${STATE_BEGIN_MARKER}\r\n{"a":1}\r\n${STATE_END_MARKER}\r\nSTAMPER_EXECUTION_SUCCESS`)).toBe('{"a":1}');
    expect(extractStateSnapshot('no markers')).toBeUndefined();
  });
});

describe('W4-AO1 executeGetThenSet', () => {
  it('live: reads real pre-state, writes, reads real post-state; stateChanged is a real comparison (true)', async () => {
    const a = scriptedAdapter('{"enabled":true}', true);
    const r = await executeGetThenSet(a, entry, { upn: 'u@x' }, false);
    expect(r.preStateOutput).toBe('{"enabled":true}');
    expect(r.postStateOutput).toBe('{"enabled":true}-changed');
    expect(r.stateChanged).toBe(true);
    expect(r.applied).toBe(true);
    // Both reads were REAL reads (dryRun=false), never the adapter's dry-run placeholder path.
    expect(a.calls.filter((c) => c.command.includes(STATE_BEGIN_MARKER)).every((c) => c.dryRun === false)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/\[dry-run\]|DRY RUN/);
  });

  it('live: an idempotent set that changes nothing records pre == post and stateChanged=false', async () => {
    const a = scriptedAdapter('{"enabled":false}', false);
    const r = await executeGetThenSet(a, entry, { upn: 'u@x' }, false);
    expect(r.preStateOutput).toBe(r.postStateOutput);
    expect(r.stateChanged).toBe(false);
    expect(r.applied).toBe(true);
  });

  it('dry run: reads the real current state through the reader and NEVER sends the set', async () => {
    const setAdapter = scriptedAdapter('unused', true);
    const reader = scriptedAdapter('{"enabled":true}', true);
    const r = await executeGetThenSet(setAdapter, entry, { upn: 'u@x' }, true, reader);
    expect(r.preStateOutput).toBe('{"enabled":true}');
    expect(r.applied).toBe(false);
    expect(r.stateChanged).toBeUndefined();
    expect(setAdapter.calls).toHaveLength(0);
    expect(reader.calls).toHaveLength(1);
    expect(reader.calls[0].command).toContain(STATE_BEGIN_MARKER);
    expect(reader.calls[0].dryRun).toBe(false);
  });

  it('dry run with no reader: pre-state is recorded as unavailable with a reason, never a placeholder', async () => {
    const a = scriptedAdapter('x', true);
    const r = await executeGetThenSet(a, entry, { upn: 'u@x' }, true, undefined);
    expect(r.preStateOutput).toBeUndefined();
    expect(r.stateReadError).toMatch(/no state reader/);
    expect(a.calls).toHaveLength(0);
  });

  it('a mutating get_command is refused before ANY call (dry run and live)', async () => {
    const bad = { ...entry, get_command: "Set-MgUser -UserId '{upn}' -AccountEnabled:$true" };
    const a = scriptedAdapter('x', true);
    await expect(executeGetThenSet(a, bad, { upn: 'u' }, true, a)).rejects.toBeInstanceOf(StateReadRefusedError);
    await expect(executeGetThenSet(a, bad, { upn: 'u' }, false)).rejects.toBeInstanceOf(StateReadRefusedError);
    expect(a.calls).toHaveLength(0);
  });

  it('never blind-writes: a failed pre-state read aborts the live set', async () => {
    const calls: Call[] = [];
    const a = {
      async execute(task: any, _v: any, dryRun: boolean) {
        calls.push({ command: task.action.command, dryRun });
        return { success: false, stdout: '', stderr: 'Get-MgUser : not found', exit_code: 1 };
      },
    };
    const r = await executeGetThenSet(a, entry, { upn: 'u' }, false);
    expect(r.result.success).toBe(false);
    expect(r.result.error).toMatch(/aborted before the write/);
    expect(r.applied).toBe(false);
    expect(calls).toHaveLength(1); // only the read
  });
});
