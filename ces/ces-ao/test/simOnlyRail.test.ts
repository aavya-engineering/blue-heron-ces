// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A5: Sim-only safety rail tests.
//
// (a) isStacksimModeActive true for a ces-tester-style injected env
// (b) false when PSModulePath is real or STACKSIM_SERVER_URL is non-loopback or absent
// (c) a sim record is refused when it has non-loopback endpoints
// (d) CES_AO_SIM_ONLY=1 with a non-sim tenant refuses everything, and the refusal
//     writes an evidence row
// FX-AO2 (2026-09-27): sim-only ON by default; live needs CES_AO_ALLOW_LIVE=1 + kind 'live'.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isStacksimModeActive, checkSimOnlyRail } from '../src/execution/SimOnlyRail.js';

// ── Mock the PowerShell boundary (same as E2E); counts every call so FX-AO2 (c)
// can prove an allowed request actually reaches the executor. ──
const psCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() { return 'mgraph'; }
    async execute(task: any, _variables: Record<string, any>, dryRun: boolean) {
      psCalls.count++;
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import type { TenantConfig } from 'ces-shared/config';

let tmpRoot: string;
let psmodulesDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-sim-rail-'));
  psmodulesDir = path.join(tmpRoot, 'psmodules');
  fs.mkdirSync(psmodulesDir);
  fs.mkdirSync(path.join(psmodulesDir, 'Microsoft.Graph.Authentication'));

  savedEnv.CES_PIPELINE_ROOT = process.env.CES_PIPELINE_ROOT;
  savedEnv.CES_CONFIG_PATH = process.env.CES_CONFIG_PATH;
  savedEnv.CES_AO_SIM_ONLY = process.env.CES_AO_SIM_ONLY;
  savedEnv.CES_AO_ALLOW_LIVE = process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): default every test in this file to a stacksim-routed process
  // (STACKSIM_SERVER_URL loopback + a PSModulePath with the shim marker dir, reusing
  // psmodulesDir above) so the pre-existing "sim tenant -> allowed" integration tests
  // below keep passing now that CommandExecutor fail-closes on isStacksimModeActive().
  // The dedicated AO-20 tests explicitly unset these to prove the refusal case.
  savedEnv.STACKSIM_SERVER_URL = process.env.STACKSIM_SERVER_URL;
  savedEnv.PSModulePath = process.env.PSModulePath;
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  process.env.STACKSIM_SERVER_URL = 'http://127.0.0.1:4390';
  process.env.PSModulePath = `${psmodulesDir}${path.delimiter}C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`;
  psCalls.count = 0;
});
afterEach(() => {
  closeAllCesRepositories();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isStacksimModeActive predicate', () => {
  it('(a) true for a ces-tester-style injected env', () => {
    const env: Record<string, string> = {
      STACKSIM_SERVER_URL: 'http://127.0.0.1:4390',
      PSModulePath: `${psmodulesDir};C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`,
    };
    expect(isStacksimModeActive(env)).toBe(true);
  });

  it('(a) true for localhost variant', () => {
    const env: Record<string, string> = {
      STACKSIM_SERVER_URL: 'http://localhost:4390',
      PSModulePath: `${psmodulesDir};C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`,
    };
    expect(isStacksimModeActive(env)).toBe(true);
  });

  it('(b) false when STACKSIM_SERVER_URL is absent', () => {
    const env: Record<string, string> = {
      PSModulePath: `${psmodulesDir};C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`,
    };
    expect(isStacksimModeActive(env)).toBe(false);
  });

  it('(b) false when STACKSIM_SERVER_URL is non-loopback', () => {
    const env: Record<string, string> = {
      STACKSIM_SERVER_URL: 'https://graph.microsoft.us',
      PSModulePath: `${psmodulesDir};C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`,
    };
    expect(isStacksimModeActive(env)).toBe(false);
  });

  it('(b) false when PSModulePath does not start with a stacksim dir', () => {
    const realDir = path.join(tmpRoot, 'real-modules');
    fs.mkdirSync(realDir);
    const env: Record<string, string> = {
      STACKSIM_SERVER_URL: 'http://127.0.0.1:4390',
      PSModulePath: `${realDir};${psmodulesDir}`,
    };
    expect(isStacksimModeActive(env)).toBe(false);
  });

  it('(b) false when PSModulePath is missing', () => {
    const env: Record<string, string> = {
      STACKSIM_SERVER_URL: 'http://127.0.0.1:4390',
    };
    expect(isStacksimModeActive(env)).toBe(false);
  });
});

