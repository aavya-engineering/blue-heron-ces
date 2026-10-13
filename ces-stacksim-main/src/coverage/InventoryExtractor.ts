// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { InventoryItem, InventoryReport, InventorySource } from './InventoryTypes.js';
import { extractStamperInventory } from './StamperExtractor.js';
import { extractEoInventory } from './EoExtractor.js';
import { extractAoInventory } from './AoExtractor.js';

/**
 * G-STACKSIM-2 iteration 1 inventory extractor (docs/context/LOOP_STATE.md,
 * G-STACKSIM-2 Loop State / DOC-2 deliverable (a)/(b)/(c)). Orchestrates the
 * three per-source extractors and writes coverage/inventory.json. Read-only
 * against ces-stamper/ces-eo/ces-ao; zero edits.
 */
export interface InventoryExtractorArgs {
  /** tenant-stacksim's own repo root (defaults to process.cwd()). */
  stacksimRoot?: string;
  /** The monorepo root containing ces-stamper/ces-eo/ces-ao (defaults to one level above stacksimRoot). */
  monorepoRoot?: string;
}

export interface ResolvedInventoryPaths {
  stamperRegistryPaths: string[];
  eoComplianceSignalFetcherPath: string;
  eoPowerShellFallbackAdapterPath: string;
  aoTemplateRegistryPath: string;
  cesAoRoot: string;
  tsxCliPath: string;
}

export function resolveInventoryPaths(args: InventoryExtractorArgs = {}): ResolvedInventoryPaths {
  const stacksimRoot = args.stacksimRoot ?? process.cwd();
  const monorepoRoot = args.monorepoRoot ?? path.resolve(stacksimRoot, '..');

  return {
    stamperRegistryPaths: [
      path.join(monorepoRoot, 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json'),
      path.join(monorepoRoot, 'ces-stamper', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json'),
    ],
    eoComplianceSignalFetcherPath: path.join(
      monorepoRoot,
      'ces-eo',
      'src',
      'eo',
      'ingestion',
      'ComplianceSignalFetcher.ts',
    ),
    eoPowerShellFallbackAdapterPath: path.join(
      monorepoRoot,
      'ces-eo',
      'src',
      'eo',
      'ingestion',
      'PowerShellFallbackAdapter.ts',
    ),
    aoTemplateRegistryPath: path.join(monorepoRoot, 'ces-ao', 'src', 'registry', 'TemplateRegistry.ts'),
    cesAoRoot: path.join(monorepoRoot, 'ces-ao'),
    tsxCliPath: path.join(monorepoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  };
}

export async function buildInventory(args: InventoryExtractorArgs = {}): Promise<InventoryReport> {
  const paths = resolveInventoryPaths(args);

  const [stamperItems, eoItems, aoItems] = await Promise.all([
    extractStamperInventory(paths.stamperRegistryPaths),
    extractEoInventory({
      complianceSignalFetcherPath: paths.eoComplianceSignalFetcherPath,
      powerShellFallbackAdapterPath: paths.eoPowerShellFallbackAdapterPath,
    }),
    extractAoInventory({
      templateRegistryPath: paths.aoTemplateRegistryPath,
      cesAoRoot: paths.cesAoRoot,
      tsxCliPath: paths.tsxCliPath,
    }),
  ]);

  const items: InventoryItem[] = [...stamperItems, ...eoItems, ...aoItems];
  const counts: Record<InventorySource, number> = {
    stamper: stamperItems.length,
    eo: eoItems.length,
    ao: aoItems.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    counts,
    items,
  };
}

export async function writeInventoryReport(report: InventoryReport, outPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
}

export async function runInventoryExtraction(args: InventoryExtractorArgs = {}): Promise<{
  report: InventoryReport;
  outPath: string;
}> {
  const stacksimRoot = args.stacksimRoot ?? process.cwd();
  const report = await buildInventory(args);
  const outPath = path.join(stacksimRoot, 'coverage', 'inventory.json');
  await writeInventoryReport(report, outPath);
  return { report, outPath };
}
