// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-TENANT-M5 gate 5 — AO executes against a `kind: 'sim'` tenant via
// ces-tenant's registry + StacksimModeController.
//
// Grounding: tenant-stacksim's coverage inventory already replays AO's
// 139-call surface (`tenant-stacksim/coverage/inventory.json`, source:"ao"),
// so AO-against-sim is a real scenario. Pre-M5, AO had zero sim-mode code
// (no StacksimMode/simMode match in src). This suite proves the capability
// arrives entirely through ces-tenant surfaces (goal must-NOT: no hand-rolled
// sim mode):
//
//   1. `requestAoStacksimMode` obtains a registry-verified `kind:'sim'`
//      record (creating an ephemeral one when absent) and enables stacksim
//      mode through ces-tenant's `StacksimEnvironment` controller — with the
//      injected env/PSHOME/fetch seams, so no real powershell.exe or sim
//      server is touched.
//   2. The A9 guard: a slug resolving to a LIVE registry record is refused.
//   3. The full AO pipeline (registry resolution -> AuthChain execution
//      context -> CommandExecutor -> evidence persistence) runs a registry
//      command against the sim tenant. Mock boundary: ONLY
//      `ces-stamper/adapters/powershell` (same policy as the E2E suite).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Mock the PowerShell execution boundary BEFORE importing the executor. ──
const adapterExecuteCalls: Array<{ command: string; dryRun: boolean }> = [];
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(task: any, _variables: Record<string, any>, dryRun: boolean) {
      const command = task?.action?.command ?? '';
      adapterExecuteCalls.push({ command, dryRun });
      const body = JSON.stringify({ ok: true, command, dryRun, sample: 'sim-output' });
      return {
        success: true,
        // W4-AO1: a state read is wrapped in marker-delimited ConvertTo-Json; echo the markers as PowerShell would.
        stdout: command.includes('<<AO-STATE-BEGIN>>') ? `<<AO-STATE-BEGIN>>
${body}
<<AO-STATE-END>>` : body,
        stderr: '',
        exit_code: 0,
      };
    }
  }
  return { PowerShellAdapter };
});

import {
  AO_CONSUMER,
  getTenantRegistry,
  loadTenantConfigBySlug,
  requestAoStacksimMode,
  resetTenantRegistryForTests,
} from '../src/tenant/aoTenants.js';
import { createExecutionContext } from '../src/execution/AuthChain.js';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import type { AoCommand } from '../src/types/AoCommand.js';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
const COMMANDS = registry as unknown as AoCommand[];

let root: string;
let tenantRoot: string;
let stacksimRoot: string;
let stacksimProcessEnv: StacksimEnvHandle;
const env0 = { ...process.env };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-sim-'));
  tenantRoot = path.join(root, 'registry');
  process.env.CES_TENANT_ROOT = tenantRoot;
  process.env.CES_PIPELINE_ROOT = path.join(root, 'pipeline');
  delete process.env.STACKSIM_SERVER_URL;
  resetTenantRegistryForTests();

  // Fake tenant-stacksim checkout carrying the module-tree marker the
  // controller's dir guard checks for.
  stacksimRoot = path.join(root, 'stacksim');
  fs.mkdirSync(path.join(stacksimRoot, 'psmodules', 'Microsoft.Graph.Authentication'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(stacksimRoot, 'azshim'), { recursive: true });
  adapterExecuteCalls.length = 0;
  // AO-20 (2026-09-27): requestAoStacksimMode above mutates an INJECTED env object
  // (simSeams()), never process.env, so this doesn't affect those tests. But the
  // 'full pipeline' test below calls executeAoCommand directly with a kind:'sim'
  // config, which now needs THIS process routed to stacksim (isStacksimModeActive
  // reads process.env) or the executor's new AO-20 check refuses it.
  stacksimProcessEnv = activateStacksimEnv();
});

