// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-2 step 2 (X1, founder decision 2026-09-27 #8): a write with no observed change.
//
// Policy: demote to NOT_SAT ONLY when the command's idempotency class means "always mutates"
// (unsafe_requires_gate / unsafe) and the paired read shows no change (stateChanged === false).
// Idempotent classes (get-then-set, evidence-only, best_effort, safe) are unchanged: an
// unchanged state can legitimately mean "already in the target state".
//
// Drives the REAL persist path (executeAoCommand -> GetThenSetExecutor -> EvidenceEmitter ->
// CesRepository) with a kind:'sim' loopback tenant. The ONLY mock is the PowerShell boundary:
// a tiny stateful "tenant" whose state reads return the current value and whose set either
// changes it or not. Each persisted row is read back and parsed with the shared schema.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const holder = vi.hoisted(() => ({ state: 'v0', setChanges: true, failStateRead: false }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(task: any) {
      const command: string = task?.action?.command ?? '';
      if (command.includes('<<AO-STATE-BEGIN>>')) {
        if (holder.failStateRead) return { success: false, stdout: '', stderr: 'state read boom', exit_code: 1, error: 'state read boom' };
        return {
          success: true,
          stdout: `<<AO-STATE-BEGIN>>\r\n${JSON.stringify({ value: holder.state })}\r\n<<AO-STATE-END>>\r\nSTAMPER_EXECUTION_SUCCESS\r\n`,
          stderr: '',
          exit_code: 0,
        };
      }
      if (holder.setChanges) holder.state = `${holder.state}-changed`;
      return { success: true, stdout: 'set ok\r\nSTAMPER_EXECUTION_SUCCESS\r\n', stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

// Synthetic write commands (ids X1-*), each with a get + set template.
vi.mock('../src/registry/TemplateRegistry.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, any>>();
  return {
    ...orig,
    getCommandTemplates: (id: string) =>
      id.startsWith('X1-')
        ? { get_command: "Get-MgUser -UserId 'x1@x1.onmicrosoft.us' | Select-Object Id", set_command: "Update-MgUser -UserId 'x1@x1.onmicrosoft.us' -AccountEnabled:$false" }
        : orig.getCommandTemplates(id),
  };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { recordApprovalDecision } from '../src/execution/ApprovalStore.js';
import { NO_OBSERVED_CHANGE_RATIONALE, ALWAYS_MUTATE_IDEMPOTENCY_CLASSES } from '../src/execution/EvidenceEmitter.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceSchema } from 'ces-shared/types/adminops-evidence';
import { makeAoCommand, verifiedApprover } from './fixtures.js';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const TENANT_ID = 'x1-sim-tenant';
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
const saved: Record<string, string | undefined> = {};
let root: string;
let stacksim: StacksimEnvHandle;

function simTenant(): TenantConfig {
  const certPath = path.join(root, 'x1.pfx');
  fs.writeFileSync(certPath, 'dummy-cert');
  return {
    tenantSlug: 'x1-sim',
    tenantId: TENANT_ID,
    appId: 'x1-app-id',
    certPath,
    certThumbprint: 'E1E1000000000000000000000000000000000000',
    domain: 'x1.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'x1-sub',
    resources: {},
  } as unknown as TenantConfig;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-x1-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  stacksim = activateStacksimEnv();
  holder.state = 'v0';
  holder.setChanges = true;
  holder.failStateRead = false;
});

afterEach(() => {
  closeAllCesRepositories();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(root, { recursive: true, force: true });
});

function rowFor(id: string) {
  const rows = getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r) => r.data?.metadata?.commandId === id && r.data?.metadata?.outcome !== 'blocked_pending_approval');
  expect(rows).toHaveLength(1);
  const parsed = AdminOpsEvidenceSchema.safeParse(rows[0].data.metadata);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return { metadata: parsed.data!, evidence: rows[0].data.evidence };
}

/** Tier-2 write-shaped command (CONFIG trigger) of the given idempotency class, run live. */
async function liveWrite(id: string, idempotencyClass: string, setChanges: boolean) {
  holder.setChanges = setChanges;
  const cmd = makeAoCommand({ id, trigger: 'CONFIG', idempotencyClass, cmmcPractices: ['AC.L1-3.1.1'] } as any);
  const res: any = await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@x1.onmicrosoft.us' });
  expect(res.success, res.error).toBe(true);
  return rowFor(id);
}

