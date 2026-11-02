// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { startServe } from '../../src/cli/commands/serve.js';
import { runProcess } from '../../src/coverage/psHarness.js';

/**
 * G-STACKSIM-3: Muster state-detection integration test.
 *
 * For each shipped muster-* scenario: build the partially-configured tenant
 * (ScenarioEngine), serve it, then run ces-muster's REAL, UNMODIFIED harvest
 * route (`createHarvestRouter` from muster-api/src/routes/harvest.ts, mounted
 * on a real Express app exactly as muster-api/src/app.ts mounts it) in a tsx
 * child process, and assert the harvested facts match the scenario's
 * expectedFacts manifest.
 *
 * FC-SIM-3 (2026-09-28) rework: FC-MU-3 retired consentService.ts and the
 * client-secret consent-url/callback routes (Muster commit e8b0547 — the only
 * live path is now device-code consent). The sim path never went through
 * consent at all: `POST /api/harvest/run { sim: true }` always built its
 * Graph client against the hardcoded `SIM_GRAPH_BASE` constant
 * (`http://127.0.0.1:4390/v1.0` — see harvest.ts; not overridable by request
 * or env, by design, per muster-api/tests/harvest.sim.test.ts). This test no
 * longer exercises the removed device-code-for-sim workaround; instead it
 * mirrors muster-api's own `harvest.sim.test.ts` pattern: stub `fetch` so
 * calls to `SIM_GRAPH_BASE` are redirected to THIS scenario's ephemeral sim
 * instance, and inject `simProbe = async () => true` (the same test seam
 * `createHarvestRouter`'s second parameter offers muster-api's own suite) so
 * the route never pings the real shared sim on :4390. Every other line of
 * the harvest route, `runHarvest`, `realGraphClient`, and the JWT auth
 * middleware run unmodified. Was: docs/requirements/REQ-ces-muster-consentservice-missing.md
 * (closed by this rework — see that file).
 *
 * Skips (rather than fails) when the sibling ces-muster checkout or the
 * monorepo tsx binary is absent — same cross-repo posture as the coverage
 * harness's EO runner.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCENARIOS_DIR = path.join(SIM_ROOT, 'scenarios');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
// Muster moved DevProjects/scre-muster -> ces/ces-muster on 2026-07-10; try
// the current home first, then the legacy location.
const MUSTER_ROOT = [
  path.resolve(SIM_ROOT, '..', 'ces-muster'),
  path.resolve(SIM_ROOT, '..', '..', 'scre-muster'),
].find((p) => existsSync(path.join(p, 'muster-api', 'src'))) ?? path.resolve(SIM_ROOT, '..', 'ces-muster');
const MUSTER_API_SRC = path.join(MUSTER_ROOT, 'muster-api', 'src');
const HARVEST_ROUTE = path.join(MUSTER_API_SRC, 'routes', 'harvest.ts');
const HARVEST_SERVICE = path.join(MUSTER_API_SRC, 'services', 'harvestService.ts');
const GRAPH_CLIENT = path.join(MUSTER_API_SRC, 'lib', 'graphClient.ts');
const JWT_LIB = path.join(MUSTER_API_SRC, 'lib', 'jwt.ts');
const TSX_CLI = path.resolve(SIM_ROOT, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

const musterAvailable =
  existsSync(HARVEST_ROUTE) && existsSync(HARVEST_SERVICE) && existsSync(GRAPH_CLIENT) && existsSync(JWT_LIB) && existsSync(TSX_CLI);

interface HarvestFact {
  question_id: string;
  answer: string;
  provenance: string;
  confidence: string;
  source: string;
}

/**
 * The runner: mounts Muster's real, unmodified `createHarvestRouter()` on a
 * real Express app (express resolved via `createRequire` rooted at
 * HARVEST_ROUTE, since node_modules lives under muster-api, not this temp
 * dir), mints a bhd_operator JWT with Muster's real `mintToken`, then POSTs
 * `{ sim: true }` to it — the exact production sim-harvest contract
 * (muster-api/src/app.ts: `app.use('/api/harvest', createHarvestRouter(...))`).
 *
 * `simProbe` is injected as `async () => true` (the same seam muster-api's
 * own harvest.sim.test.ts uses) so the route never pings the real shared sim
 * on :4390. `fetch` is stubbed so the ONE thing the sim path hardcodes — the
 * Graph base URL — is redirected from `SIM_GRAPH_BASE` to this scenario's own
 * ephemeral stacksim instance; every other fetch (including the runner's own
 * call into the local Express app) passes through untouched.
 */
