// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH5 (V127, V77): every terminal refusal row records the two-person mode
// (evidence.metadata.twoPersonApproval), not only the 428 and rejection rows:
// the sim-only rail, the CMMC scope gate and the unbound-parameter row too.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      return { success: true, stdout: '{}', stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});
vi.mock('../src/execution/AuthChain.js', () => ({
  createExecutionContext: () => ({ executionConfig: { dryRun: true }, sessionFactory: {} }),
}));

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';

let tmpRoot: string;
const KEYS = ['CES_PIPELINE_ROOT', 'AO_CMMC_STRICT', 'CES_AO_ALLOW_LIVE', 'CES_AO_SIM_ONLY', 'CES_TWO_PERSON_APPROVAL'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ph5-2p-'));
  for (const k of KEYS) savedEnv[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  delete process.env.CES_TWO_PERSON_APPROVAL;
});

afterEach(() => {
  closeAllCesRepositories();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeTenant(overrides: Record<string, any> = {}): any {
  return {
    tenantSlug: 't-ph5', tenantId: 'tid-ph5', appId: 'app-ph5', certThumbprint: 'THUMB', certPath: 'C:/certs/t.pfx',
    domain: 'ph5.onmicrosoft.us', endpoints: {}, kind: 'live', ...overrides,
  };
}

function persistedMode(commandId: string): unknown {
  const row = getCesRepository().listAll<any>('adminops_evidence').find((r) => r.data?.metadata?.commandId === commandId);
  expect(row, `row for ${commandId}`).toBeTruthy();
  return row!.data?.evidence?.metadata?.twoPersonApproval?.mode ?? row!.data?.metadata?.twoPersonApproval?.mode;
}

describe('PH5: refusal rows carry the two-person mode', () => {
  it('sim-only rail denial (live tenant, no CES_AO_ALLOW_LIVE) records mode off', async () => {
    const r: any = await executeAoCommand(makeAoCommand({ id: 'X-71' }), makeTenant(), {}, true);
    expect(r.evidence.outcome).toBe('denied_sim_only');
    expect(r.evidence.metadata.twoPersonApproval).toMatchObject({ mode: 'off' });
    expect(persistedMode('X-71')).toBe('off');
  });

  it('CMMC scope denial records the mode (off by default, on when re-enabled)', async () => {
    process.env.CES_AO_ALLOW_LIVE = '1';
    const cmd = makeAoCommand({ id: 'X-72', cmmcPractices: ['AC.L2-3.1.5'] });
    const off: any = await executeAoCommand(cmd, makeTenant({ cmmcLevel: 'L1' }), {}, true);
    expect(off.evidence.outcome).toBe('denied_cmmc');
    expect(off.evidence.metadata.twoPersonApproval).toMatchObject({ mode: 'off' });
    expect(persistedMode('X-72')).toBe('off');
    process.env.CES_TWO_PERSON_APPROVAL = '1';
    const on: any = await executeAoCommand(cmd, makeTenant({ cmmcLevel: 'L1' }), {}, true);
    expect(on.evidence.metadata.twoPersonApproval).toMatchObject({ mode: 'on' });
  });

  it('an unbound tenant-sourced parameter row records the mode', async () => {
    process.env.CES_AO_ALLOW_LIVE = '1';
    const cmd = makeAoCommand({
      id: 'X-73',
      parameters: [{ name: 'publicIpName', label: 'Public IP', type: 'text', source: 'resources.publicIpName', required: true }],
    } as any);
    const r: any = await executeAoCommand(cmd, makeTenant({ cmmcMigrationExempt: true }), {}, true);
    expect(r.error).toMatch(/Parameter binding failed/);
    expect(r.evidence.metadata.twoPersonApproval).toMatchObject({ mode: 'off' });
    expect(persistedMode('X-73')).toBe('off');
  });
});