/** Tier-3 always-mutate command through the real two-person approval, run live. */
async function approvedTier3Write(id: string, setChanges: boolean) {
  holder.setChanges = setChanges;
  const cmd = makeAoCommand({ id, trigger: 'OFFBOARDING', sodTier: 'Tier 3', idempotencyClass: 'unsafe_requires_gate', cmmcPractices: ['AC.L2-3.1.5'] } as any);
  const pending: any = await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@x1.onmicrosoft.us' });
  expect(pending.status).toBe('pending_approval');
  await recordApprovalDecision(pending.approvalId, verifiedApprover('approver@x1.onmicrosoft.us', TENANT_ID), 'approve');
  const res: any = await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@x1.onmicrosoft.us', approvalId: pending.approvalId });
  expect(res.success, res.error).toBe(true);
  return rowFor(id);
}

describe('FC-AO-2 X1: always-mutate writes with no observed change are NOT_SAT', () => {
  it('the always-mutate classes are exactly unsafe_requires_gate and unsafe', () => {
    expect([...ALWAYS_MUTATE_IDEMPOTENCY_CLASSES].sort()).toEqual(['unsafe', 'unsafe_requires_gate']);
  });

  it('Tier-3 unsafe_requires_gate write, paired read unchanged -> NOT_SAT with the no-change reason', async () => {
    const { metadata, evidence } = await approvedTier3Write('X1-T3-NOCHANGE', false);
    expect(metadata.mode).toBe('live');
    expect(evidence.metadata.setApplied).toBe(true);
    expect(evidence.metadata.stateChanged).toBe(false);
    expect(metadata.verdict).toBe('NOT_SAT');
    expect(metadata.verdictRationale).toBe(NO_OBSERVED_CHANGE_RATIONALE);
  });

  it('Tier-3 unsafe_requires_gate write, paired read changed -> SAT (control)', async () => {
    const { metadata, evidence } = await approvedTier3Write('X1-T3-CHANGE', true);
    expect(evidence.metadata.stateChanged).toBe(true);
    expect(metadata.verdict).toBe('SAT');
  });

  it("Stamper's 'unsafe' class, no change -> NOT_SAT", async () => {
    const { metadata } = await liveWrite('X1-UNSAFE-NOCHANGE', 'unsafe', false);
    expect(metadata.verdict).toBe('NOT_SAT');
    expect(metadata.verdictRationale).toBe(NO_OBSERVED_CHANGE_RATIONALE);
  });

  it('a missing snapshot (stateChanged undefined) is not "no change": not demoted by X1', async () => {
    holder.failStateRead = true;
    holder.setChanges = false;
    const cmd = makeAoCommand({ id: 'X1-UNSAFE-NOREAD', trigger: 'CONFIG', idempotencyClass: 'unsafe', cmmcPractices: ['AC.L1-3.1.1'] } as any);
    await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@x1.onmicrosoft.us' });
    const { metadata, evidence } = rowFor('X1-UNSAFE-NOREAD');
    expect(evidence.metadata.stateChanged).toBeUndefined();
    expect(metadata.verdictRationale).not.toBe(NO_OBSERVED_CHANGE_RATIONALE);
  });
});

describe('FC-AO-2 X1: idempotent classes are unchanged (no change can mean "already compliant")', () => {
  for (const cls of ['get-then-set', 'evidence-only', 'best_effort', 'safe']) {
    it(`${cls} write, paired read unchanged -> still SAT`, async () => {
      const { metadata, evidence } = await liveWrite(`X1-IDEM-${cls.toUpperCase()}`, cls, false);
      expect(evidence.metadata.setApplied).toBe(true);
      expect(evidence.metadata.stateChanged).toBe(false);
      expect(metadata.verdict).toBe('SAT');
      expect(metadata.verdictRationale).not.toBe(NO_OBSERVED_CHANGE_RATIONALE);
    });
  }
});
