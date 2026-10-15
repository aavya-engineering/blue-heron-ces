// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-AO-CMMC-BOUND-1 M4 / GP-AO-BOUND-1 — CmmcScopeGate wired into the executor.
//
// Asserts the M4 gate criteria end-to-end:
//   - an out-of-scope command is denied BEFORE any session/context work
//     (AuthChain.createExecutionContext never called — the goal's spy technique),
//     and the denial is persisted as enforcement evidence (GP-AO-BOUND-1 M3);
//   - a correctly-scoped command proceeds to dry-run untouched;
//   - Phase-1 warnings and CUI-boundary denials land on evidence.metadata.cmmcGate;
//   - the SoD additive floor (L2 + live + write-shaped Tier 2) forces the manual
//     gate, and does NOT fire against a sim tenant (sim-transparency).
//
// Mock boundary: the PowerShell adapter (as in commandExecutionE2E) plus a
// counting stub for AuthChain.createExecutionContext — no AuthChain spy existed
// before (E2E runs it real), so this is the goal's one-time minimal spy setup.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const adapterExecuteCalls: Array<{ command: string; dryRun: boolean }> = [];
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(task: any, _variables: Record<string, any>, dryRun: boolean) {
      adapterExecuteCalls.push({ command: task?.action?.command ?? '', dryRun });
      return {
        success: true,
        stdout: JSON.stringify({ ok: true }),
        stderr: '',
        exit_code: 0,
      };
    }
  }
  return { PowerShellAdapter };
});

const createExecutionContextSpy = vi.fn(() => ({
  executionConfig: { dryRun: true },
  sessionFactory: {},
}));
vi.mock('../src/execution/AuthChain.js', () => ({
  createExecutionContext: (...args: unknown[]) => createExecutionContextSpy(...args),
}));

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

let tmpRoot: string;
const savedEnv: Record<string, string | undefined> = {};
let stacksim: StacksimEnvHandle;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cmmc-gate-'));
  for (const k of ['CES_PIPELINE_ROOT', 'AO_CMMC_STRICT', 'CES_AO_ALLOW_LIVE', 'CES_AO_SIM_ONLY'] as const) {
    savedEnv[k] = process.env[k];
  }
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  // FX-AO2: sim-only is ON by default. These tests exercise the CMMC gate against
  // live-kind fixtures (PowerShell boundary mocked), so this file opts in explicitly.
  // The default-refuse behavior itself is proven in simOnlyRail.test.ts.
  process.env.CES_AO_ALLOW_LIVE = '1';
  adapterExecuteCalls.length = 0;
  createExecutionContextSpy.mockClear();
  // AO-20 (2026-09-27): a couple of tests here use kind:'sim' specifically to prove
  // "sim-transparency" of the CMMC gate — they need to reach that gate, not be
  // intercepted earlier by the stacksim-routing check, so route this process to stacksim.
  stacksim = activateStacksimEnv();
});

