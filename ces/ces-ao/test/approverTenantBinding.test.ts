// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-2 step 1 (P0, security, 2026-09-28): approver tokens are TENANT-BOUND.
//
// EvidenceOps mints AdminOps approver tokens that carry the tenant they were minted for
// (`tid`, ces-eo ApproverTokenIssuer; REQ ces-eo/docs/requirements/REQ-ces-ao-approver-token-tenant-binding.md).
// A token minted for tenant A must never decide an approval on tenant B — on ANY surface:
//   - web:  POST /api/approvals/:id/decision (x-ces-principal)        -> 403 TOKEN_TENANT_MISMATCH
//   - CLI:  `ao approve` (runApproveCommand, CES_AO_PRINCIPAL_TOKEN)   -> exit 1
//   - MCP:  `ao_approve` (callAoMcpTool, principalToken)               -> throws
// and a token with NO tenant claim is refused too (fail closed). A same-tenant token succeeds.
//
// Production code under test: ApprovalStore.recordApprovalDecision / assertApproverTenant,
// VerifiedApprover.verifyApproverToken, approvals.routes.ts, approveCommand.ts, aoMcpTools.ts.
// Real temp CES database, real Express router on 127.0.0.1:0; no mocks. Tokens are signed
// with the ces-shared signer in EO's claim shape (sub, upn, roles:['ao-approver'], tid, jti).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createHs256PrincipalVerifier, signPrincipalToken } from 'ces-shared/http/principal';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import {
  createApprovalRequest,
  getApprovalRequest,
  recordApprovalDecision,
  ApprovalTenantMismatchError,
  TOKEN_TENANT_MISMATCH,
} from '../src/execution/ApprovalStore.js';
import { verifyApproverToken } from '../src/execution/VerifiedApprover.js';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { runApproveCommand, type CliIo } from '../src/cli/approveCommand.js';
import { callAoMcpTool } from '../src/mcp/aoMcpTools.js';

const SECRET = 'fc-ao-2-tenant-binding-secret-0001';
const TENANT_A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUESTOR = 'requestor@fcao2.onmicrosoft.us';
const APPROVER = 'approver@fcao2.onmicrosoft.us';

/** An approver token in EO's minted shape, for `tid` (omit `tid` to mint an unbound token). */
function eoToken(upn: string, tid?: string): string {
  return signPrincipalToken(
    {
      sub: `ao-approver:${upn}`,
      upn,
      roles: ['ao-approver'],
      ...(tid ? { tid } : {}),
      ...({ jti: `mint-${Math.random().toString(36).slice(2)}` } as object),
    },
    { secret: SECRET, ttlSeconds: 900 },
  );
}

let root: string;
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_PRINCIPAL_TOKEN', 'AO_MCP_ALLOW_APPLY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fcao2-tenant-'));
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

async function pendingOn(tenantId: string): Promise<string> {
  const r = await createApprovalRequest({
    commandId: 'A-03',
    commandTitle: 'Hard delete (FC-AO-2 tenant binding)',
    domain: 'A',
    tenantId,
    sodTier: 'Tier 3',
    requestorUPN: REQUESTOR,
    inputs: { targetUPN: 'target@fcao2.onmicrosoft.us' },
    controlIds: ['AC.L2-3.1.5'],
  });
  return r.approvalId;
}

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ CES_AO_PRINCIPAL_SECRET: SECRET, ...extra });

async function expectStillPending(id: string) {
  const a = (await getApprovalRequest(id))!;
  expect(a.status).toBe('pending');
  expect(a.approverUPN).toBeUndefined();
  expect(a.decidedAt).toBeUndefined();
}

