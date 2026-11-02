// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// CG-lint (COST-GATE-SPEC.md §3.8 items 1-4 and 6) over both Stamper registries, plus the
// catalogue drift test. Item 5 (two-person) is not checked: no two-person authorization anywhere
// for now (founder ruling CQ-4, 2026-10-31); two_person is data only. Regenerate the catalogue with
// UPDATE_COST_ITEMS=1 npx jest tests/registry/CostGateLint.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { buildStamperCostItems, costlyPatternsIn, FREE_REASONS, type CostGateBlock, type CostItemsCatalogue, type CostEstimates } from '../../src/core/CostGate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_DIR = path.resolve(__dirname, '../../src/registry');
const SHARED_DATA = path.resolve(__dirname, '../../../ces-shared/src/data');
const MAIN = 'cmmc-l2-commands.registry.json';
const INFRA = 'infra-cmmc-l2-commands.registry.json';
const CATALOGUE = path.join(SHARED_DATA, 'cost-items.reference.json');

interface Entry { entry_id: string; label: string; control_ids: string[]; set_command: string; retired?: boolean; retired_reason?: string; cost_gate?: CostGateBlock }
const load = (f: string) => (JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), 'utf-8')) as { entries: Entry[] }).entries;
const main = load(MAIN);
const infra = load(INFRA);
const all = [...main, ...infra];
const ids = new Set(all.map(e => e.entry_id));
const estimates = JSON.parse(fs.readFileSync(path.join(SHARED_DATA, 'cost-estimates.reference.json'), 'utf-8')) as CostEstimates;

function lint(entries: Entry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const costly = costlyPatternsIn(e.set_command);
    const g = e.cost_gate;
    if (costly.length > 0 && !g) problems.push(`${e.entry_id}: SET matches ${costly.join(', ')} but has no cost_gate`);
    if (!g) continue;
    if (!g.recurring) {
      if (!g.free_reason || !FREE_REASONS.includes(g.free_reason)) problems.push(`${e.entry_id}: free without a free_reason from the closed list`);
    } else {
      if (!g.cost_key || !estimates.prices[g.cost_key]) problems.push(`${e.entry_id}: recurring with cost_key ${g.cost_key ?? 'none'} not in the price file`);
      if (!g.standard_alternative || g.standard_alternative.length === 0) problems.push(`${e.entry_id}: recurring without a standard_alternative`);
      for (const alt of g.standard_alternative ?? []) {
        if (!alt.startsWith('none: ') && !ids.has(alt)) problems.push(`${e.entry_id}: standard_alternative ${alt} is not a registry entry`);
      }
    }
    if (g.last_resort) {
      const named = (g.standard_alternative ?? []).filter(a => !a.startsWith('none'));
      if (named.length === 0) problems.push(`${e.entry_id}: last_resort without a named standard alternative`);
      for (const alt of named) if (!ids.has(alt)) problems.push(`${e.entry_id}: last_resort alternative ${alt} is not a registry entry`);
    }
    if (g.licence_dependency && !estimates.prices[g.licence_dependency.cost_key]) problems.push(`${e.entry_id}: licence cost_key ${g.licence_dependency.cost_key} not in the price file`);
    if (e.retired && !e.retired_reason) problems.push(`${e.entry_id}: retired without a retired_reason`);
  }
  return problems;
}

describe('CG-lint: cost gate on the Stamper registries', () => {
  it('main registry: every costly SET carries a valid cost_gate', () => {
    expect(lint(main)).toEqual([]);
  });

  it('infra registry: every entry carries a valid cost_gate', () => {
    expect(lint(infra)).toEqual([]);
    expect(infra.filter(e => !e.cost_gate).map(e => e.entry_id)).toEqual([]);
  });

  it('the price file is dated and no more than 180 days old', () => {
    const age = (Date.now() - Date.parse(`${estimates.price_date}T00:00:00Z`)) / 86_400_000;
    expect(age).toBeLessThanOrEqual(180);
    for (const [key, p] of Object.entries(estimates.prices)) {
      expect({ key, ok: p.estimate_month_low <= p.estimate_month_high }).toEqual({ key, ok: true });
    }
  });

  it('cost-items.reference.json equals what the registries build (no drift)', () => {
    const built = buildStamperCostItems([
      { source: `ces-stamper:${MAIN}`, entries: main },
      { source: `ces-stamper:${INFRA}`, entries: infra },
    ]);
    const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf-8')) as CostItemsCatalogue;
    if (process.env.UPDATE_COST_ITEMS === '1') {
      catalogue.items = [...built, ...catalogue.items.filter(i => i.kind !== 'registry_entry')];
      fs.writeFileSync(CATALOGUE, JSON.stringify(catalogue, null, 2) + '\n');
    }
    expect(catalogue.items.filter(i => i.kind === 'registry_entry')).toEqual(built);
  });
});

