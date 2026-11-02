// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import type { InventoryItem } from './InventoryTypes.js';
import { classifyCommandEngine, isAzCli } from './engineClassifier.js';

interface StamperRegistryEntry {
  entry_id?: string;
  engine?: string;
  set_command?: string;
  get_command?: string;
  evidence_commands?: string[];
  manual_only?: boolean;
}

interface StamperRegistryFile {
  entries?: StamperRegistryEntry[];
}

// G-STACKSIM-2 iteration 4: az CLI (`az`/`az rest`) commands are no longer
// excluded - the coverage harness now shadows PATH with azshim/az.cmd
// (src/coverage/psHarness.ts's buildShadowedEnv + assertAzShimResolves),
// which routes every recognized `az` invocation to the sim's /resolve
// endpoint exactly like a real fake-PowerShell-module wrapper would (see
// src/resolvers/azCliResolvers.ts). `isAzCli()` is still computed below to
// carry an informational `notes` field distinguishing az-CLI commands from
// PowerShell cmdlets.
const AZ_CLI_NOTE = 'Azure CLI (`az`/`az rest`) command - routed through tenant-stacksim\'s az CLI shim (azshim/az.cmd), not the real Azure CLI.';

const MANUAL_GATE_EXCLUSION_REASON =
  'manual_only registry entry with empty set_command and get_command; evidence_commands are literal ' +
  'placeholder object/JSON constructions (e.g. manual-upload instructions), not calls against the tenant. ' +
  'Excluded from execution (per-item justification), not silently dropped.';

/**
 * Parses one of Stamper's two command registries (cmmc-l2-commands /
 * infra-cmmc-l2-commands) into InventoryItems. Both files share the same
 * top-level `{ version, generated_on, description, entries: [...] }` shape
 * (confirmed by direct inspection at extraction time). One entry yields up
 * to two items (its set_command as a 'write' item, its get_command as a
 * 'read' item); entries with both empty (Stamper's 20 manual_gate,
 * evidence-only entries) yield one excluded 'read' item carrying their
 * evidence_commands text, per "never silently drop".
 */
export async function extractStamperInventory(registryPaths: string[]): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];

  for (const registryPath of registryPaths) {
    let raw: string;
    try {
      raw = await fs.readFile(registryPath, 'utf8');
    } catch (err) {
      items.push({
        id: `stamper:${registryPath}:read-error`,
        source: 'stamper',
        sourceRef: registryPath,
        engine: 'other',
        commandText: '',
        classification: 'read',
        excluded: true,
        exclusionReason: `Failed to read registry file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let parsed: StamperRegistryFile;
    try {
      parsed = JSON.parse(raw) as StamperRegistryFile;
    } catch (err) {
      items.push({
        id: `stamper:${registryPath}:parse-error`,
        source: 'stamper',
        sourceRef: registryPath,
        engine: 'other',
        commandText: raw.slice(0, 200),
        classification: 'read',
        excluded: true,
        exclusionReason: `Registry file failed to parse as JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!Array.isArray(parsed.entries)) {
      items.push({
        id: `stamper:${registryPath}:no-entries`,
        source: 'stamper',
        sourceRef: registryPath,
        engine: 'other',
        commandText: '',
        classification: 'read',
        excluded: true,
        exclusionReason: 'Registry file has no top-level "entries" array - structure defeats static extraction.',
      });
      continue;
    }

    for (const entry of parsed.entries) {
      const entryId = entry.entry_id ?? `(missing entry_id in ${registryPath})`;
      const setCmd = typeof entry.set_command === 'string' ? entry.set_command.trim() : '';
      const getCmd = typeof entry.get_command === 'string' ? entry.get_command.trim() : '';

      if (setCmd.length > 0) {
        const azCli = isAzCli(setCmd);
        items.push({
          id: `stamper:${entryId}:set`,
          source: 'stamper',
          sourceRef: `${entryId}:set`,
          engine: azCli ? 'other' : classifyCommandEngine(setCmd, entry.engine),
          commandText: setCmd,
          classification: 'write',
          notes: azCli ? AZ_CLI_NOTE : undefined,
        });
      }

      if (getCmd.length > 0) {
        const azCli = isAzCli(getCmd);
        items.push({
          id: `stamper:${entryId}:get`,
          source: 'stamper',
          sourceRef: `${entryId}:get`,
          engine: azCli ? 'other' : classifyCommandEngine(getCmd, entry.engine),
          commandText: getCmd,
          classification: 'read',
          notes: azCli ? AZ_CLI_NOTE : undefined,
        });
      }

      if (setCmd.length === 0 && getCmd.length === 0) {
        items.push({
          id: `stamper:${entryId}:manual`,
          source: 'stamper',
          sourceRef: `${entryId}:manual`,
          engine: 'other',
          commandText: (entry.evidence_commands ?? []).join(' ; '),
          classification: 'read',
          excluded: true,
          exclusionReason: MANUAL_GATE_EXCLUSION_REASON,
          notes: `manual_only=${String(entry.manual_only ?? false)}, engine="${entry.engine ?? '(none)'}"`,
        });
      }
    }
  }

  return items;
}
