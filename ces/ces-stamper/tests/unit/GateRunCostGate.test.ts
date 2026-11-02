// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// GATE-RUN (COST-GATE-SPEC §3.4-§3.5, §3.9): DP-2 is typed at the PowerShellAdapter guard site as
// `<entry id> <monthly cost>` before a recurring SET is sent; DP-1 is given by `stamper cost-ack` or
// POST /api/cost-gate/ack; both write cost-gate evidence. Fail-closed: no runtime = refused.
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import http from 'http';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { tenantBaseDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { COST_GATE_EVIDENCE_DIR, readCostAcks, recordCostAck, type CostGateReference } from '../../src/core/CostGate';
import { runDp2, expectedDp2Text, dp2PromptText, buildDp2Prompt, setProcessCostGateRuntime, type Dp2Prompt } from '../../src/adapters/CostGateDp2';
import { giveDp1, dp1Summary } from '../../src/cli/costAckCommand';
import { createCostAckRouter } from '../../src/server/routes/costAck.routes';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const ENTRY = 'GR.test.vault';
const FREE_ENTRY = 'GR.test.free';

function makeRef(): CostGateReference {
  const items = [
    {
      item_id: ENTRY, kind: 'registry_entry' as const, source: 'test', label: 'Test vault', control_ids: ['SC.L2-3.13.10'],
      cost_gate: { recurring: true, cost_key: 'test.kv', estimate_basis: '1 vault, per-use operations', standard_alternative: ['SC.L2-3.13.10.key-escrow'], free_reason: null },
    },
    {
      item_id: FREE_ENTRY, kind: 'registry_entry' as const, source: 'test', label: 'Free read', control_ids: ['AC.L1-3.1.1'],
      cost_gate: { recurring: false, free_reason: 'no_meter' as const },
    },
  ];
  return {
    estimates: {
      schema_version: '1.0.0', currency: 'USD', region: 'usgov', price_date: '2026-10-31', source: 'test',
      prices: { 'test.kv': { label: 'kv', unit: 'month', estimate_month_low: 4.56, estimate_month_high: 4.56, basis: 'per-use', commercial_list: false } },
    },
    catalogue: { schema_version: '1.0.0', items },
    byId: new Map(items.map(i => [i.item_id, i])),
  };
}

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

function makeTask(id: string, subs: SubCommand[]): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'powershell', command: 'placeholder', args: { _sub_commands: subs } },
    inputs: [], outputs: [], controls: ['SC.L2-3.13.10'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

function sub(id: string, set: string): SubCommand {
  return {
    id, label: id, engine: 'azure', sequence_hint: 1, set_command: set, get_command: '',
    idempotency: 'unsafe', variables_required: [], variables_runtime: [], on_failure: 'warn_continue', evidence_commands: [],
  };
}

function fakeSession() {
  const received: string[] = [];
  return { received, manager: { execute: async (_t: string, command: string) => { if (!command.startsWith('Get-Module')) received.push(command); return { stdout: 'ok', stderr: '', exitCode: 0 }; } } };
}

function adapterFor(tenant: string, ref: CostGateReference) {
  const s = fakeSession();
  const adapter = new PowerShellAdapter(makeConfig(), s.manager as any, undefined, undefined, tenant);
  (adapter as any).costGateRef = ref;
  return { adapter, received: s.received };
}

function dp2Records(tenant: string): any[] {
  const dir = path.join(tenantBaseDir(tenant), COST_GATE_EVIDENCE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('-dp2.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

afterEach(() => setProcessCostGateRuntime(undefined));

describe('GATE-RUN DP-2 at the PowerShellAdapter guard site', () => {
  it('fail-closed: no DP-1 and no runtime -> the SET is never sent; blocked with cost_gated_off and the estimate; dp2 refused evidence', async () => {
    const tenant = 'gr-dp2-none';
    const { adapter, received } = adapterFor(tenant, makeRef());
    const result = await adapter.execute(makeTask('t-none', [sub(ENTRY, "New-AzKeyVault -Name 'kv' -Sku 'Standard'")]), {}, false);
    expect(result.success).toBe(false);
    expect(received.some(c => c.includes('New-AzKeyVault'))).toBe(false);
    expect(result.error).toContain('cost_gated_off');
    expect(result.error).toContain('$4.56');
    const recs = dp2Records(tenant);
    expect(recs).toHaveLength(1);
    expect(recs[0].outcome).toBe('refused');
    expect(recs[0].metadata).toMatchObject({ gate: 'cost', dp: 2, entryId: ENTRY, estimateShown: '$4.56' });
    expect(adapter.getRecurringCostRunReportLine()).toBe('Recurring cost enabled by this run: none');
  });

  it('DP-1 + manual + typed "<entry id> <monthly cost>" -> prompt shows the estimate, the SET is sent, run-report line counts it', async () => {
    const tenant = 'gr-dp2-ok';
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'test-operator' }, ref);
    const { adapter, received } = adapterFor(tenant, ref);
    const prompts: Dp2Prompt[] = [];
    adapter.setCostGateRuntime({ mode: 'manual', interactive: true, promptDp2: async (p) => { prompts.push(p); return { typed: `${ENTRY} $4.56`, operator: 'test-operator' }; } });
    const result = await adapter.execute(makeTask('t-ok', [sub(ENTRY, "New-AzKeyVault -Name 'kv' -Sku 'Standard'")]), {}, false);
    expect(result.success).toBe(true);
    expect(received.some(c => c.includes('New-AzKeyVault'))).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].expected).toBe(`${ENTRY} $4.56`);
    expect(dp2PromptText(prompts[0])).toContain('about $4.56 a month');
    const recs = dp2Records(tenant);
    expect(recs.map(r => r.outcome)).toEqual(['accepted']);
    expect(recs[0].metadata.typed).toBe(`${ENTRY} $4.56`);
    expect(recs[0].metadata.ackHash).toMatch(/^[0-9a-f]{64}$/);
    expect(adapter.getRecurringCostRunReportLine()).toBe('Recurring cost enabled by this run: 1 item, about $4.56 a month (price date 2026-10-31)');
  });

  it('the entry id alone (or the figure alone) is refused: the typed form is "<entry id> <monthly cost>"', async () => {
    const tenant = 'gr-dp2-partial';
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'test-operator' }, ref);
    for (const typed of [ENTRY, '$4.56']) {
      const out = await runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: { mode: 'manual', interactive: true, promptDp2: async () => ({ typed }) }, tenantDir: tenantBaseDir(tenant) });
      expect(out.allowed).toBe(false);
      expect(out.reason).toContain(expectedDp2Text(ENTRY, '$4.56'));
      expect(out.evidence.metadata.typed).toBe(typed);
    }
  });

  it('auto mode, no terminal and harness runs are refused before any prompt', async () => {
    const tenant = 'gr-dp2-modes';
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'test-operator' }, ref);
    const acks = readCostAcks(tenantBaseDir(tenant));
    let asked = 0;
    const promptDp2 = async () => { asked++; return { typed: `${ENTRY} $4.56` }; };
    const auto = await runDp2({ entryId: ENTRY, ref, acks, runtime: { mode: 'auto', interactive: true, promptDp2 } });
    const headless = await runDp2({ entryId: ENTRY, ref, acks, runtime: { mode: 'manual', interactive: false, promptDp2 } });
    const harness = await runDp2({ entryId: ENTRY, ref, acks, runtime: { mode: 'manual', interactive: true, harness: true, promptDp2 } });
    expect([auto.allowed, headless.allowed, harness.allowed]).toEqual([false, false, false]);
    expect(auto.reason).toContain('--mode manual');
    expect(headless.reason).toContain('terminal');
    expect(harness.reason).toContain('harness');
    expect(asked).toBe(0);
  });

  it('DP-1 given but no runtime for the run -> refused as "no DP-2 confirmation channel"', async () => {
    const ref = makeRef();
    const tenant = 'gr-dp2-nochannel';
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'test-operator' }, ref);
    const out = await runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)) });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain('no DP-2 confirmation channel');
  });

  it('the process runtime (set by the CLI execute command) is used when the adapter has none', async () => {
    const tenant = 'gr-dp2-process';
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'test-operator' }, ref);
    setProcessCostGateRuntime({ mode: 'manual', interactive: true, promptDp2: async () => ({ typed: `  ${ENTRY}   $4.56 ` }) });
    const { adapter, received } = adapterFor(tenant, ref);
    const result = await adapter.execute(makeTask('t-proc', [sub(ENTRY, "New-AzKeyVault -Name 'kv'")]), {}, false);
    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('a free entry, and a recurring entry in dry-run, never reach DP-2', async () => {
    const tenant = 'gr-dp2-free';
    const { adapter, received } = adapterFor(tenant, makeRef());
    const free = await adapter.execute(makeTask('t-free', [sub(FREE_ENTRY, "Set-Thing -Enabled $true")]), {}, false);
    expect(free.success).toBe(true);
    expect(received).toHaveLength(1);
    const dry = await adapter.execute(makeTask('t-dry', [sub(ENTRY, "New-AzKeyVault -Name 'kv'")]), {}, true);
    expect(dry.success).toBe(true);
    expect(dp2Records(tenant)).toHaveLength(0);
  });

  it('fail-closed classification: an uncatalogued costly SET is blocked too', async () => {
    const tenant = 'gr-dp2-uncatalogued';
    const { adapter, received } = adapterFor(tenant, makeRef());
    const result = await adapter.execute(makeTask('t-unc', [sub('GR.test.unknown', "New-AzFirewall -Name 'fw'")]), {}, false);
    expect(result.success).toBe(false);
    expect(received).toHaveLength(0);
    expect(result.error).toContain('cost_gated_off');
  });

  it('buildDp2Prompt carries the estimate, basis, price date and the standard alternative', () => {
    const p = buildDp2Prompt(ENTRY, makeRef())!;
    expect(p).toMatchObject({ estimate: '$4.56', priceDate: '2026-10-31', standardAlternative: ['SC.L2-3.13.10.key-escrow'], expected: `${ENTRY} $4.56` });
  });
});