afterEach(() => {
  closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  stacksim.restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Minimal tenant config the executor + ParameterMapper can walk. */
function makeTenant(overrides: Record<string, any> = {}): any {
  return {
    tenantSlug: 't-gate-test',
    tenantId: 'tid-123',
    appId: 'app-123',
    certThumbprint: 'THUMB',
    certPath: 'C:/certs/t.pfx',
    domain: 'gate-test.onmicrosoft.us',
    endpoints: {},
    // FX-AO2: an explicit kind; the rail refuses a kind-less record even with the opt-in.
    kind: 'live',
    ...overrides,
  };
}

describe('CmmcScopeGate in executeAoCommand (M4)', () => {
  it('denies an L2-only command against an L1 live tenant BEFORE any context/session work, with enforcement evidence', async () => {
    const cmd = makeAoCommand({ id: 'X-42', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({ cmmcLevel: 'L1', kind: 'live' });

    const result: any = await executeAoCommand(cmd, tenant, {}, true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CMMC scope gate denied/);
    expect(createExecutionContextSpy).not.toHaveBeenCalled(); // no auth chain
    expect(adapterExecuteCalls).toHaveLength(0); // no session/execution
    // The blocked command IS evidence of enforcement (GP-AO-BOUND-1 M3).
    expect(result.evidence?.metadata?.cmmcGate).toMatchObject({
      allow: false,
      tenantCmmcLevel: 'L1',
      tenantKind: 'live',
    });
    // AE-R1: deny outcome and mode are stamped.
    expect(result.evidence.outcome).toBe('denied_cmmc');
    expect(result.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
    expect(result.evidence.metadata.dryRun).toBe(true);
    expect(result.evidence.metadata.mode).toBe('dry_run');
    expect(result.evidencePath).toBeTruthy(); // persisted, not just in-memory
    // AE-R1: read back the persisted row and verify flat metadata.
    const rows = getCesRepository().listAll<any>('adminops_evidence');
    const persisted = rows.find(r => r.data?.metadata?.commandId === 'X-42');
    expect(persisted).toBeTruthy();
    expect(persisted!.data.metadata.outcome).toBe('denied_cmmc');
    expect(persisted!.data.metadata.dryRun).toBe(true);
    expect(persisted!.data.metadata.mode).toBe('dry_run');
  });

  it('denies identically against a sim tenant (sim-transparency: kind never changes the scope decision)', async () => {
    const cmd = makeAoCommand({ id: 'X-42', cmmcPractices: ['AC.L2-3.1.5'] });
    const live: any = await executeAoCommand(cmd, makeTenant({ cmmcLevel: 'L1', kind: 'live' }), {}, true);
    const sim: any = await executeAoCommand(cmd, makeTenant({ cmmcLevel: 'L1', kind: 'sim' }), {}, true);

    expect(sim.success).toBe(false);
    expect(sim.error).toBe(live.error); // same denial, same reason
  });

  it('lets a correctly-scoped command proceed to dry-run with no gate metadata', async () => {
    const cmd = makeAoCommand({ id: 'X-43', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({ cmmcLevel: 'L2', kind: 'live' });

    const result: any = await executeAoCommand(cmd, tenant, {}, true);

    expect(result.success).toBe(true);
    expect(createExecutionContextSpy).toHaveBeenCalledTimes(1);
    // W4-AO1: a dry run never goes through the adapter's dry-run placeholder branch. This
    // fixture command has no get_command, so there is nothing read-only to read: nothing
    // is sent, and the reason is recorded on the evidence.
    expect(adapterExecuteCalls).toHaveLength(0);
    expect(result.evidence?.metadata?.stateReadError).toMatch(/dry run did not read: empty get_command/);
    expect(result.evidence?.metadata?.cmmcGate).toBeUndefined(); // clean pass — no decision to record
    // AE-R1: dry-run mode and outcome are stamped even on a clean pass.
    expect(result.evidence.outcome).toBe('dry_run');
    expect(result.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
    expect(result.evidence.metadata.dryRun).toBe(true);
    expect(result.evidence.metadata.mode).toBe('dry_run');
  });

  it('records the Phase-1 fail-open warning on the evidence artifact (explicit non-strict)', async () => {
    // Phase 2 (CMMC_STRICT_DEFAULT=true) is now the default, so the fail-open
    // migration-window path must be opted into explicitly to exercise it — that
    // is exactly what a --no-strict operator override does.
    const cmd = makeAoCommand({ id: 'X-44', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({}); // no cmmcLevel — migration window

    const result: any = await executeAoCommand(cmd, tenant, {}, true, { strictCmmc: false });

    expect(result.success).toBe(true);
    expect(result.evidence?.metadata?.cmmcGate).toMatchObject({ allow: true, strict: false });
    expect(result.evidence?.metadata?.cmmcGate?.warning).toMatch(/no cmmcLevel/);
  });

  it('fails closed on an unmigrated (non-exempt) tenant under the Phase-2 default (no opts, no env)', async () => {
    const cmd = makeAoCommand({ id: 'X-44b', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({}); // no cmmcLevel, not exempt

    const result: any = await executeAoCommand(cmd, tenant, {}, true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CMMC scope gate denied/);
    expect(result.evidence?.metadata?.cmmcGate).toMatchObject({ allow: false, strict: true });
    expect(createExecutionContextSpy).not.toHaveBeenCalled();
  });

  it('lets a migration-exempt tenant (dev/sim) through under the Phase-2 default', async () => {
    const cmd = makeAoCommand({ id: 'X-44c', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({ cmmcMigrationExempt: true }); // exempt, no cmmcLevel

    const result: any = await executeAoCommand(cmd, tenant, {}, true);

    expect(result.success).toBe(true);
    expect(createExecutionContextSpy).toHaveBeenCalledTimes(1);
  });

  it('opts.strictCmmc (CLI --strict-cmmc thread) fails closed on an unmigrated tenant', async () => {
    const cmd = makeAoCommand({ id: 'X-45', cmmcPractices: ['AC.L2-3.1.5'] });
    const tenant = makeTenant({}); // no cmmcLevel

    const result: any = await executeAoCommand(cmd, tenant, {}, true, { strictCmmc: true });

    expect(result.success).toBe(false);
    expect(result.evidence?.metadata?.cmmcGate).toMatchObject({ allow: false, strict: true });
    expect(createExecutionContextSpy).not.toHaveBeenCalled();
  });

  it('emits a CUI-boundary denial as enforcement evidence, before any context/session work', async () => {
    const cmd = makeAoCommand({
      id: 'X-46',
      cmmcPractices: ['SC.L2-3.13.16'],
      parameters: [
        { name: 'storageAccountName', label: 'Storage', type: 'text', source: 'resources.storageAccountName', required: true },
      ],
    });
    const tenant = makeTenant({
      cmmcLevel: 'L2',
      kind: 'live',
      resources: { storageAccountName: 'sa-outside-boundary' },
      cuiBoundary: { resourceAllowlist: ['sa-inside-boundary'] },
    });

    const result: any = await executeAoCommand(cmd, tenant, {}, true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CUI boundary denied/);
    expect(createExecutionContextSpy).not.toHaveBeenCalled();
    expect(result.evidence?.metadata?.cmmcGate).toMatchObject({
      allow: false,
      cuiBoundaryCase: 'out-of-boundary',
    });
    // AE-R1: CUI deny outcome and mode are stamped.
    expect(result.evidence.outcome).toBe('denied_cui');
    expect(result.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
    expect(result.evidence.metadata.dryRun).toBe(true);
    expect(result.evidence.metadata.mode).toBe('dry_run');
    expect(result.evidencePath).toBeTruthy();
    // AE-R1: read back the persisted row and verify flat metadata.
    const rows = getCesRepository().listAll<any>('adminops_evidence');
    const persisted = rows.find(r => r.data?.metadata?.commandId === 'X-46');
    expect(persisted).toBeTruthy();
    expect(persisted!.data.metadata.outcome).toBe('denied_cui');
    expect(persisted!.data.metadata.dryRun).toBe(true);
    expect(persisted!.data.metadata.mode).toBe('dry_run');
  });
});

describe('SoD additive floor in executeAoCommand (M4)', () => {
  // A-01 is a real registry command: Tier 2, get-then-set, with real set/get
  // templates — write-shaped, so the floor applies against a live L2 tenant.
  it('floors a write-shaped Tier 2 command up to the manual gate against a live L2 tenant', async () => {
    const a01 = getCommand('A-01')!;
    expect(a01.sodTier).toBe('Tier 2');
    const tenant = makeTenant({ cmmcLevel: 'L2', kind: 'live' });

    const result: any = await executeAoCommand(a01, tenant, {}, true, { requestorUPN: 'op@gate-test.us' });

    expect(result.status).toBe('pending_approval'); // two-person approval now required
    expect(adapterExecuteCalls).toHaveLength(0); // nothing executed
  });

  it('does NOT floor the same command against a sim tenant (sim-transparency)', async () => {
    const a01 = getCommand('A-01')!;
    // W4-AO2: A-01's tenant-sourced SKU + base group come from the tenant record.
    const tenant = makeTenant({
      cmmcLevel: 'L2',
      kind: 'sim',
      resources: { m365_license_sku_id: 'sku-gate', base_group_id: 'group-gate' },
    });

    const result: any = await executeAoCommand(a01, tenant, { upn: 'user@gate-test.us' }, true);

    expect(result.status).toBeUndefined(); // no approval interception
    expect(result.success).toBe(true);
    // The floored-vs-not decision is visible on evidence for the floored case only.
    expect(result.evidence?.metadata?.cmmcGate?.sodFloorApplied).toBeUndefined();
  });
});
