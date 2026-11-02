// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// API-4 (G-API): the CLI (`ao exec`), the MCP tool (`ao_execute`) and the HTTP route
// (POST /api/execute/:commandId) drive ONE service layer (src/execution/invokeCommand.ts).
// With the executor stubbed, the same command through each surface must reach the
// executor with identical arguments and hand back the identical evidence row —
// for a dry run, a live apply, and a Tier-3 pending-approval result.
//
// Mocks: CommandExecutor.executeAoCommand (the executor) and the tenant loader.
// The route is mounted on a throwaway express app on 127.0.0.1:0.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const TENANT = {
  tenantSlug: 'api4-sim',
  tenantId: 'api4-tenant',
  appId: 'api4-app',
  certPath: 'C:/nonexistent/api4.pfx',
  certThumbprint: 'A4A4000000000000000000000000000000000000',
  domain: 'api4.onmicrosoft.us',
  kind: 'sim',
  cmmcLevel: 'L2',
  endpoints: {},
  resources: {},
};

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async () => ({ ...TENANT }),
}));

// Hoisted so the CLI's re-import (vi.resetModules) shares the same executor stub.
const exec = vi.hoisted(() => {
  const state = { next: undefined as any, fn: undefined as any };
  state.fn = vi.fn(async () => state.next);
  return state;
});
vi.mock('../src/execution/CommandExecutor.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeAoCommand: exec.fn,
}));

import express from 'express';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { loadRegistry } from '../src/execution/invokeCommand.js';
import { callAoMcpTool } from '../src/mcp/aoMcpTools.js';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';

const execMock = vi.mocked(executeAoCommand);
expect(execMock).toBe(exec.fn);

const registry = loadRegistry();
const tier2 = registry.find(c => c.sodTier === 'Tier 2')!;
const tier3 = registry.find(c => c.sodTier === 'Tier 3')!;

function inputsFor(cmd: (typeof registry)[number]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cmd.parameters) if (p.required && !p.source) out[p.name] = `api4-${p.name}`;
  return out;
}

function evidenceRow(commandId: string, dryRun: boolean) {
  return {
    success: true,
    output: 'stubbed',
    evidence: {
      evidenceId: `EV-API4-${commandId}`,
      commandId,
      tenantId: TENANT.tenantId,
      dryRun,
      outcome: dryRun ? 'dry_run' : 'applied',
      metadata: { commandExecuted: `Stub-${commandId}` },
    },
    evidencePath: `/evidence/${commandId}.json`,
    metadataPath: `/evidence/${commandId}.meta.json`,
    evidencePersisted: true,
  };
}

