// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-3 step 3 (2026-09-28): adopt RequestPrincipal.tokenId (ces-shared/http/principal
// 1.1.0, the token's `jti`) and persist it on every approval decision (`approverTokenId`),
// so a decision links back to EvidenceOps's mint record. Recorded explicitly as `null` when
// the approver carried no token id (the dev loopback principal always has none) — a decision
// always STATES the fact, never leaves it ambiguous. Also carried into the rejection's
// AO-private evidence (`data.evidence.metadata.approverTokenId`; the shared, schema-governed
// contract row is untouched — see StamperTypes.ts / ApprovalStore.ts comments).
//
// Production code under test: ApprovalStore.recordApprovalDecision, VerifiedApprover.verifyApproverToken.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createHs256PrincipalVerifier } from 'ces-shared/http/principal';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { createApprovalRequest, getApprovalRequest, recordApprovalDecision } from '../src/execution/ApprovalStore.js';
import { verifyApproverToken } from '../src/execution/VerifiedApprover.js';
import { createApprovalsRouter } from '../src/server/routes/approvals.routes.js';
import { runApproveCommand, type CliIo } from '../src/cli/approveCommand.js';
import { callAoMcpTool } from '../src/mcp/aoMcpTools.js';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';
import { TEST_PRINCIPAL_SECRET, testPrincipalToken, verifiedApprover, makeAoCommand } from './fixtures.js';

// FC-AO-3 step 3 (executed-evidence describe block, below): a synthetic Tier-3 write command
// so the executed-evidence assertion doesn't depend on the real A-03 registry template /
// stacksim state (same technique as x1.writeVerdict.test.ts). ONLY the PowerShell execution
// boundary is mocked; CommandExecutor -> GetThenSetExecutor -> EvidenceEmitter -> CesRepository
// is the real code.
const tok3Holder = vi.hoisted(() => ({ state: 'v0' }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(task: any) {
      const command: string = task?.action?.command ?? '';
      if (command.includes('<<AO-STATE-BEGIN>>')) {
        return {
          success: true,
          stdout: `<<AO-STATE-BEGIN>>\r\n${JSON.stringify({ value: tok3Holder.state })}\r\n<<AO-STATE-END>>\r\nSTAMPER_EXECUTION_SUCCESS\r\n`,
          stderr: '',
          exit_code: 0,
        };
      }
      tok3Holder.state = `${tok3Holder.state}-changed`;
      return { success: true, stdout: 'set ok\r\nSTAMPER_EXECUTION_SUCCESS\r\n', stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});
vi.mock('../src/registry/TemplateRegistry.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, any>>();
  return {
    ...orig,
    getCommandTemplates: (id: string) =>
      id === 'TOK3-01'
        ? { get_command: "Get-MgUser -UserId 'tok3@tok3.onmicrosoft.us' | Select-Object Id", set_command: "Update-MgUser -UserId 'tok3@tok3.onmicrosoft.us' -AccountEnabled:$false" }
        : orig.getCommandTemplates(id),
  };
});

const TENANT_ID = 'fc-ao-3-tokenid-tenant';
const REQUESTOR = 'requestor@fcao3tok.onmicrosoft.us';
const APPROVER = 'approver@fcao3tok.onmicrosoft.us';

let root: string;
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fcao3-tokenid-'));
  process.env.CES_PIPELINE_ROOT = root;
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
    commandTitle: 'Hard delete (FC-AO-3 token id test)',
    domain: 'A',
    tenantId: TENANT_ID,
    sodTier: 'Tier 3',
    requestorUPN: REQUESTOR,
    inputs: { targetUPN: 'target@fcao3tok.onmicrosoft.us' },
    controlIds: ['AC.L2-3.1.5'],
  });
  return r.approvalId;
}

