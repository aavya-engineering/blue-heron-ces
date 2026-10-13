// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * PLAN.md M5 task 1 / GP-TESTER-1 M3 (docs/M5-COVERAGE-PLAN.md): coverage
 * mapping of tenant-stacksim's call inventory against what retained runs
 * ACTUALLY exercised, per the runs' own ledger snapshots. Read-only over the
 * sibling's inventory file (interface charter — a data file the sim publishes,
 * not internals).
 *
 * Matching rule (grounded in real artifacts): a ledger entry's `source` is
 * either a cmdlet name (`Set-AtpPolicyForO365`) or a Graph URI path
 * (`/v1.0/identity/conditionalAccess/policies`); an inventory item's
 * `commandText` begins with its cmdlet token, or contains a Graph URI. An item
 * counts as EXERCISED when any ledger entry source matches its command token
 * (write items need a `mutate`/`create` entry; read items any entry).
 */

export interface InventoryItem {
  id: string;
  source: string; // stamper | eo | ao
  sourceRef: string;
  engine?: string;
  commandText?: string;
  classification: string; // read | write | (future: manual_only)
}

export interface InventoryFile {
  generatedAt?: string;
  counts?: Record<string, number>;
  items: InventoryItem[];
}

interface LedgerEntry {
  type: string; // mutate | read-serve | create
  source?: string;
}

/** The T1 PROTECT tier — the 36 controls with PVA >= 11 per
 * ces-strategy/rfi/analysis/control-value-add.md (strategy source of truth;
 * duplicated here as data because that repo is read-only and this list is
 * frozen with the 2026-07 analysis). */
export const T1_PROTECT_CONTROLS = [
  '3.1.1', '3.1.2', '3.1.5', '3.1.12', '3.1.13', '3.1.17', '3.1.18', '3.2.1',
  '3.3.1', '3.3.5', '3.4.1', '3.4.2', '3.4.5', '3.4.6', '3.4.7', '3.4.8',
  '3.5.1', '3.5.2', '3.5.3', '3.5.10', '3.6.1', '3.6.2', '3.7.5', '3.8.3',
  '3.8.7', '3.9.2', '3.11.2', '3.12.3', '3.13.1', '3.13.5', '3.13.6',
  '3.13.11', '3.14.1', '3.14.2', '3.14.4', '3.14.6',
] as const;

/** Extracts the short control id (3.x.y) from an inventory item id like
 * `stamper:AC.L2-3.1.1.operator-discover:get`. */
export function controlIdOf(item: Pick<InventoryItem, 'id'>): string | undefined {
  const m = /(?:L[12]-)?(3\.\d+\.\d+)/.exec(item.id);
  return m?.[1];
}

/** First command token of an inventory item's commandText (cmdlet name), or a
 * Graph URI path if the text carries one instead. */