describe('Key Vault dropped from the standard baseline (founder ruling 2026-10-31)', () => {
  const byId = (id: string) => all.find(e => e.entry_id === id)!;

  it('SC.L2-3.13.10.key-vault is recurring (per-use billing, CQ-2), Standard SKU, opt-in', () => {
    const kv = byId('SC.L2-3.13.10.key-vault');
    expect(kv.cost_gate).toMatchObject({ recurring: true, cost_key: 'azure.keyvault.operations', standard_alternative: ['SC.L2-3.13.10.key-escrow'] });
    expect(kv.set_command).toContain("-Sku 'Standard'");
    expect(kv.set_command).not.toContain("'Premium'");
  });

  it('SC.L2-3.13.10.key-escrow is the free evidence read: BitLocker recovery keys, metadata only', () => {
    const ke = byId('SC.L2-3.13.10.key-escrow');
    expect(ke.cost_gate).toEqual({ recurring: false, free_reason: 'read_only' });
    expect(ke.set_command).toBe('');
    expect((ke as any).evidence_commands[0]).toContain('/informationProtection/bitlocker/recoveryKeys');
    expect((ke as any).evidence_commands[0]).not.toMatch(/\bkey\b,|select=key/i);
  });

  it('no Key Vault SET is free', () => {
    for (const e of all.filter(x => /New-AzKeyVault\b|Add-AzKeyVaultKey\b/.test(x.set_command))) {
      expect({ id: e.entry_id, recurring: e.cost_gate?.recurring }).toEqual({ id: e.entry_id, recurring: true });
    }
  });
});