describe('checkSimOnlyRail', () => {
  it('(c) refuses a sim tenant with non-loopback endpoints', () => {
    const result = checkSimOnlyRail('sim', {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/non-loopback/);
  });

  it('allows a sim tenant with loopback endpoints', () => {
    const result = checkSimOnlyRail('sim', {
      graph: 'http://127.0.0.1:4390/graph',
      login: 'http://localhost:4390/login',
    });
    expect(result.allowed).toBe(true);
  });

  // FX-AO2 (2026-09-27): corrected. This used to assert that a live tenant was allowed
  // with no env set (sim-only off by default). Sim-only is now ON by default.
  it('FX-AO2 (a) refuses a live tenant when no env is set (sim-only by default)', () => {
    const result = checkSimOnlyRail('live', {
      graph: 'https://graph.microsoft.us',
    }, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Sim-only by default/);
  });

  it('FX-AO2 (b) opt-in set but tenant not marked live -> refused', () => {
    expect(checkSimOnlyRail(undefined, { graph: 'https://graph.microsoft.us' }, { CES_AO_ALLOW_LIVE: '1' }).allowed).toBe(false);
    expect(checkSimOnlyRail('dev', { graph: 'https://graph.microsoft.us' }, { CES_AO_ALLOW_LIVE: '1' }).allowed).toBe(false);
  });

  it('FX-AO2 (c) opt-in + live tenant -> allowed', () => {
    expect(checkSimOnlyRail('live', { graph: 'https://graph.microsoft.us' }, { CES_AO_ALLOW_LIVE: '1' }).allowed).toBe(true);
  });

  it('FX-AO2 lockdown beats opt-in: CES_AO_SIM_ONLY=1 refuses a live tenant even with CES_AO_ALLOW_LIVE=1', () => {
    const r = checkSimOnlyRail('live', { graph: 'https://graph.microsoft.us' }, { CES_AO_ALLOW_LIVE: '1', CES_AO_SIM_ONLY: '1' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/CES_AO_SIM_ONLY/);
  });

  it('FX-AO2 (d) stacksim (sim + loopback) endpoints are always allowed, whatever the env', () => {
    const eps = { graph: 'http://127.0.0.1:4390', login: 'http://localhost:4390' };
    expect(checkSimOnlyRail('sim', eps, {}).allowed).toBe(true);
    expect(checkSimOnlyRail('sim', eps, { CES_AO_SIM_ONLY: '1' }).allowed).toBe(true);
    expect(checkSimOnlyRail('sim', eps, { CES_AO_ALLOW_LIVE: '1' }).allowed).toBe(true);
  });

  it('(d) CES_AO_SIM_ONLY=1 refuses a live tenant', () => {
    const result = checkSimOnlyRail('live', {
      graph: 'https://graph.microsoft.us',
    }, { CES_AO_SIM_ONLY: '1' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CES_AO_SIM_ONLY/);
  });

  it('(d) CES_AO_SIM_ONLY=1 refuses a tenant with no kind', () => {
    const result = checkSimOnlyRail(undefined, {}, { CES_AO_SIM_ONLY: '1' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CES_AO_SIM_ONLY/);
  });
});

describe('Sim-only rail integration (CommandExecutor)', () => {
  function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
    const certPath = path.join(tmpRoot, 'test.pfx');
    if (!fs.existsSync(certPath)) fs.writeFileSync(certPath, 'dummy');
    return {
      tenantSlug: 'sim-rail-test',
      tenantId: 'sim-rail-tid',
      appId: 'app-id',
      certPath,
      certThumbprint: 'CCDD000000000000000000000000000000000000',
      domain: 'sim.onmicrosoft.us',
      cmmcMigrationExempt: true,
      endpoints: {
        graph: 'https://graph.microsoft.us',
        login: 'https://login.microsoftonline.us',
      },
      subscription: { subscription_id: 'sub-1', resource_group: 'rg-1', location: 'usgovvirginia' },
      subscriptionId: 'sub-1',
      resources: { operatorUPN: 'op@sim.onmicrosoft.us' },
      clientName: 'Sim Rail Test',
      ...overrides,
    } as TenantConfig;
  }

  it('(d) CES_AO_SIM_ONLY=1 with a live tenant writes deny evidence', async () => {
    process.env.CES_AO_SIM_ONLY = '1';
    const cmd = makeAoCommand({ id: 'SIM-01', cmmcPractices: ['AC.L1-3.1.1'] });
    const tenant = makeTenant({ kind: 'live' } as any);

    const result = await executeAoCommand(cmd, tenant, {}, true, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });

    expect((result as any).success).toBe(false);
    expect((result as any).error).toMatch(/CES_AO_SIM_ONLY/);

    const all = getCesRepository().listAll<any>('adminops_evidence');
    const rows = all.filter((r: any) => r.data?.metadata?.commandId === 'SIM-01');
    expect(rows.length).toBe(1);
    expect(rows[0].data.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
  });

  it('(c) sim tenant with non-loopback endpoints is refused', async () => {
    const cmd = makeAoCommand({ id: 'SIM-02', cmmcPractices: ['AC.L1-3.1.1'] });
    const tenant = makeTenant({
      kind: 'sim',
      endpoints: { graph: 'https://graph.microsoft.us' },
    } as any);

    const result = await executeAoCommand(cmd, tenant, {}, true, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });

    expect((result as any).success).toBe(false);
    expect((result as any).error).toMatch(/non-loopback/);
  });

  const rowsFor = (id: string) =>
    getCesRepository().listAll<any>('adminops_evidence').filter((r: any) => r.data?.metadata?.commandId === id);

  it('FX-AO2 (a) no env set -> live tenant refused through the executor, deny evidence persisted, executor never called', async () => {
    const cmd = makeAoCommand({ id: 'FX2-A', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({ kind: 'live' } as any), {}, false, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Sim-only by default/);
    expect(psCalls.count).toBe(0);
    const rows = rowsFor('FX2-A');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.evidence.complianceVerdict).not.toBe('SATISFIED');
    expect(rows[0].data.evidence.outcomeRationale).toMatch(/Sim-only by default/);
  });

  it('FX-AO2 (a) no env set -> a dry-run against a live tenant is refused too', async () => {
    const cmd = makeAoCommand({ id: 'FX2-A-DRY', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({ kind: 'live' } as any), {}, true, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });
    expect(result.success).toBe(false);
    expect(psCalls.count).toBe(0);
    expect(rowsFor('FX2-A-DRY')).toHaveLength(1);
  });

  it('FX-AO2 (b) opt-in set but tenant not marked live -> refused through the executor with evidence', async () => {
    process.env.CES_AO_ALLOW_LIVE = '1';
    const cmd = makeAoCommand({ id: 'FX2-B', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant(), {}, false, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not marked live/);
    expect(psCalls.count).toBe(0);
    const rows = rowsFor('FX2-B');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.evidence.complianceVerdict).not.toBe('SATISFIED');
  });

  it('FX-AO2 (c) opt-in + live tenant -> allowed through to the (mocked) executor', async () => {
    process.env.CES_AO_ALLOW_LIVE = '1';
    const cmd = makeAoCommand({ id: 'FX2-C', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({ kind: 'live' } as any), {}, false, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });
    expect(result.success).toBe(true);
    expect(psCalls.count).toBe(1);
    expect(rowsFor('FX2-C')[0].data.metadata.outcome).toBe('executed');
  });

  it('FX-AO2 (d) sim tenant with stacksim (loopback) endpoints is allowed with no CES_AO_* env set (stacksim routing is set by this file\'s beforeEach, per AO-20)', async () => {
    const cmd = makeAoCommand({ id: 'FX2-D', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({
      kind: 'sim',
      endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    } as any), {}, false, { requestorUPN: 'op@sim.onmicrosoft.us' });
    expect(result.success).toBe(true);
    expect(psCalls.count).toBe(1);
  });

  // AO-20 (2026-09-27, FC-AO): checkSimOnlyRail (above) only checks tenant kind +
  // loopback endpoints. It never asked whether THIS PROCESS is actually routed to the
  // stacksim shims. These two tests pin the new, additional check.
  it('AO-20: sim tenant + this process routed to stacksim -> allowed (every other test in this file proves this too)', async () => {
    const cmd = makeAoCommand({ id: 'AO20-ROUTED', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({
      kind: 'sim',
      endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    } as any), {}, false, { requestorUPN: 'op@sim.onmicrosoft.us' });
    expect(result.success).toBe(true);
    expect(result.evidence?.complianceVerdict).not.toBe('NOT_APPLICABLE');
    expect(psCalls.count).toBe(1);
  });

  it('AO-20: sim tenant + this process NOT routed to stacksim -> refused with a clear message, evidence persisted, executor never called', async () => {
    delete process.env.STACKSIM_SERVER_URL;
    delete process.env.PSModulePath;
    const cmd = makeAoCommand({ id: 'AO20-UNROUTED', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({
      kind: 'sim',
      endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    } as any), {}, false, { requestorUPN: 'op@sim.onmicrosoft.us' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not routed to stacksim/);
    expect(psCalls.count).toBe(0);

    const rows = getCesRepository().listAll<any>('adminops_evidence').filter((r: any) => r.data?.metadata?.commandId === 'AO20-UNROUTED');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.evidence.complianceVerdict).not.toBe('SATISFIED');
    expect(rows[0].data.evidence.outcomeRationale).toMatch(/not routed to stacksim/);
  });

  it('AO-20: a LIVE-kind tenant is unaffected by stacksim routing (only kind:\'sim\' triggers the check)', async () => {
    delete process.env.STACKSIM_SERVER_URL;
    delete process.env.PSModulePath;
    process.env.CES_AO_ALLOW_LIVE = '1';
    const cmd = makeAoCommand({ id: 'AO20-LIVE-UNROUTED', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });
    const result: any = await executeAoCommand(cmd, makeTenant({ kind: 'live' } as any), {}, false, {
      requestorUPN: 'op@sim.onmicrosoft.us',
    });
    // Not refused BY THE STACKSIM-ROUTING CHECK specifically (it only gates kind:'sim');
    // it still reaches the (mocked) executor.
    expect(result.success).toBe(true);
    expect(psCalls.count).toBe(1);
  });
});
