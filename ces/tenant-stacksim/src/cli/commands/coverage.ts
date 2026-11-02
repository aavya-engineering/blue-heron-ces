// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { buildInventory, writeInventoryReport } from '../../coverage/InventoryExtractor.js';
import { resolveReportDir } from '../../coverage/reportDir.js';
import { runCoverage, writeCoverageReport, formatCoverageSummary, type CoverageReport } from '../../coverage/CoverageRunner.js';

/**
 * `stacksim coverage` - G-STACKSIM-2 iteration 1 baseline coverage run.
 * Re-extracts coverage/inventory.json (so it always reflects the current
 * real ces-stamper/ces-eo/ces-ao source), then runs every inventory item
 * against a freshly seeded m365_azure sim tenant and writes
 * coverage/coverage-report.json. Prints a per-source summary plus a per-item
 * table for every non-PASS item (error text included) - the full per-item
 * PASS list lives in coverage-report.json. `--out <dir>` / STACKSIM_REPORT_DIR
 * sends inventory.json + coverage-report.json there instead.
 */
export async function runCoverageCommand(flags: Record<string, string | boolean> = {}): Promise<CoverageReport> {
  const stacksimRoot = process.cwd();
  const { dir } = resolveReportDir(flags, process.env, path.join(stacksimRoot, 'coverage'));
  const outPath = path.join(dir, 'coverage-report.json');
  console.log(`report: ${outPath}`);

  const inventory = await buildInventory({ stacksimRoot });
  await writeInventoryReport(inventory, path.join(dir, 'inventory.json'));
  console.log(
    `stacksim coverage: inventory refreshed (stamper ${inventory.counts.stamper}, eo ${inventory.counts.eo}, ao ${inventory.counts.ao}, total ${inventory.items.length})`,
  );

  const report = await runCoverage({ stacksimRoot, items: inventory.items });
  await writeCoverageReport(report, outPath);

  console.log(formatCoverageSummary(report));
  console.log(`wrote ${outPath}`);

  const nonPass = report.results.filter((r) => r.status !== 'PASS');
  if (nonPass.length > 0) {
    console.log('');
    console.log(`Non-PASS items (${nonPass.length}):`);
    for (const r of nonPass) {
      console.log(`  [${r.status}] ${r.id} (${r.engine}) - ${r.detail.slice(0, 200)}`);
    }
  }

  return report;
}
