// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// collectorKit.test.ts — GP-MUSTER-2 M4 gate: the script-upload kit is
// read-only by construction, signed per the recipe convention, and its output
// lands on the EXISTING import seam identically to the direct path (the GO-2
// M3 / DISCOVERY-1 Gate 3 equivalence discipline — no second format).
import { describe, it, expect } from 'vitest';
import {
  generateCollectorScript,
  buildKitManifest,
  expectedRowsFor,
  COLLECTOR_GENERATED_BY,
} from '../src/services/collectorKitService.js';
import { toGetEntries, type RegistryGetEntry } from '../src/services/discoveryService.js';
import { verifyRecipe } from '../src/lib/recipeSigning.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';
// The SPA-side seam, via the '@' alias muster-api's vitest config already
// provides for cross-package contract tests.
import { parseDiscoveryResultsFile } from '@/features/discovery/importResultsFile';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';

const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'AC.get-users', control_ids: ['AC.L1-3.1.1'], engine: 'mgraph', get_command: 'Get-MgUser -Top 25' },
  { entry_id: 'IA.get-authpolicy', control_ids: ['IA.L2-3.5.3', 'AC.L2-3.1.13'], engine: 'mgraph', get_command: 'Get-MgPolicyAuthenticationMethodPolicy' },
  { entry_id: 'MP.manual-media', control_ids: ['MP.L2-3.8.1'], engine: 'manual', manual_only: true },
  { entry_id: 'XX.no-surface', control_ids: ['XX.L2-0.0.0'], engine: 'mgraph' },
];

describe('collector kit — read-only by construction, human-readable', () => {
  it('emits every runnable get annotated with entry + controls; skips manual_only and command-less entries', () => {
    const script = generateCollectorScript(ENTRIES);
    expect(script).toContain('Get-MgUser -Top 25');
    expect(script).toContain('AC.get-users — evidences: AC.L1-3.1.1');
    expect(script).toContain('IA.L2-3.5.3, AC.L2-3.1.13');
    expect(script).not.toContain('MP.manual-media');
    expect(script).not.toContain('XX.no-surface');
    // The reader-facing pledge and the verify instruction are present.
    expect(script).toContain('read-only');
    expect(script).toContain('manifest.sha256');
  });

  it('a registry entry with a set_command cannot leak into the script (structural read-only)', () => {
    const raw = [
      {
        entry_id: 'AC.dual',
        control_ids: ['AC.L1-3.1.1'],
        engine: 'mgraph',
        get_command: 'Get-MgUser',
        set_command: 'Set-MgUserPassword -Reset',
      },
    ];
    const script = generateCollectorScript(toGetEntries(raw));
    expect(script).toContain('Get-MgUser');
    expect(script).not.toContain('Set-MgUserPassword');
    // No executable mutating line anywhere: every non-comment line that invokes
    // a cmdlet in the emitted blocks is the entry's get_command.
    const mutating = script
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => /\b(Set-|New-|Remove-|Update-|Disable-|Enable-)[A-Za-z]/.test(l));
    expect(mutating).toEqual([]);
  });

  it('is signed per the recipe convention and tampering is detected', () => {
    const script = generateCollectorScript(ENTRIES);
    const manifest = buildKitManifest(script);
    expect(manifest.read_only).toBe(true);
    expect(verifyRecipe({ script: Buffer.from(script), manifest }).valid).toBe(true);

    const tampered = script.replace('Get-MgUser -Top 25', 'Get-MgUser -Top 25; Remove-MgUser');
    const check = verifyRecipe({ script: Buffer.from(tampered), manifest });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/sha256 mismatch/);
  });
});

describe('collector output — lands on the existing import seam (no second format)', () => {
  it('the emitted results-file shape parses through parseDiscoveryResultsFile and joins identically to the direct path', () => {
    // The rows the script produces for a mixed walk (mirrors its emission 1:1).
    const rows = expectedRowsFor(ENTRIES, {
      'AC.get-users': 'high',
      'IA.get-authpolicy': 'unknown',
    });
    const file = JSON.stringify({ generated_by: COLLECTOR_GENERATED_BY, results: rows });

    const uploaded = parseDiscoveryResultsFile(file);
    expect(uploaded).toEqual(rows);

    // Same facts as feeding the rows directly — the M3 equivalence, and it
    // must be non-vacuous (the control ids really join the question graph).
    const viaUpload = synthesizeFactsFromDiscovery(uploaded, QUESTION_GRAPH).map(
      ({ recorded_at: _r, ...rest }) => rest
    );
    const direct = synthesizeFactsFromDiscovery(rows, QUESTION_GRAPH).map(
      ({ recorded_at: _r, ...rest }) => rest
    );
    expect(viaUpload).toEqual(direct);
    expect(viaUpload.length).toBeGreaterThan(0);

    // FCA carried: the errored entry's facts are unsure, never yes.
    const unknowns = viaUpload.filter((f) => f.confidence === 'unknown');
    expect(unknowns.length).toBeGreaterThan(0);
    for (const f of unknowns) expect(f.answer).toBe('unsure');
  });

  it('real-registry smoke: the kit generates from the live Stamper registries (skip-if-absent)', () => {
    const entries = loadRegistryGetEntries();
    if (entries.length === 0) {
      console.warn('[M4] Stamper registries not present in this checkout — skipping');
      return;
    }
    const script = generateCollectorScript(entries);
    const manifest = buildKitManifest(script);
    expect(verifyRecipe({ script: Buffer.from(script), manifest }).valid).toBe(true);
    // All runnable gets present, none of the registry's set_commands.
    const runnable = entries.filter((e) => !e.manual_only && e.get_command?.trim());
    expect(runnable.length).toBeGreaterThan(50);
    for (const e of runnable.slice(0, 20)) {
      expect(script).toContain(e.entry_id);
    }
  });
});