describe('FIN-40: cost-gate prerequisites for DEPTH-2 (CG-9, QUESTIONS P-11)', () => {
  const byId = (id: string) => infra.find(e => e.entry_id === id) as any;
  const commandFields = (e: any): string[] => [e.set_command, e.get_command, ...(e.evidence_commands ?? [])].filter((c: unknown) => typeof c === 'string' && c);

  it('the standard boundary (SB) entries exist and are free; the egress IP is recurring, not two-person', () => {
    for (const id of ['AZ-NSG-006', 'AZ-NSG-007', 'AZ-SEP-001', 'AZ-POL-001', 'AZ-VM-005']) {
      // FIN-41: SEP-001 (storage) and VM-005 (the CES VM) also carry requires_entries; the cost class is unchanged.
      const { requires_entries: _req, ...gate } = byId(id)?.cost_gate ?? {};
      expect({ id, gate }).toEqual({ id, gate: { recurring: false, free_reason: 'no_meter' } });
    }
    expect(byId('AZ-NET-007').cost_gate).toMatchObject({ recurring: true, cost_key: 'azure.public_ip.standard' });
    expect(byId('AZ-NET-007').cost_gate.two_person).toBeUndefined();
  });

  it('every firewall entry is last resort and two-person, and names the SB entries as its alternative', () => {
    for (const id of ['AZ-FW-000', 'AZ-FW-001', 'AZ-FW-002', 'AZ-FW-004', 'AZ-NET-005']) {
      const g = byId(id).cost_gate;
      expect({ id, last_resort: g.last_resort, two_person: g.two_person }).toEqual({ id, last_resort: true, two_person: true });
      expect(g.standard_alternative).toEqual(expect.arrayContaining(['AZ-NSG-006', 'AZ-NSG-007', 'AZ-SEP-001', 'AZ-POL-001', 'AZ-VM-005']));
    }
    expect(byId('AZ-FW-003').cost_gate).toEqual({ recurring: false, free_reason: 'cost_reducing', requires_entries: ['AZ-FW-002'] });
  });

  it('AZ-FOUND-003 and AZ-KV-003 SETs match the free manifest (Free Defender tier, software RSA key); paid Defender is the AZ-FOUND-005 opt-in', () => {
    const def = byId('AZ-FOUND-003');
    expect(def.set_command).toContain("-PricingTier 'Free'");
    expect(def.set_command).not.toMatch(/Set-AzSecurityPricing[^;|]*'Standard'/);
    expect(def.cost_gate).toEqual({ recurring: false, free_reason: 'no_meter' });
    expect(byId('AZ-FOUND-005').cost_gate).toMatchObject({ recurring: true, cost_key: 'azure.defender.paid_plans', standard_alternative: ['AZ-FOUND-003'] });
    const key = byId('AZ-KV-003');
    expect(key.set_command).toContain('-Destination Software -KeyType RSA -Size 4096');
    expect(key.set_command).not.toMatch(/-Destination\s+'?HSM/);
    expect(key.cost_gate).toMatchObject({ recurring: true, cost_key: 'azure.keyvault.software_key' });
    expect(byId('AZ-KV-001').notes).not.toMatch(/Premium|HSM-backed/);
  });

  it('AZ-LOG-001 keeps 90 days in the workspace', () => {
    const law = byId('AZ-LOG-001');
    expect(law.set_command).toContain('-RetentionInDays 90');
    expect(law.label).toContain('90-day');
  });

  it('no hard-coded region or subscription in any infra command (P-11)', () => {
    const hits = infra.flatMap(e => commandFields(e).filter(c => /usgovvirginia|usgovarizona|usgovtexas|668a730f/i.test(c)).map(() => e.entry_id));
    expect(hits).toEqual([]);
    expect(JSON.stringify(infra)).not.toMatch(/668a730f/);
  });

  it('AZ-DIAG-002/003 evidence commands no longer pipe from a bare if statement', () => {
    for (const id of ['AZ-DIAG-002', 'AZ-DIAG-003']) {
      for (const c of commandFields(byId(id))) expect({ id, bad: /\}\s*else\s*\{[^}]*\}\s*\|/.test(c) }).toEqual({ id, bad: false });
    }
  });

  it('every {placeholder} in an infra command is declared in variables_required or variables_runtime', () => {
    const problems: string[] = [];
    for (const e of infra as any[]) {
      const declared = new Set([...(e.variables_required ?? []), ...(e.variables_runtime ?? [])]);
      for (const c of commandFields(e)) {
        for (const m of c.matchAll(/(?<![$\w])\{([A-Za-z][A-Za-z0-9_]*)\}/g)) if (!declared.has(m[1])) problems.push(`${e.entry_id}: {${m[1]}}`);
      }
    }
    expect([...new Set(problems)].filter(p => /AZ-(NSG-006|NSG-007|SEP-001|POL-001|VM-005|NET-007|FOUND-002|FOUND-005|NW-001)\b/.test(p))).toEqual([]);
  });
});

describe('CG-7 hygiene', () => {
  it('no hard-coded rg-eo-prod or edcgov names remain', () => {
    const text = fs.readFileSync(path.join(REGISTRY_DIR, MAIN), 'utf-8') + fs.readFileSync(path.join(REGISTRY_DIR, INFRA), 'utf-8');
    expect(text).not.toMatch(/rg-eo-prod|edcgov/);
  });

  it('retired entries are marked: AZ-NW-002 (NSG flow logs) and AZ-VM-004 (Monitoring Agent)', () => {
    expect(infra.filter(e => e.retired).map(e => e.entry_id).sort()).toEqual(['AZ-NW-002', 'AZ-VM-004']);
  });

  it("AZ-FOUND-003 no longer names the unknown 'Discovery' pricing plan", () => {
    expect(JSON.stringify(infra.find(e => e.entry_id === 'AZ-FOUND-003'))).not.toContain('Discovery');
  });
});