let server: Server;
let base: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['AO_MCP_ALLOW_APPLY', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_PRINCIPAL_REQUIRED'];

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  execMock.mockClear();
  const app = express();
  app.use(express.json());
  app.use('/api', createExecuteRouter(registry));
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

/** Run `ao exec` through the real CLI entry (commander parses process.argv on import). */
async function runCli(argv: string[]): Promise<any> {
  const savedArgv = process.argv;
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((l: unknown) => { lines.push(String(l)); });
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as any);
  try {
    process.argv = ['node', 'ao', ...argv];
    vi.resetModules();
    await import('../src/cli/index.ts');
    await vi.waitFor(() => { if (!lines.length) throw new Error('no CLI output yet'); }, { timeout: 5000 });
    return JSON.parse(lines.join('\n'));
  } finally {
    process.argv = savedArgv;
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
}

async function runRoute(commandId: string, body: Record<string, unknown>) {
  const r = await fetch(`${base}/api/execute/${commandId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

/** The executor arguments each surface produced, with undefined option keys dropped. */
function executorCalls() {
  return execMock.mock.calls.map(([cmd, tenant, inputs, dryRun, opts]) => ({
    commandId: (cmd as any).id,
    tenant,
    inputs,
    dryRun,
    opts: JSON.parse(JSON.stringify(opts ?? {})),
  }));
}

describe('API-4: CLI, MCP and route share one service layer', () => {
  it('a dry run produces the same executor call and the same evidence row on all three surfaces', async () => {
    const inputs = inputsFor(tier2);
    exec.next = evidenceRow(tier2.id, true);

    const cli = await runCli(['exec', tier2.id, '-t', TENANT.tenantSlug, '-i', JSON.stringify(inputs), '--json']);
    const mcp = await callAoMcpTool('ao_execute', { commandId: tier2.id, tenant: TENANT.tenantSlug, inputs }, { env: {} });
    const route = await runRoute(tier2.id, { tenant: TENANT.tenantSlug, inputs });

    expect(route.status).toBe(200);
    expect(mcp.mode).toBe('DRY_RUN');

    const calls = executorCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ commandId: tier2.id, tenant: TENANT, inputs, dryRun: true, opts: {} });
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);

    expect(cli.evidence).toEqual(exec.next.evidence);
    expect(mcp.result.evidence).toEqual(exec.next.evidence);
    expect(route.body.evidence).toEqual(exec.next.evidence);
  });

  it('a live apply reaches the executor identically once each surface is armed', async () => {
    const inputs = inputsFor(tier2);
    exec.next = evidenceRow(tier2.id, false);
    const requestor = 'requestor@api4.onmicrosoft.us';

    const cli = await runCli(['exec', tier2.id, '-t', TENANT.tenantSlug, '-i', JSON.stringify(inputs), '--apply', '--requestor', requestor, '--json']);
    const mcp = await callAoMcpTool(
      'ao_execute',
      { commandId: tier2.id, tenant: TENANT.tenantSlug, inputs, dryRun: false, requestorUPN: requestor },
      { env: { AO_MCP_ALLOW_APPLY: '1' } }
    );
    const route = await runRoute(tier2.id, {
      tenant: TENANT.tenantSlug, inputs, dryRun: false, confirmApply: tier2.id, requestorUPN: requestor,
    });

    expect(route.status).toBe(200);
    expect(mcp.mode).toBe('LIVE');

    const calls = executorCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ commandId: tier2.id, tenant: TENANT, inputs, dryRun: false, opts: { requestorUPN: requestor } });
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);

    expect(cli.evidence).toEqual(exec.next.evidence);
    expect(mcp.result.evidence).toEqual(exec.next.evidence);
    expect(route.body.evidence).toEqual(exec.next.evidence);
  });

  it('a Tier-3 request carries the same approval binding and returns the same pending-approval record', async () => {
    const inputs = inputsFor(tier3);
    const requestor = 'requestor@api4.onmicrosoft.us';
    exec.next = {
      success: false,
      status: 'pending_approval',
      approvalId: 'APR-API4-1',
      commandId: tier3.id,
      message: 'Tier 3: second-person approval required',
      evidencePersisted: true,
    };

    const cli = await runCli(['exec', tier3.id, '-t', TENANT.tenantSlug, '-i', JSON.stringify(inputs), '--requestor', requestor, '--json']);
    const mcp = await callAoMcpTool(
      'ao_execute',
      { commandId: tier3.id, tenant: TENANT.tenantSlug, inputs, requestorUPN: requestor },
      { env: {} }
    );
    const route = await runRoute(tier3.id, { tenant: TENANT.tenantSlug, inputs, requestorUPN: requestor });

    expect(route.status).toBe(202);

    const calls = executorCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ commandId: tier3.id, tenant: TENANT, inputs, dryRun: true, opts: { requestorUPN: requestor } });
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);

    expect(cli.approvalId).toBe('APR-API4-1');
    expect(mcp.result.approvalId).toBe('APR-API4-1');
    expect(route.body.approvalId).toBe('APR-API4-1');
  });

  it('missing required parameters are refused before the executor on every surface', async () => {
    const withRequired = registry.find(c => c.parameters.some(p => p.required && !p.source));
    if (!withRequired) return;

    await expect(
      callAoMcpTool('ao_execute', { commandId: withRequired.id, tenant: TENANT.tenantSlug, inputs: {} }, { env: {} })
    ).rejects.toThrow(/Missing required parameter/);
    const route = await runRoute(withRequired.id, { tenant: TENANT.tenantSlug, inputs: {} });
    expect(route.status).toBe(400);
    expect(route.body.error).toMatch(/^Missing required parameter: /);

    expect(execMock).not.toHaveBeenCalled();
  });
});
