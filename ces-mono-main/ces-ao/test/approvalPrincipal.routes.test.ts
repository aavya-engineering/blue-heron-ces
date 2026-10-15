// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO3 (2026-09-27) — authenticated approvers (ces-shared W4-SH1 request principal).
//
// Through the real Express routers (execute + approvals) on 127.0.0.1:0:
//  - an unauthenticated approval decision is 401 and records nothing;
//  - an authenticated decision records the PRINCIPAL as approver (a body
//    approverUPN is ignored), and the executed row carries that principal;
//  - an authenticated requester cannot approve their own Tier-3 request (409),
//    and the requestor is the principal, not a body claim.
// Mocks: the PowerShell boundary and the tenant loader (kind:'sim' loopback).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

const holder = vi.hoisted(() => ({ root: '' }));

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'w4-ao3-sim-tenant',
    appId: 'w4-ao3-app',
    certPath: `${holder.root}/w4.pfx`,
    certThumbprint: 'A3A3000000000000000000000000000000000000',
    domain: 'w4.onmicrosoft.us',
    kind: 'sim',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'w4-sub',
    resources: {},
  }),
}));

import express from 'express';
import { createHs256PrincipalVerifier, signPrincipalToken } from 'ces-shared/http/principal';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { getApprovalRequest } from '../src/execution/ApprovalStore.js';
import { aoPrincipalOptionsFromEnv } from '../src/server/principal.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const SECRET = 'w4-ao3-principal-secret-0001';
const T3_CMD = makeAoCommand({ id: 'W4-T3-01', trigger: 'EVIDENCE', sodTier: 'Tier 3', cmmcPractices: ['AC.L2-3.1.5'] });
const REQUESTOR = 'requestor@w4.onmicrosoft.us';
const APPROVER = 'approver@w4.onmicrosoft.us';

let tmpRoot: string;
let server: Server;
let base: string;
let stacksim: StacksimEnvHandle;
const saved: Record<string, string | undefined> = {};
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE',
  'CES_AO_PRINCIPAL_SECRET', 'CES_AO_DEV_PRINCIPAL_UPN'];

// FC-AO-2: approver tokens are tenant-bound (tid = the approval's tenant, as EO mints them).
const TENANT_ID = 'w4-ao3-sim-tenant';
// FC-AO-3 step 1: approver tokens need the ao-approver role too.
const token = (upn: string, secret = SECRET, tid: string | undefined = TENANT_ID) =>
  signPrincipalToken({ sub: `sub-${upn}`, upn, roles: ['ao-approver'], ...(tid ? { tid } : {}) }, { secret });

async function startApp(approvalsOpts?: Parameters<typeof createApprovalsRouter>[0]) {
  const app = express();
  app.use(express.json());
  const principal = { verifier: createHs256PrincipalVerifier({ secret: SECRET }) };
  app.use('/api', createApprovalsRouter(approvalsOpts ?? { principal }));
  app.use('/api', createExecuteRouter([T3_CMD], { principal }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (url: string, body: unknown, asUpn?: string, rawToken?: string) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(asUpn ? { 'x-ces-principal': token(asUpn) } : {}),
      ...(rawToken ? { 'x-ces-principal': rawToken } : {}),
    },
    body: JSON.stringify(body),
  });

const rows = (commandId: string) =>
  getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r: any) => r.data?.metadata?.commandId === commandId);

