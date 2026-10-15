// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A2 (route level): the approval-rejection and correlation round trips through the real
// Express routers, not just the underlying functions.
//
//  1. POST /api/approvals/:id/decision {decision:'reject'} → exactly one persisted
//     adminops_evidence row: approval_rejected, live (F-4), verdict ≠ SAT, approver set.
//  2. POST /api/execute/:commandId with a body correlationId → the response echoes it and
//     the persisted row carries it.
//
// The routers are mounted on a throwaway express app listening on 127.0.0.1:0 (loopback
// only). Mocks: the PowerShell boundary, and the tenant loader (returns a sim tenant) —
// no real tenant or network. Temp CES_PIPELINE_ROOT per test.

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

const tenantHolder = vi.hoisted(() => ({ root: '' }));
vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'route-sim-tenant',
    appId: 'route-app-id',
    certPath: `${tenantHolder.root}/route.pfx`,
    certThumbprint: 'B0B0000000000000000000000000000000000000',
    domain: 'route.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'route-sub',
    resources: {},
  }),
}));

import express from 'express';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { createHs256PrincipalVerifier, signPrincipalToken } from 'ces-shared/http/principal';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { createApprovalRequest } from '../src/execution/ApprovalStore.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

let tmpRoot: string;
let server: Server;
let base: string;
let stacksim: StacksimEnvHandle;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY'] as const;

const CORR_CMD = makeAoCommand({ id: 'ROUTE-CORR-01', cmmcPractices: ['AC.L1-3.1.1'] });

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-routes-'));
  tenantHolder.root = tmpRoot;
  fs.writeFileSync(path.join(tmpRoot, 'route.pfx'), 'dummy');
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  // AO-20 (2026-09-27): the tenant here is kind:'sim' (loopback) — route this process
  // to stacksim so the executor's isStacksimModeActive() check doesn't refuse it.
  stacksim = activateStacksimEnv();

  const app = express();
  app.use(express.json());
  // W4-AO3: decisions require an authenticated principal; the test approver signs in with a token.
  app.use('/api', createApprovalsRouter({ principal: { verifier: createHs256PrincipalVerifier({ secret: PRINCIPAL_SECRET }) } }));
  app.use('/api', createExecuteRouter([CORR_CMD]));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  stacksim.restore();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const PRINCIPAL_SECRET = 'ao-route-test-principal-secret';
/** W4-AO3: a decision body's approverUPN is the UPN the caller authenticates as (x-ces-principal token). */
const post = (url: string, body: any) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (url.endsWith('/decision') && body?.approverUPN) {
    headers['x-ces-principal'] = signPrincipalToken(
      // FC-AO-2: approver tokens are tenant-bound; this file's tenant is 'route-sim-tenant'.
      // FC-AO-3 step 1: approver tokens need the ao-approver role too.
      { sub: `sub:${body.approverUPN}`, upn: body.approverUPN, roles: ['ao-approver'], tid: 'route-sim-tenant' },
      { secret: PRINCIPAL_SECRET },
    );
  }
  return fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
};

describe('Approval rejection through the route (A2)', () => {
  it('POST /api/approvals/:id/decision reject → one approval_rejected row, live, verdict ≠ SAT', async () => {
    const request = await createApprovalRequest({
      commandId: 'ROUTE-T3-01',
      commandTitle: 'Route Tier 3',
      domain: 'A',
      tenantId: 'route-sim-tenant',
      sodTier: 'Tier 3',
      requestorUPN: 'requestor@route.onmicrosoft.us',
      inputs: {},
      controlIds: ['AC.L2-3.1.5'],
    });

    const res = await post(`/api/approvals/${request.approvalId}/decision`, {
      approverUPN: 'approver@route.onmicrosoft.us',
      decision: 'reject',
      reason: 'route-level rejection',
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.approval.status).toBe('rejected');

    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === 'ROUTE-T3-01');
    expect(rows.length).toBe(1);
    const m = rows[0].data.metadata;
    expect(m.outcome).toBe('approval_rejected');
    expect(m.mode).toBe('live');
    expect(m.dryRun).toBe(false);
    expect(m.verdict).not.toBe('SAT');
    expect(m.approverUPN).toBe('approver@route.onmicrosoft.us');
    expect(m.approvalId).toBe(request.approvalId);
  });

  it('a self-approval (SoD violation) is refused with 409 and writes no evidence row', async () => {
    const request = await createApprovalRequest({
      commandId: 'ROUTE-T3-02',
      commandTitle: 'Route Tier 3',
      domain: 'A',
      tenantId: 'route-sim-tenant',
      sodTier: 'Tier 3',
      requestorUPN: 'requestor@route.onmicrosoft.us',
      inputs: {},
      controlIds: ['AC.L2-3.1.5'],
    });
    const res = await post(`/api/approvals/${request.approvalId}/decision`, {
      approverUPN: 'requestor@route.onmicrosoft.us',
      decision: 'reject',
    });
    expect(res.status).toBe(409);
    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === 'ROUTE-T3-02');
    expect(rows.length).toBe(0);
  });
});

describe('Correlation round trip through the execute route (A2)', () => {
  it('POST /api/execute/:commandId echoes the body correlationId and persists it', async () => {
    const corr = 'route-corr-7f3a';
    const res = await post(`/api/execute/${CORR_CMD.id}`, {
      tenant: 'route-sim',
      inputs: {},
      dryRun: true,
      requestorUPN: 'operator@route.onmicrosoft.us',
      correlationId: corr,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.correlationId).toBe(corr);

    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === CORR_CMD.id);
    expect(rows.length).toBe(1);
    expect(rows[0].data.metadata.correlationId).toBe(corr);
    expect(rows[0].data.metadata.outcome).toBe('dry_run');
  });
});
