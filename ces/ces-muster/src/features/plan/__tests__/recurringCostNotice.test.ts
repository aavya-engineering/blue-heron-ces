// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// CG-8 (the recurring-cost notice) and CG-1 / CG-lint item 7 (Muster defaults off).
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { buildRecurringCostNotice, noticeWarnings, noticeSummary, DEFAULT_COST_REFERENCE } from '../recurringCostNotice';
import { generateInfrastructureManifest } from '../engine/mpt/services/infraManifestGenerator';
import { buildTenantConfigProfile, decorateInfraManifest, type TcpQuestionBank } from '../tcpAdapter';
import type { SIBaseline } from '@/features/plan/engine/shared/types/artifacts';

const BANK = load(fs.readFileSync(path.resolve('public/knowledge', 'primed TCP Question Bank.yaml'), 'utf8')) as TcpQuestionBank;
const si = (deps: Record<string, unknown>): SIBaseline =>
  ({ ces: {}, si_baseline: { dependencies: deps, scope: {}, operations: {} } }) as unknown as SIBaseline;
const tcp = () => buildTenantConfigProfile([], BANK, null, { orgName: 'Cost Test Co' }).tenantConfig;

function azureManifest() {
  const raw = generateInfrastructureManifest(si({ infrastructure_model: 'm365_azure' }), tcp());
  expect(raw).not.toBeNull();
  return { raw: raw!, emitted: decorateInfraManifest(raw!, si({ infrastructure_model: 'm365_azure' }), null) };
}
const resources = (raw: unknown) =>
  Object.values((raw as { infrastructure_manifest: Record<string, unknown> }).infrastructure_manifest)
    .filter(Array.isArray)
    .flat() as Array<{ resource_id: string; resource_type: string; name: string; properties: Record<string, unknown> }>;

describe('CG-1: Muster defaults are off', () => {
  test('an unanswered SIT-020 gives m365_only: no Infrastructure Manifest', () => {
    expect(generateInfrastructureManifest(si({}), tcp())).toBeNull();
  });

  test('an m365_azure manifest has no paid Defender plan, Premium vault, HSM key, retention over 90 days or AzureFirewallSubnet', () => {
    const r = resources(azureManifest().raw);
    const defender = r.find((x) => x.resource_type === 'defender_for_cloud')!;
    expect((defender.properties.plans as Array<{ tier: string }>).every((p) => p.tier === 'Free')).toBe(true);
    expect(r.find((x) => x.resource_type === 'key_vault')!.properties.sku).toBe('Standard');
    expect(r.find((x) => x.resource_type === 'key_vault_key')!.properties.key_type).toBe('RSA');
    for (const law of r.filter((x) => x.resource_type === 'log_analytics_workspace')) expect(law.properties.retention_days).toBe(90);
    expect(r.some((x) => x.name === 'AzureFirewallSubnet')).toBe(false);
    expect(r.some((x) => x.resource_type === 'private_endpoint' || x.resource_type === 'private_dns_zone')).toBe(false);
    expect(r.some((x) => x.resource_type === 'service_endpoint_policy')).toBe(true);
  });
});

describe('CG-8: the recurring-cost notice', () => {
  test('m365_only (no manifest): 0 items', async () => {
    const n = await buildRecurringCostNotice({ infrastructureManifest: null, missionPlan: {} });
    expect(n.items).toEqual([]);
    expect(n.total_estimate_high).toBe(0);
    expect(noticeSummary(n)).toBe('COST_RECURRING: 0 items, ~$0/month');
  });

  test('m365_azure: the items equal the catalogue lookups of the manifest resources, priced from the price file', async () => {
    const { emitted } = azureManifest();
    const n = await buildRecurringCostNotice({ infrastructureManifest: emitted, missionPlan: {} });
    const byId = new Map(DEFAULT_COST_REFERENCE.items.map((i) => [i.item_id, i]));
    const expected = [...new Set(resources({ infrastructure_manifest: emitted.infrastructure }).flatMap((x) => (x as unknown as { registry_entry_ids?: string[] }).registry_entry_ids ?? []))]
      .filter((id) => byId.get(id)?.cost_gate.recurring);
    expect(n.items.map((i) => i.item_id).sort()).toEqual(expected.sort());
    expect(n.items.length).toBeGreaterThan(0);
    for (const i of n.items) {
      const p = DEFAULT_COST_REFERENCE.prices[i.cost_key];
      expect([i.item_id, i.estimate_month_low, i.estimate_month_high]).toEqual([i.item_id, p.estimate_month_low, p.estimate_month_high]);
      expect(i.why_in_plan).toContain('m365_azure');
    }
    expect(n.price_date).toBe(DEFAULT_COST_REFERENCE.price_date);
    expect(n.items_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(noticeWarnings(n)).toHaveLength(n.items.length);
    expect(noticeWarnings(n)[0]).toMatch(/^COST_RECURRING: .* needs your opt-in in Stamper$/);
  });

  test('a licence dependency is listed, not counted (CQ-1)', async () => {
    const mp = { outputs: { human_readable_mission_plan: { control_directives: [{ control_id: 'PS.L2-3.9.2', directive: 'implement' }] } } };
    const n = await buildRecurringCostNotice({ infrastructureManifest: null, missionPlan: mp });
    expect(n.items).toEqual([]);
    expect(n.licence_dependencies.map((l) => l.licence)).toEqual(['Entra ID Governance']);
  });
});
