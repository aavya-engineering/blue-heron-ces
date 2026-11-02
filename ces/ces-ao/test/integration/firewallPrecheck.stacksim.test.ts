// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO3 acceptance on stacksim (opt-in AO_STACKSIM_IT=1, Windows).
//
// The SERVED UI's firewall pre-check (public/index.html via uiHarness) calls the REAL execute
// router, which runs the PRODUCTION executor as a dry run: the get-then-set pre-state read goes
// through the Stamper PowerShellAdapter -> powershell.exe -> stacksim's Get-AzFirewall shim ->
// the in-process stacksim server. Nothing is mocked. The seeded firewall `sim-fw-1` is
// Succeeded / Allocated, so the badges must say so (before FX2-AO3: always STATE UNKNOWN).
//
// Tenant record: stacksim's own emitted tenant object plus `resources.firewall_name`, a key
// proposed in docs/requirements/REQ-tenant-stacksim-ao-source-keys.md (not emitted today).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { startAoStacksim, STACKSIM_IT_ENABLED, logSkipIfDisabled, type AoStacksimEnv } from './stacksimHarness.js';
import { loadUi } from '../uiHarness.js';

logSkipIfDisabled('FX2-AO3 firewallPrecheck.stacksim');

describe.skipIf(!STACKSIM_IT_ENABLED)('FX2-AO3 firewall pre-check against stacksim (real route, real executor)', () => {
  let env: AoStacksimEnv;
  let server: Server;
  let base: string;
  let store: () => Promise<string>;

  beforeAll(async () => {
    env = await startAoStacksim({ slug: 'ao-fx2-fw', extraResources: { firewall_name: 'sim-fw-1' } });
    const express = (await import('express')).default;
    const { createExecuteRouter } = await import('../../src/server/routes/execute.routes.js');
    const { getCommand } = await import('../../src/execution/invokeCommand.js');
    const app = express();
    app.use(express.json());
    app.use('/api', createExecuteRouter([getCommand('F-11')!]));
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    store = async () => JSON.stringify(await env.store.list('firewalls'));
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const { closeAllCesRepositories } = await import('ces-shared/persistence/node');
    closeAllCesRepositories();
    await env?.stop();
  });

  it('F-11 pre-check shows ALLOCATED / SUCCEEDED from the sim, and the firewall is not changed', async () => {
    const { getCommand } = await import('../../src/execution/invokeCommand.js');
    const before = await store();
    const ui = loadUi((url: string, init?: any) => fetch(`${base}${url}`, init) as any);
    ui.run(`registry = ${JSON.stringify([getCommand('F-11')])}`);
    ui.el('tenantSelect').value = env.slug;
    await ui.run('checkFirewallState(registry[0])');

    const call = ui.calls.find((c) => c.url === '/api/execute/F-11')!;
    expect(call.body.dryRun).toBe(true);
    expect(ui.el('precheckWarning').textContent).not.toMatch(/refused/i);
    expect(ui.el('precheckBadge').textContent).toBe('ALLOCATED');
    expect(ui.el('precheckProvBadge').textContent).toBe('SUCCEEDED');
    expect(await store()).toBe(before);
  }, 180_000);
});
