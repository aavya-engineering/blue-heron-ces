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
import type { ScenarioResult } from './result-shape.js';

/**
 * PLAN.md M2 acceptance gate: writes `runs/<run-id>/<scenario_id>/result.json`.
 */
export async function writeScenarioResult(
  runsRoot: string,
  runId: string,
  result: ScenarioResult,
): Promise<string> {
  const dir = path.join(runsRoot, runId, result.scenario_id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'result.json');
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}
