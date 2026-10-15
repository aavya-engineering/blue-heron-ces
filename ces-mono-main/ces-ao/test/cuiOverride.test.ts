// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO1 (2026-09-27 fix batch): a request input cannot override the CUI boundary.
//
// The boundary decision comes only from the server-side tenant record. These tests go
// through the production executor (executeAoCommand) and read the persisted
// adminops_evidence row back from the repository. Mocked seam: the PowerShell boundary
// only. Tenant: kind 'sim', loopback endpoints, migrated (cmmcMigrationExempt:false) with
// an explicit resourceAllowlist, so the sim rail, the exempt short-circuit and the SoD
// gate don't fire first.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const psCalls = vi.hoisted(() => ({ variables: [] as Record<string, any>[] }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() { return 'mgraph'; }
    async execute(_task: any, variables: Record<string, any>) {
      psCalls.variables.push({ ...variables });
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

let tmpRoot: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
let stacksim: StacksimEnvHandle;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cui-override-'));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  psCalls.variables = [];
  // AO-20 (2026-09-27): tenant here is kind:'sim' (loopback) — route this process to
  // stacksim so the executor's isStacksimModeActive() fail-closed check doesn't refuse it.
  stacksim = activateStacksimEnv();
});
afterEach(() => {
  closeAllCesRepositories();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tenant(resources: Record<string, string>): TenantConfig {
  const certPath = path.join(tmpRoot, 'cui.pfx');
  fs.writeFileSync(certPath, 'dummy');
  return {
    tenantSlug: 'cui-sim',
    tenantId: 'cui-sim-tenant',
    appId: 'cui-app',
    certPath,
    certThumbprint: 'C0C0000000000000000000000000000000000000',
    domain: 'cui.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: false,
    cuiBoundary: { resourceAllowlist: ['sa-inside-boundary'] },
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'cui-sub',
    resources,
  } as unknown as TenantConfig;
}

// Read-path command (trigger EVIDENCE, no set_command) so the single-command path runs.
const cmd = (id: string) =>
  makeAoCommand({
    id,
    trigger: 'EVIDENCE',
    cmmcPractices: ['SC.L2-3.13.16'],
    parameters: [
      { name: 'storageAccountName', label: 'Storage', type: 'text', source: 'resources.storageAccountName', required: true },
    ] as any,
  });

function rowsFor(commandId: string) {
  return getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r) => r.data?.metadata?.commandId === commandId);
}

describe('FX-AO1: CUI boundary cannot be overridden by the request', () => {
  it('request supplies an out-of-boundary resource for an unresolvable source -> denied_cui row, not SAT, never executed', async () => {
    const result: any = await executeAoCommand(
      cmd('CUI-OVR-01'),
      tenant({}),
      { storageAccountName: 'sa-outside-boundary' },
      false,
      { requestorUPN: 'op@cui.onmicrosoft.us' },
    );
    expect(result.success).toBe(false);
    expect(psCalls.variables).toHaveLength(0);
    const rows = rowsFor('CUI-OVR-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.outcome).toBe('denied_cui');
    expect(rows[0].data.evidence.complianceVerdict).not.toBe('SATISFIED');
  });

  it('request tries to swap an in-boundary tenant resource for an out-of-boundary one -> denied_cui row, never executed', async () => {
    await executeAoCommand(
      cmd('CUI-OVR-02'),
      tenant({ storageAccountName: 'sa-inside-boundary' }),
      { storageAccountName: 'sa-outside-boundary' },
      false,
      { requestorUPN: 'op@cui.onmicrosoft.us' },
    );
    expect(psCalls.variables).toHaveLength(0);
    const rows = rowsFor('CUI-OVR-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.outcome).toBe('denied_cui');
    expect(rows[0].data.evidence.complianceVerdict).not.toBe('SATISFIED');
  });

  it('legitimate in-boundary request still passes and runs against the tenant value', async () => {
    const result: any = await executeAoCommand(
      cmd('CUI-OK-01'),
      tenant({ storageAccountName: 'sa-inside-boundary' }),
      {},
      false,
      { requestorUPN: 'op@cui.onmicrosoft.us' },
    );
    expect(result.success).toBe(true);
    expect(psCalls.variables).toHaveLength(1);
    expect(psCalls.variables[0].storageAccountName).toBe('sa-inside-boundary');
    const rows = rowsFor('CUI-OK-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.outcome).toBe('executed');
  });
});
