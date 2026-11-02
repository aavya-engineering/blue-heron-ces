// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-16 (COST-GATE-SPEC §3.5 GUI; V115): DP-2 in the Stamper GUI. A recurring SET's DP-2 becomes
// a pending cost approval (`cost::<entry id>`) that POST /api/approve answers with gateType 'cost'
// and a required typed `<entry id> <monthly cost>`. Without DP-1 the run refuses before any prompt;
// a wrong text, a skip, an abort or a timeout refuses; a scripted answer counts only on a sim tenant.
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import http from 'http';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { tenantBaseDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { COST_GATE_EVIDENCE_DIR, readCostAcks, recordCostAck, type CostGateReference } from '../../src/core/CostGate';
import { runDp2, getProcessCostGateRuntime, setProcessCostGateRuntime } from '../../src/adapters/CostGateDp2';
import { createGuiCostGate, costGateKey, type ApprovalGateMap } from '../../src/server/guiCostGate';
import { createExecuteRouter } from '../../src/server/routes/execute.routes';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const ENTRY = 'F16.test.vault';
const TYPED = `${ENTRY} $4.56`;

function makeRef(): CostGateReference {
  const items = [
    {
      item_id: ENTRY, kind: 'registry_entry' as const, source: 'test', label: 'Test vault', control_ids: ['SC.L2-3.13.10'],
      cost_gate: { recurring: true, cost_key: 'test.kv', estimate_basis: '1 vault, per-use operations', standard_alternative: ['SC.L2-3.13.10.key-escrow'], free_reason: null },
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

function adapterFor(tenant: string, ref: CostGateReference) {
  const received: string[] = [];
  const manager = { execute: async (_t: string, command: string) => { if (!command.startsWith('Get-Module')) received.push(command); return { stdout: 'ok', stderr: '', exitCode: 0 }; } };
  const config = StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
  const adapter = new PowerShellAdapter(config, manager as any, undefined, undefined, tenant);
  (adapter as any).costGateRef = ref;
  return { adapter, received };
}

function dp2Records(tenant: string): any[] {
  const dir = path.join(tenantBaseDir(tenant), COST_GATE_EVIDENCE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('-dp2.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

function freshTenant(slug: string): string {
  fs.rmSync(tenantBaseDir(slug), { recursive: true, force: true });
  return slug;
}

async function waitForPending(gate: { pending(): unknown[] }): Promise<void> {
  for (let i = 0; i < 200 && gate.pending().length === 0; i++) await new Promise(r => setTimeout(r, 5));
}

const kinds: Record<string, string> = { 'f16-sim': 'sim', 'f16-live': 'live' };
function makeGate(approvalGate: ApprovalGateMap = new Map(), timeoutMs?: number) {
  return createGuiCostGate({ approvalGate, lookupTenantKind: async (s) => kinds[s], log: () => undefined, ...(timeoutMs ? { timeoutMs } : {}) });
}

afterEach(() => setProcessCostGateRuntime(undefined));

describe('FIN-16 GUI DP-2 broker', () => {
  it('no DP-1 -> refused before any prompt (nothing pending), SET never sent', async () => {
    const tenant = freshTenant('f16-nodp1');
    const gate = makeGate();
    const { adapter, received } = adapterFor(tenant, makeRef());
    adapter.setCostGateRuntime(gate.runtime);
    const result = await adapter.execute(makeTask('t', [sub(ENTRY, "New-AzKeyVault -Name 'kv'")]), {}, false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cost_gated_off: no DP-1');
    expect(gate.pending()).toHaveLength(0);
    expect(received).toHaveLength(0);
    expect(dp2Records(tenant).map(r => r.outcome)).toEqual(['refused']);
  });

  it('DP-1 + the typed text in the dialog -> pending shows the price, the SET runs, DP-2 accepted evidence with the operator', async () => {
    const tenant = freshTenant('f16-ok');
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
    const approvalGate: ApprovalGateMap = new Map();
    const gate = makeGate(approvalGate);
    const { adapter, received } = adapterFor(tenant, ref);
    adapter.setCostGateRuntime(gate.runtime);
    const run = adapter.execute(makeTask('t', [sub(ENTRY, "New-AzKeyVault -Name 'kv'")]), {}, false);
    await waitForPending(gate);
    const [p] = gate.pending();
    expect(p).toMatchObject({ entryId: ENTRY, estimate: '$4.56', priceDate: '2026-10-31', expected: TYPED, gateKey: costGateKey(ENTRY), standardAlternative: ['SC.L2-3.13.10.key-escrow'] });
    expect(approvalGate.has(costGateKey(ENTRY))).toBe(true);
    const ans = await gate.answer({ entryId: ENTRY, typed: TYPED, operator: 'gui-operator', tenant, decision: 'approve' });
    expect(ans).toEqual({ status: 200, body: { ok: true, outcome: 'accepted', gateKey: costGateKey(ENTRY) } });
    const result = await run;
    expect(result.success).toBe(true);
    expect(received.some(c => c.includes('New-AzKeyVault'))).toBe(true);
    expect(gate.pending()).toHaveLength(0);
    expect(approvalGate.has(costGateKey(ENTRY))).toBe(false);
    const recs = dp2Records(tenant);
    expect(recs.map(r => r.outcome)).toEqual(['accepted']);
    expect(recs[0].metadata).toMatchObject({ gate: 'cost', dp: 2, typed: TYPED, operator: 'gui-operator', estimateShown: '$4.56' });
    // DP-1 evidence is there too (both confirmations evidenced, V115).
    const dp1 = fs.readdirSync(path.join(tenantBaseDir(tenant), COST_GATE_EVIDENCE_DIR)).filter(f => f.endsWith('-dp1.json'));
    expect(dp1).toHaveLength(1);
  });

  it('wrong typed text -> refused (the entry id alone is not enough)', async () => {
    const tenant = freshTenant('f16-wrong');
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
    const gate = makeGate();
    const out = runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime, tenantDir: tenantBaseDir(tenant) });
    await waitForPending(gate);
    const ans = await gate.answer({ entryId: ENTRY, typed: ENTRY, operator: 'gui-operator', decision: 'approve' });
    expect(ans.status).toBe(200);
    expect(ans.body.outcome).toBe('refused');
    const res = await out;
    expect(res.allowed).toBe(false);
    expect(res.evidence.metadata.typed).toBe(ENTRY);
  });

  it('typed and operator are required; an unknown entry is 404', async () => {
    const tenant = freshTenant('f16-req');
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
    const gate = makeGate();
    const out = runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime });
    await waitForPending(gate);
    expect((await gate.answer({ entryId: ENTRY, operator: 'gui-operator', decision: 'approve' })).status).toBe(400);
    expect((await gate.answer({ entryId: ENTRY, typed: TYPED, decision: 'approve' })).status).toBe(400);
    expect((await gate.answer({ entryId: 'nope', typed: TYPED, operator: 'x', decision: 'approve' })).status).toBe(404);
    expect((await gate.answer({ typed: TYPED, operator: 'x' })).status).toBe(400);
    expect(gate.pending()).toHaveLength(1);
    await gate.answer({ entryId: ENTRY, decision: 'skip' });
    expect((await out).allowed).toBe(false);
  });

  it('skip, /api/abort (approvalGate skip) and a timeout all refuse', async () => {
    const ref = makeRef();
    for (const how of ['skip', 'abort', 'timeout'] as const) {
      const tenant = freshTenant(`f16-${how}`);
      recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
      const approvalGate: ApprovalGateMap = new Map();
      const gate = makeGate(approvalGate, how === 'timeout' ? 30 : undefined);
      const out = runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime });
      await waitForPending(gate);
      if (how === 'skip') await gate.answer({ entryId: ENTRY, decision: 'skip' });
      if (how === 'abort') approvalGate.get(costGateKey(ENTRY))!('skip');
      const res = await out;
      expect(res.allowed).toBe(false);
      expect(gate.pending()).toHaveLength(0);
      expect(approvalGate.size).toBe(0);
    }
  });

  it('FD-1: a scripted answer is refused (403) on a non-sim tenant and accepted on a sim tenant', async () => {
    const ref = makeRef();
    for (const [tenant, want] of [['f16-live', false], ['f16-sim', true], ['f16-unregistered', false]] as const) {
      freshTenant(tenant);
      recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
      const gate = makeGate();
      const out = runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime, tenantDir: tenantBaseDir(tenant) });
      await waitForPending(gate);
      const ans = await gate.answer({ entryId: ENTRY, typed: TYPED, operator: 'tester', tenant, decision: 'approve', automated: true });
      expect(ans.status).toBe(want ? 200 : 403);
      const res = await out;
      expect(res.allowed).toBe(want);
      expect(dp2Records(tenant).map(r => r.outcome)).toEqual([want ? 'accepted' : 'refused']);
    }
  });

  it('beginRun: an auto run refuses DP-2 with no prompt; the restore puts manual back', async () => {
    const tenant = freshTenant('f16-auto');
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
    const gate = makeGate();
    const end = gate.beginRun({ mode: 'auto', tenant });
    expect(gate.runtime.mode).toBe('auto');
    const res = await runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime, tenantDir: tenantBaseDir(tenant) });
    expect(res.allowed).toBe(false);
    expect(gate.pending()).toHaveLength(0);
    end();
    expect(gate.runtime.mode).toBe('manual');
  });

  it('FD-1 judges the run tenant: a scripted answer naming a sim tenant during a live run is refused', async () => {
    const tenant = freshTenant('f16-live');
    const ref = makeRef();
    recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
    const gate = makeGate();
    const end = gate.beginRun({ mode: 'manual', tenant });
    const out = runDp2({ entryId: ENTRY, ref, acks: readCostAcks(tenantBaseDir(tenant)), runtime: gate.runtime, tenantDir: tenantBaseDir(tenant) });
    await waitForPending(gate);
    const ans = await gate.answer({ entryId: ENTRY, typed: TYPED, operator: 'tester', tenant: 'f16-sim', decision: 'approve', automated: true });
    expect(ans.status).toBe(403);
    expect((await out).allowed).toBe(false);
    end();
  });
});

