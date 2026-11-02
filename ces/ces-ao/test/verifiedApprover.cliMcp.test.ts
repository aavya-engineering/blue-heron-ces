// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO1 (P0, separation of duties): CLI `ao approve` and MCP `ao_approve` take the
// approver from a VERIFIED principal (ces-shared signed principal token), never a typed name.
//
// Production code under test: src/cli/approveCommand.ts (runApproveCommand, wired by
// src/cli/index.ts — also spawned for real below), src/mcp/aoMcpTools.ts (callAoMcpTool,
// the dispatch mcp/ao-mcp-server.mjs imports from dist/), src/execution/VerifiedApprover.ts
// and ApprovalStore.recordApprovalDecision. Real temp CES database; no mocks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApprovalRequest, getApprovalRequest, recordApprovalDecision } from '../src/execution/ApprovalStore.js';
import { runApproveCommand, type CliIo } from '../src/cli/approveCommand.js';
import { AO_MCP_TOOLS, callAoMcpTool } from '../src/mcp/aoMcpTools.js';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { TEST_PRINCIPAL_SECRET, testPrincipalToken as mintToken } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AO_ROOT = path.resolve(__dirname, '..');

const REQUESTOR = 'requestor@fx2.onmicrosoft.us';
// FC-AO-2: approver tokens are tenant-bound; every token here is minted for this file's approval tenant.
const TENANT_ID = 'fx2-tenant';
const testPrincipalToken = (upn: string, secret: string = TEST_PRINCIPAL_SECRET) => mintToken(upn, secret, TENANT_ID);
const APPROVER = 'approver@fx2.onmicrosoft.us';

let root: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_PRINCIPAL_TOKEN', 'AO_MCP_ALLOW_APPLY'];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fx2-approver-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.CES_AO_PRINCIPAL_SECRET;
  delete process.env.CES_AO_PRINCIPAL_TOKEN;
  delete process.env.AO_MCP_ALLOW_APPLY;
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
    commandTitle: 'Hard delete (FX2 test)',
    domain: 'A',
    tenantId: TENANT_ID,
    sodTier: 'Tier 3',
    requestorUPN: REQUESTOR,
    inputs: { targetUPN: 'target@fx2.onmicrosoft.us' },
    controlIds: ['AC.L2-3.1.5'],
  });
  return r.approvalId;
}

function io(env: NodeJS.ProcessEnv): CliIo & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return { env, out: (l) => outLines.push(l), err: (l) => errLines.push(l), outLines, errLines };
}

const configured = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET, ...extra });

async function statusOf(id: string) {
  return (await getApprovalRequest(id))!;
}

