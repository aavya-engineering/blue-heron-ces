// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO6 (AdminOps evidence contract 1.3.0, ces-shared FX-SH3 03a6d0a): target identity +
// current contract version on persisted rows.
//
// Goes through the production executor (executeAoCommand) with the REAL registry commands
// (getCommand) and reads the persisted adminops_evidence row back from the repository.
// Mocked seam: the PowerShell boundary only. Tenant: kind 'sim', loopback endpoints.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() { return 'mgraph'; }
    async execute(task: any) {
      const body = JSON.stringify({ ok: true });
      // W4-AO1: state reads are marker-delimited; echo the markers as PowerShell would.
      const isStateRead = String(task?.action?.command ?? '').includes('<<AO-STATE-BEGIN>>');
      return { success: true, stdout: isStateRead ? `<<AO-STATE-BEGIN>>
${body}
<<AO-STATE-END>>` : body, stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import {
  AdminOpsEvidenceSchema,
  ADMINOPS_EVIDENCE_CONTRACT_VERSION,
} from 'ces-shared/types/adminops-evidence';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { recordApprovalDecision } from '../src/execution/ApprovalStore.js';
import { verifiedApprover } from './fixtures.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { resolveTargetIdentity } from '../src/execution/TargetIdentity.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

let tmpRoot: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
let stacksim: StacksimEnvHandle;

const TENANT_ID = 'fxao6-sim-tenant';
const OPERATOR = 'operator@fxao6.onmicrosoft.us';
const APPROVER = 'approver@fxao6.onmicrosoft.us';
const LEAVER = 'leaver@fxao6.onmicrosoft.us';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fxao6-'));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): the tenant here is kind:'sim' (loopback) — route this process
  // to stacksim so the executor's isStacksimModeActive() check doesn't refuse it.
  stacksim = activateStacksimEnv();
});
afterEach(() => {
  closeAllCesRepositories();
  stacksim.restore();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function simTenant(overrides: Record<string, unknown> = {}): TenantConfig {
  const certPath = path.join(tmpRoot, 'fxao6.pfx');
  if (!fs.existsSync(certPath)) fs.writeFileSync(certPath, 'dummy');
  return {
    tenantSlug: 'fxao6-sim',
    tenantId: TENANT_ID,
    appId: 'fxao6-app',
    certPath,
    certThumbprint: 'F6F6000000000000000000000000000000000000',
    domain: 'fxao6.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'fxao6-sub',
    resources: { operatorUPN: OPERATOR },
    ...overrides,
  } as unknown as TenantConfig;
}

function rowsFor(commandId: string): any[] {
  return getCesRepository()
    .listAll<any>('adminops_evidence')
    .map((r) => r.data.metadata)
    .filter((m) => m.commandId === commandId);
}

/** Run a real registry command live; if the SoD gate parks it, approve with a second UPN and re-run. */
async function runLive(id: string, inputs: Record<string, unknown>) {
  const cmd = getCommand(id)!;
  expect(cmd, `registry command ${id}`).toBeDefined();
  let res: any = await executeAoCommand(cmd, simTenant(), inputs, false, { requestorUPN: OPERATOR });
  if (res.status === 'pending_approval') {
    await recordApprovalDecision(res.approvalId, verifiedApprover(APPROVER, TENANT_ID), 'approve');
    res = await executeAoCommand(cmd, simTenant(), inputs, false, {
      requestorUPN: OPERATOR,
      approvalId: res.approvalId,
    });
  }
  return res;
}

describe('FX-AO6 — contract 1.3.0 target identity on persisted rows', () => {
  it('A-02 (offboarding disable) live row carries targetUPN of the disabled user, at the current contract version', async () => {
    const res = await runLive('A-02', { upn: LEAVER });
    expect(res.success).toBe(true);
    const executed = rowsFor('A-02').filter((m) => m.outcome === 'executed');
    expect(executed).toHaveLength(1);
    const row = AdminOpsEvidenceSchema.parse(executed[0]);
    expect(row.contractVersion).toBe(ADMINOPS_EVIDENCE_CONTRACT_VERSION);
    expect(row.mode).toBe('live');
    expect(row.targetUPN).toBe(LEAVER);
    // The target is the user acted on, never the operator.
    expect(row.requestorUPN).toBe(OPERATOR);
    expect(row.targetUPN).not.toBe(row.requestorUPN);
    // Every A-02 row persisted on the way (pending included) names the same target.
    for (const m of rowsFor('A-02')) expect(m.targetUPN).toBe(LEAVER);
  });

  it.each([
    ['A-03', { targetUPN: LEAVER, reason: 'FX-AO6 sim termination' }],
    ['B-05', { targetUPN: LEAVER }],
  ])('%s rows carry targetUPN from the targetUPN parameter', async (id, inputs) => {
    await runLive(id, inputs);
    const rows = rowsFor(id);
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) {
      const row = AdminOpsEvidenceSchema.parse(m);
      expect(row.contractVersion).toBe(ADMINOPS_EVIDENCE_CONTRACT_VERSION);
      expect(row.targetUPN).toBe(LEAVER);
      expect(row.targetObjectId).toBeUndefined();
    }
  });

  it('a sim-only refusal row parses as denied_sim_only at the current version, never SAT, target kept', async () => {
    process.env.CES_AO_SIM_ONLY = '1';
    const res: any = await executeAoCommand(getCommand('A-02')!, simTenant({ kind: 'live' }), { upn: LEAVER }, false, {
      requestorUPN: OPERATOR,
    });
    expect(res.success).toBe(false);
    const rows = rowsFor('A-02');
    expect(rows).toHaveLength(1);
    const row = AdminOpsEvidenceSchema.parse(rows[0]);
    expect(row.outcome).toBe('denied_sim_only');
    expect(row.contractVersion).toBe(ADMINOPS_EVIDENCE_CONTRACT_VERSION);
    expect(row.verdict).not.toBe('SAT');
    expect(row.targetUPN).toBe(LEAVER);
  });

  it('operator-identity parameters are never reported as the target', async () => {
    // A-17 declares adminUPN (the new admin account being provisioned by the operator) — not in the allowlist.
    const a17 = getCommand('A-17')!;
    expect(a17.parameters.map((p) => p.name)).toContain('adminUPN');
    expect(resolveTargetIdentity({ adminUPN: 'x@fxao6.onmicrosoft.us' }, a17)).toEqual({});
    // Declared-parameter filter: an undeclared targetUPN in the request is ignored.
    expect(resolveTargetIdentity({ targetUPN: LEAVER }, { parameters: [] } as any)).toEqual({});
    // Blank values are not a target (the schema rejects empty strings).
    expect(resolveTargetIdentity({ upn: '   ' }, getCommand('A-02')!)).toEqual({});
  });
});
