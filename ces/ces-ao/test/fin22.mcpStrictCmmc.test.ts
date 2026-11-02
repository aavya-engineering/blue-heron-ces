// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-22 (V127 unit half: MCP surface): ao_execute takes `strictCmmc`, the MCP twin of the CLI's
// --strict-cmmc (AUDIT-ADMINOPS.md "ao_execute cannot pass strictCmmc"). Like the CLI flag it
// only tightens: `true` reaches the executor; `false` or a non-boolean is dropped, so an agent
// cannot loosen AO_CMMC_STRICT. Then the real gate: a tenant without CMMC scoping fields is
// denied under strictCmmc:true and is not denied without it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = {
  tenantSlug: 'fin22-sim',
  tenantId: 'fin22-tenant',
  appId: 'fin22-app',
  certPath: 'C:/nonexistent/fin22.pfx',
  certThumbprint: 'F22F220000000000000000000000000000000000',
  domain: 'fin22.onmicrosoft.us',
  kind: 'sim',
  cmmcLevel: 'L2',
  endpoints: {},
  resources: {},
};

vi.mock('../src/tenant/aoTenants.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadTenantConfigBySlug: async () => ({ ...TENANT }),
}));

const exec = vi.hoisted(() => {
  const state = { fn: undefined as any };
  state.fn = vi.fn(async () => ({ success: true, output: 'stubbed', evidence: { commandId: 'x', dryRun: true } }));
  return state;
});
vi.mock('../src/execution/CommandExecutor.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeAoCommand: exec.fn,
}));

import { AO_MCP_TOOLS, callAoMcpTool } from '../src/mcp/aoMcpTools.js';
import { loadRegistry } from '../src/execution/invokeCommand.js';
import { evaluate as evaluateCmmcGate } from '../src/execution/CmmcScopeGate.js';

const registry = loadRegistry();
const tier2 = registry.find((c) => c.sodTier === 'Tier 2' && c.parameters.every((p) => !p.required || p.source))!;

function lastOpts(): Record<string, unknown> {
  const call = exec.fn.mock.calls.at(-1)!;
  return JSON.parse(JSON.stringify(call[4] ?? {}));
}

beforeEach(() => exec.fn.mockClear());

describe('FIN-22: ao_execute strictCmmc (MCP twin of --strict-cmmc)', () => {
  it('the tool schema declares strictCmmc as a boolean', () => {
    const tool = AO_MCP_TOOLS.find((t) => t.name === 'ao_execute')!;
    expect((tool.inputSchema.properties as any).strictCmmc.type).toBe('boolean');
  });

  it('strictCmmc:true reaches the executor exactly as the CLI flag does', async () => {
    await callAoMcpTool('ao_execute', { commandId: tier2.id, tenant: TENANT.tenantSlug, strictCmmc: true }, { env: {} });
    expect(lastOpts().strictCmmc).toBe(true);
  });

  it('strictCmmc:false, a string or no value is dropped (it can only tighten)', async () => {
    for (const v of [false, 'true', 1, undefined]) {
      await callAoMcpTool('ao_execute', { commandId: tier2.id, tenant: TENANT.tenantSlug, strictCmmc: v }, { env: {} });
      expect(lastOpts(), String(v)).not.toHaveProperty('strictCmmc');
    }
  });

  it('the gate the flag drives: strict denies a tenant with no CMMC scoping fields; non-strict does not', () => {
    const unscoped = { tenantSlug: 'fin22-unscoped' } as any;
    const strict = evaluateCmmcGate(unscoped, tier2 as any, { strictCmmc: true });
    const loose = evaluateCmmcGate(unscoped, tier2 as any, { strictCmmc: false });
    expect(strict.allow).toBe(false);
    expect(loose.allow).toBe(true);
  });
});
