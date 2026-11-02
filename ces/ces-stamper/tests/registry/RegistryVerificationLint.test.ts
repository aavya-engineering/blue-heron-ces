// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-03 registry lint: verification reads the post-SET get_command output as JSON, so every
// entry with a SET and a structured evidence rule (jsonpath, regex or checks) must have a
// JSON-producing get_command. FX-01: destructive entries carry their guard.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

/** PowerShell output piped to ConvertTo-Json, or an az CLI call left on its default JSON output. */
function producesJson(command: string): boolean {
  if (/\|\s*ConvertTo-Json\b/i.test(command)) return true;
  if (/^\s*az\s/i.test(command)) return !/(\s-o|\s--output)\s+(tsv|table|none|yaml|yamlc|jsonc)\b/i.test(command);
  return false;
}

describe('Registry lint — FX-03 / FX-01', () => {
  const registry = CommandRegistry.load(REGISTRY_PATH);

  it('every verified SET entry has a JSON-producing get_command', () => {
    const offenders = registry.allEntries
      .filter(e => e.set_command.trim() !== '')
      .filter(e => {
        const ev = e.verification?.evidence;
        return !!ev && (ev.jsonpath !== undefined || ev.regex !== undefined || (ev.checks?.length ?? 0) > 0);
      })
      .filter(e => !producesJson(e.get_command))
      .map(e => e.entry_id);
    expect(offenders).toEqual([]);
  });

  it('the lint rule itself rejects PowerShell list text and az table output', () => {
    expect(producesJson('Get-TransportConfig | Select-Object AllowLegacyTLSClients')).toBe(false);
    expect(producesJson('az network vnet list -o table')).toBe(false);
    expect(producesJson('Get-TransportConfig | ConvertTo-Json -Depth 10')).toBe(true);
    expect(producesJson("az rest --method GET --url 'https://x'")).toBe(true);
  });

  it('AC.L2-3.1.5.pim-eligible verifies one schedule (filtered by principal and role), not the whole list', () => {
    // An unfiltered -All list has many schedules on a real tenant; a multi-element array has no
    // single $.PrincipalId, and any existing schedule would wrongly trigger the get-then-set skip.
    const e = registry.allEntries.find(x => x.entry_id === 'AC.L2-3.1.5.pim-eligible')!;
    expect(e.get_command).toContain("-Filter 'principalId eq ''{operatorUserId}'' and roleDefinitionId eq ''{roleDefId}'''");
    expect(e.get_command).not.toContain('-All');
  });

  it('IA.L2-3.5.5.disable-inactive is destructive, guarded, not "safe", and aborts the step on failure', () => {
    const e = registry.allEntries.find(x => x.entry_id === 'IA.L2-3.5.5.disable-inactive')!;
    expect(e.destructive).toBe(true);
    expect(e.idempotency).not.toBe('safe');
    expect(e.on_failure).toBe('abort_step');
    expect(e.destructive_guard?.exclusion_variables).toEqual(['operatorUPN', 'breakGlassUPN']);
    expect(e.destructive_guard?.max_share).toBe(0.5);
    // (d) accounts with no sign-in data are skipped by both the SET and the preview.
    expect(e.set_command).toContain('LastSignInDateTime -ne $null');
    expect(e.destructive_guard?.preview_command).toContain('LastSignInDateTime -ne $null');
  });
});
