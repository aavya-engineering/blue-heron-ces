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
import type { MaterializedScenarioFile, StacksimSeedBlock } from './types.js';

/**
 * Splices the wrapper's `scenario_id` (-> stacksim's required top-level "name")
 * and optional `description` onto the verbatim `stacksim_seed` block. Does NOT
 * reinterpret stance/countOverrides/steps — passed through untouched (PLAN.md
 * Scenario Schema Skeleton, decision 4).
 *
 * Per stacksim-findings.md gotcha 7: unknown top-level fields are silently
 * accepted by stacksim's loader, so this function only ever emits
 * {name, description?, ...stacksim_seed} — no wrapper-only fields
 * (muster/expected_state/etc.) leak into the materialized file.
 */
export function buildMaterializedScenario(
  scenarioId: string,
  seed: StacksimSeedBlock,
  description?: string,
): MaterializedScenarioFile {
  const materialized: MaterializedScenarioFile = {
    name: scenarioId,
    ...seed,
  };
  if (description !== undefined) {
    materialized.description = description;
  }
  return materialized;
}

/**
 * Writes the materialized scenario file to `<scenariosDir>/<scenarioId>.json`.
 * Per stacksim-findings.md gotcha 2, the CLI invocation must use the BARE
 * scenarioId (no ".json") — this function only handles the write side.
 */
export async function writeMaterializedScenario(
  scenariosDir: string,
  scenarioId: string,
  seed: StacksimSeedBlock,
  description?: string,
): Promise<string> {
  await fs.mkdir(scenariosDir, { recursive: true });
  const materialized = buildMaterializedScenario(scenarioId, seed, description);
  const filePath = path.join(scenariosDir, `${scenarioId}.json`);
  await fs.writeFile(filePath, JSON.stringify(materialized, null, 2), 'utf8');
  return filePath;
}