describe('FC-AO-2 store: the decision is bound to the token tenant', () => {
  it('verifyApproverToken carries the token tid', () => {
    expect(verifyApproverToken(eoToken(APPROVER, TENANT_A), env()).tenantId).toBe(TENANT_A);
  });

  it('refuses a tenant-A token on a tenant-B approval (nothing recorded)', async () => {
    const id = await pendingOn(TENANT_B);
    const p = verifyApproverToken(eoToken(APPROVER, TENANT_A), env());
    const err = await recordApprovalDecision(id, p, 'approve').catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalTenantMismatchError);
    expect(err.code).toBe(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('refuses a tenant-A token REJECTING a tenant-B approval too', async () => {
    const id = await pendingOn(TENANT_B);
    const p = verifyApproverToken(eoToken(APPROVER, TENANT_A), env());
    await expect(recordApprovalDecision(id, p, 'reject', 'x')).rejects.toThrow(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('refuses a token with no tenant claim (fail closed)', async () => {
    const id = await pendingOn(TENANT_A);
    const p = verifyApproverToken(eoToken(APPROVER), env());
    await expect(recordApprovalDecision(id, p, 'approve')).rejects.toThrow(/no tenant \(tid\) claim/);
    await expectStillPending(id);
  });

  it('accepts a same-tenant token (case-insensitive) and records the token tenant', async () => {
    const id = await pendingOn(TENANT_A);
    const p = verifyApproverToken(eoToken(APPROVER, TENANT_A.toUpperCase()), env());
    const a = await recordApprovalDecision(id, p, 'approve');
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(APPROVER);
    expect((await getApprovalRequest(id))!.approverTenantId).toBe(TENANT_A.toUpperCase());
  });

  it('the tenant check does not bypass SoD: a same-tenant self-approval is still refused', async () => {
    const id = await pendingOn(TENANT_A);
    const p = verifyApproverToken(eoToken(REQUESTOR, TENANT_A), env());
    await expect(recordApprovalDecision(id, p, 'approve')).rejects.toThrow(/Separation-of-duties/);
    await expectStillPending(id);
  });
});

describe('FC-AO-2 web: POST /api/approvals/:id/decision', () => {
  let server: Server;
  let base: string;

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

  const decide = (id: string, token: string, decision = 'approve') =>
    fetch(`${base}/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ces-principal': token },
      body: JSON.stringify({ decision, reason: 'fc-ao-2' }),
    });

  it('403 TOKEN_TENANT_MISMATCH for a tenant-A token on a tenant-B approval', async () => {
    const id = await pendingOn(TENANT_B);
    const res = await decide(id, eoToken(APPROVER, TENANT_A));
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('403 for a cross-tenant rejection and for a token with no tenant claim', async () => {
    const id = await pendingOn(TENANT_B);
    expect((await decide(id, eoToken(APPROVER, TENANT_A), 'reject')).status).toBe(403);
    expect((await decide(id, eoToken(APPROVER))).status).toBe(403);
    await expectStillPending(id);
  });

  it('200 for a same-tenant token; the approval records the principal and its tenant', async () => {
    const id = await pendingOn(TENANT_B);
    const res = await decide(id, eoToken(APPROVER, TENANT_B));
    expect(res.status).toBe(200);
    const a = (await getApprovalRequest(id))!;
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(APPROVER);
    expect(a.approverTenantId).toBe(TENANT_B);
  });
});

describe('FC-AO-2 CLI: `ao approve`', () => {
  function io(e: NodeJS.ProcessEnv): CliIo & { errLines: string[] } {
    const errLines: string[] = [];
    return { env: e, out: () => undefined, err: (l) => errLines.push(l), errLines };
  }

  it('refuses a tenant-A token on a tenant-B approval (exit 1, nothing recorded)', async () => {
    const id = await pendingOn(TENANT_B);
    const c = io(env({ CES_AO_PRINCIPAL_TOKEN: eoToken(APPROVER, TENANT_A) }));
    expect(await runApproveCommand(id, {}, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('refuses a token with no tenant claim (--principal-token)', async () => {
    const id = await pendingOn(TENANT_B);
    const c = io(env());
    expect(await runApproveCommand(id, { principalToken: eoToken(APPROVER) }, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('succeeds with a same-tenant token', async () => {
    const id = await pendingOn(TENANT_B);
    const c = io(env({ CES_AO_PRINCIPAL_TOKEN: eoToken(APPROVER, TENANT_B) }));
    expect(await runApproveCommand(id, {}, c)).toBe(0);
    const a = (await getApprovalRequest(id))!;
    expect(a.status).toBe('approved');
    expect(a.approverTenantId).toBe(TENANT_B);
  });
});

describe('FC-AO-2 MCP: `ao_approve`', () => {
  const mcpEnv = () => env({ AO_MCP_ALLOW_APPLY: '1' });

  it('refuses a tenant-A token on a tenant-B approval (nothing recorded)', async () => {
    const id = await pendingOn(TENANT_B);
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, principalToken: eoToken(APPROVER, TENANT_A) }, { env: mcpEnv() }),
    ).rejects.toThrow(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('refuses a token with no tenant claim, including a rejection', async () => {
    const id = await pendingOn(TENANT_B);
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, reject: true, reason: 'x', principalToken: eoToken(APPROVER) }, { env: mcpEnv() }),
    ).rejects.toThrow(TOKEN_TENANT_MISMATCH);
    await expectStillPending(id);
  });

  it('succeeds with a same-tenant token', async () => {
    const id = await pendingOn(TENANT_B);
    const res = await callAoMcpTool('ao_approve', { approvalId: id, principalToken: eoToken(APPROVER, TENANT_B) }, { env: mcpEnv() });
    expect(res.decision).toBe('approve');
    const a = (await getApprovalRequest(id))!;
    expect(a.status).toBe('approved');
    expect(a.approverTenantId).toBe(TENANT_B);
  });
});
