// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// collectorKitService.ts — GP-MUSTER-2 M4: the script-upload kit (the
// residual-elicitation ladder's rung 2, ruled self-serve-allowed 2026-07-25).
//
// Generates the SIGNED, HUMAN-READABLE, READ-ONLY collector a customer admin
// runs under their OWN session — CES never holds credentials. The script's
// output is the results-file flavor GO-2 M3 defined ({ generated_by,
// results: DiscoveryResult[] }) and lands on the EXISTING import seam
// (parseDiscoveryResultsFile) — no second format, per the standing rule.
//
// Read-only is structural, same discipline as the discovery executor: the
// generator consumes RegistryGetEntry (a shape with no set_command field), so
// a mutating command cannot even reach the emitter. Human-readable means every
// command block is annotated with its registry entry id and the controls it
// evidences — the admin can (and should) read exactly what will run.
//
// Signing follows the recipe convention (recipeSigning.ts): the kit manifest
// embeds sha256 of the script; verifyRecipe() checks it. An admin can verify
// the script they received is the script BHD signed.
import { sha256Hex, type RecipeManifest } from '../lib/recipeSigning.js';
import type { RegistryGetEntry } from './discoveryService.js';

export const COLLECTOR_KIT_NAME = 'muster-collector-kit';
export const COLLECTOR_KIT_VERSION = '1.0.0';
export const COLLECTOR_GENERATED_BY = `${COLLECTOR_KIT_NAME}/${COLLECTOR_KIT_VERSION}`;

/** The confidence rule the script implements — identical semantics to the
 * discovery executor's: evidence => high, empty read => low, error => unknown.
 * (No 'not_met' inference: absence of evidence is unknown, never a finding.) */
const CONFIDENCE_RULE_COMMENT = `# Confidence per command: output => 'high', empty => 'low', error => 'unknown'.
# 'unknown' NEVER counts for you or against you as evidence — it becomes an
# interview question. This mirrors Muster's own discovery engine exactly.`;

function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Generate the collector script from registry get-entries. manual_only and
 * command-less entries are skipped at generation (they have nothing runnable);
 * the interview covers them — same rule as the executor's walk, which records
 * them as unknown.
 */
export function generateCollectorScript(entries: RegistryGetEntry[]): string {
  const runnable = entries.filter(
    (e) => !e.manual_only && !!e.get_command && e.get_command.trim() !== ''
  );

  const blocks = runnable.map((entry) => {
    const controls = entry.control_ids.length > 0 ? entry.control_ids : [entry.entry_id];
    const controlsPs = controls.map(psSingleQuote).join(', ');
    return `# ── ${entry.entry_id} — evidences: ${controls.join(', ')} (engine: ${entry.engine})
# Runs (read-only):
#   ${entry.get_command}
$conf = 'unknown'
try {
  $out = ${entry.get_command} | Out-String
  if ([string]::IsNullOrWhiteSpace($out)) { $conf = 'low' } else { $conf = 'high' }
} catch {
  $conf = 'unknown'
}
foreach ($cid in @(${controlsPs})) {
  $results.Add(@{ control_id = $cid; objective_ids = @(); confidence = $conf }) | Out-Null
}
`;
  });

  return `# ${COLLECTOR_GENERATED_BY} — Muster read-only evidence collector
# =====================================================================
# WHAT THIS IS
#   You (the customer admin) run this in YOUR OWN PowerShell session, signed
#   in with YOUR OWN account. It only READS configuration (every command below
#   is a Get-*), writes NOTHING to your tenant, and produces ONE local file:
#   muster-results.json — which you upload back into Muster yourself.
#   No credentials, tokens, or tenant data leave your machine via this script.
#
# BEFORE RUNNING
#   1. Read the commands below — every one is listed with the compliance
#      control it evidences. If you are not comfortable with a command,
#      delete its block; the assessment will simply ask you instead.
#   2. Verify this script against the manifest BHD sent you (sha256 must
#      match manifest.sha256).
#   3. Connect first (read-only consent, your account):  Connect-MgGraph
#
# HOW TO RUN
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\\muster-collector.ps1
#
${CONFIDENCE_RULE_COMMENT}
# =====================================================================

$ErrorActionPreference = 'Continue'
$results = [System.Collections.ArrayList]@()

${blocks.join('\n')}
# ── Emit the results file (the ONLY write this script performs, to YOUR disk) ──
@{ generated_by = ${psSingleQuote(COLLECTOR_GENERATED_BY)}; results = $results } |
  ConvertTo-Json -Depth 5 |
  Out-File -Encoding utf8 -FilePath .\\muster-results.json
Write-Host "Done. Wrote $($results.Count) result rows to muster-results.json — upload this file in Muster."
`;
}

/** Sign a generated script: the kit manifest embeds sha256(script), the recipe
 * convention verifyRecipe() already checks. */
export function buildKitManifest(script: string): RecipeManifest {
  return {
    name: COLLECTOR_KIT_NAME,
    version: COLLECTOR_KIT_VERSION,
    description:
      'Read-only evidence collector for the Muster script-upload flow (independent mode). ' +
      'Output (muster-results.json) is uploaded into Muster by the customer.',
    output_maps_to: [],
    read_only: true,
    sha256: sha256Hex(script),
  };
}

/** The rows the script will produce for a given walk outcome — used by tests
 * to prove seam equivalence without executing PowerShell. Mirrors the script's
 * emission logic 1:1 (same fan-out per control, same [] objective_ids). */
export function expectedRowsFor(
  entries: RegistryGetEntry[],
  confidenceByEntry: Record<string, 'high' | 'low' | 'unknown'>
): Array<{ control_id: string; objective_ids: string[]; confidence: 'high' | 'low' | 'unknown' }> {
  const rows: Array<{
    control_id: string;
    objective_ids: string[];
    confidence: 'high' | 'low' | 'unknown';
  }> = [];
  for (const entry of entries) {
    if (entry.manual_only || !entry.get_command || entry.get_command.trim() === '') continue;
    const controls = entry.control_ids.length > 0 ? entry.control_ids : [entry.entry_id];
    for (const control_id of controls) {
      rows.push({
        control_id,
        objective_ids: [],
        confidence: confidenceByEntry[entry.entry_id] ?? 'unknown',
      });
    }
  }
  return rows;
}
