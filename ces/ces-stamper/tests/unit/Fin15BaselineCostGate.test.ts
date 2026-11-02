// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-15 (finishing plan PH-1): "Bring to Baseline" fails honestly and asks for the operator's two
// cost confirmations (DP-1 = plan-time opt-in, DP-2 = typed at run time; COST-GATE-SPEC §3.4-§3.5,
// CG-6). Also the run-report cost line and the cost_gate / gate:'cost' schema declarations.
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import http from 'http';
import { fileURLToPath } from 'node:url';
import {
  BaselineProvisioner,
  BASELINE_RESOURCE_TYPES,
  BASELINE_COST_KEYS,
  baselineCostEntryId,
  baselineCostReference,
  isBaselineRecurring,
  parseDiscovery,
} from '../../src/core/BaselineProvisioner';
import {
  baselineCostItems,
  makeBaselineCostDecider,
  parseDp2Param,
  createBaselineRouter,
} from '../../src/server/routes/baseline.routes';
import { loadCostGateReference, recordCostAck, COST_GATE_EVIDENCE_DIR } from '../../src/core/CostGate';
import { tenantBaseDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { ExecutionReporter } from '../../src/reporting/ExecutionReporter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { StructuredEvidenceSchema } from '../../src/types/schema.types';
import { CommandRegistrySchema } from '../../src/registry/command-registry.types';
import type { AzureResourceDefinition } from '../../src/types/baseline.types';

const VARS: Record<string, string> = {
  subscriptionId: 'sub-1', resourceGroup: 'rg-fin15', location: 'usgovvirginia',
  lawWorkspaceName: 'law-fin15', storageAccountName: 'stfin15', keyVaultName: 'kv-fin15',
  cmkKeyName: 'cmk-fin15', vnetName: 'vnet-fin15', vnetCidr: '10.0.0.0/16', subnetPeName: 'snet-pe',
  subnetPeCidr: '10.0.1.0/24', nsgPeName: 'nsg-pe', automationAccountName: 'aa-fin15', eoAppDisplayName: 'eo-app',
};

type Res = { stdout: string; stderr: string; exitCode: number };

/** The resource a command acts on: provision = the last `-Name` (else `-VaultName`); discovery = the first. */
function targetOf(command: string, provision: boolean): string | undefined {
  const names = [...command.matchAll(/-Name '([^']+)'/g)].map(m => m[1]);
  const vault = /-VaultName '([^']+)'/.exec(command)?.[1];
  if (names.length === 0) return vault;
  return provision ? names[names.length - 1] : names[0];
}

/**
 * A session stub. `provision` answers a provision command by resource name (default: exit 0, clean).
 * A discovery read finds a resource when a clean provision created it, or (when given) when it is in
 * `existsAfter`.
 */
