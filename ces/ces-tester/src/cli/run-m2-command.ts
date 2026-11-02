// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { runScenarioCommand } from './run-scenario-command.js';

/**
 * M3: run-m2 is now a THIN WRAPPER over the generalized scenario runner with
 * the ported scenarios/clean-tenant-mfa-baseline.json — one lifecycle, no
 * parallel path. The heartbeat command (`npm run tester`) therefore inherits
 * the M3 assertion redesign: expected_state asserts the MFA outcome the
 * pipeline actually produces (authenticationMethodConfigurations enabled),
 * retiring the caPolicy-1 grantControls expectation (loop-board tick-7
 * finding). The M2 lifecycle itself (wipe+seed -> registry -> serve ->
 * ready-check -> dev-server -> drive -> assert -> execute -> verify ->
 * result.json -> teardown) lives on, parameterized, in run-scenario-command.ts.
 */
export interface RunM2Options {
  stacksimRoot: string;
  plannerRoot: string;
  stamperRoot: string;
  runsRoot: string;
  runId: string;
  runWorkspaceDir: string;
  headless?: boolean;
  plannerPort?: number;
  registryRoot?: string;
}

export interface RunM2Result {
  resultPath: string;
  status: 'pass' | 'fail';
}

export const SCENARIO_ID = 'clean-tenant-mfa-baseline';

export async function runM2Command(opts: RunM2Options): Promise<RunM2Result> {
  const scenarioPath = path.resolve(process.cwd(), 'scenarios', 'clean-tenant-mfa-baseline.json');
  const result = await runScenarioCommand({ ...opts, scenarioPath });
  return { resultPath: result.resultPath, status: result.status };
}