async function openTier3(asUpn?: string, bodyRequestor = REQUESTOR): Promise<string> {
  const res = await post(`/api/execute/${T3_CMD.id}`, { tenant: 'w4-sim', inputs: {}, dryRun: false, confirmApply: T3_CMD.id, requestorUPN: bodyRequestor }, asUpn);
  expect(res.status).toBe(202);
  const body: any = await res.json();
  return body.approvalId;
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-w4-ao3-'));
  holder.root = tmpRoot;
  fs.writeFileSync(path.join(tmpRoot, 'w4.pfx'), 'placeholder');
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  for (const k of KEYS.slice(1)) delete process.env[k];
  // AO-20 (2026-09-27): this file's tenant is kind:'sim' (loopback) — the executor now
  // fail-closes on isStacksimModeActive() too, so route this process to stacksim.
  stacksim = activateStacksimEnv();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  stacksim.restore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('W4-AO3 authenticated approvers', () => {
  it('unauthenticated approval decision -> 401 and no decision is recorded (no row)', async () => {
    await startApp();
    const approvalId = await openTier3();
    const before = rows(T3_CMD.id).length; // the pending-approval row

    const res = await post(`/api/approvals/${approvalId}/decision`, { approverUPN: APPROVER, decision: 'approve' });
    expect(res.status).toBe(401);
    const rej = await post(`/api/approvals/${approvalId}/decision`, { approverUPN: APPROVER, decision: 'reject' });
    expect(rej.status).toBe(401);
    const forged = await post(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, undefined, token(APPROVER, 'a-different-secret-000000'));
    expect(forged.status).toBe(401);

    const approval = await getApprovalRequest(approvalId);
    expect(approval?.status).toBe('pending');
    expect(approval?.approverUPN).toBeUndefined();
    expect(rows(T3_CMD.id).length).toBe(before); // no approval_rejected / executed row
  });

  it('no principal configured at all -> decisions fail closed (401)', async () => {
    expect(aoPrincipalOptionsFromEnv({}).verifier).toBeUndefined();
    await startApp({}); // env-derived options, env empty
    const approvalId = await openTier3();
    const res = await post(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, APPROVER);
    expect(res.status).toBe(401);
    expect((await getApprovalRequest(approvalId))?.status).toBe('pending');
  });

  it('authenticated approval -> the row carries the principal (body approverUPN ignored)', async () => {
    await startApp();
    const approvalId = await openTier3();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await post(`/api/approvals/${approvalId}/decision`, { approverUPN: 'forged@w4.onmicrosoft.us', decision: 'approve' }, APPROVER);
    expect(res.status).toBe(200);
    const approval = await getApprovalRequest(approvalId);
    expect(approval?.status).toBe('approved');
    expect(approval?.approverUPN).toBe(APPROVER);
    expect(approval?.approverSubjectId).toBe(`sub-${APPROVER}`);
    expect(approval?.approverVerified).toBe(true);
    expect(approval?.approverPrincipalSource).toBe('token');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('ignoring body approverUPN'))).toBe(true);

    const exec = await post(`/api/execute/${T3_CMD.id}`, { tenant: 'w4-sim', inputs: {}, dryRun: false, confirmApply: T3_CMD.id, requestorUPN: REQUESTOR, approvalId });
    expect(exec.status).toBe(200);
    const executed = rows(T3_CMD.id).filter((r) => r.data.metadata.outcome === 'executed');
    expect(executed).toHaveLength(1);
    expect(executed[0].data.metadata.approverUPN).toBe(APPROVER);
    expect(executed[0].data.metadata.requestorUPN).toBe(REQUESTOR);
  });

  it('an authenticated requester cannot approve their own Tier-3 request (409), and a body requestor claim is ignored', async () => {
    await startApp();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Requester authenticates as REQUESTOR but claims someone else in the body.
    const approvalId = await openTier3(REQUESTOR, 'someone-else@w4.onmicrosoft.us');
    const opened = await getApprovalRequest(approvalId);
    expect(opened?.requestorUPN).toBe(REQUESTOR);
    expect(opened?.requestorAuthenticated).toBe(true);

    const self = await post(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, REQUESTOR);
    expect(self.status).toBe(409);
    expect((await getApprovalRequest(approvalId))?.status).toBe('pending');

    const other = await post(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, APPROVER);
    expect(other.status).toBe(200);
  });

  it('an invalid principal token on execute is refused (401), not silently downgraded', async () => {
    await startApp();
    const res = await post(`/api/execute/${T3_CMD.id}`, { tenant: 'w4-sim', inputs: {}, dryRun: false, confirmApply: T3_CMD.id, requestorUPN: REQUESTOR }, undefined, 'not.a.token');
    expect(res.status).toBe(401);
  });

  it('a Tier-3 request with no requestor is a 400 (was 500)', async () => {
    await startApp();
    const res = await post(`/api/execute/${T3_CMD.id}`, { tenant: 'w4-sim', inputs: {}, dryRun: false, confirmApply: T3_CMD.id });
    expect(res.status).toBe(400);
  });
});
