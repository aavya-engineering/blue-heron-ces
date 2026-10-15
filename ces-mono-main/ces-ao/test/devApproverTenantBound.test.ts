// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-3 step 2 (founder decision 10, 2026-09-28): the explicit loopback dev approver
// (CES_AO_DEV_PRINCIPAL_UPN, web-loopback only, verified:false) is now bound to a tenant too
// (CES_AO_DEV_PRINCIPAL_TENANT) — it can only decide approvals on THAT tenant, the same
// fail-closed shape FC-AO-2 gave a real approver token. UPN configured with no tenant
// configured fails closed (the dev principal decides nothing).
//
// Production code under test: src/server/principal.ts (aoPrincipalOptionsFromEnv,
// withDevApproverTenant), ApprovalStore.assertApproverTenant (generalized off `source==='token'`
// in this same wave), approvals.routes.ts. Real Express router, loopback (127.0.0.1) requests
// only — matches how ces-shared's requirePrincipal recognizes a dev-eligible request.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import {
  createApprovalRequest,
  getApprovalRequest,
  TOKEN_TENANT_MISMATCH,
} from '../src/execution/ApprovalStore.js';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { aoPrincipalOptionsFromEnv, withDevApproverTenant } from '../src/server/principal.js';

const TENANT_A = 'fc-ao-3-dev-tenant-a';
const TENANT_B = 'fc-ao-3-dev-tenant-b';
const REQUESTOR = 'requestor@fcao3dev.onmicrosoft.us';
const DEV_UPN = 'dev-approver@fcao3dev.onmicrosoft.us';

let root: string;
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_DEV_PRINCIPAL_UPN', 'CES_AO_DEV_PRINCIPAL_TENANT'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fcao3-devtenant-'));
  process.env.CES_PIPELINE_ROOT = root;
  for (const k of KEYS.slice(1)) delete process.env[k];
  process.env.CES_AO_DEV_PRINCIPAL_UPN = DEV_UPN;
});

afterEach(() => {
  closeAllCesRepositories();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

async function pendingOn(tenantId: string): Promise<string> {
  const r = await createApprovalRequest({
    commandId: 'A-03',
    commandTitle: 'Hard delete (FC-AO-3 dev tenant test)',
    domain: 'A',
    tenantId,
    sodTier: 'Tier 3',
    requestorUPN: REQUESTOR,
    inputs: { targetUPN: 'target@fcao3dev.onmicrosoft.us' },
    controlIds: ['AC.L2-3.1.5'],
  });
  return r.approvalId;
}

describe('FC-AO-3 step 2 unit: withDevApproverTenant', () => {
  it('leaves a token principal unchanged', () => {
    const p = { source: 'token' as const, tenantId: 'x' };
    expect(withDevApproverTenant(p, { CES_AO_DEV_PRINCIPAL_TENANT: 'y' })).toBe(p);
  });

  it('attaches the configured tenant to the dev principal', () => {
    const p = { source: 'dev-unverified' as const };
    expect(withDevApproverTenant(p, { CES_AO_DEV_PRINCIPAL_TENANT: TENANT_A })).toEqual({ ...p, tenantId: TENANT_A });
  });

  it('leaves the dev principal without a tenant when none is configured', () => {
    const p = { source: 'dev-unverified' as const };
    expect(withDevApproverTenant(p, {})).toBe(p);
  });
});

describe('FC-AO-3 step 2 web: the dev loopback approver is tenant-bound', () => {
  let server: Server;
  let base: string;

  async function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', createApprovalsRouter({ principal: aoPrincipalOptionsFromEnv() }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const decide = (id: string, decision = 'approve') =>
    fetch(`${base}/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // no x-ces-principal => loopback dev principal
      body: JSON.stringify({ decision }),
    });

  it('CES_AO_DEV_PRINCIPAL_UPN with NO tenant configured fails closed (403), nothing recorded', async () => {
    await startApp();
    const id = await pendingOn(TENANT_A);
    const res = await decide(id);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe(TOKEN_TENANT_MISMATCH);
    expect((await getApprovalRequest(id))!.status).toBe('pending');
  });

  it('a dev principal bound to tenant A cannot decide a tenant-B approval', async () => {
    process.env.CES_AO_DEV_PRINCIPAL_TENANT = TENANT_A;
    await startApp();
    const id = await pendingOn(TENANT_B);
    const res = await decide(id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe(TOKEN_TENANT_MISMATCH);
    expect((await getApprovalRequest(id))!.status).toBe('pending');
  });

  it('a dev principal bound to tenant A decides a tenant-A approval (still verified:false)', async () => {
    process.env.CES_AO_DEV_PRINCIPAL_TENANT = TENANT_A;
    await startApp();
    const id = await pendingOn(TENANT_A);
    const res = await decide(id);
    expect(res.status).toBe(200);
    const a = (await getApprovalRequest(id))!;
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(DEV_UPN);
    expect(a.approverVerified).toBe(false);
    expect(a.approverPrincipalSource).toBe('dev-unverified');
    expect(a.approverTenantId).toBe(TENANT_A);
  });

  it('rejection is tenant-bound the same way', async () => {
    process.env.CES_AO_DEV_PRINCIPAL_TENANT = TENANT_A;
    await startApp();
    const id = await pendingOn(TENANT_B);
    const res = await decide(id, 'reject');
    expect(res.status).toBe(403);
    expect((await getApprovalRequest(id))!.status).toBe('pending');
  });
});
