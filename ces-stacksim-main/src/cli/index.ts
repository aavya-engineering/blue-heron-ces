// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { runInitTenant } from './commands/init-tenant.js';
import { runSeed } from './commands/seed.js';
import { runServe } from './commands/serve.js';
import { runQueryLedger } from './commands/query-ledger.js';
import { runQueryEvidence } from './commands/query-evidence.js';
import { runVerifyDoc } from './commands/verify-doc.js';
import { runInventory } from './commands/inventory.js';
import { runCoverageCommand } from './commands/coverage.js';
import { runAoSemanticCommand } from '../coverage/AoSemanticRunner.js';
import { runScenario } from './commands/scenario.js';
import { runUp } from './commands/up.js';

/** Minimal `--flag value` / `--flag` (boolean) argv parser. No new dependency. */
export function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'init-tenant': {
      const result = await runInitTenant(rest);
      const written = [result.flatPath, result.planDataPath].filter(Boolean);
      console.log(
        written.length > 0
          ? `stacksim init-tenant: wrote ${written.join(' and ')}`
          : 'stacksim init-tenant: no files written — pass --plan-data-root <dir>, --emit-plan-data, or --tenantprobe-flat (backlog-S3: the flat ~/.stamper path is opt-in now)',
      );
      break;
    }
    case 'seed': {
      const result = await runSeed(rest);
      console.log(`stacksim seed: ${JSON.stringify(result.counts)}`);
      break;
    }
    case 'serve': {
      const result = await runServe(rest);
      console.log(`stacksim serve: listening on http://127.0.0.1:${result.port}`);
      break;
    }
    case 'query-ledger': {
      const result = await runQueryLedger(rest);
      console.log(JSON.stringify(result));
      break;
    }
    case 'query-evidence': {
      const result = await runQueryEvidence(rest);
      console.log(JSON.stringify(result));
      break;
    }
    case 'verify-doc': {
      await runVerifyDoc(rest);
      break;
    }
    case 'inventory': {
      await runInventory();
      break;
    }
    case 'coverage': {
      await runCoverageCommand();
      break;
    }
    case 'coverage-ao': {
      // SIMFIX FIX-S2 / GOAL M6: semantic self-certification of AO's 95 commands.
      const report = await runAoSemanticCommand();
      if (report.totals.fail > 0) process.exitCode = 1;
      break;
    }
    case 'scenario': {
      await runScenario(rest);
      break;
    }
    case 'up': {
      await runUp(rest);
      break;
    }
    default:
      throw new Error(`stacksim: unknown command "${String(command)}"`);
  }
}
