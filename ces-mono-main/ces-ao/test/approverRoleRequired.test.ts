// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-3 step 1 (P0, founder decision 10, 2026-09-28): only an `ao-approver`-role principal
// may decide an approval, on web, CLI and MCP alike. A principal that is otherwise perfectly
// valid (right secret, right tenant, real verified token) but lacks the role is refused with
// a clear reason (APPROVER_ROLE_REQUIRED) — nothing is recorded.
//
// Production code under test: ApprovalStore.recordApprovalDecision / assertApproverRole,
// VerifiedApprover.verifyApproverToken (carries roles through), approvals.routes.ts,
// approveCommand.ts, aoMcpTools.ts. Real temp CES database; no mocks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createHs256PrincipalVerifier } from 'ces-shared/http/principal';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import {
  createApprovalRequest,
  getApprovalRequest,
  recordApprovalDecision,
  ApproverRoleError,
  APPROVER_ROLE_REQUIRED,
} from '../src/execution/ApprovalStore.js';
import { verifyApproverToken } from '../src/execution/VerifiedApprover.js';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { runApproveCommand, type CliIo } from '../src/cli/approveCommand.js';
import { callAoMcpTool } from '../src/mcp/aoMcpTools.js';
import { TEST_PRINCIPAL_SECRET, testPrincipalToken, verifiedApprover } from './fixtures.js';

const TENANT_ID = 'fc-ao-3-role-tenant';
const REQUESTOR = 'requestor@fcao3.onmicrosoft.us';
const APPROVER = 'approver@fcao3.onmicrosoft.us';

let root: string;
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_PRINCIPAL_TOKEN', 'AO_MCP_ALLOW_APPLY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fcao3-role-'));
  process.env.CES_PIPELINE_ROOT = root;
  for (const k of KEYS.slice(1)) delete process.env[k];
});

afterEach(() => {
  closeAllCesRepositories();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

async function pending(): Promise<string> {
  const r = await createApprovalRequest({
    commandId: 'A-03',
    commandTitle: 'Hard delete (FC-AO-3 role test)',
    domain: 'A',
    tenantId: TENANT_ID,
    sodTier: 'Tier 3',
    requestorUPN: REQUESTOR,
    inputs: { targetUPN: 'target@fcao3.onmicrosoft.us' },
    controlIds: ['AC.L2-3.1.5'],
  });
  return r.approvalId;
}

async function expectStillPending(id: string) {
  const a = (await getApprovalRequest(id))!;
  expect(a.status).toBe('pending');
  expect(a.approverUPN).toBeUndefined();
}

describe('FC-AO-3 step 1 store: only an ao-approver-role principal may decide', () => {
  it('refuses a fully-valid token principal with no ao-approver role', async () => {
    const id = await pending();
    const p = verifiedApprover(APPROVER, TENANT_ID, { roles: [] });
    expect(p.roles).toEqual([]);
    const err = await recordApprovalDecision(id, p, 'approve').catch((e) => e);
    expect(err).toBeInstanceOf(ApproverRoleError);
    expect(err.code).toBe(APPROVER_ROLE_REQUIRED);
    expect(err.message).toMatch(/ao-approver/);
    await expectStillPending(id);
  });

  it('refuses a token with an unrelated role, on rejection too', async () => {
    const id = await pending();
    const p = verifiedApprover(APPROVER, TENANT_ID, { roles: ['some-other-role'] });
    await expect(recordApprovalDecision(id, p, 'reject', 'x')).rejects.toThrow(APPROVER_ROLE_REQUIRED);
    await expectStillPending(id);
  });

  it('accepts a token that carries the ao-approver role', async () => {
    const id = await pending();
    const p = verifiedApprover(APPROVER, TENANT_ID);
    const a = await recordApprovalDecision(id, p, 'approve');
    expect(a.status).toBe('approved');
  });
});

describe('FC-AO-3 step 1 web: POST /api/approvals/:id/decision', () => {
  let server: Server;
  let base: string;
  const SECRET = 'fc-ao-3-role-web-secret';

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApprovalsRouter({ principal: { verifier: createHs256PrincipalVerifier({ secret: SECRET }) } }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const decide = (id: string, token: string) =>
    fetch(`${base}/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ces-principal': token },
      body: JSON.stringify({ decision: 'approve' }),
    });

  it('403 APPROVER_ROLE_REQUIRED for a verified token with no ao-approver role', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, SECRET, TENANT_ID, { roles: [] });
    const res = await decide(id, token);
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe(APPROVER_ROLE_REQUIRED);
    await expectStillPending(id);
  });

  it('200 for a verified token with the ao-approver role', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, SECRET, TENANT_ID);
    const res = await decide(id, token);
    expect(res.status).toBe(200);
    expect((await getApprovalRequest(id))!.status).toBe('approved');
  });
});

describe('FC-AO-3 step 1 CLI: `ao approve` needs the ao-approver role', () => {
  function io(env: NodeJS.ProcessEnv): CliIo & { errLines: string[] } {
    const errLines: string[] = [];
    return { env, out: () => undefined, err: (l) => errLines.push(l), errLines };
  }
  const configured = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET, ...extra });

  it('refuses a role-less token (exit 1); nothing is recorded', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { roles: [] });
    const c = io(configured({ CES_AO_PRINCIPAL_TOKEN: token }));
    expect(await runApproveCommand(id, {}, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(APPROVER_ROLE_REQUIRED);
    await expectStillPending(id);
  });

  it('succeeds with an ao-approver-role token', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID);
    const c = io(configured({ CES_AO_PRINCIPAL_TOKEN: token }));
    expect(await runApproveCommand(id, {}, c)).toBe(0);
    expect((await getApprovalRequest(id))!.status).toBe('approved');
  });
});

describe('FC-AO-3 step 1 MCP: `ao_approve` needs the ao-approver role', () => {
  const env = (extra: NodeJS.ProcessEnv = {}) => ({ AO_MCP_ALLOW_APPLY: '1', CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET, ...extra });

  it('rejects a role-less token; nothing is recorded', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { roles: [] });
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, principalToken: token }, { env: env() })
    ).rejects.toThrow(APPROVER_ROLE_REQUIRED);
    await expectStillPending(id);
  });

  it('succeeds with an ao-approver-role token', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID);
    const res = await callAoMcpTool('ao_approve', { approvalId: id, principalToken: token }, { env: env() });
    expect(res.decision).toBe('approve');
  });
});

describe('FC-AO-3 step 1: verifyApproverToken carries roles through', () => {
  it('a role-less token yields an ApproverPrincipal with an empty roles array', () => {
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { roles: [] });
    const p = verifyApproverToken(token, { CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET });
    expect(p.roles).toEqual([]);
  });

  it('a token with roles yields an ApproverPrincipal carrying them', () => {
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { roles: ['ao-approver', 'other'] });
    const p = verifyApproverToken(token, { CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET });
    expect(p.roles).toEqual(['ao-approver', 'other']);
  });
});
