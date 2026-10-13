// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { loadScenario, applyScenario, type ApplyScenarioResult } from '../../scenarios/ScenarioEngine.js';
import { parseFlags } from '../index.js';

/** `stacksim scenario <name> [--slug s] [--scenarios-dir d]`
 *
 * Builds the named partially-configured tenant from scenarios/<name>.json:
 * fresh deterministic seed (countOverrides merged over the stance profile)
 * plus mutation steps replayed through the real resolver path (ledger-
 * recorded). Serve it afterwards with
 * `stacksim serve <stance> --slug <slug>` — slug defaults to the scenario
 * name. */
export async function runScenario(argv: string[]): Promise<ApplyScenarioResult> {
  const [name, ...rest] = argv;
  if (!name) {
    throw new Error('stacksim scenario: missing <name> argument (a file in scenarios/<name>.json)');
  }
  const flags = parseFlags(rest);
  const scenariosDir =
    typeof flags['scenarios-dir'] === 'string' ? flags['scenarios-dir'] : path.join(process.cwd(), 'scenarios');
  const scenario = await loadScenario(path.join(scenariosDir, `${name}.json`));
  const slug = typeof flags.slug === 'string' ? flags.slug : scenario.name;
  const tenantRoot = path.join(process.cwd(), '.stacksim', 'tenants', slug);

  const result = await applyScenario(scenario, {
    profilesDir: path.join(process.cwd(), 'profiles'),
    tenantRoot,
  });

  console.log(`stacksim scenario: built "${scenario.name}" (${scenario.description})`);
  console.log(`  tenant:  ${tenantRoot}`);
  console.log(`  seeded:  ${JSON.stringify(result.seedCounts)}`);
  console.log(`  steps:   ${result.stepsApplied} mutation(s) applied via resolver (ledger-recorded)`);
  if (scenario.expectedFacts) {
    console.log(`  expected facts (state-detection ground truth):`);
    for (const [id, answer] of Object.entries(scenario.expectedFacts)) {
      console.log(`    ${id}: ${answer}`);
    }
  }
  console.log(`  serve:   node bin/stacksim.mjs serve ${scenario.stance} --slug ${slug}`);
  return result;
}