describe('FIN-16 execute router: /api/cost-gate/pending and POST /api/approve gateType cost', () => {
  it('installs the GUI runtime only when none is set, lists the pending prompt and answers it over HTTP', async () => {
    const cliRuntime = { mode: 'manual' as const, interactive: true };
    setProcessCostGateRuntime(cliRuntime);
    createExecuteRouter(new Map(), () => false, () => undefined);
    expect(getProcessCostGateRuntime()).toBe(cliRuntime);
    setProcessCostGateRuntime(undefined);

    const approvalGate = new Map<string, (d: 'approve' | 'skip' | 'accomplish') => void>();
    const app = express();
    app.use(express.json());
    app.use(createExecuteRouter(approvalGate, () => false, () => undefined));
    const runtime = getProcessCostGateRuntime();
    expect(runtime).toMatchObject({ mode: 'manual', interactive: true });
    const server: http.Server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (body: object) => fetch(`${base}/api/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
      const tenant = freshTenant('f16-http');
      const ref = makeRef();
      recordCostAck(tenantBaseDir(tenant), { entry_id: ENTRY, operator: 'gui-operator' }, ref);
      const { adapter, received } = adapterFor(tenant, ref);
      const run = adapter.execute(makeTask('t', [sub(ENTRY, "New-AzKeyVault -Name 'kv'")]), {}, false);

      let pending: any[] = [];
      for (let i = 0; i < 200 && pending.length === 0; i++) {
        pending = ((await (await fetch(`${base}/api/cost-gate/pending`)).json()) as any).pending;
        if (pending.length === 0) await new Promise(r => setTimeout(r, 5));
      }
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ entryId: ENTRY, estimate: '$4.56', expected: TYPED });

      expect((await post({ gateType: 'cost', entryId: ENTRY, decision: 'approve', operator: 'gui-operator' })).status).toBe(400);
      const ok = await post({ gateType: 'cost', entryId: ENTRY, decision: 'approve', typed: TYPED, operator: 'gui-operator', tenant });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, outcome: 'accepted' });
      expect((await run).success).toBe(true);
      expect(received.some(c => c.includes('New-AzKeyVault'))).toBe(true);

      // The step / sub-command / layer gates are unchanged.
      approvalGate.set('T1::S1', () => undefined);
      expect((await post({ taskId: 'T1', subId: 'S1', decision: 'approve' })).status).toBe(200);
      expect((await post({ taskId: 'T2', decision: 'approve' })).status).toBe(404);
      expect((await post({ taskId: 'T2' })).status).toBe(400);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