describe('FC-AO-3 step 3: verifyApproverToken carries the token id (jti) through', () => {
  it('a token with jti yields an ApproverPrincipal carrying tokenId', () => {
    const p = verifiedApprover(APPROVER, TENANT_ID, { jti: 'mint-42' });
    expect(p.tokenId).toBe('mint-42');
  });

  it('a token with no jti yields an ApproverPrincipal with no tokenId', () => {
    const p = verifiedApprover(APPROVER, TENANT_ID);
    expect(p.tokenId).toBeUndefined();
  });
});

describe('FC-AO-3 step 3 store: approverTokenId is recorded on every decision', () => {
  it('an approval decided by a token with jti records that id', async () => {
    const id = await pending();
    const a = await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID, { jti: 'mint-approve-1' }), 'approve');
    expect(a.approverTokenId).toBe('mint-approve-1');
    expect((await getApprovalRequest(id))!.approverTokenId).toBe('mint-approve-1');
  });

  it('an approval decided by a token with NO jti records approverTokenId: null (not absent)', async () => {
    const id = await pending();
    const a = await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'approve');
    expect(a.approverTokenId).toBeNull();
    expect('approverTokenId' in (await getApprovalRequest(id))!).toBe(true);
  });

  it('a rejection with jti also records the id, AND carries it into the AO-private evidence metadata', async () => {
    const id = await pending();
    const a = await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID, { jti: 'mint-reject-1' }), 'reject', 'no');
    expect(a.approverTokenId).toBe('mint-reject-1');

    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === 'A-03' && r.data?.metadata?.outcome === 'approval_rejected');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.evidence.metadata.approverTokenId).toBe('mint-reject-1');
    // The strict, shared contract row carries NO such field (AO-private only).
    expect('approverTokenId' in rows[0].data.metadata).toBe(false);
  });

  it('a rejection with no jti records approverTokenId: null in both the decision and the evidence', async () => {
    const id = await pending();
    await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'reject', 'no');
    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === 'A-03' && r.data?.metadata?.outcome === 'approval_rejected');
    expect(rows[0].data.evidence.metadata.approverTokenId).toBeNull();
  });
});

