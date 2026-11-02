// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Gap closure API-6: executeForTenant() itself. Both modes load the same plan with the same
// variables; the explicit options do what they say (tenant variables.json restore, environment
// secret line, forced failures, mode-specific "not loaded" text). Dry run, no tenant session.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PLAN_SRC = path.join(ROOT, 'tests', 'fixtures', 'synthetic-mission-plan.executable.json');

process.env.DRY_RUN = 'true';
delete process.env.CES_MUSTER_SECRETS_URL;

import { executeForTenant, type ExecuteForTenantInput } from '../../src/core/executeForTenant';
import { StamperEngine } from '../../src/core/StamperEngine';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { tenantBaseDir } from '../../src/core/EvidenceReadinessAnalyzer';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-api6-core-'));
const planPath = path.join(tmp, 'plan.json');
const TENANT = 'api6-core';

function input(mode: 'cli' | 'gui', over: Partial<ExecuteForTenantInput> = {}): ExecuteForTenantInput & { lines: string[] } {
  const lines: string[] = [];
  return {
    mode,
    engine: new StamperEngine(new StamperConfig()),
    planPath,
    session: mode === 'gui' ? { kind: 'persistent' } : { kind: 'per-command' },
    primeMusterSecrets: mode === 'cli',
    restoreTenantVariables: mode === 'gui',
    log: (l: string) => lines.push(l),
    lines,
    ...over,
  };
}

beforeAll(() => {
  fs.copyFileSync(PLAN_SRC, planPath);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tenantBaseDir(TENANT), { recursive: true, force: true });
});

describe('API-6 executeForTenant', () => {
  it('cli and gui modes load the same plan and variables (no tenant)', async () => {
    const cli = input('cli');
    const gui = input('gui');
    const a = await executeForTenant(cli);
    const b = await executeForTenant(gui);
    expect(a.plan.plan_id).toBe('translated-synthetic-gcch-l2-001');
    expect(b.plan.plan_id).toBe(a.plan.plan_id);
    expect(b.plan.variables).toEqual(a.plan.variables);
    expect(b.plan.execution_graph.map(t => t.id)).toEqual(a.plan.execution_graph.map(t => t.id));
    expect(cli.engine.getPlan()).toBe(a.plan);
    expect(cli.lines).toEqual(gui.lines);
  });

  it('restoreTenantVariables puts variables.json under the plan variables (gui option only)', async () => {
    fs.mkdirSync(tenantBaseDir(TENANT), { recursive: true });
    fs.writeFileSync(path.join(tenantBaseDir(TENANT), 'variables.json'), JSON.stringify({ api6Captured: 'from-variables-json' }));
    const gui = await executeForTenant(input('gui', { tenantSlug: TENANT }));
    const cli = await executeForTenant(input('cli', { tenantSlug: TENANT }));
    expect(gui.plan.variables.api6Captured).toBe('from-variables-json');
    expect(cli.plan.variables.api6Captured).toBeUndefined();
  });

  it('environment secrets: same line in both modes, sentinel in the context', async () => {
    const saved = process.env.STAMPER_INITIAL_PASSWORD;
    process.env.STAMPER_INITIAL_PASSWORD = 'api6-test-value';
    try {
      const cliCtx = new ExecutionContext(false);
      const guiCtx = new ExecutionContext(false);
      const cli = input('cli', { executionContext: cliCtx });
      const gui = input('gui', { executionContext: guiCtx });
      await executeForTenant(cli);
      await executeForTenant(gui);
      const expected = 'Secret input initialPassword: supplied from STAMPER_INITIAL_PASSWORD (held in memory only)';
      expect(cli.lines).toEqual([expected]);
      expect(gui.lines).toEqual([expected]);
      expect(JSON.stringify(cli.lines)).not.toContain('api6-test-value');
    } finally {
      if (saved === undefined) delete process.env.STAMPER_INITIAL_PASSWORD; else process.env.STAMPER_INITIAL_PASSWORD = saved;
    }
  });

  it('forceFail is handed to the engine', async () => {
    const i = input('cli', { forceFail: ['entry-x'] });
    const calls: string[][] = [];
    const orig = i.engine.setForcedFailures.bind(i.engine);
    i.engine.setForcedFailures = (ids: string[]) => { calls.push(ids); orig(ids); };
    await executeForTenant(i);
    expect(calls).toEqual([['entry-x']]);
  });

  it('a missing plan file fails the same way in both modes', async () => {
    const missing = path.join(tmp, 'missing.json');
    await expect(executeForTenant(input('cli', { planPath: missing, primeMusterSecrets: false }))).rejects.toThrow(/Plan file not found/);
    await expect(executeForTenant(input('gui', { planPath: missing }))).rejects.toThrow(/Plan file not found/);
  });
});
