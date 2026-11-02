// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DEPTH-2 (closes FQ-10): one merged registry for the CLI and the GUI, filtered by enclave.
// - Golden: an m365_azure Infra Manifest plans the free, unconditioned AZ-* entries (the list below,
//   the same on all four scenarios, LOG-DEPTH-2.md §2); m365_only plans none (V95); m365_sentinel
//   plans no `full`-tier entry.
// - Recurring entries without a DP-1 stay cost_gated_off and are reported; a DP-1 brings one in, with
//   the free entries that require it (cost_gate.requires_entries).
// - CLI = GUI (V72) on the merged registry; a named --registry file is used as it is (no merge).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  translateForTenant,
  projectExecutablePlan,
  planRegistry,
  unresolvedInfraEntries,
  mergesInfra,
} from '../../src/translators/translateForTenant';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { computeAckHash, loadCostGateReference, type CostAck } from '../../src/core/CostGate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REG = path.join(ROOT, 'src', 'registry');
const MAIN = path.join(REG, 'cmmc-l2-commands.registry.json');
const INFRA = path.join(REG, 'infra-cmmc-l2-commands.registry.json');
const SHARED = path.resolve(ROOT, '..', 'ces-shared', 'src', 'data');
const MUSTER = path.resolve(ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const HAVE_MUSTER = fs.existsSync(path.join(MUSTER, 'manual-mission-plan.json'));
// The source catalogue and price file (the built copy may be stale in a worktree).
const REF = loadCostGateReference({ estimates: path.join(SHARED, 'cost-estimates.reference.json'), catalogue: path.join(SHARED, 'cost-items.reference.json') });

/** The AZ-* entries DEPTH-2 plans for an m365_azure enclave with no DP-1 (LOG-DEPTH-2.md §2). */
const PLANNED_AZURE = [
  'AZ-BOUNDARY-001', 'AZ-CTX-001', 'AZ-FOUND-001', 'AZ-FOUND-002', 'AZ-FOUND-003',
  'AZ-ID-001', 'AZ-ID-002', 'AZ-ID-004', 'AZ-ID-005',
  'AZ-NET-001', 'AZ-NET-002', 'AZ-NET-003', 'AZ-NET-004',
  'AZ-NSG-001', 'AZ-NSG-002', 'AZ-NSG-003', 'AZ-NSG-005', 'AZ-NSG-006',
  'AZ-NW-001', 'AZ-POL-001', 'AZ-PREFLIGHT-001', 'AZ-SUBNET-001',
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'depth2-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** The Muster fixture staged with its Infra Manifest beside the TM, the model set as given. */
function stage(name: string, model?: 'm365_only' | 'm365_sentinel' | 'm365_azure') {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const mp = path.join(dir, 'manual-mission-plan_x.json');
  const tm = path.join(dir, 'tenant-manifest_x.json');
  fs.copyFileSync(path.join(MUSTER, 'manual-mission-plan.json'), mp);
  fs.copyFileSync(path.join(MUSTER, 'tenant-manifest.json'), tm);
  const im = JSON.parse(fs.readFileSync(path.join(MUSTER, 'infrastructure-manifest.json'), 'utf-8'));
  if (model) im.infrastructure.infrastructure_model = model;
  fs.writeFileSync(path.join(dir, 'infrastructure-manifest_x.json'), JSON.stringify(im, null, 2));
  return { mp, tm, out: path.join(dir, 'executable-plan.json') };
}

const azIds = (plan: unknown) => [...new Set(projectExecutablePlan(plan).tasks.flatMap(t => t.sub_commands.map(s => s.id)).filter(id => /^AZ-/.test(id)))].sort();
const readPlan = (f: string) => JSON.parse(fs.readFileSync(f, 'utf-8'));

(HAVE_MUSTER ? describe : describe.skip)('DEPTH-2: the merged registry reaches the plan (V95)', () => {
  it('m365_azure: the free, unconditioned AZ-* entries are planned; recurring ones are cost_gated_off', async () => {
    const s = stage('azure', 'm365_azure');
    const out = await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: s.out });
    expect(out.infraRegistryPath).toBe(INFRA);
    const plan = readPlan(s.out);
    // The Muster fixture carries no subscriptionId, breakGlassUPN or operatorUPN, so the five entries
    // that need them are left out (unresolved variable); the four scenarios carry all three.
    const NEEDS_VARS = ['AZ-CTX-001', 'AZ-FOUND-002', 'AZ-ID-001', 'AZ-ID-002', 'AZ-POL-001'];
    expect(azIds(plan)).toEqual(PLANNED_AZURE.filter(id => !NEEDS_VARS.includes(id)).sort());
    for (const id of NEEDS_VARS) expect({ id, reason: out.excludedEntries?.find(e => e.entry_id === id)?.reason }).toEqual({ id, reason: 'unresolved_variable' });
    const gated = (plan.variables._cost_gate.gated_off as Array<{ entry_id: string }>).map(g => g.entry_id);
    for (const id of ['AZ-KV-001', 'AZ-LOG-001', 'AZ-SEN-001', 'AZ-VM-001', 'AZ-FW-002', 'AZ-BAS-002', 'AZ-NET-007']) expect(gated).toContain(id);
    // No recurring entry is planned without a DP-1.
    const infra = CommandRegistry.load(INFRA);
    for (const id of azIds(plan)) expect({ id, recurring: infra.lookupByEntryId(id)?.cost_gate?.recurring }).toEqual({ id, recurring: false });
    // Left out before translation: retired entries, entries whose creator is not planned, and AZ-ID-003 (no appId).
    const excluded = new Map((out.excludedEntries ?? []).map(e => [e.entry_id, e]));
    expect(excluded.get('AZ-NW-002')?.reason).toBe('retired');
    expect(excluded.get('AZ-KV-002')).toMatchObject({ reason: 'requires_not_planned', missing: ['AZ-KV-001'] });
    expect(excluded.get('AZ-FW-000')).toMatchObject({ reason: 'requires_not_planned', missing: ['AZ-FW-002'] });
    expect(excluded.get('AZ-ID-003')).toMatchObject({ reason: 'unresolved_variable', missing: ['appId'] });
    expect(excluded.has('AZ-NSG-007')).toBe(true); // {m365Ipv4Ranges} is not supplied yet
    expect(out.result.warnings.filter(w => /^UNRESOLVED_VARIABLE:.*AZ-/.test(w))).toEqual([]);
    // The operator sees why: one ENTRY_NOT_PLANNED line per left-out entry (retired ones excepted).
    expect(out.result.warnings).toContain('ENTRY_NOT_PLANNED: AZ-KV-002 requires AZ-KV-001 (not planned)');
    expect(out.result.warnings).toContain('ENTRY_NOT_PLANNED: AZ-ID-003 has no value for appId');
    expect(out.result.warnings.filter(w => w.startsWith('ENTRY_NOT_PLANNED:')).length).toBe((out.excludedEntries ?? []).filter(e => e.reason !== 'retired').length);
  });

  it('m365_only: no AZ-* entry and no infra registry (V95)', async () => {
    const s = stage('only', 'm365_only');
    const out = await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: s.out });
    expect(out.infraRegistryPath).toBeUndefined();
    expect(azIds(readPlan(s.out))).toEqual([]);
  });

  it('m365_sentinel: no full-tier entry', async () => {
    const s = stage('sentinel', 'm365_sentinel');
    await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: s.out });
    const infra = CommandRegistry.load(INFRA);
    const ids = azIds(readPlan(s.out));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect({ id, tier: infra.lookupByEntryId(id)?.azure_tier }).not.toEqual({ id, tier: 'full' });
  });

  it('CLI and GUI translate to the same projection on the merged registry (V72)', async () => {
    const s = stage('modes', 'm365_azure');
    const gui = path.join(path.dirname(s.out), 'gui.json');
    await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: s.out });
    await translateForTenant({ mode: 'gui', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: gui });
    expect(projectExecutablePlan(readPlan(gui))).toEqual(projectExecutablePlan(readPlan(s.out)));
  });

  it('a named registry file is used as it is: no merge', async () => {
    const s = stage('named', 'm365_azure');
    const out = await translateForTenant({ mode: 'cli', missionPlanPath: s.mp, manifestPath: s.tm, outputPath: s.out, registryPath: MAIN });
    expect(out.infraRegistryPath).toBeUndefined();
    expect(azIds(readPlan(s.out))).toEqual([]);
  });
});