describe('FC-AO-3 step 3 web: POST /api/approvals/:id/decision records approverTokenId', () => {
  let server: Server;
  let base: string;
  const SECRET = 'fc-ao-3-tokenid-web-secret';

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

  it('records the token jti as approverTokenId', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, SECRET, TENANT_ID, { jti: 'mint-web-1' });
    const res = await fetch(`${base}/api/approvals/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ces-principal': token },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    expect((await getApprovalRequest(id))!.approverTokenId).toBe('mint-web-1');
  });
});

describe('FC-AO-3 step 3 CLI: `ao approve` records approverTokenId', () => {
  function io(env: NodeJS.ProcessEnv): CliIo {
    return { env, out: () => undefined, err: () => undefined };
  }

  it('records the token jti as approverTokenId', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { jti: 'mint-cli-1' });
    const c = io({ CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET, CES_AO_PRINCIPAL_TOKEN: token });
    expect(await runApproveCommand(id, {}, c)).toBe(0);
    expect((await getApprovalRequest(id))!.approverTokenId).toBe('mint-cli-1');
  });
});

describe('FC-AO-3 step 3 MCP: `ao_approve` records approverTokenId', () => {
  it('records the token jti as approverTokenId', async () => {
    const id = await pending();
    const token = testPrincipalToken(APPROVER, TEST_PRINCIPAL_SECRET, TENANT_ID, { jti: 'mint-mcp-1' });
    const res = await callAoMcpTool(
      'ao_approve',
      { approvalId: id, principalToken: token },
      { env: { AO_MCP_ALLOW_APPLY: '1', CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET } }
    );
    expect(res.decision).toBe('approve');
    expect((await getApprovalRequest(id))!.approverTokenId).toBe('mint-mcp-1');
  });
});

describe("FC-AO-3 step 3: an APPROVED decision's executed evidence also carries approverTokenId", () => {
  // Real executeAoCommand pipeline (CommandExecutor -> GetThenSetExecutor -> EvidenceEmitter ->
  // CesRepository); ONLY the PowerShell boundary is mocked (module-level vi.mock above), a
  // kind:'sim' loopback tenant so no stacksim/live network call is made either way.
  const EXEC_TENANT_ID = 'fc-ao-3-tokenid-exec-tenant';
  const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
  const savedExec: Record<string, string | undefined> = {};
  let execRoot: string;
  let tok3Stacksim: StacksimEnvHandle;

  function simTenant() {
    const certPath = path.join(execRoot, 'fcao3.pfx');
    fs.writeFileSync(certPath, 'dummy-cert');
    return {
      tenantSlug: 'fcao3-tokenid-sim',
      tenantId: EXEC_TENANT_ID,
      appId: 'fcao3-app-id',
      certPath,
      certThumbprint: 'F3F3000000000000000000000000000000000000',
      domain: 'fcao3tok.onmicrosoft.us',
      kind: 'sim',
      cmmcLevel: 'L2',
      cmmcMigrationExempt: true,
      endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
      subscriptionId: 'fcao3-sub',
      resources: {},
    } as any;
  }

  beforeEach(async () => {
    for (const k of ENV_KEYS) savedExec[k] = process.env[k];
    execRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fcao3-tokenid-exec-'));
    process.env.CES_PIPELINE_ROOT = execRoot;
    delete process.env.CES_CONFIG_PATH;
    delete process.env.AO_CMMC_STRICT;
    delete process.env.CES_AO_SIM_ONLY;
    delete process.env.CES_AO_ALLOW_LIVE;
    tok3Holder.state = 'v0';
    // AO-20: the executor fail-closes a kind:'sim' tenant unless this process is routed to
    // stacksim (env markers only — the PowerShell boundary above is fully mocked, so nothing
    // actually talks to 127.0.0.1:4390).
    tok3Stacksim = activateStacksimEnv();
  });

  afterEach(() => {
    closeAllCesRepositories();
    for (const k of ENV_KEYS) {
      if (savedExec[k] === undefined) delete process.env[k];
      else process.env[k] = savedExec[k];
    }
    tok3Stacksim.restore();
    fs.rmSync(execRoot, { recursive: true, force: true });
  });

  it("the approved-and-executed row carries the approving decision's approverTokenId", async () => {
    const cmd = makeAoCommand({
      id: 'TOK3-01',
      trigger: 'OFFBOARDING',
      sodTier: 'Tier 3',
      idempotencyClass: 'unsafe_requires_gate',
      cmmcPractices: ['AC.L2-3.1.5'],
    } as any);

    const pendingResult: any = await executeAoCommand(cmd, simTenant(), {}, false, {
      requestorUPN: 'op@fcao3tok.onmicrosoft.us',
    });
    expect(pendingResult.status).toBe('pending_approval');

    const decided = await recordApprovalDecision(
      pendingResult.approvalId,
      verifiedApprover('approver@fcao3tok.onmicrosoft.us', EXEC_TENANT_ID, { jti: 'mint-exec-1' }),
      'approve'
    );
    expect(decided.approverTokenId).toBe('mint-exec-1');

    const executed: any = await executeAoCommand(cmd, simTenant(), {}, false, {
      requestorUPN: 'op@fcao3tok.onmicrosoft.us',
      approvalId: pendingResult.approvalId,
    });
    expect(executed.success, executed.error).toBe(true);

    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r: any) => r.data?.metadata?.commandId === 'TOK3-01' && r.data?.metadata?.outcome !== 'blocked_pending_approval');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.evidence.metadata.approverTokenId).toBe('mint-exec-1');
    // The strict, shared contract row carries NO such field (AO-private only).
    expect('approverTokenId' in rows[0].data.metadata).toBe(false);
  });
});