export function commandKeyOf(item: Pick<InventoryItem, 'commandText'>): string | undefined {
  const text = item.commandText?.trim();
  if (!text) return undefined;
  const uri = /(\/v1\.0\/[^\s"']+|\/beta\/[^\s"']+)/.exec(text);
  if (uri) return uri[1];
  return text.split(/\s+/)[0];
}

export interface CoverageReport {
  generated_at: string;
  inventory_generated_at?: string;
  runs_scanned: number;
  ledger_entries_scanned: number;
  totals: {
    items: number;
    exercised: number;
    by_source: Record<string, { total: number; exercised: number }>;
    by_classification: Record<string, { total: number; exercised: number }>;
  };
  t1_protect: {
    controls_total: number;
    /** T1 controls with at least one exercised inventory item. */
    controls_exercised: string[];
    controls_unexercised: string[];
  };
  /** classification 'manual_only' items (PLAN.md M5 task 3) — explicitly
   * listed as known-untested, never silently dropped. Empty if the inventory
   * version carries none. */
  manual_only_known_untested: string[];
  exercised_item_ids: string[];
}

export function computeCoverage(
  inventory: InventoryFile,
  ledgerEntries: LedgerEntry[],
  opts: { runsScanned: number; now?: Date } = { runsScanned: 0 },
): CoverageReport {
  const mutatedSources = new Set<string>();
  const anySources = new Set<string>();
  for (const e of ledgerEntries) {
    if (!e.source) continue;
    anySources.add(e.source);
    if (e.type === 'mutate' || e.type === 'create') mutatedSources.add(e.source);
  }

  const exercised = new Set<string>();
  for (const item of inventory.items) {
    const key = commandKeyOf(item);
    if (!key) continue;
    const pool = item.classification === 'write' ? mutatedSources : anySources;
    if (pool.has(key)) exercised.add(item.id);
  }

  const bySource: Record<string, { total: number; exercised: number }> = {};
  const byClass: Record<string, { total: number; exercised: number }> = {};
  for (const item of inventory.items) {
    (bySource[item.source] ??= { total: 0, exercised: 0 }).total++;
    (byClass[item.classification] ??= { total: 0, exercised: 0 }).total++;
    if (exercised.has(item.id)) {
      bySource[item.source].exercised++;
      byClass[item.classification].exercised++;
    }
  }

  const t1Exercised = new Set<string>();
  for (const item of inventory.items) {
    if (!exercised.has(item.id)) continue;
    const cid = controlIdOf(item);
    if (cid && (T1_PROTECT_CONTROLS as readonly string[]).includes(cid)) t1Exercised.add(cid);
  }

  return {
    generated_at: (opts.now ?? new Date()).toISOString(),
    ...(inventory.generatedAt ? { inventory_generated_at: inventory.generatedAt } : {}),
    runs_scanned: opts.runsScanned,
    ledger_entries_scanned: ledgerEntries.length,
    totals: {
      items: inventory.items.length,
      exercised: exercised.size,
      by_source: bySource,
      by_classification: byClass,
    },
    t1_protect: {
      controls_total: T1_PROTECT_CONTROLS.length,
      controls_exercised: [...t1Exercised].sort(),
      controls_unexercised: (T1_PROTECT_CONTROLS as readonly string[]).filter((c) => !t1Exercised.has(c)),
    },
    manual_only_known_untested: inventory.items
      .filter((i) => i.classification === 'manual_only')
      .map((i) => i.id),
    exercised_item_ids: [...exercised].sort(),
  };
}

/** Loads every runs/<id>/<scenario>/ledger-snapshot.json under runsRoot. */
export async function collectLedgerEntries(runsRoot: string): Promise<{ entries: LedgerEntry[]; runs: number }> {
  const entries: LedgerEntry[] = [];
  let runsWithLedgers = 0;
  let runDirs: string[] = [];
  try {
    runDirs = await fs.readdir(runsRoot);
  } catch {
    return { entries, runs: 0 };
  }
  for (const run of runDirs) {
    let found = false;
    let scenarioDirs: string[] = [];
    try {
      scenarioDirs = await fs.readdir(path.join(runsRoot, run));
    } catch {
      continue;
    }
    for (const scen of scenarioDirs) {
      try {
        const parsed = JSON.parse(
          await fs.readFile(path.join(runsRoot, run, scen, 'ledger-snapshot.json'), 'utf8'),
        ) as LedgerEntry[];
        if (Array.isArray(parsed)) {
          entries.push(...parsed);
          found = true;
        }
      } catch {
        // not a scenario dir / no snapshot — skip
      }
    }
    if (found) runsWithLedgers++;
  }
  return { entries, runs: runsWithLedgers };
}

export async function writeCoverageReport(
  runsRoot: string,
  inventoryPath: string,
  outPath: string,
): Promise<CoverageReport> {
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8')) as InventoryFile;
  const { entries, runs } = await collectLedgerEntries(runsRoot);
  const report = computeCoverage(inventory, entries, { runsScanned: runs });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}
