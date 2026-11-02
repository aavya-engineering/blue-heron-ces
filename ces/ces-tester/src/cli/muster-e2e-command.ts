// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * P4.1 / P4.3 CLI glue.
 *   run-scenario <muster-e2e file> --root <WS> --package-root <pkg>
 *       [--skip-forced-run] [--force-fail-entry <id>] [--skip-ao] [--dry-run]
 *     (run-scenario dispatches here when the file declares "type": "muster-e2e")
 *   coverage:ao [--stacksim-root <dir>] [--out <file>] [--expected-total <n>]
 */
import * as path from 'node:path';
import { loadMusterE2eFile } from '../scenarios/musterE2eFile.js';
import { runMusterE2e } from '../flow/muster-e2e-run.js';
import { runAoCoverage } from '../flow/ao-coverage.js';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

export async function runMusterE2eCli(scenarioPath: string, argv: string[]): Promise<number> {
  const root = flag(argv, '--root');
  const packageRoot = flag(argv, '--package-root');
  if (!root || !packageRoot) {
    console.error('run-scenario (muster-e2e): --root <WS> and --package-root <run package> are required');
    return 2;
  }
  try {
    const scenario = await loadMusterE2eFile(scenarioPath);
    const rec = await runMusterE2e({
      scenario,
      scenarioPath,
      wsRoot: path.resolve(root),
      packageRoot: path.resolve(packageRoot),
      skipForcedRun: argv.includes('--skip-forced-run'),
      forceFailEntry: flag(argv, '--force-fail-entry'),
      skipAo: argv.includes('--skip-ao'),
      dryRun: argv.includes('--dry-run'),
    });
    if (rec.status === 'DRY-RUN') return 0;
    console.log(`${rec.status}: ${rec.scenario_id}`);
    return rec.status === 'PASS' ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester run-scenario (muster-e2e): crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}

export async function runCoverageAoCommand(argv: string[]): Promise<number> {
  const stacksimRoot = path.resolve(flag(argv, '--stacksim-root') ?? path.join(process.cwd(), '..', 'tenant-stacksim'));
  const outFile = path.resolve(flag(argv, '--out') ?? path.join(process.cwd(), 'runs', `coverage-ao-${Date.now()}.json`));
  const expectedTotal = Number(flag(argv, '--expected-total') ?? 95);
  try {
    const rec = await runAoCoverage({
      stacksimRoot,
      outFile,
      logBase: outFile.replace(/\.json$/i, ''),
      expectedTotal,
    });
    console.log(rec.summary_line ?? '(no summary line from stacksim coverage-ao)');
    console.log(`coverage:ao ${rec.pass ? 'PASS' : 'FAIL'}${rec.reasons.length ? ` (${rec.reasons.join('; ')})` : ''}; record ${outFile}`);
    return rec.pass ? 0 : 1;
  } catch (err) {
    console.error(`ces-tester coverage:ao: crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return 2;
  }
}