function stubSession(opts: { provision?: Record<string, Res>; existsAfter?: Set<string> }) {
  const sent: string[] = [];
  const created = new Set<string>();
  const manager = {
    execute: async (_type: string, command: string): Promise<Res> => {
      sent.push(command);
      if (/^(New-|Add-|\$vnet = )/.test(command)) {
        const name = targetOf(command, true) ?? '';
        const r = opts.provision?.[name] ?? { stdout: '{}', stderr: '', exitCode: 0 };
        if (r.exitCode === 0 && !r.stderr) created.add(name);
        return r;
      }
      const name = targetOf(command, false) ?? '';
      const exists = opts.existsAfter ? opts.existsAfter.has(name) : created.has(name);
      return exists ? { stdout: JSON.stringify({ ResourceId: `/subs/x/${name}`, Id: `/subs/x/${name}` }), stderr: '', exitCode: 0 } : { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  return { sent, manager };
}

function provisioner(session: { execute: (t: string, c: string) => Promise<Res> }): BaselineProvisioner {
  return new BaselineProvisioner('fin15-tenant', VARS, () => false, session as any, { registerCaptures: () => undefined } as any);
}

function events() {
  const list: any[] = [];
  return { list, send: (d: object) => list.push(d) };
}

const rg = (p: BaselineProvisioner) => p.getResourceDefinitions('m365_foundation').filter(r => r.resourceType === 'ResourceGroup');

describe('FIN-15 BaselineProvisioner: honest failure', () => {
  it('every provision command stops on error; discovery keeps SilentlyContinue', () => {
    const p = provisioner(stubSession({}).manager);
    const defs = p.getResourceDefinitions('m365_full_infra');
    for (const d of defs) {
      expect(d.provisionCommand).not.toContain('SilentlyContinue');
      expect(d.provisionCommand).toContain('-ErrorAction Stop');
    }
    expect(defs.map(d => d.resourceType)).toEqual([...BASELINE_RESOURCE_TYPES.m365_full_infra]);
    expect(p.getResourceDefinitions('m365_foundation').map(d => d.resourceType)).toEqual([...BASELINE_RESOURCE_TYPES.m365_foundation]);
  });

  it('exit 0, no stderr and found afterwards = succeeded', async () => {
    const s = stubSession({});
    const p = provisioner(s.manager);
    const e = events();
    const r = await p.executeGaps(rg(p), e.send);
    expect(r).toEqual({ succeeded: 1, failed: 0, skipped: 0, costGatedOff: 0, recurringEnabled: [] });
    expect(e.list.filter(x => x.type === 'baseline_error')).toHaveLength(0);
  });

  it('a non-zero exit is a failure, and its dependents are skipped', async () => {
    const p = provisioner(stubSession({ provision: { 'rg-fin15': { stdout: '', stderr: 'AuthorizationFailed', exitCode: 1 } } }).manager);
    const e = events();
    const defs = p.getResourceDefinitions('m365_full_infra').filter(d => ['ResourceGroup', 'VNet', 'NSG'].includes(d.resourceType));
    const r = await p.executeGaps(defs, e.send);
    expect(r.failed).toBe(1);
    expect(r.succeeded).toBe(0);
    expect(r.skipped).toBe(2);
    expect(e.list.find(x => x.type === 'baseline_error' && x.resourceName === 'rg-fin15').error).toBe('AuthorizationFailed');
  });

  it('a negative exit code is a failure too', async () => {
    const p = provisioner(stubSession({ provision: { 'rg-fin15': { stdout: '', stderr: '', exitCode: -1 } } }).manager);
    const r = await p.executeGaps(rg(p), events().send);
    expect(r.failed).toBe(1);
  });

  it('exit 0 with error output is a failure', async () => {
    const p = provisioner(stubSession({ provision: { 'rg-fin15': { stdout: '{}', stderr: 'New-AzResourceGroup : The client does not have authorization', exitCode: 0 } } }).manager);
    const e = events();
    const r = await p.executeGaps(rg(p), e.send);
    expect(r.failed).toBe(1);
    expect(e.list.find(x => x.type === 'baseline_error').error).toMatch(/^Provision wrote error output: /);
  });

  it('exit 0 and clean output, but not found afterwards, is a failure', async () => {
    const p = provisioner(stubSession({ existsAfter: new Set() }).manager);
    const e = events();
    const r = await p.executeGaps(rg(p), e.send);
    expect(r).toMatchObject({ succeeded: 0, failed: 1 });
    expect(e.list.find(x => x.type === 'baseline_error').error).toBe('Provision returned success but the resource is not found afterwards');
  });

  it('parseDiscovery: exists only with an id', () => {
    expect(parseDiscovery('STAMPER_EXECUTION_SUCCESS\n{"ResourceId":"/x"}')).toEqual({ exists: true, resourceId: '/x' });
    expect(parseDiscovery('{"Name":"x"}')).toEqual({ exists: false });
    expect(parseDiscovery('not json')).toEqual({ exists: false });
    expect(parseDiscovery('')).toEqual({ exists: false });
  });
});

describe('FIN-15 BaselineProvisioner: cost gate', () => {
  it('free types are RG, VNet, Subnet, NSG; the rest (and any unlisted type) are recurring', () => {
    expect(['ResourceGroup', 'VNet', 'Subnet', 'NSG'].map(isBaselineRecurring)).toEqual([false, false, false, false]);
    expect(['LogAnalyticsWorkspace', 'StorageAccount', 'KeyVault', 'CMKKey', 'AutomationAccount', 'SomethingNew'].map(isBaselineRecurring)).toEqual([true, true, true, true, true, true]);
    expect(BASELINE_COST_KEYS.StorageAccount).toBe('azure.storage.baseline_account');
  });

  it('with no cost gate every recurring resource is refused, no command is sent for it, and dependents are skipped', async () => {
    const s = stubSession({});
    const p = provisioner(s.manager);
    const e = events();
    const r = await p.executeGaps(p.getResourceDefinitions('m365_foundation'), e.send);
    expect(r).toEqual({ succeeded: 1, failed: 0, skipped: 1, costGatedOff: 4, recurringEnabled: [] });
    expect(s.sent.some(c => /New-AzKeyVault|New-AzStorageAccount|New-AzOperationalInsightsWorkspace|New-AzAutomationAccount|Add-AzKeyVaultKey/.test(c))).toBe(false);
    const gates = e.list.filter(x => x.type === 'cost_gate');
    expect(gates.map(g => g.entryId)).toEqual(['baseline.LogAnalyticsWorkspace', 'baseline.StorageAccount', 'baseline.KeyVault', 'baseline.AutomationAccount']);
    expect(gates.every(g => g.allowed === false && /cost_gated_off/.test(g.reason))).toBe(true);
    expect(e.list.find(x => x.type === 'baseline_error' && x.resourceName === 'cmk-fin15').error).toBe('dependency kv-fin15 not provisioned (cost_gated_off)');
  });

  it('a resource the gate allows is provisioned and listed as enabled', async () => {
    const s = stubSession({});
    const p = provisioner(s.manager);
    const allow = async (res: AzureResourceDefinition) => ({ allowed: res.resourceType === 'StorageAccount', estimate: '$0.5-$2' });
    const defs = p.getResourceDefinitions('m365_foundation').filter(d => ['ResourceGroup', 'StorageAccount'].includes(d.resourceType));
    const r = await p.executeGaps(defs, events().send, allow);
    expect(r).toEqual({ succeeded: 2, failed: 0, skipped: 0, costGatedOff: 0, recurringEnabled: ['baseline.StorageAccount'] });
    expect(s.sent.some(c => c.startsWith('New-AzStorageAccount'))).toBe(true);
  });

  it('a gate that throws refuses (fail-closed)', async () => {
    const p = provisioner(stubSession({}).manager);
    const defs = p.getResourceDefinitions('m365_foundation').filter(d => d.resourceType === 'StorageAccount');
    const r = await p.executeGaps(defs, events().send, async () => { throw new Error('boom'); });
    expect(r.costGatedOff).toBe(1);
  });
});

describe('FIN-15 baseline DP-1 / DP-2 (real price file)', () => {
  const tenant = 'fin15-baseline';
  const dir = tenantBaseDir(tenant);
  const ref = baselineCostReference(loadCostGateReference());

  it('lists the recurring items of a posture, unticked, with estimate and the DP-2 text', () => {
    expect(baselineCostItems('m365_only', dir, ref)).toEqual([]);
    const items = baselineCostItems('m365_foundation', dir, ref);
    expect(items.map(i => i.entry_id)).toEqual(['LogAnalyticsWorkspace', 'StorageAccount', 'KeyVault', 'CMKKey', 'AutomationAccount'].map(baselineCostEntryId));
    const st = items.find(i => i.resourceType === 'StorageAccount')!;
    expect(st).toMatchObject({ acked: false, cost_key: 'azure.storage.baseline_account', price_date: ref.estimates.price_date });
    expect(st.estimate).toMatch(/^\$/);
    expect(st.expected_dp2).toBe(`baseline.StorageAccount ${st.estimate}`);
    expect(baselineCostItems('m365_full_infra', dir, ref)).toHaveLength(5);
  });

  it('DP-2 is refused without DP-1, refused on a wrong text, accepted with DP-1 and the exact text; each writes evidence', async () => {
    const storage = provisioner(stubSession({}).manager).getResourceDefinitions('m365_foundation').find(d => d.resourceType === 'StorageAccount')!;
    const expected = baselineCostItems('m365_foundation', dir, ref).find(i => i.resourceType === 'StorageAccount')!.expected_dp2!;

    const noDp1 = await makeBaselineCostDecider({ ref, tenantDir: dir, operator: 'op-1', dp2: { 'baseline.StorageAccount': expected } })(storage);
    expect(noDp1.allowed).toBe(false);
    expect(noDp1.reason).toMatch(/no DP-1/);

    recordCostAck(dir, { entry_id: 'baseline.StorageAccount', operator: 'op-1' }, ref);
    expect(baselineCostItems('m365_foundation', dir, ref).find(i => i.resourceType === 'StorageAccount')!.acked).toBe(true);

    const wrong = await makeBaselineCostDecider({ ref, tenantDir: dir, operator: 'op-1', dp2: { 'baseline.StorageAccount': 'baseline.StorageAccount' } })(storage);
    expect(wrong.allowed).toBe(false);
    expect(wrong.reason).toMatch(/typed text does not match/);

    const none = await makeBaselineCostDecider({ ref, tenantDir: dir, operator: 'op-1', dp2: {} })(storage);
    expect(none.allowed).toBe(false);

    const ok = await makeBaselineCostDecider({ ref, tenantDir: dir, operator: 'op-1', dp2: { 'baseline.StorageAccount': `  ${expected.replace(' ', '   ')} ` } })(storage);
    expect(ok.allowed).toBe(true);

    const records = fs.readdirSync(path.join(dir, COST_GATE_EVIDENCE_DIR)).map(f => JSON.parse(fs.readFileSync(path.join(dir, COST_GATE_EVIDENCE_DIR, f), 'utf-8')));
    const dp2 = records.filter(r => r.metadata.dp === 2 && r.metadata.entryId === 'baseline.StorageAccount');
    expect(dp2.map(r => r.outcome).sort()).toEqual(['accepted', 'refused', 'refused', 'refused']);
    expect(records.filter(r => r.metadata.dp === 1 && r.metadata.entryId === 'baseline.StorageAccount')).toHaveLength(1);
    expect(records.every(r => r.metadata.gate === 'cost')).toBe(true);
  });

  it('parseDp2Param accepts only a JSON object of strings', () => {
    expect(parseDp2Param('{"baseline.KeyVault":"baseline.KeyVault $0-$0.5","x":3}')).toEqual({ 'baseline.KeyVault': 'baseline.KeyVault $0-$0.5' });
    expect(parseDp2Param('[1]')).toEqual({});
    expect(parseDp2Param('nope')).toEqual({});
    expect(parseDp2Param(undefined)).toEqual({});
  });
});

describe('FIN-15 baseline cost routes', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(createBaselineRouter(() => [], () => false, () => undefined));
    await new Promise<void>(resolve => { server = app.listen(0, () => { base = `http://127.0.0.1:${(server.address() as any).port}`; resolve(); }); });
  });
  afterAll(() => { server?.close(); });

  async function call(method: string, url: string, body?: object): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  }

  it('GET /api/baseline/cost-items needs a real tenant and a valid posture', async () => {
    expect((await call('GET', '/api/baseline/cost-items?tenant=dev&posture=m365_foundation')).status).toBe(400);
    expect((await call('GET', '/api/baseline/cost-items?tenant=fin15-route&posture=bogus')).status).toBe(400);
    const ok = await call('GET', '/api/baseline/cost-items?tenant=fin15-route&posture=m365_foundation');
    expect(ok.status).toBe(200);
    expect(ok.body.items).toHaveLength(5);
    expect(ok.body.items.every((i: any) => i.acked === false)).toBe(true);
  });

  it('POST /api/baseline/cost-ack gives DP-1 only for a baseline id typed exactly', async () => {
    expect((await call('POST', '/api/baseline/cost-ack', { tenant: 'fin15-route', entryId: 'SC.L2-3.13.10.key-vault', typed: 'SC.L2-3.13.10.key-vault', operator: 'op' })).status).toBe(400);
    expect((await call('POST', '/api/baseline/cost-ack', { tenant: 'fin15-route', entryId: 'baseline.KeyVault', typed: 'yes', operator: 'op' })).status).toBe(400);
    expect((await call('POST', '/api/baseline/cost-ack', { tenant: 'fin15-route', entryId: 'baseline.KeyVault', typed: 'baseline.KeyVault', operator: '' })).status).toBe(400);
    const ok = await call('POST', '/api/baseline/cost-ack', { tenant: 'fin15-route', entryId: 'baseline.KeyVault', typed: 'baseline.KeyVault', operator: 'op' });
    expect(ok.status).toBe(200);
    expect(ok.body.ack.entry_id).toBe('baseline.KeyVault');
    const list = await call('GET', '/api/baseline/cost-items?tenant=fin15-route&posture=m365_foundation');
    expect(list.body.items.find((i: any) => i.entry_id === 'baseline.KeyVault').acked).toBe(true);
  });
});

