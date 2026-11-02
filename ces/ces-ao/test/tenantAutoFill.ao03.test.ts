// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-03 (2026-09-27, FC-AO): UI auto-fill for snake_case-bound parameters.
//
// VERIFY-ao.md gap: public/index.html read `tenantConfig[param.source]` literally (e.g.
// `tenantConfig['resources.firewallName']`), which only works when the raw Stamper tenant
// object happens to have a flat key spelled exactly like the registry's `source` string.
// It does not — the tenant object nests `resources.firewall_name` (snake_case) — so the
// readonly field rendered blank for every snake_case-bound command (F-11/F-12 among them)
// even though the server resolves and executes correctly through
// SourceBindings.resolveSource / ParameterMapper.mapAoParametersToVariables.
//
// Fix: GET /api/tenant/bindings?tenant=<slug>&commandId=<id> (tenant.routes.ts) resolves
// through the SAME table the server uses, and the UI's two auto-fill sites
// (public/index.html) now read from that resolved map instead of the raw tenant object.
//
// Part 1 tests the new route directly (real Express router, mocked tenant loader only) —
// a tenant object shaped like stacksim's (resources.firewall_name / resources.resource_group,
// snake_case). Part 2 tests the served UI code (node:vm harness) end to end: opening F-11's
// form renders the readonly fields pre-filled with the bound values, not ''.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { loadUi, jsonResponse, type FetchImpl } from './uiHarness.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
import type { AoCommand } from '../src/types/AoCommand.js';

const COMMANDS = registry as unknown as AoCommand[];
function grouped() {
  const m = new Map<string, AoCommand[]>();
  for (const c of COMMANDS) m.set(c.domain, [...(m.get(c.domain) ?? []), c]);
  return [...m.entries()].map(([id, commands]) => ({ id, name: commands[0].domainName, commands }));
}

const STACKSIM_SHAPED_TENANT = {
  tenantSlug: 'ao03-sim',
  tenantId: 'ao03-tid',
  kind: 'sim',
  cmmcMigrationExempt: true,
  endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
  subscription: { subscription_id: 'sub-1' },
  resources: {
    firewall_name: 'fw-cmmc-01',
    resource_group: 'rg-eo-prod-01',
  },
};

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async (slug: string) => ({ ...STACKSIM_SHAPED_TENANT, tenantSlug: slug }),
}));

describe('AO-03 route: GET /api/tenant/bindings resolves snake_case-bound params', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const { createTenantRouter } = await import('../src/server/routes/tenant.routes.js');
    const app = express();
    app.use(express.json());
    app.use(createTenantRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('F-11: returns resolved firewallName/resourceGroup from resources.firewall_name/resource_group', async () => {
    const res = await fetch(`${base}/api/tenant/bindings?tenant=ao03-sim&commandId=F-11`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.bindings.firewallName).toBe('fw-cmmc-01');
    expect(body.bindings.resourceGroup).toBe('rg-eo-prod-01');
  });

  it('404s for an unregistered command id', async () => {
    const res = await fetch(`${base}/api/tenant/bindings?tenant=ao03-sim&commandId=NOT-REAL`);
    expect(res.status).toBe(404);
  });

  it('400s (via tenantLoader) when no tenant is given', async () => {
    const res = await fetch(`${base}/api/tenant/bindings?commandId=F-11`);
    expect(res.status).toBe(400);
  });
});

describe('AO-03 UI: F-11 form auto-fills readonly snake_case-bound fields', () => {
  function makeFetch(): FetchImpl {
    return (url) => {
      if (url === '/api/tenants') return jsonResponse({ tenants: [{ slug: 'ao03-sim', kind: 'sim' }], liveAllowed: false });
      if (url === '/api/commands') return jsonResponse({ domains: grouped() });
      if (url.startsWith('/api/tenant/bindings')) {
        expect(url).toContain('commandId=F-11');
        return jsonResponse({ bindings: { firewallName: 'fw-cmmc-01', resourceGroup: 'rg-eo-prod-01' } });
      }
      if (url.startsWith('/api/tenant?')) return jsonResponse(STACKSIM_SHAPED_TENANT);
      if (url.startsWith('/api/approvals')) return jsonResponse({ success: true, approvals: [] });
      return jsonResponse({}, 404);
    };
  }

  function inputTag(html: string, id: string): string {
    const m = new RegExp(`<input[^>]*id="param-${id}"[^>]*>`).exec(html);
    return m ? m[0] : '';
  }

  it('renders param-firewallName and param-resourceGroup pre-filled with the resolved values', async () => {
    const ui = loadUi(makeFetch());
    await ui.run('loadTenants()');
    await ui.run('loadRegistry()');
    ui.el('tenantSelect').value = 'ao03-sim';
    await ui.run(`openCommandForm('F-11')`);

    const html = ui.el('formParams').innerHTML;
    expect(inputTag(html, 'firewallName')).toContain('value="fw-cmmc-01"');
    expect(inputTag(html, 'resourceGroup')).toContain('value="rg-eo-prod-01"');
    // Would have been '' under the old `tenantConfig[param.source]` (literal-key) lookup —
    // the raw tenant object has no flat 'resources.firewallName' key, only the nested
    // snake_case one.
    expect(inputTag(html, 'firewallName')).not.toContain('value=""');
  });

  it('re-fills F-11 fields on tenant change via onTenantChanged, not just on first open', async () => {
    const ui = loadUi(makeFetch());
    await ui.run('loadTenants()');
    await ui.run('loadRegistry()');
    ui.el('tenantSelect').value = 'ao03-sim';
    await ui.run(`openCommandForm('F-11')`);
    // Simulate re-selecting the same tenant (onTenantChanged is the select's onchange).
    await ui.run('onTenantChanged()');
    expect(ui.el('param-firewallName').value).toBe('fw-cmmc-01');
    expect(ui.el('param-resourceGroup').value).toBe('rg-eo-prod-01');
  });
});
