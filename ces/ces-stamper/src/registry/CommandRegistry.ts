// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { CommandRegistrySchema, CommandEntry, CommandRegistryData } from './command-registry.types.js';
import { fileURLToPath } from 'node:url';

/**
 * Loads, validates, and provides lookup access to the CMMC L2 command registry.
 * The registry is the canonical source of deterministic PowerShell/CLI commands
 * for M365 GCC High tenant compliance configuration.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class CommandRegistry {
  private entries: CommandEntry[];
  private byControl: Map<string, CommandEntry[]> = new Map();
  private byEntryId: Map<string, CommandEntry> = new Map();
  private registryData: CommandRegistryData;

  private constructor(data: CommandRegistryData) {
    this.registryData = data;
    this.entries = data.entries;
    this.buildIndexes();
  }

  /**
   * Load the registry from a JSON file. Defaults to the bundled registry.
   * Validates against CommandRegistrySchema — throws on invalid data.
   */
  static load(registryPath?: string): CommandRegistry {
    const filePath = registryPath ?? path.resolve(
      __dirname, 'cmmc-l2-commands.registry.json'
    );

    if (!fs.existsSync(filePath)) {
      throw new Error(`Command registry file not found: ${filePath}`);
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const result = CommandRegistrySchema.safeParse(raw);
    if (!result.success) {
      const errors = result.error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join('\n  ');
      throw new Error(`Command registry validation failed:\n  ${errors}`);
    }

    return new CommandRegistry(result.data);
  }

  /**
   * Load from an already-parsed and validated data object (for testing).
   */
  static fromData(data: CommandRegistryData): CommandRegistry {
    return new CommandRegistry(data);
  }

  /**
   * Merge multiple registries into one, deduplicating by entry_id (first wins).
   * Indexes are rebuilt automatically by the constructor.
   */
  static merge(...registries: CommandRegistry[]): CommandRegistry {
    const allEntries: CommandEntry[] = [];
    const seen = new Set<string>();
    for (const reg of registries) {
      for (const entry of reg.entries) {
        if (seen.has(entry.entry_id)) {
          console.warn(`Duplicate entry_id during merge: ${entry.entry_id}`);
          continue;
        }
        seen.add(entry.entry_id);
        allEntries.push(entry);
      }
    }
    return new CommandRegistry({
      version: registries[0]?.registryData.version ?? '1.0.0',
      generated_on: new Date().toISOString().slice(0, 10),
      description: `Merged from ${registries.length} registries`,
      entries: allEntries,
    });
  }

  /**
   * Look up all registry entries that satisfy a given CMMC control ID.
   * Returns entries sorted by sequence_hint.
   */
  lookupByControl(controlId: string): CommandEntry[] {
    return this.byControl.get(controlId) ?? [];
  }

  /**
   * Look up a single registry entry by its entry_id.
   */
  lookupByEntryId(entryId: string): CommandEntry | undefined {
    return this.byEntryId.get(entryId);
  }

  /**
   * Get all registry entries that match ANY of the given control IDs.
   * Deduplicates by entry_id and sorts by layer_hint then sequence_hint.
   */
  getEntriesForStep(controlIds: string[]): CommandEntry[] {
    const seen = new Set<string>();
    const result: CommandEntry[] = [];

    for (const controlId of controlIds) {
      const entries = this.lookupByControl(controlId);
      for (const entry of entries) {
        if (!seen.has(entry.entry_id)) {
          seen.add(entry.entry_id);
          result.push(entry);
        }
      }
    }

    // Sort by layer_hint first, then sequence_hint within layer
    result.sort((a, b) => {
      if (a.layer_hint !== b.layer_hint) return a.layer_hint - b.layer_hint;
      return a.sequence_hint - b.sequence_hint;
    });

    return result;
  }

  /**
   * Get all entries in the registry.
   */
  get allEntries(): CommandEntry[] {
    return [...this.entries];
  }

  /**
   * Filter entries by enclave type (infrastructure_model).
   * Returns entries matching the specified tier inclusion rules.
   */
  filterByEnclave(enclaveType: 'm365_only' | 'm365_sentinel' | 'm365_azure'): CommandEntry[] {
    const includedTiers: Set<string> = new Set();

    switch (enclaveType) {
      case 'm365_only':
        includedTiers.add('none');
        break;
      case 'm365_sentinel':
        includedTiers.add('none');
        includedTiers.add('foundation');
        includedTiers.add('sentinel');
        break;
      case 'm365_azure':
        includedTiers.add('none');
        includedTiers.add('foundation');
        includedTiers.add('sentinel');
        includedTiers.add('full');
        break;
    }

    return this.allEntries.filter(entry =>
      includedTiers.has(entry.azure_tier ?? 'none')
    );
  }

  /**
   * Get the registry version string.
   */
  get version(): string {
    return this.registryData.version;
  }

  /**
   * Get registry statistics.
   */
  get stats(): {
    total: number;
    byFamily: Record<string, number>;
    byEngine: Record<string, number>;
    byLayer: Record<number, number>;
    manualOnly: number;
    automatable: number;
  } {
    const byFamily: Record<string, number> = {};
    const byEngine: Record<string, number> = {};
    const byLayer: Record<number, number> = {};
    let manualOnly = 0;

    for (const entry of this.entries) {
      // Extract family from first control_id (e.g., "AC" from "AC.L2-3.1.1")
      const family = entry.control_ids[0]?.split('.')[0] ?? 'UNKNOWN';
      byFamily[family] = (byFamily[family] ?? 0) + 1;

      byEngine[entry.engine] = (byEngine[entry.engine] ?? 0) + 1;
      byLayer[entry.layer_hint] = (byLayer[entry.layer_hint] ?? 0) + 1;

      if (entry.manual_only) manualOnly++;
    }

    return {
      total: this.entries.length,
      byFamily,
      byEngine,
      byLayer,
      manualOnly,
      automatable: this.entries.length - manualOnly,
    };
  }

  /**
   * Get all unique control IDs covered by the registry.
   */
  get coveredControlIds(): string[] {
    return Array.from(this.byControl.keys()).sort();
  }

  /**
   * Get all unique CMMC families covered (AC, AT, AU, etc.).
   */
  get coveredFamilies(): string[] {
    const families = new Set<string>();
    for (const controlId of this.byControl.keys()) {
      families.add(controlId.split('.')[0]);
    }
    return Array.from(families).sort();
  }

  private buildIndexes(): void {
    for (const entry of this.entries) {
      // Index by entry_id
      if (this.byEntryId.has(entry.entry_id)) {
        console.warn(`Duplicate entry_id in registry: ${entry.entry_id}`);
      }
      this.byEntryId.set(entry.entry_id, entry);

      // Index by each control_id
      for (const controlId of entry.control_ids) {
        if (!this.byControl.has(controlId)) {
          this.byControl.set(controlId, []);
        }
        this.byControl.get(controlId)!.push(entry);
      }
    }

    // Sort each control's entries by sequence_hint
    for (const entries of this.byControl.values()) {
      entries.sort((a, b) => a.sequence_hint - b.sequence_hint);
    }
  }
}