describe('FIN-15 run-report line and schema declarations', () => {
  const report = {
    plan_id: 'p1', status: 'completed' as const, started_at: 'a', completed_at: 'b', duration_ms: 1000,
    summary: { total_tasks: 1, completed: 1, failed: 0, skipped: 0, accomplished: 0 },
    failed_tasks: [], evidence_collected: 0, recommendations: [],
  };

  it('the report prints the recurring-cost line when the run carries it', () => {
    const reporter = new ExecutionReporter(StamperConfig.fromTenantConfig({ tenantId: 't', appId: 'a', certThumbprint: 'c', targetTenantDomain: 'x.onmicrosoft.us', clientName: 'X' }));
    const md = reporter.generateMarkdownReport({ ...report, recurring_cost: { line: 'Recurring cost enabled by this run: 1 item, about $4.56 a month (price date 2026-10-31)', items: [{ entry_id: 'X.vault', estimate_month_low: 4.56, estimate_month_high: 4.56 }] } });
    expect(md).toContain('**Recurring cost enabled by this run: 1 item, about $4.56 a month (price date 2026-10-31)**');
    expect(md).toContain('- X.vault');
    expect(reporter.generateMarkdownReport(report)).not.toContain('Recurring cost');
  });

  it("gate: 'cost' and dp parse on a structured-evidence record; 'manual' still does", () => {
    const rec = (gate: string, dp?: number) => ({
      rawResponse: '{}', outcome: 'success', verificationResult: undefined,
      metadata: { controlIds: [], timestamp: 't', executorIdentity: 'e', commandExecuted: 'c', sha256Hash: 'h', gate, ...(dp ? { dp } : {}) },
    });
    const parsedCost = StructuredEvidenceSchema.safeParse(rec('cost', 2));
    const parsedManual = StructuredEvidenceSchema.safeParse(rec('manual'));
    const parsedOther = StructuredEvidenceSchema.safeParse(rec('other'));
    // only the gate field is under test; other required fields may differ by schema version
    const gateIssue = (r: any) => !r.success && r.error.issues.some((i: any) => i.path.join('.') === 'metadata.gate');
    expect(gateIssue(parsedCost)).toBe(false);
    expect(gateIssue(parsedManual)).toBe(false);
    expect(gateIssue(parsedOther)).toBe(true);
  });

  it('a registry load keeps cost_gate and retired (no longer stripped)', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirnameOf(), '..', '..', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json'), 'utf-8'));
    const parsed = CommandRegistrySchema.parse(raw);
    const withGate = parsed.entries.filter(e => e.cost_gate);
    expect(withGate.length).toBe(raw.entries.filter((e: any) => e.cost_gate).length);
    expect(withGate.length).toBeGreaterThan(0);
    const retired = parsed.entries.filter(e => e.retired);
    expect(retired.length).toBe(raw.entries.filter((e: any) => e.retired).length);
    for (const e of retired) expect(typeof e.retired_reason).toBe('string');
  });
});

function __dirnameOf(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

describe('FIN-15 assess route: every evidence write carries a WORM ledger (FLOW-2b remainder)', () => {
  it('each writeAndUploadEvidence call in assess.routes.ts passes assessLedger(...)', () => {
    const src = fs.readFileSync(path.resolve(__dirnameOf(), '..', '..', 'src', 'server', 'routes', 'assess.routes.ts'), 'utf-8');
    const calls = src.match(/await writeAndUploadEvidence\([^;]*\);/g) ?? [];
    expect(calls.length).toBe(5);
    for (const c of calls) expect(c).toMatch(/assessLedger\((entry\.entry_id|controlId|pi\.controlId)\)\);$/);
    expect(src).toContain('new EvidenceStore(stamperConfig)');
  });
});
