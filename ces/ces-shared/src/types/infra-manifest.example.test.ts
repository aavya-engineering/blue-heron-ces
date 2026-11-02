// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-SH2: the golden-style Infra Manifest example Muster targets, checked against the shared contract
// and against what Stamper's translate/baseline paths consume.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  InfraManifestSchema, InfrastructureBodySchema, INFRA_VARIABLE_ALIASES,
  STAMPER_PROVISIONING_REQUIRED_VARIABLES, normalizeInfraVariableMap,
} from './mission-plan.contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(__dirname, '../data/infra-manifest.example.json');
const load = () => JSON.parse(fs.readFileSync(EXAMPLE, 'utf-8'));
const SECTIONS = ['identity', 'logging', 'security', 'storage', 'network', 'automation', 'diagnostics'] as const;

describe('W4-SH2 infra-manifest example fixture', () => {
  it('parses with InfraManifestSchema under the canonical infrastructure key, unchanged', () => {
    const raw = load();
    const r = InfraManifestSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(raw);
  });

  it('meets Stamper-only refinements: ISO date-time generated_on and an explicit infrastructure_model', () => {
    const m = InfraManifestSchema.parse(load());
    expect(z.string().datetime().safeParse(m.ces.generated_on).success).toBe(true);
    expect(m.infrastructure.infrastructure_model).toBe('m365_azure');
  });

  it('every variable the Stamper BaselineProvisioner requires is present and non-empty', () => {
    const vm = InfraManifestSchema.parse(load()).infrastructure.stamper_variable_map as Record<string, unknown>;
    for (const k of STAMPER_PROVISIONING_REQUIRED_VARIABLES) {
      expect(typeof vm[k] === 'string' && (vm[k] as string).length > 0, k).toBe(true);
    }
  });

  it('carries the subnet and resource names the Stamper network registry resolves (canonical names)', () => {
    const vm = InfraManifestSchema.parse(load()).infrastructure.stamper_variable_map;
    for (const k of ['mgmtSubnetCidr', 'workloadSubnetCidr', 'bastionSubnetCidr', 'firewallSubnetCidr', 'firewallName', 'publicIpName'] as const) {
      expect(vm[k], k).toMatch(/.+/);
    }
    expect((vm as Record<string, unknown>).fwSubnetCidr).toBeUndefined();
  });

  it('has at least one resource in every section; registry ids are all counted in registry_coverage', () => {
    const body = InfraManifestSchema.parse(load()).infrastructure;
    const covered = new Set(body.registry_coverage.covered_entry_ids);
    const ids = new Set<string>();
    for (const s of SECTIONS) {
      expect(body[s].length, s).toBeGreaterThan(0);
      for (const res of body[s]) res.registry_entry_ids.forEach((i) => ids.add(i));
    }
    for (const i of ids) expect(covered.has(i), i).toBe(true);
    expect(body.registry_coverage.total_infra_entries).toBe(covered.size + body.registry_coverage.uncovered_entry_ids.length);
    const resIds = new Set(SECTIONS.flatMap((s) => body[s].map((r) => r.resource_id)));
    for (const s of SECTIONS) for (const r of body[s]) for (const d of r.depends_on) expect(resIds.has(d), `${r.resource_id} -> ${d}`).toBe(true);
  });
});

describe('W4-SH2 Muster-emitted variable names', () => {
  const musterShaped = () => {
    const raw = load();
    const vm = { ...raw.infrastructure.stamper_variable_map };
    vm.fwSubnetCidr = vm.firewallSubnetCidr; delete vm.firewallSubnetCidr;
    return { ces: raw.ces, infrastructure_manifest: { ...raw.infrastructure, stamper_variable_map: vm } };
  };

  it('deprecated fwSubnetCidr is normalized onto firewallSubnetCidr (alias kept), via the deprecated envelope key too', () => {
    const r = InfraManifestSchema.safeParse(musterShaped());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.infrastructure.stamper_variable_map.firewallSubnetCidr).toBe('10.20.5.0/26');
      expect(r.data.infrastructure.stamper_variable_map.fwSubnetCidr).toBe('10.20.5.0/26');
    }
  });

  it('rejects a manifest whose alias contradicts the canonical name', () => {
    const m = musterShaped();
    (m.infrastructure_manifest.stamper_variable_map as Record<string, string>).firewallSubnetCidr = '10.99.0.0/26';
    const r = InfraManifestSchema.safeParse(m);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path.join('.')).toBe('infrastructure_manifest.stamper_variable_map.fwSubnetCidr');
  });

  it('empty alias does not overwrite; empty canonical is filled; alias map is exported', () => {
    expect(INFRA_VARIABLE_ALIASES).toEqual({ fwSubnetCidr: 'firewallSubnetCidr' });
    expect(normalizeInfraVariableMap({ fwSubnetCidr: '', firewallSubnetCidr: 'x' }).firewallSubnetCidr).toBe('x');
    expect(normalizeInfraVariableMap({ fwSubnetCidr: 'y', firewallSubnetCidr: '' }).firewallSubnetCidr).toBe('y');
  });

  it('backward compatible: the Sentinel-only shape (empty network names, empty subnet vars) still parses unchanged', () => {
    const vm = { subscriptionId: 's', resourceGroup: 'rg', location: 'l', lawWorkspaceName: 'law', eoAppDisplayName: 'eo',
      storageAccountName: '', keyVaultName: '', cmkKeyName: '', vnetName: '', vnetCidr: '', subnetPeName: '', subnetPeCidr: '',
      nsgPeName: '', automationAccountName: '', mgmtSubnetCidr: '', identitySubnetCidr: '', peSubnetCidr: '', fwSubnetCidr: '' };
    const body = { identity: [], logging: [], security: [], storage: [], network: [], automation: [], diagnostics: [],
      stamper_variable_map: vm, registry_coverage: { total_infra_entries: 0, covered_entry_ids: [], uncovered_entry_ids: [], coverage_pct: 0 },
      provenance: [] };
    expect(InfrastructureBodySchema.safeParse(body).success).toBe(true);
    const r = InfraManifestSchema.safeParse({ ces: load().ces, infrastructure_manifest: body });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.infrastructure.stamper_variable_map).toEqual(vm);
  });
});
