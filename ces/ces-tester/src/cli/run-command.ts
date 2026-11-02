// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runScenario, tenantRootFor } from '../stacksim-client/cli.js';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { waitUntilReady } from '../stacksim-client/ready-check.js';
import { resolve as resolveHttp } from '../stacksim-client/http.js';
import { queryLedger } from '../stacksim-client/http.js';
import { DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import { launchStamperTranslateAndExecute } from '../stamper-launcher/launch.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { extractCollection, assertCaPolicyEnabled, type AssertionResult } from './assertion.js';
import {
  HARDCODED_SCENARIO_ID,
  HARDCODED_CA_POLICY_ID,
  HARDCODED_SEED_PASS,
  HARDCODED_SEED_FAIL,
} from './hardcoded-scenario.js';
import {
  createTenantRegistry,
  createEphemeralSimTenant,
  teardownEphemeralSimTenant,
  getSimLaunchEnv,
} from '../tenant-registry/index.js';
import type { StacksimSeedBlock } from '../stacksim-client/types.js';

/**
 * PLAN.md M1 task 5/6: the `run` command chains
 *   materialize+scenario -> serve start -> ready-check -> Stamper
 *   translate+execute -> /resolve+/ledger query -> one hardcoded assertion
 *   -> serve stop
 * and prints one PASS/FAIL console line for the assertion. FAIL (not crash)
 * when the assertion is false.
 *
 * G-TESTER-1 Gate Ledger "Operational consequence": scenario CLI must run
 * BEFORE serve starts (S1's exclusive tenant lock forbids both at once).
 */

export interface RunCommandOptions {
  stacksimRoot: string;
  /** Optional Stamper leg — omit to run the stacksim-only half (see PLAN.md M1
   * Acceptance Gate fallback: "If the Stamper leg cannot complete end-to-end
   * ... implement everything, get the stacksim half of the gate green"). */
  stamper?: {
    stamperRoot: string;
    missionPlanPath: string;
    manifestPath: string;
    outputPath: string;
  };
  /** Use the FAIL seed variant instead of the PASS one (for the acceptance gate's FAIL run). */
  useFailSeed?: boolean;
  scenariosDir?: string;
}

export interface RunCommandResult {
  assertion: AssertionResult;
  stamperBlocked?: string;
}

async function makeScratchScenariosDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ces-tester-scenarios-'));
}

export async function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const scenariosDir = opts.scenariosDir ?? (await makeScratchScenariosDir());
  const seed: StacksimSeedBlock = opts.useFailSeed ? HARDCODED_SEED_FAIL : HARDCODED_SEED_PASS;
  const scenarioId = HARDCODED_SCENARIO_ID;

  // 1. materialize + scenario (no serve running yet — S1 lock would reject this otherwise)
  await runScenario(
    { stacksimRoot: opts.stacksimRoot },
    scenariosDir,
    scenarioId,
    seed,
    'ces-tester M1 hardcoded scenario: CA policy MFA state probe',
  );

  // 1b. G-TENANT-ADOPT (2026-07-11): register the ephemeral kind:'sim'
  // tenant through ces-tenant's registry — see src/tenant-registry/index.ts.
  const registry = createTenantRegistry({ stacksimRoot: opts.stacksimRoot });
  await createEphemeralSimTenant(registry, scenarioId, seed);

  // 2. serve start
  let serveHandle: ServeHandle | undefined;
  let stamperBlocked: string | undefined;
  try {
    serveHandle = await startServe({
      stacksimRoot: opts.stacksimRoot,
      stance: seed.stance,
      slug: scenarioId,
    });

    const serverUrl = DEFAULT_STACKSIM_SERVER_URL;

    // 3. ready-check: poll a cheap /resolve query for the seeded caPolicies
    // collection. BLOCKED-PENDING-CES-TENANT: should be
    // TenantReachProbe.probeSimReady() per G-TENANT-ADOPT Acceptance Gate
    // item 3, but ces-tenant 0.2.0 ships no implementation of that
    // interface (see run-m2-command.ts's header comment for the full
    // evidence) — kept as the original hand-rolled poll loop.
    await waitUntilReady({
      serverUrl,
      method: 'GET',
      uri: '/v1.0/identity/conditionalAccess/policies',
    });

    // 4. Stamper translate+execute (optional leg — see RunCommandOptions doc comment)
    if (opts.stamper) {
      const simLaunchEnv = await getSimLaunchEnv(registry, scenarioId, {
        stacksimRoot: opts.stacksimRoot,
      });
      const stamperChildEnv = mergeSimLaunchEnv({ simLaunchEnv });
      await launchStamperTranslateAndExecute({
        stamperRoot: opts.stamper.stamperRoot,
        env: stamperChildEnv,
        missionPlanPath: opts.stamper.missionPlanPath,
        manifestPath: opts.stamper.manifestPath,
        tenantSlug: scenarioId,
        outputPath: opts.stamper.outputPath,
      });
    } else {
      stamperBlocked =
        'Stamper leg skipped: no Mission Plan/Tenant Manifest inputs supplied ' +
        '(Muster export is M2 scope; see docs/context/IMPLEMENTATION_LOG.md for the blocked-precondition evidence).';
    }

    // 5. query /resolve + /ledger for the hardcoded assertion
    const data = await resolveHttp(serverUrl, {
      kind: 'uri',
      method: 'GET',
      uri: '/v1.0/identity/conditionalAccess/policies',
    });
    const policies = extractCollection(data);
    const assertion = assertCaPolicyEnabled(policies, HARDCODED_CA_POLICY_ID);

    // /ledger query, per PLAN.md M1 task 5 ("queries /resolve+/ledger for one hardcoded assertion")
    await queryLedger(serverUrl, { objectType: 'caPolicies', id: HARDCODED_CA_POLICY_ID });

    return { assertion, stamperBlocked };
  } finally {
    // 6. serve stop
    if (serveHandle) {
      await serveHandle.stop();
    }
    // G-TENANT-ADOPT: teardown through the registry (idempotent — a no-op if
    // already gone), replacing the removed cleanupSimTenantFlatConfig().
    await teardownEphemeralSimTenant(registry, scenarioId);
  }
}

export function printAssertionResult(result: AssertionResult): void {
  const line = result.pass ? `PASS: ${result.name}` : `FAIL: ${result.name} (${result.detail})`;
  console.log(line);
}
