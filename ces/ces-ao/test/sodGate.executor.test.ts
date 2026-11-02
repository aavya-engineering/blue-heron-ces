// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-3b: the manual separation-of-duties gate (SodGate.assertManualGateCleared) is wired into
// CommandExecutor. A gated command with an approval id runs only when the RECORDED decision is a
// second person's; a refusal is a terminal, evidenced denial returned to the caller (never a
// throw), and the web route maps it to 403 rather than a 500 crash. Real temp CES database;
// the only mocks are the PowerShell boundary and the route's tenant loader.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// W9-C1: two-person approval is OFF by default; these tests cover the re-enabled path.
process.env.CES_TWO_PERSON_APPROVAL = '1';

const holder = vi.hoisted(() => ({ root: '', executed: 0 }));

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      holder.executed++;
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'ao3b-sim-tenant',
    appId: 'ao3b-app',
    certPath: `${holder.root}/ao3b.pfx`,
    certThumbprint: 'A3B0000000000000000000000000000000000000',
    domain: 'ao3b.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'ao3b-sub',
    resources: {},
  }),
}));

import express from 'express';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { recordApprovalDecision, getApprovalRequest } from '../src/execution/ApprovalStore.js';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { TenantConfig } from 'ces-shared/config';
import { makeAoCommand, verifiedApprover } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const TENANT_ID = 'ao3b-sim-tenant';
const T3 = makeAoCommand({ id: 'AO3B-T3-01', trigger: 'EVIDENCE', sodTier: 'Tier 3', cmmcPractices: ['AC.L2-3.1.5'] });
const REQUESTOR = 'requestor@ao3b.onmicrosoft.us';
const APPROVER = 'approver@ao3b.onmicrosoft.us';
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
const saved: Record<string, string | undefined> = {};
let stacksim: StacksimEnvHandle;
let server: Server | undefined;

function simTenant(): TenantConfig {
  return {
    tenantSlug: 'ao3b-sim',
    tenantId: TENANT_ID,
    appId: 'ao3b-app',
    certPath: path.join(holder.root, 'ao3b.pfx'),
    certThumbprint: 'A3B0000000000000000000000000000000000000',
    domain: 'ao3b.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'ao3b-sub',
    resources: {},
  } as unknown as TenantConfig;
}

const rows = () =>
  getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r: any) => r.data?.metadata?.commandId === T3.id);

async function openRequest(): Promise<string> {
  const pending: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR });
  expect(pending.status).toBe('pending_approval');
  return pending.approvalId;
}

async function tamper(id: string, patch: Record<string, unknown>) {
  const a: any = await getApprovalRequest(id);
  getCesRepository().put('adminops_approvals', { id, ces: a.ces ?? { tenantId: TENANT_ID }, data: { ...a, ...patch } });
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  holder.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-ao3b-'));
  holder.executed = 0;
  fs.writeFileSync(path.join(holder.root, 'ao3b.pfx'), 'placeholder');
  process.env.CES_PIPELINE_ROOT = holder.root;
  for (const k of KEYS.slice(1)) delete process.env[k];
  stacksim = activateStacksimEnv();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  closeAllCesRepositories();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(holder.root, { recursive: true, force: true });
});

describe('AO-3b: CommandExecutor calls the manual SoD gate before applying', () => {
  it('a second person approval clears the gate and the command runs', async () => {
    const id = await openRequest();
    await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'approve');
    const res: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR, approvalId: id });
    expect(res.success, res.error).toBe(true);
    expect(holder.executed).toBeGreaterThan(0);
  });

  it('approved record whose approver is the requestor -> evidenced refusal, no throw, nothing runs', async () => {
    const id = await openRequest();
    await tamper(id, { status: 'approved', approverUPN: ` ${REQUESTOR.toUpperCase()} `, decidedAt: new Date().toISOString() });
    const res: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR, approvalId: id });
    expect(res.success).toBe(false);
    expect('status' in res).toBe(false);
    expect(res.error).toMatch(/Manual separation-of-duties gate refused command AO3B-T3-01 \(permission denied\)/);
    expect(res.error).toMatch(/Separation-of-duties violation/);
    expect(holder.executed).toBe(0);
    expect(res.evidencePersisted).toBe(true);
    expect(res.evidence.outcome).toBe('blocked_pending_approval');
    expect(rows().filter((r: any) => r.data.metadata.approvalId === id)).toHaveLength(1);
    expect((await getApprovalRequest(id))?.status).toBe('approved'); // not consumed
  });

  it('approved record with no recorded approver -> refused', async () => {
    const id = await openRequest();
    await tamper(id, { status: 'approved', approverUPN: undefined, decidedAt: undefined });
    const res: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR, approvalId: id });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no recorded second-person decision/);
    expect(holder.executed).toBe(0);
  });

  it('pending (undecided) and unknown approval ids -> refused, not thrown', async () => {
    const id = await openRequest();
    const pending: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR, approvalId: id });
    expect(pending.success).toBe(false);
    expect(pending.error).toMatch(/not in 'approved' status/);
    const unknown: any = await executeAoCommand(T3, simTenant(), {}, false, { requestorUPN: REQUESTOR, approvalId: 'no-such-approval' });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toMatch(/not found/);
    expect(holder.executed).toBe(0);
  });

  it('dry run without an approval id still opens a pending request (unchanged)', async () => {
    const res: any = await executeAoCommand(T3, simTenant(), {}, true, { requestorUPN: REQUESTOR });
    expect(res.status).toBe('pending_approval');
    expect(holder.executed).toBe(0);
  });

  it('web route maps a gate refusal to 403, not a 500 crash', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createExecuteRouter([T3]));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const id = await openRequest();
    await tamper(id, { status: 'approved', approverUPN: REQUESTOR, decidedAt: new Date().toISOString() });
    const res = await fetch(`${base}/api/execute/${T3.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'ao3b-sim', inputs: {}, dryRun: false, confirmApply: T3.id, requestorUPN: REQUESTOR, approvalId: id }),
    });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.result.error).toMatch(/Separation-of-duties violation/);
    expect(holder.executed).toBe(0);
  });
});