describe('GATE-RUN DP-1 (cost-ack command core and GUI route)', () => {
  it('giveDp1 refuses a typed text other than the entry id, a free entry and an unknown one', () => {
    const ref = makeRef();
    expect(() => giveDp1({ tenant: 'gr-dp1-refuse', entryId: ENTRY, typed: 'yes', operator: 'test-operator', ref })).toThrow('does not match the entry id');
    expect(() => giveDp1({ tenant: 'gr-dp1-refuse', entryId: FREE_ENTRY, typed: FREE_ENTRY, operator: 'test-operator', ref })).toThrow('is free');
    expect(() => giveDp1({ tenant: 'gr-dp1-refuse', entryId: 'nope', typed: 'nope', operator: 'test-operator', ref })).toThrow('no cost record');
    expect(() => giveDp1({ tenant: '../x', entryId: ENTRY, typed: ENTRY, operator: 'test-operator', ref })).toThrow('not valid');
    expect(readCostAcks(tenantBaseDir('gr-dp1-refuse'))).toEqual([]);
  });

  it('giveDp1 records cost-acks.json with the estimate shown and a dp:1 evidence record', () => {
    const ref = makeRef();
    const { ack, evidencePath, summary } = giveDp1({ tenant: 'gr-dp1-ok', entryId: ENTRY, typed: ENTRY, operator: 'test-operator', ref });
    expect(summary.estimate).toBe('$4.56');
    expect(ack).toMatchObject({ entry_id: ENTRY, estimate_month_low: 4.56, price_date: '2026-10-31', operator: 'test-operator' });
    expect(readCostAcks(tenantBaseDir('gr-dp1-ok'))).toHaveLength(1);
    const rec = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
    expect(rec.metadata).toMatchObject({ gate: 'cost', dp: 1, entryId: ENTRY, estimateShown: '$4.56' });
    expect(dp1Summary(ENTRY, ref)).toMatchObject({ estimate: '$4.56', standard_alternative: ['SC.L2-3.13.10.key-escrow'] });
  });

  it('GET /api/cost-gate/items lists recurring entries unticked; POST /api/cost-gate/ack needs the typed entry id', async () => {
    const app = express();
    app.use(express.json());
    app.use(createCostAckRouter());
    const server: http.Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const list = await (await fetch(`${base}/api/cost-gate/items?tenant=gr-route`)).json() as any;
      expect(list.items.length).toBeGreaterThan(0);
      expect(list.items.every((i: any) => i.acked === false)).toBe(true);
      const vault = list.items.find((i: any) => i.entry_id === 'SC.L2-3.13.10.key-vault');
      expect(vault).toBeDefined();
      expect(typeof vault.estimate).toBe('string');

      const bad = await fetch(`${base}/api/cost-gate/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 'gr-route', entryId: 'SC.L2-3.13.10.key-vault', typed: 'ok', operator: 'test-operator' }) });
      expect(bad.status).toBe(400);
      const good = await fetch(`${base}/api/cost-gate/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 'gr-route', entryId: 'SC.L2-3.13.10.key-vault', typed: 'SC.L2-3.13.10.key-vault', operator: 'test-operator' }) });
      expect(good.status).toBe(200);
      const after = await (await fetch(`${base}/api/cost-gate/items?tenant=gr-route`)).json() as any;
      expect(after.items.find((i: any) => i.entry_id === 'SC.L2-3.13.10.key-vault').acked).toBe(true);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