describe('DEPTH-2: planRegistry (retired, requires_entries, unresolved variables)', () => {
  const main = CommandRegistry.load(MAIN);
  const infra = CommandRegistry.load(INFRA);
  const ack = (entry_id: string): CostAck => {
    const item = REF.byId.get(entry_id)!;
    const key = item.cost_gate.cost_key!;
    const p = REF.estimates.prices[key];
    return { entry_id, cost_key: key, estimate_month_low: p.estimate_month_low, estimate_month_high: p.estimate_month_high, price_date: REF.estimates.price_date, operator: 'operator-1', acked_at: '2026-10-31T00:00:00Z', ackHash: computeAckHash(entry_id, p.estimate_month_low, p.estimate_month_high, REF.estimates.price_date) };
  };
  const ids = (r: CommandRegistry) => new Set(r.allEntries.map(e => e.entry_id));

  it('merges only for m365_sentinel and m365_azure', () => {
    expect([mergesInfra('m365_only'), mergesInfra(undefined), mergesInfra('m365_sentinel'), mergesInfra('m365_azure')]).toEqual([false, false, true, true]);
  });

  it('no DP-1: Key Vault follow-on entries are left out, recurring ones stay for the cost gate to report', () => {
    const { registry } = planRegistry([main, infra], 'm365_azure', [], REF);
    const have = ids(registry);
    expect(have.has('AZ-KV-001')).toBe(true); // recurring: kept, so it is reported cost_gated_off
    expect(have.has('AZ-KV-002')).toBe(false);
    expect(have.has('AZ-KV-004')).toBe(false);
    expect(have.has('AZ-NW-002')).toBe(false); // retired
    expect(have.has('SC.L2-3.13.10.key-escrow')).toBe(true); // main registry untouched
  });

  it('a DP-1 for AZ-KV-001 brings in the free entries that require it', () => {
    const { registry, excluded } = planRegistry([main, infra], 'm365_azure', [ack('AZ-KV-001')], REF);
    const have = ids(registry);
    expect(have.has('AZ-KV-002')).toBe(true);
    expect(have.has('AZ-KV-004')).toBe(true);
    expect(excluded.find(e => e.entry_id === 'AZ-KV-005')).toBeUndefined(); // recurring, no DP-1: kept for the gate
  });

  it('pairs resolve together: the firewall and its IP need both DP-1s', () => {
    const one = planRegistry([main, infra], 'm365_azure', [ack('AZ-FW-002')], REF);
    expect(ids(one.registry).has('AZ-FW-000')).toBe(false);
    expect(one.excluded.find(e => e.entry_id === 'AZ-FW-002')).toMatchObject({ reason: 'requires_not_planned', missing: ['AZ-FW-001'] });
    const both = planRegistry([main, infra], 'm365_azure', [ack('AZ-FW-001'), ack('AZ-FW-002')], REF);
    for (const id of ['AZ-FW-000', 'AZ-FW-001', 'AZ-FW-002', 'AZ-FW-003', 'AZ-NET-005']) expect({ id, planned: ids(both.registry).has(id) }).toEqual({ id, planned: true });
  });

  it('an entry outside the enclave is not planned, so its dependants are not either', () => {
    const { excluded } = planRegistry([main, infra], 'm365_sentinel', [ack('AZ-VM-001')], REF);
    expect(excluded.find(e => e.entry_id === 'AZ-VM-002')).toBeUndefined(); // full tier: the enclave filter drops both
  });

  it('unresolved variables: parsed from the translator warnings, infra entries only', () => {
    const infraIds = new Set(infra.allEntries.map(e => e.entry_id));
    const got = unresolvedInfraEntries([
      'UNRESOLVED_VARIABLE: appId (required by AZ-ID-003, task t1)',
      'UNRESOLVED_VARIABLE: appId (required by AZ-ID-003, task t2)',
      'UNRESOLVED_VARIABLE: cuiGroupId (required by AC.L2-3.1.3.cui-group, task t3)',
      'UNRESOLVED_RUNTIME_VARIABLE: kvUri (required by AZ-LOG-002c, task t4)',
    ], infraIds);
    expect([...got]).toEqual([['AZ-ID-003', ['appId']]]);
    const { registry, excluded } = planRegistry([main, infra], 'm365_azure', [], REF, got);
    expect(ids(registry).has('AZ-ID-003')).toBe(false);
    expect(excluded.find(e => e.entry_id === 'AZ-ID-003')).toEqual({ entry_id: 'AZ-ID-003', reason: 'unresolved_variable', missing: ['appId'] });
  });
});