function harvestRunnerScript(graphBaseUrl: string, tenantId: string): string {
  return [
    `import { createRequire } from 'node:module';`,
    `const requireFromMuster = createRequire(${JSON.stringify(pathToFileURL(HARVEST_ROUTE).href)});`,
    `const express = requireFromMuster('express');`,
    `const { createHarvestRouter, SIM_GRAPH_BASE } = await import(${JSON.stringify(pathToFileURL(HARVEST_ROUTE).href)});`,
    `const { mintToken } = await import(${JSON.stringify(pathToFileURL(JWT_LIB).href)});`,
    ``,
    `const realFetch = globalThis.fetch;`,
    `globalThis.fetch = (input, init) => {`,
    `  const url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input);`,
    `  if (url.startsWith(SIM_GRAPH_BASE)) {`,
    `    return realFetch(${JSON.stringify(graphBaseUrl)} + url.slice(SIM_GRAPH_BASE.length), init);`,
    `  }`,
    `  return realFetch(input, init);`,
    `};`,
    ``,
    `const app = express();`,
    `app.use(express.json());`,
    `app.use('/api/harvest', createHarvestRouter(undefined, async () => true));`,
    `const server = app.listen(0, '127.0.0.1');`,
    `await new Promise((resolve, reject) => {`,
    `  server.once('listening', resolve);`,
    `  server.once('error', reject);`,
    `});`,
    `const port = server.address().port;`,
    ``,
    `const token = mintToken({ sub: 'sim-test', tenant_id: ${JSON.stringify(tenantId)}, party_id: null, role: 'bhd_operator' });`,
    `const res = await realFetch(\`http://127.0.0.1:\${port}/api/harvest/run\`, {`,
    `  method: 'POST',`,
    `  headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },`,
    `  body: JSON.stringify({ sim: true }),`,
    `});`,
    `const body = await res.json();`,
    `server.close();`,
    `if (!res.ok) {`,
    `  console.error('HTTP_STATUS::' + res.status);`,
    `  console.error('BODY::' + JSON.stringify(body));`,
    `  process.exit(1);`,
    `}`,
    `console.log('FACTS::' + JSON.stringify(body.facts));`,
    '',
  ].join('\n');
}

// Every muster-*.json scenario is auto-covered — adding a scenario file adds
// a test case; a scenario without expectedFacts fails loudly below.
const SCENARIO_NAMES = existsSync(SCENARIOS_DIR)
  ? readdirSync(SCENARIOS_DIR)
      .filter((f) => f.startsWith('muster-') && f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
  : [];

describe.skipIf(!musterAvailable)('Muster harvest against sim scenarios (G-STACKSIM-3)', () => {
  expect(SCENARIO_NAMES.length).toBeGreaterThanOrEqual(3);
  for (const scenarioName of SCENARIO_NAMES) {
    it(
      `harvests "${scenarioName}" and detects exactly the scenario's expected facts`,
      async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-muster-${scenarioName}-`));
        const tenantRoot = path.join(dir, 'tenant');
        let handle: Awaited<ReturnType<typeof startServe>> | undefined;
        try {
          const scenario = await loadScenario(path.join(SCENARIOS_DIR, `${scenarioName}.json`));
          expect(scenario.expectedFacts, `${scenarioName} must declare expectedFacts`).toBeTruthy();

          await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot });
          handle = await startServe({
            stance: scenario.stance,
            slug: scenario.name,
            port: 0,
            profilesDir: PROFILES_DIR,
            tenantRoot,
          });

          const simBaseUrl = `http://127.0.0.1:${handle.port}`;
          const graphBaseUrl = `${simBaseUrl}/v1.0`;
          const tenantId = `sim-tenant-${scenario.name}`;
          const runnerPath = path.join(dir, 'harvest-runner.mts');
          await fs.writeFile(runnerPath, harvestRunnerScript(graphBaseUrl, tenantId), 'utf8');

          const result = await runProcess(process.execPath, [TSX_CLI, runnerPath], {
            ...process.env,
            // muster-api's own vitest.config.ts uses this exact test-only value.
            JWT_SECRET: 'test-secret-not-for-production',
          });
          if (result.exitCode !== 0) {
            throw new Error(
              `harvest runner failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
            );
          }

          const factsLine = result.stdout.split('\n').find((l) => l.startsWith('FACTS::'));
          expect(factsLine, `runner stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBeDefined();
          const facts = JSON.parse(factsLine!.slice('FACTS::'.length)) as HarvestFact[];

          // Every probe must have produced a fact (a failed probe yields NO
          // fact — absence here would mean the sim's REST facade or a
          // resolver entry is broken, not a legitimate 'no').
          const byQuestion = new Map(facts.map((f) => [f.question_id, f]));
          for (const [questionId, expected] of Object.entries(scenario.expectedFacts!)) {
            const fact = byQuestion.get(questionId);
            expect(fact, `no harvested fact for ${questionId} (facts: ${JSON.stringify(facts)})`).toBeDefined();
            expect(fact!.answer, `${scenarioName}: ${questionId}`).toBe(expected);
            expect(fact!.provenance).toBe('auto_detected');
          }
        } finally {
          await handle?.stop();
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
      120_000,
    );
  }
});