describe('FX2-AO1 CLI `ao approve` needs a verified approver', () => {
  it('refuses a typed name with no verified principal; nothing is recorded', async () => {
    const id = await pending();
    const c = io(configured());
    expect(await runApproveCommand(id, { approver: APPROVER }, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(/typed approver names are not accepted/);
    const a = await statusOf(id);
    expect(a.status).toBe('pending');
    expect(a.approverUPN).toBeUndefined();
  });

  it('refuses a typed name even alongside a valid token (the typed name is never accepted)', async () => {
    const id = await pending();
    const c = io(configured({ CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(APPROVER) }));
    expect(await runApproveCommand(id, { approver: APPROVER }, c)).toBe(1);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses when no token is supplied', async () => {
    const id = await pending();
    const c = io(configured());
    expect(await runApproveCommand(id, {}, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(/no verified principal/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses when no verifier is configured (CES_AO_PRINCIPAL_SECRET unset)', async () => {
    const id = await pending();
    const c = io({ CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(APPROVER) });
    expect(await runApproveCommand(id, {}, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(/CES_AO_PRINCIPAL_SECRET is not configured/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses a forged token (signed with another secret)', async () => {
    const id = await pending();
    const c = io(configured());
    const forged = testPrincipalToken(APPROVER, 'some-other-secret-0000000000');
    expect(await runApproveCommand(id, { principalToken: forged }, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(/rejected \(bad_signature\)/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it("refuses self-approval by the requestor's own verified principal", async () => {
    const id = await pending();
    const c = io(configured({ CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(REQUESTOR) }));
    expect(await runApproveCommand(id, {}, c)).toBe(1);
    expect(c.errLines.join('\n')).toMatch(/Separation-of-duties/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('succeeds with a verified second principal (token from env) and records that principal', async () => {
    const id = await pending();
    const c = io(configured({ CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(APPROVER) }));
    expect(await runApproveCommand(id, {}, c)).toBe(0);
    const a = await statusOf(id);
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(APPROVER);
    expect(a.approverSubjectId).toBe(`sub-${APPROVER}`);
    expect(a.approverVerified).toBe(true);
    expect(a.approverPrincipalSource).toBe('token');
  });

  it('a verified second principal can reject (token from --principal-token)', async () => {
    const id = await pending();
    const c = io(configured());
    expect(await runApproveCommand(id, { reject: true, reason: 'no', principalToken: testPrincipalToken(APPROVER) }, c)).toBe(0);
    const a = await statusOf(id);
    expect(a.status).toBe('rejected');
    expect(a.approverUPN).toBe(APPROVER);
  });
});

describe('FX2-AO1 the real `ao` CLI process (src/cli/index.ts via tsx)', () => {
  const tsxCli = [path.join(AO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(AO_ROOT, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')].find(
    (p) => fs.existsSync(p)
  );

  function runCli(args: string[], env: NodeJS.ProcessEnv) {
    closeAllCesRepositories(); // release the temp DB before the child opens it
    const r = spawnSync(process.execPath, [tsxCli!, path.join(AO_ROOT, 'src', 'cli', 'index.ts'), ...args], {
      cwd: AO_ROOT,
      env: { ...process.env, CES_PIPELINE_ROOT: root, ...env },
      encoding: 'utf-8',
      timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  }

  it('refuses `--approver <typed name>`, then accepts a verified second principal', async () => {
    expect(tsxCli, 'tsx CLI present').toBeTruthy();
    const id = await pending();

    const typed = runCli(['approve', id, '--approver', APPROVER], { CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET });
    expect(typed.code, typed.out).toBe(1);
    expect(typed.out).toMatch(/typed approver names are not accepted/);
    expect((await statusOf(id)).status).toBe('pending');

    const ok = runCli(['approve', id], { CES_AO_PRINCIPAL_SECRET: TEST_PRINCIPAL_SECRET, CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(APPROVER) });
    expect(ok.code, ok.out).toBe(0);
    closeAllCesRepositories();
    const a = await statusOf(id);
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(APPROVER);
    expect(a.approverVerified).toBe(true);
  }, 120_000);
});

describe('FX2-AO1 MCP `ao_approve` needs a verified approver', () => {
  const env = (extra: NodeJS.ProcessEnv = {}) => ({ AO_MCP_ALLOW_APPLY: '1', ...configured(), ...extra });

  it('the tool schema takes principalToken and has no approverUPN', () => {
    const tool = AO_MCP_TOOLS.find((t) => t.name === 'ao_approve')!;
    const schema = tool.inputSchema as any;
    expect(Object.keys(schema.properties)).not.toContain('approverUPN');
    expect(schema.required).toEqual(['approvalId', 'principalToken']);
  });

  it('refuses a typed approverUPN with no verified principal', async () => {
    const id = await pending();
    await expect(callAoMcpTool('ao_approve', { approvalId: id, approverUPN: APPROVER }, { env: env() })).rejects.toThrow(
      /typed approver names are not accepted/
    );
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses a typed approverUPN even alongside a valid token', async () => {
    const id = await pending();
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, approverUPN: APPROVER, principalToken: testPrincipalToken(APPROVER) }, { env: env() })
    ).rejects.toThrow(/typed approver names are not accepted/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses without a token, and does not fall back to a server-env token', async () => {
    const id = await pending();
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id }, { env: env({ CES_AO_PRINCIPAL_TOKEN: testPrincipalToken(APPROVER) }) })
    ).rejects.toThrow(/no verified principal/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('refuses a token when the server has no verifier configured', async () => {
    const id = await pending();
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, principalToken: testPrincipalToken(APPROVER) }, { env: { AO_MCP_ALLOW_APPLY: '1' } })
    ).rejects.toThrow(/CES_AO_PRINCIPAL_SECRET is not configured/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it("refuses self-approval by the requestor's verified principal", async () => {
    const id = await pending();
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, principalToken: testPrincipalToken(REQUESTOR) }, { env: env() })
    ).rejects.toThrow(/Separation-of-duties/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('succeeds with a verified second principal', async () => {
    const id = await pending();
    const res = await callAoMcpTool('ao_approve', { approvalId: id, principalToken: testPrincipalToken(APPROVER) }, { env: env() });
    expect(res.decision).toBe('approve');
    const a = await statusOf(id);
    expect(a.status).toBe('approved');
    expect(a.approverUPN).toBe(APPROVER);
    expect(a.approverPrincipalSource).toBe('token');
  });

  it('is still blocked without AO_MCP_ALLOW_APPLY=1, even with a valid token', async () => {
    const id = await pending();
    await expect(
      callAoMcpTool('ao_approve', { approvalId: id, principalToken: testPrincipalToken(APPROVER) }, { env: configured() })
    ).rejects.toThrow(/AO_MCP_ALLOW_APPLY=1/);
    expect((await statusOf(id)).status).toBe('pending');
  });
});

describe('FX2-AO1 zero code paths accept a raw approver string', () => {
  it('the store refuses a string approver', async () => {
    const id = await pending();
    await expect(recordApprovalDecision(id, APPROVER as any, 'approve')).rejects.toThrow(/verified principal/);
    await expect(
      recordApprovalDecision(id, { upn: APPROVER, subjectId: 's', verified: false, source: 'token' } as any, 'approve')
    ).rejects.toThrow(/verifier/);
    expect((await statusOf(id)).status).toBe('pending');
  });

  it('only the verified-principal paths call recordApprovalDecision in src/ and mcp/', () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|mts|mjs|js)$/.test(e.name) && /recordApprovalDecision\s*\(/.test(fs.readFileSync(p, 'utf-8'))) {
          callers.push(path.relative(AO_ROOT, p).replace(/\\/g, '/'));
        }
      }
    };
    walk(path.join(AO_ROOT, 'src'));
    walk(path.join(AO_ROOT, 'mcp'));
    expect(callers.sort()).toEqual([
      'src/execution/ApprovalStore.ts', // the definition
      'src/execution/VerifiedApprover.ts', // CLI + MCP: token-verified principal
      'src/server/routes/approvals.routes.ts', // web: ces-shared request principal
    ]);
  });
});