describe('FIN-41 (SP-12): zero-cost encryption at rest; Key Vault Standard, gated and optional', () => {
  const byId = (id: string) => all.find(e => e.entry_id === id)! as Entry & { variables_required: string[]; control_ids: string[]; objective_ids?: string[] };
  const opted = (e: Entry) => e.cost_gate?.recurring === true && (e.cost_gate.standard_alternative ?? []).some(a => ids.has(a)) && /^Opt-in: /.test(e.label);

  it('no Key Vault or key SET is Premium or HSM unless it is a recurring, labelled opt-in with a named standard alternative', () => {
    for (const e of all.filter(x => /-Sku\s+'Premium'|-Destination\s+HSM|"name"\s*:\s*"premium"|\\"name\\":\\"premium\\"/i.test(x.set_command))) {
      expect({ id: e.entry_id, opted: opted(e) }).toEqual({ id: e.entry_id, opted: true });
    }
  });

  it('every Key Vault entry is gated: recurring, or free only when it plans with AZ-KV-001 (requires_entries)', () => {
    for (const e of all.filter(x => /New-AzKeyVault\b|Add-AzKeyVaultKey\b|Update-AzKeyVaultNetworkRuleSet\b|-Scope \(Get-AzKeyVault/.test(x.set_command))) {
      const g = e.cost_gate as (CostGateBlock & { requires_entries?: string[] }) | undefined;
      const gated = g?.recurring === true || (g?.requires_entries ?? []).includes('AZ-KV-001') || e.entry_id === 'SC.L2-3.13.10.key-vault';
      expect({ id: e.entry_id, gated }).toEqual({ id: e.entry_id, gated: true });
    }
  });

  it('the HSM opt-in AZ-KV-005 is recurring, priced and falls back to the software key', () => {
    const kv5 = byId('AZ-KV-005');
    expect(kv5.cost_gate).toMatchObject({ recurring: true, cost_key: 'azure.keyvault.hsm_key', standard_alternative: ['AZ-KV-003'], requires_entries: ['AZ-KV-001'] });
    expect(byId('AZ-KV-003').set_command).toContain('-Destination Software');
    expect(byId('AZ-KV-001').set_command).toContain("-Sku 'Standard'");
  });

  it('no entry uses Azure Disk Encryption (Disk Backup keeps working)', () => {
    expect(all.filter(e => /Set-AzVMDiskEncryptionExtension/.test(e.set_command)).map(e => e.entry_id)).toEqual([]);
  });

  it('AZ-VM-001 is Trusted Launch with Secure Boot, vTPM and encryption at host, and stores no password', () => {
    const vm = byId('AZ-VM-001');
    expect(vm.set_command).toContain("-SecurityType 'TrustedLaunch' -EnableSecureBoot $true -EnableVtpm $true -EncryptionAtHost");
    expect(vm.set_command).toContain("Register-AzProviderFeature -FeatureName 'EncryptionAtHost'");
    expect(vm.set_command).not.toMatch(/Set-AzKeyVaultSecret|keyVaultName/);
    expect(vm.variables_required).not.toContain('keyVaultName');
    expect(vm.cost_gate).toMatchObject({ recurring: true });
  });

  it('AZ-VM-002 is free encryption at host for SC.L2-3.13.16 only, planned only with AZ-VM-001', () => {
    const vm2 = byId('AZ-VM-002');
    expect(vm2.cost_gate).toEqual({ recurring: false, free_reason: 'no_meter', requires_entries: ['AZ-VM-001'] });
    expect(vm2.control_ids).toEqual(['SC.L2-3.13.16']);
    expect(vm2.objective_ids).toEqual(['SC.L2-3.13.16[a]']);
    expect(vm2.set_command).toContain('-EncryptionAtHost $true');
  });

  it('requires_entries names only registry entries', () => {
    for (const e of all) {
      for (const r of ((e.cost_gate as { requires_entries?: string[] } | undefined)?.requires_entries ?? [])) {
        expect({ id: e.entry_id, requires: r, known: ids.has(r) }).toEqual({ id: e.entry_id, requires: r, known: true });
      }
    }
  });
});
