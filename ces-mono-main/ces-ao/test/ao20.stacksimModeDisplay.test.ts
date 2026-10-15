// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-20 (2026-09-27, FC-AO), "display the mode" half: the GUI and MCP surfaces show
// whether THIS PROCESS is actually routed to stacksim (isStacksimModeActive), a
// process-level fact independent of which tenant is selected. The fail-closed
// enforcement half (a sim-kind tenant refused when not routed) is proven in
// test/simOnlyRail.test.ts's three new AO-20 cases; this file proves the two display
// surfaces named in the instructions: GET /api/tenants (GUI) and ao_execute (MCP).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { activateStacksimEnv, deactivateStacksimEnv, restoreEnv, type StacksimEnvHandle } from './stacksimEnv.js';
import { loadUi, jsonResponse, type FetchImpl } from './uiHarness.js';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';

vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() { return 'mgraph'; }
    async execute() {
      return { success: true, stdout: JSON.stringify({ ok: true }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTenantRegistry: () => ({
    listByKind: async (kind: string) => (kind === 'sim' ? [{ tenantSlug: 'ao20-sim', kind: 'sim' }] : []),
  }),
  loadTenantConfigBySlug: async (slug: string) => ({
    tenantSlug: slug,
    tenantId: 'ao20-mcp-tid',
    appId: 'ao20-app',
    certPath: '/dev/null',
    certThumbprint: 'AA00000000000000000000000000000000000000',
    domain: 'ao20-mcp.onmicrosoft.us',
    kind: 'live',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'https://graph.microsoft.us' },
    subscriptionId: 'ao20-sub',
    resources: {},
  }),
}));

describe('AO-20 GUI display: GET /api/tenants carries stacksimModeActive', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const { createTenantRouter } = await import('../src/server/routes/tenant.routes.js');
    const app = express();
    app.use(createTenantRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('true when this process is routed to stacksim', async () => {
    const stacksim = activateStacksimEnv();
    try {
      const res = await fetch(`${base}/api/tenants`);
      const body: any = await res.json();
      expect(body.stacksimModeActive).toBe(true);
    } finally {
      stacksim.restore();
    }
  });

  it('false when this process is NOT routed to stacksim', async () => {
    const saved = deactivateStacksimEnv();
    try {
      const res = await fetch(`${base}/api/tenants`);
      const body: any = await res.json();
      expect(body.stacksimModeActive).toBe(false);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('AO-20 GUI display: the served UI code renders the stacksim-mode badge', () => {
  function makeFetch(stacksimModeActive: boolean): FetchImpl {
    return (url) => {
      if (url === '/api/tenants') {
        return jsonResponse({ tenants: [{ slug: 'ao20-sim', kind: 'sim' }], liveAllowed: false, stacksimModeActive });
      }
      return jsonResponse({}, 404);
    };
  }

  it('shows "ROUTED" when the server reports stacksimModeActive:true', async () => {
    const ui = loadUi(makeFetch(true));
    await ui.run('loadTenants()');
    const badge = ui.el('stacksimModeBadge');
    expect(badge.textContent).toBe('stacksim: ROUTED');
    expect(badge.className).toContain('allocated');
  });

  it('shows "NOT ROUTED" when the server reports stacksimModeActive:false', async () => {
    const ui = loadUi(makeFetch(false));
    await ui.run('loadTenants()');
    const badge = ui.el('stacksimModeBadge');
    expect(badge.textContent).toBe('stacksim: NOT ROUTED');
    expect(badge.className).toContain('deallocated');
  });
});

describe('AO-20 MCP display: ao_execute reports stacksimModeActive', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_AO_ALLOW_LIVE'] as const;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao20-mcp-'));
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.CES_PIPELINE_ROOT = tmpRoot;
    // A live-kind tenant sidesteps AO-20's sim-routing check entirely (it only gates
    // kind:'sim'), so this describe block can prove the DISPLAY field independent of
    // stacksim routing/enforcement (covered separately above and in simOnlyRail.test.ts).
    process.env.CES_AO_ALLOW_LIVE = '1';
  });

  afterEach(() => {
    closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('true when the tool call env is stacksim-routed', async () => {
    const { callAoMcpTool } = await import('../src/mcp/aoMcpTools.js');
    const handle: StacksimEnvHandle = activateStacksimEnv();
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const result: any = await callAoMcpTool(
        'ao_execute',
        { commandId: 'A-08', tenant: 'ao20-mcp-tenant', dryRun: true },
        { env },
      );
      expect(result.stacksimModeActive).toBe(true);
    } finally {
      handle.restore();
    }
  });

  it('false when the tool call env is NOT stacksim-routed', async () => {
    const { callAoMcpTool } = await import('../src/mcp/aoMcpTools.js');
    const saved = deactivateStacksimEnv();
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const result: any = await callAoMcpTool(
        'ao_execute',
        { commandId: 'A-08', tenant: 'ao20-mcp-tenant', dryRun: true },
        { env },
      );
      expect(result.stacksimModeActive).toBe(false);
    } finally {
      restoreEnv(saved);
    }
  });
});
