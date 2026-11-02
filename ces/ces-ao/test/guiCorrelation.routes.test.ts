// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO7 route level (REQ-AO-GUI-NO-CORRELATION-ID + tenant list), through the real
// Express routers on a throwaway loopback app (127.0.0.1:0):
//
//  - the REAL UI code (public/index.html scripts in node:vm, test/uiHarness.ts) drives
//    POST /api/execute against the real execute router; the correlationId the UI generated
//    round-trips into the response, the result panel, and the persisted evidence row;
//  - GET /api/tenants lists registry tenants (slug + kind) and reports liveAllowed=false
//    by default (sim-only; CES_AO_ALLOW_LIVE is never set here).
//
// Mocks: the PowerShell boundary; the execute route's tenant load (kind:'sim' loopback).
// The ces-tenant registry is re-anchored on a tmp CES_TENANT_ROOT. No real tenant/network.

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
    tenantId: 'corr-sim-tenant',
    appId: 'corr-app-id',
    certPath: `${holder.root}/corr.pfx`,
    certThumbprint: 'C0C0000000000000000000000000000000000000',
    domain: 'corr.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'corr-sub',
    resources: {},
  }),
}));

import express from 'express';
import { createExecuteRouter } from '../src/server/routes/execute.routes.js';
import { createTenantRouter, isLiveAllowed } from '../src/server/routes/tenant.routes.js';
import { getTenantRegistry, resetTenantRegistryForTests } from '../src/tenant/aoTenants.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand } from './fixtures.js';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';
import { loadUi } from './uiHarness.js';

const READ_CMD = makeAoCommand({ id: 'CORR-READ-01', trigger: 'EVIDENCE', cmmcPractices: ['AC.L1-3.1.1'] });

let tmpRoot: string;
let server: Server;
let base: string;
let stacksim: StacksimEnvHandle;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_TENANT_ROOT', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE',
] as const;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-guicorr-'));
  holder.root = tmpRoot;
  fs.writeFileSync(path.join(tmpRoot, 'corr.pfx'), 'dummy');
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CES_PIPELINE_ROOT = tmpRoot;
  process.env.CES_TENANT_ROOT = path.join(tmpRoot, 'tenants');
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): the tenant here is kind:'sim' (loopback) — route this process
  // to stacksim so the executor's isStacksimModeActive() check doesn't refuse it.
  stacksim = activateStacksimEnv();
  resetTenantRegistryForTests();

  const app = express();
  app.use(express.json());
  app.use(createTenantRouter());
  app.use('/api', createExecuteRouter([READ_CMD]));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllCesRepositories();
  resetTenantRegistryForTests();
  stacksim.restore();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const evidenceRows = (commandId: string) =>
  getCesRepository()
    .listAll<any>('adminops_evidence')
    .filter((r: any) => r.data?.metadata?.commandId === commandId);

/** UI fetch bridged to the live test server (relative URLs → loopback base). */
const bridgedFetch = (url: string, init?: any) => fetch(`${base}${url}`, init) as any;

describe('FX-AO7: UI correlationId round-trips into the persisted evidence row', () => {
  it('real UI executeCommand → real execute route → row.metadata.correlationId === UI id', async () => {
    const ui = loadUi(bridgedFetch);
    ui.run(`registry = [${JSON.stringify(READ_CMD)}]`);
    ui.el('tenantSelect').value = 'corr-sim';
    await ui.run('executeCommand(registry[0])');

    const [call] = ui.calls.filter((c) => c.url.startsWith('/api/execute/'));
    const sent = call.body.correlationId;
    expect(sent).toMatch(/^ao-ui-/);
    expect(call.body.tenant).toBe('corr-sim');

    const rows = evidenceRows(READ_CMD.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.correlationId).toBe(sent);
    expect(ui.el('resultCorrelationId').textContent).toBe(`correlationId: ${sent}`);
    expect(ui.el('resultStatusBadge').textContent).toBe('SUCCESS');
    expect(ui.el('evidenceLostBanner').classList.contains('visible')).toBe(false);
  });

  it('direct POST: response echoes the correlationId that lands on the row', async () => {
    const res = await fetch(`${base}/api/execute/${READ_CMD.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'corr-sim', inputs: {}, dryRun: true, correlationId: 'ao-ui-route-echo-1' }),
    });
    const body: any = await res.json();
    expect(body.correlationId).toBe('ao-ui-route-echo-1');
    expect(evidenceRows(READ_CMD.id)[0].data.metadata.correlationId).toBe('ao-ui-route-echo-1');
  });
});

describe('FX-AO7: GET /api/tenants (the list the UI must choose from)', () => {
  it('lists registry tenants with kind, and liveAllowed=false by default', async () => {
    await getTenantRegistry().createEphemeralSimTenant('guicorr-sim', undefined);
    const res = await fetch(`${base}/api/tenants`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.liveAllowed).toBe(false);
    expect(body.tenants).toContainEqual({ slug: 'guicorr-sim', kind: 'sim' });
    for (const t of body.tenants) expect(Object.keys(t).sort()).toEqual(['kind', 'slug']);
  });

  it('the real UI populates its select from the live route, with nothing pre-selected', async () => {
    await getTenantRegistry().createEphemeralSimTenant('guicorr-sim', undefined);
    const ui = loadUi(bridgedFetch);
    await ui.run('loadTenants()');
    expect(ui.el('tenantSelect').innerHTML).toContain('value="guicorr-sim"');
    expect(ui.el('tenantSelect').value).toBe('');
  });

  it('isLiveAllowed mirrors the rail: lockdown beats opt-in; no opt-in = sim-only', () => {
    expect(isLiveAllowed({})).toBe(false);
    expect(isLiveAllowed({ CES_AO_ALLOW_LIVE: '1' })).toBe(true);
    expect(isLiveAllowed({ CES_AO_ALLOW_LIVE: '1', CES_AO_SIM_ONLY: '1' })).toBe(false);
  });
});
