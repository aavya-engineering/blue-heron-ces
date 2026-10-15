// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO3 (P1): the firewall pre-check (F-11 / F-12) must read the state the route returns.
//
// POST /api/execute/:id answers { success, result: <ExecutionResult>, evidence, ... }, so the
// get_command output is at `result.result.stdout`. The pre-check read `result.stdout`
// (always undefined) and always showed STATE UNKNOWN.
//
// The SERVED UI code (public/index.html inline scripts, via uiHarness) calls the REAL execute
// router on 127.0.0.1:0, which runs the REAL executor (dry run: get-then-set pre-state read,
// no write). The only mocks are the PowerShell boundary (returns the firewall state between
// the executor's state markers, as a real session does) and the tenant loader (a kind:'sim'
// loopback tenant carrying resources.resource_group / resources.firewall_name).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const ps = vi.hoisted(() => ({
  state: { Name: 'sim-fw-1', ProvisioningState: 'Succeeded', AllocationState: 'Allocated' } as Record<string, string>,
  calls: [] as Array<{ command: string; dryRun: boolean }>,
  root: '',
  /** true = what PowerShell really prints: the state read pipes F-11/F-12's get_command (which
   *  already ends in ConvertTo-Json) through ConvertTo-Json again, so the snapshot is a JSON
   *  string holding the object (observed on stacksim). false = a plain JSON object. */
  doubleEncoded: true,
}));

vi.mock('ces-stamper/adapters/powershell', async () => {
  const { STATE_BEGIN_MARKER, STATE_END_MARKER } = await import('../src/execution/GetThenSetExecutor.js');
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'azure';
    }
    async execute(task: any, _vars: Record<string, string>, dryRun: boolean) {
      const command = String(task?.action?.command ?? '');
      ps.calls.push({ command, dryRun });
      if (command.includes(STATE_BEGIN_MARKER)) {
        return {
          success: true,
          stdout: `${STATE_BEGIN_MARKER}\r\n${ps.doubleEncoded ? JSON.stringify(JSON.stringify(ps.state, null, 4)) : JSON.stringify(ps.state)}\r\n${STATE_END_MARKER}\r\nSTAMPER_EXECUTION_SUCCESS\r\n`,
          stderr: '',
          exit_code: 0,
        };
      }
      return { success: true, stdout: 'unexpected non-state command', stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'fx2-fw-sim-tenant',
    appId: 'fx2-fw-app',
    certPath: path.join(ps.root, 'fw.pfx'),
    certThumbprint: 'F0F0000000000000000000000000000000000000',
    domain: 'fw.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'fx2-fw-sub',
    resources: { resource_group: 'sim-rg-1', firewall_name: 'sim-fw-1', vnet_name: 'sim-vnet-1', public_ip_name: 'sim-pip-1' },
  }),
}));

import express from 'express';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { loadUi, readIndexHtml } from './uiHarness.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
const saved: Record<string, string | undefined> = {};
let server: Server;
let base: string;
let stacksim: StacksimEnvHandle;

beforeEach(async () => {
  ps.calls = [];
  ps.doubleEncoded = true;
  ps.state = { Name: 'sim-fw-1', ProvisioningState: 'Succeeded', AllocationState: 'Allocated' };
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  ps.root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fx2-fw-'));
  fs.writeFileSync(path.join(ps.root, 'fw.pfx'), 'placeholder');
  process.env.CES_PIPELINE_ROOT = ps.root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): F-11/F-12 here use a kind:'sim' loopback tenant — route this
  // process to stacksim so the executor's isStacksimModeActive() check doesn't refuse it.
  stacksim = activateStacksimEnv();
  const app = express();
  app.use(express.json());
  app.use('/api', createExecuteRouter([getCommand('F-11')!, getCommand('F-12')!]));
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(ps.root, { recursive: true, force: true });
});

async function precheck(id: 'F-11' | 'F-12') {
  const bridgedFetch = (url: string, init?: any) => fetch(`${base}${url}`, init) as any;
  const ui = loadUi(bridgedFetch);
  ui.run(`registry = ${JSON.stringify([getCommand(id)])}`);
  ui.el('tenantSelect').value = 'fx2-fw-sim';
  await ui.run('checkFirewallState(registry[0])');
  const call = ui.calls.find((c) => c.url === `/api/execute/${id}`)!;
  return { ui, call };
}

describe('FX2-AO3 firewall pre-check shows the state the real route returns', () => {
  it('F-11 dry-run pre-check: ALLOCATED + SUCCEEDED from result.result.stdout, and nothing is written', async () => {
    const { ui, call } = await precheck('F-11');
    expect(call.body.dryRun).toBe(true);
    expect(ui.el('precheckBadge').textContent).toBe('ALLOCATED');
    expect(ui.el('precheckBadge').classList.contains('allocated')).toBe(true);
    expect(ui.el('precheckProvBadge').textContent).toBe('SUCCEEDED');
    expect(ui.el('precheckWarning').style.display).not.toBe('block'); // F-11 targets deallocated: no warning
    // Only the read-only state read ran — as a real read (dryRun:false) — never the Deallocate set.
    expect(ps.calls.length).toBeGreaterThan(0);
    expect(ps.calls.every((c) => !/\.Deallocate\(|Set-AzFirewall/.test(c.command))).toBe(true);
    expect(ps.calls.every((c) => c.command.includes('Get-AzFirewall') && c.dryRun === false)).toBe(true);
  });

  it('F-12 on an already-allocated firewall warns that it is already in the target state', async () => {
    const { ui } = await precheck('F-12');
    expect(ui.el('precheckBadge').textContent).toBe('ALLOCATED');
    expect(ui.el('precheckWarning').style.display).toBe('block');
    expect(ui.el('precheckWarning').textContent).toMatch(/already ALLOCATED/);
  });

  it('a deallocated firewall with a failed provisioning state shows DEALLOCATED + FAILED', async () => {
    ps.state = { Name: 'sim-fw-1', ProvisioningState: 'Failed', AllocationState: 'Deallocated' };
    const { ui } = await precheck('F-11');
    expect(ui.el('precheckBadge').textContent).toBe('DEALLOCATED');
    expect(ui.el('precheckProvBadge').textContent).toBe('FAILED');
    expect(ui.el('precheckWarning').textContent).toMatch(/ProvisioningState is FAILED/);
  });

  it('a plain (single-encoded) JSON snapshot is read too', async () => {
    ps.doubleEncoded = false;
    const { ui } = await precheck('F-11');
    expect(ui.el('precheckBadge').textContent).toBe('ALLOCATED');
    expect(ui.el('precheckProvBadge').textContent).toBe('SUCCEEDED');
  });

  it('the old top-level result.stdout path is gone from the pre-check', () => {
    const html = readIndexHtml();
    const start = html.indexOf('async function checkFirewallState');
    const body = html.slice(start, html.indexOf('\n    }\n', start));
    expect(body).not.toMatch(/(?<!result\.)result\.stdout/); // only result.result.stdout may remain
    expect(body).toMatch(/result\.result/);
  });
});
