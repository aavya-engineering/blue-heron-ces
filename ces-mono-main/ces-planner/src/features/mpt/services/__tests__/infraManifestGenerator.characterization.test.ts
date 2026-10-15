// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G0 characterization tests for the Planner infrastructure-manifest generator.
//
// This code moved here from the Stamper subsystem (the old stamper test was deleted as a dead
// orphan during G0 — see docs/G0-test-coverage-map.md). These tests pin the CURRENT behavior of
// generateInfrastructureManifest + deriveInfraSteps so the upcoming identity/persistence rework
// can't silently change the generated Azure infrastructure spec.
//
// Non-deterministic fields (ces.generated_on, generateId-based ids) are asserted by shape/regex,
// never by exact value.

import { describe, it, expect } from 'vitest';
import {
  generateInfrastructureManifest,
  deriveInfraSteps,
} from '../infraManifestGenerator';

// ─── Minimal fixtures (only the fields the generator actually reads) ───
function makeSI(overrides: {
  infrastructure_model?: string;
  retention_target_days?: number;
  target_cmmc_level?: string;
  tenant_model_preference?: string;
} = {}) {
  return {
    si_baseline: {
      dependencies: {
        infrastructure_model: overrides.infrastructure_model ?? 'm365_sentinel',
        ...(overrides.tenant_model_preference
          ? { tenant_model_preference: overrides.tenant_model_preference }
          : {}),
      },
      target: { target_cmmc_level: overrides.target_cmmc_level ?? 'L2' },
      evidence: overrides.retention_target_days
        ? { retention_target_days: overrides.retention_target_days }
        : {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeTCP(overrides: {
  primary_domain?: string;
  cloud_environment?: string;
  sentinel_resource_group?: string;
  sentinel_workspace_name?: string;
  break_glass_accounts?: string[];
} = {}) {
  return {
    tenant_config: {
      identity: {
        primary_domain: overrides.primary_domain ?? 'contoso.com',
        cloud_environment: overrides.cloud_environment ?? 'gcc_high',
      },
      monitoring: {
        ...(overrides.sentinel_resource_group
          ? { sentinel_resource_group: overrides.sentinel_resource_group }
          : {}),
        ...(overrides.sentinel_workspace_name
          ? { sentinel_workspace_name: overrides.sentinel_workspace_name }
          : {}),
      },
      identity_architecture: overrides.break_glass_accounts
        ? { break_glass_accounts: overrides.break_glass_accounts }
        : {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('generateInfrastructureManifest — infrastructure_model gating', () => {
  it('returns null for m365_only (no Azure manifest)', () => {
    expect(generateInfrastructureManifest(makeSI({ infrastructure_model: 'm365_only' }), makeTCP())).toBeNull();
  });

  it('defaults to the minimal m365_sentinel manifest when model is unset', () => {
    const m = generateInfrastructureManifest(makeSI({ infrastructure_model: undefined as unknown as string }), makeTCP())!;
    expect(m).not.toBeNull();
    expect(m.ces.intent).toContain('Sentinel-only');
  });
});

describe('generateInfrastructureManifest — m365_sentinel (minimal)', () => {
  const m = generateInfrastructureManifest(makeSI({ infrastructure_model: 'm365_sentinel' }), makeTCP())!;
  const body = m.infrastructure_manifest;

  it('stamps the artifact envelope', () => {
    expect(m.ces.artifact).toBe('infrastructure_manifest');
    expect(m.ces.version).toBe('1.0.0');
    expect(m.ces.generated_on).toMatch(ISO_RE);
    expect(m.ces.intent).toBe('CMMC L2 Sentinel-only infrastructure specification for rg-cmmc-contoso');
  });

  it('emits only the 3 logging resources; all other sections empty', () => {
    expect(body.logging.map((r) => r.resource_id)).toEqual(['log-rg', 'log-law', 'log-sentinel']);
    expect(body.identity).toEqual([]);
    expect(body.security).toEqual([]);
    expect(body.storage).toEqual([]);
    expect(body.network).toEqual([]);
    expect(body.automation).toEqual([]);
    expect(body.diagnostics).toEqual([]);
  });

  it('leaves every Azure-only variable-map field blank', () => {
    const v = body.stamper_variable_map;
    expect(v.resourceGroup).toBe('rg-cmmc-contoso');
    expect(v.lawWorkspaceName).toBe('contoso-law-prod');
    expect(v.location).toBe('usgovvirginia');
    expect(v.eoAppDisplayName).toBe('EvidenceOps-Automation');
    for (const blank of [
      'storageAccountName', 'keyVaultName', 'cmkKeyName', 'vnetName', 'vnetCidr',
      'subnetPeName', 'subnetPeCidr', 'nsgPeName', 'automationAccountName',
      'mgmtSubnetCidr', 'identitySubnetCidr', 'peSubnetCidr', 'fwSubnetCidr',
    ] as const) {
      expect(v[blank]).toBe('');
    }
  });

  it('reports Sentinel registry coverage (3 of 53 entries = 6%)', () => {
    expect(body.registry_coverage).toEqual({
      total_infra_entries: 53,
      covered_entry_ids: ['AZ-FOUND-001', 'AZ-LOG-001', 'AZ-SEN-001'],
      uncovered_entry_ids: [],
      coverage_pct: 6,
    });
  });
});

describe('generateInfrastructureManifest — m365_azure (full)', () => {
  const m = generateInfrastructureManifest(makeSI({ infrastructure_model: 'm365_azure' }), makeTCP())!;
  const body = m.infrastructure_manifest;

  it('emits the full resource set with stable section sizes (32 total)', () => {
    expect(body.identity).toHaveLength(4);
    expect(body.logging).toHaveLength(4);
    expect(body.security).toHaveLength(2);
    expect(body.storage).toHaveLength(6); // 3 resources + 3 WORM containers
    expect(body.network).toHaveLength(10);
    expect(body.automation).toHaveLength(2);
    expect(body.diagnostics).toHaveLength(4);
  });

  it('derives resource names from the domain prefix (contoso)', () => {
    const v = body.stamper_variable_map;
    expect(v.keyVaultName).toBe('contoso-kv-prod');
    expect(v.storageAccountName).toBe('contosoevops01'); // hyphen-stripped
    expect(v.vnetName).toBe('contoso-vnet-eo');
    expect(v.cmkKeyName).toBe('cmk-contoso');
    expect(v.nsgPeName).toBe('contoso-nsg-pe');
    expect(v.automationAccountName).toBe('contoso-automation-eo');
  });

  it('carves /27 subnets deterministically from the 10.0.0.0/16 VNet', () => {
    const v = body.stamper_variable_map;
    expect(v.vnetCidr).toBe('10.0.0.0/16');
    expect(v.subnetPeCidr).toBe('10.0.1.0/27');
    expect(v.mgmtSubnetCidr).toBe('10.0.2.0/27');
    expect(v.identitySubnetCidr).toBe('10.0.3.0/27');
    expect(v.peSubnetCidr).toBe('10.0.4.0/27');
    expect(v.fwSubnetCidr).toBe('10.0.5.0/27');
  });

  it('uses the gov-cloud DNS suffix + location for gcc_high', () => {
    expect(body.stamper_variable_map.location).toBe('usgovvirginia');
    const dnsKv = body.network.find((r) => r.resource_id === 'net-dns-kv')!;
    expect(dnsKv.name).toBe('privatelink.vaultcore.usgovcloudapi.net');
  });

  it('counts 27 distinct covered registry entries (51%)', () => {
    expect(body.registry_coverage.total_infra_entries).toBe(53);
    expect(body.registry_coverage.covered_entry_ids).toHaveLength(27);
    expect(body.registry_coverage.coverage_pct).toBe(51);
  });
});

describe('generateInfrastructureManifest — input-driven overrides', () => {
  it('switches to commercial location + DNS suffix for non-gov clouds', () => {
    const m = generateInfrastructureManifest(
      makeSI({ infrastructure_model: 'm365_azure' }),
      makeTCP({ cloud_environment: 'commercial' }),
    )!;
    const body = m.infrastructure_manifest;
    expect(body.stamper_variable_map.location).toBe('eastus');
    const dnsKv = body.network.find((r) => r.resource_id === 'net-dns-kv')!;
    expect(dnsKv.name).toBe('privatelink.vaultcore.azure.net');
  });

  it('honors TCP resource-group + workspace-name overrides', () => {
    const m = generateInfrastructureManifest(
      makeSI({ infrastructure_model: 'm365_sentinel' }),
      makeTCP({ sentinel_resource_group: 'rg-custom', sentinel_workspace_name: 'law-custom' }),
    )!;
    const v = m.infrastructure_manifest.stamper_variable_map;
    expect(v.resourceGroup).toBe('rg-custom');
    expect(v.lawWorkspaceName).toBe('law-custom');
  });

  it('propagates the SI evidence retention target into LAW + WORM (default 2557)', () => {
    const def = generateInfrastructureManifest(makeSI({ infrastructure_model: 'm365_sentinel' }), makeTCP())!;
    const law = def.infrastructure_manifest.logging.find((r) => r.resource_id === 'log-law')!;
    expect((law.properties as Record<string, unknown>).retention_days).toBe(2557);

    const custom = generateInfrastructureManifest(
      makeSI({ infrastructure_model: 'm365_azure', retention_target_days: 1000 }),
      makeTCP(),
    )!;
    const lawC = custom.infrastructure_manifest.logging.find((r) => r.resource_id === 'log-law')!;
    expect((lawC.properties as Record<string, unknown>).retention_days).toBe(1000);
  });
});

describe('deriveInfraSteps — DAG layering', () => {
  const manifest = generateInfrastructureManifest(makeSI({ infrastructure_model: 'm365_azure' }), makeTCP())!;
  const steps = deriveInfraSteps(manifest);

  it('produces one step per resource (32) sorted by ascending layer', () => {
    expect(steps).toHaveLength(32);
    const layers = steps.map((s) => s.layer);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });

  it('prefixes dependencies with infra_ and computes layer from the depends_on DAG', () => {
    const peKv = steps.find((s) => s.id === 'infra_net-pe-kv')!;
    expect(peKv.dependencies).toEqual(['infra_sto-kv', 'infra_net-snet-pe', 'infra_net-dns-kv']);
    expect(peKv.layer).toBe(3);
  });

  it('estimates 0.5h for registry-backed resources and 1h + manual for the rest', () => {
    const peKv = steps.find((s) => s.id === 'infra_net-pe-kv')!; // has registry entries
    expect(peKv.estimated_effort_hours).toBe(0.5);
    expect(peKv.gap_classifications).toEqual(['configure']);

    const breakGlass = steps.find((s) => s.id === 'infra_id-break-glass')!; // no registry entries
    expect(breakGlass.estimated_effort_hours).toBe(1);
    expect(breakGlass.gap_classifications).toEqual(['manual']);
  });
});