afterEach(() => {
  closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
  resetTenantRegistryForTests();
  stacksimProcessEnv.restore();
  for (const k of ['CES_TENANT_ROOT', 'CES_PIPELINE_ROOT', 'STACKSIM_SERVER_URL'] as const) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** Injectable seams so no real powershell.exe / sim server / process.env is touched. */
function simSeams(env: NodeJS.ProcessEnv) {
  return {
    env,
    stacksimRoot,
    queryPsHomeModules: async () => 'C:/PSHOME/Modules',
    fetchFn: (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch,
  };
}

describe('G-TENANT-M5 — AO kind:\'sim\' support via ces-tenant', () => {
  it("AO's consumer identity is wired as module 'ces-ao' (ratified amendment 2026-07-10)", () => {
    expect(AO_CONSUMER.module).toBe('ces-ao');
    expect(AO_CONSUMER.purpose).toBeTruthy();
  });

  it("requestAoStacksimMode creates an ephemeral kind:'sim' record and enables stacksim mode through ces-tenant's controller", async () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\System32' };
    const record = await requestAoStacksimMode(undefined, {
      preferredSlug: 'ao-sim',
      ...simSeams(env),
    });

    // Registry-verified sim record, persisted in the sim namespace (A9 structural fix).
    expect(record.kind).toBe('sim');
    expect(record.tenantSlug).toBe('ao-sim');
    expect(fs.existsSync(path.join(tenantRoot, 'sim', 'ao-sim.json'))).toBe(true);

    // The controller's env mutation happened on the INJECTED env, per
    // enableStacksimMode()'s contract: fake modules first on PSModulePath,
    // az shim first on Path, sim server URL pinned.
    expect(env.PSModulePath!.startsWith(path.join(stacksimRoot, 'psmodules'))).toBe(true);
    expect(env.Path!.startsWith(path.join(stacksimRoot, 'azshim'))).toBe(true);
    expect(env.Path).toContain('C:\\Windows\\System32');
    expect(env.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:4390');
  });

  it('REFUSES stacksim mode for a slug that resolves to a live registry record (A9 guard)', async () => {
    // AO's one-time seed migrates <ces-ao>/plan-data/dev/dev.json into the
    // temp registry root as kind:'live' on first registry use.
    const live = await getTenantRegistry().get('dev');
    expect(live?.kind).toBe('live');

    await expect(
      requestAoStacksimMode(undefined, { preferredSlug: 'dev', ...simSeams({}) })
    ).rejects.toThrow(/refusing stacksim mode/);
  });

  it('resolves the sim tenant through the registry and executes a command against it (full pipeline, PS boundary mocked)', async () => {
    await getTenantRegistry().createEphemeralSimTenant('ao-sim', undefined);
    // W4-AO1: the dry-run state read runs in a NON-dry context, which validates the
    // cert file. Stacksim's Connect-* shims never consult a cert store, so a
    // run-scoped placeholder file is patched in (the ces-tester sim-record pattern).
    const simRecordPath = path.join(tenantRoot, 'sim', 'ao-sim.json');
    const rawRecord = JSON.parse(fs.readFileSync(simRecordPath, 'utf-8'));
    const certFile = path.join(tenantRoot, 'ao-sim-placeholder.pfx');
    fs.writeFileSync(certFile, 'placeholder (never a real key)');
    rawRecord.auth.cert_path = certFile;
    fs.writeFileSync(simRecordPath, JSON.stringify(rawRecord, null, 2));

    // Same registry call path all three entry points use.
    const simConfig = await loadTenantConfigBySlug('ao-sim');
    expect(simConfig.kind).toBe('sim');
    expect(simConfig.tenantSlug).toBe('ao-sim');
    // Sim record endpoints point at the stacksim server, not real Microsoft clouds.
    expect(simConfig.endpoints.graph).toMatch(/^http:\/\/.*\/graph$/);

    // Execution context is built from ces-tenant surfaces off the sim record.
    const { executionConfig, sessionFactory } = createExecutionContext(simConfig, true);
    expect(executionConfig.tenantId).toBe('sim-tenant-ao-sim');
    // The ces-tenant session surface carries the sim tenant's credentials.
    expect(sessionFactory.buildConnectCommand('graph')).toContain('sim-app-ao-sim');

    // Drive a real registry command through the governed pipeline against the sim tenant.
    const cmd = COMMANDS.find(
      (c) => c.sodTier !== 'Tier 3' && (c.parameters || []).every((p) => !p.source)
    )!;
    expect(cmd).toBeTruthy();
    const inputs: Record<string, any> = {};
    for (const p of cmd.parameters) {
      if (p.source) continue;
      if (p.type === 'select') inputs[p.name] = p.options?.[0]?.value ?? 'stub';
      else if (p.type === 'checkbox') inputs[p.name] = 'true';
      else inputs[p.name] = `stub-${p.name}`;
    }

    const result: any = await executeAoCommand(cmd, simConfig, inputs, /* dryRun */ true, {
      requestorUPN: 'operator@ao-sim.simtenant.onmicrosoft.us',
    });

    expect(result.status).not.toBe('pending_approval');
    expect(result.success).toBe(true);
    expect(result.evidence).toBeTruthy();
    expect(adapterExecuteCalls.length).toBeGreaterThan(0);
    // W4-AO1: a dry run issues only real, read-only state reads — never the set.
    if (result.evidence?.metadata?.preStateOutput !== undefined) {
      expect(adapterExecuteCalls.every((c) => c.command.includes('<<AO-STATE-BEGIN>>') && c.dryRun === false)).toBe(true);
      expect(result.evidence.metadata.preStateOutput).not.toMatch(/\[dry-run\]/);
    }
  });
});
