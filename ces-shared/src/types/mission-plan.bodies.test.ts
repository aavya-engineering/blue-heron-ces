// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ManualStepSchema,
  TenantManifestBodySchema,
  InfrastructureBodySchema,
  InfraVariableMapSchema,
  RegistryCoverageSchema,
} from './mission-plan.bodies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

describe('ManualStepSchema — fixture coverage', () => {
  it('parses every step in the Stamper fixture', () => {
    const raw = loadFixture('stamper-mission-plan.json') as any;
    const steps: unknown[] = raw.outputs.human_readable_mission_plan.steps;
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const result = ManualStepSchema.safeParse(step);
      expect(result.success, `step ${(step as any).id} failed: ${JSON.stringify(result.success ? null : result.error.issues[0])}`).toBe(true);
    }
  });

  it('round-trips Stamper steps without key loss', () => {
    const raw = loadFixture('stamper-mission-plan.json') as any;
    const steps: unknown[] = raw.outputs.human_readable_mission_plan.steps;
    for (const step of steps) {
      const parsed = ManualStepSchema.parse(step);
      expect(parsed).toEqual(step);
    }
  });

  it('rejects a step missing required fields', () => {
    const result = ManualStepSchema.safeParse({
      id: 'BAD-STEP',
      title: 'Missing fields',
    });
    expect(result.success).toBe(false);
  });

  it('preserves Stamper-only optional fields (section, resource_type, layer)', () => {
    const step = {
      id: 'STEP-EXTRA', title: 'Infra step', task_type: 'configuration',
      priority: 'p0',
      control_coverage: [{ control_id: 'SC.L2-3.13.1', support_type: 'Overt', gap_rationale: 'gap' }],
      what_to_do: ['do it'], how_to_verify: ['verify it'],
      vendor_help_refs: [],
      expected_artifacts: [{
        artifact_id: 'ART-1', artifact_type: 'config_export',
        description: 'd', collector: 'ps', retention_days: 365,
        storage_location_ref: 'evidence/',
      }],
      manual_completion_criteria: ['done'],
      section: 'network', resource_type: 'vnet', layer: 3,
    };
    const parsed = ManualStepSchema.parse(step);
    expect(parsed.section).toBe('network');
    expect(parsed.resource_type).toBe('vnet');
    expect(parsed.layer).toBe(3);
  });
});

describe('TenantManifestBodySchema — fixture coverage', () => {
  it('parses the Muster tenant manifest body', () => {
    const raw = loadFixture('muster-tenant-manifest.json') as any;
    const result = TenantManifestBodySchema.safeParse(raw.tenant_manifest);
    expect(result.success).toBe(true);
  });

  it('round-trips the Muster tenant manifest body without key loss', () => {
    const raw = loadFixture('muster-tenant-manifest.json') as any;
    const parsed = TenantManifestBodySchema.parse(raw.tenant_manifest);
    expect(parsed).toEqual(raw.tenant_manifest);
  });

  it('parses the Stamper tenant manifest body', () => {
    const raw = loadFixture('stamper-tenant-manifest.json') as any;
    const result = TenantManifestBodySchema.safeParse(raw.tenant_manifest);
    expect(result.success).toBe(true);
  });

  it('round-trips the Stamper tenant manifest body without key loss', () => {
    const raw = loadFixture('stamper-tenant-manifest.json') as any;
    const parsed = TenantManifestBodySchema.parse(raw.tenant_manifest);
    expect(parsed).toEqual(raw.tenant_manifest);
  });

  it('rejects a body missing manifest_id', () => {
    const result = TenantManifestBodySchema.safeParse({
      tech_stack_id: 1,
      normative_controls: [], assets: [],
      config_intents: [{ id: 'ci', title: 't', control_ids: ['AC.L2-3.1.1'], desired_config: {}, source_of_truth: 'iac', query_method: 'api' }],
      evidence_monitors: [{ id: 'em', control_ids: ['AC.L2-3.1.1'], signal: 's', collection_method: 'manual', cadence: '1d', retention_days: 30, on_drift: 'alert' }],
      drift_policies: [{ id: 'dp', scope: 's', severity: 'low', detection: ['d'], response_playbook: ['r'] }],
    });
    expect(result.success).toBe(false);
  });
});

describe('InfrastructureBodySchema', () => {
  const minimalInfra = {
    identity: [], logging: [], security: [], storage: [],
    network: [], automation: [], diagnostics: [],
    stamper_variable_map: {
      subscriptionId: 's', resourceGroup: 'rg', location: 'l',
      lawWorkspaceName: 'law', eoAppDisplayName: 'eo',
      storageAccountName: '', keyVaultName: '', cmkKeyName: '',
      vnetName: '', vnetCidr: '', subnetPeName: '', subnetPeCidr: '',
      nsgPeName: '', automationAccountName: '',
    },
    registry_coverage: {
      total_infra_entries: 0, covered_entry_ids: [],
      uncovered_entry_ids: [], coverage_pct: 0,
    },
    provenance: [],
  };

  it('parses a minimal infrastructure body', () => {
    const result = InfrastructureBodySchema.safeParse(minimalInfra);
    expect(result.success).toBe(true);
  });

  it('round-trips without key loss', () => {
    const parsed = InfrastructureBodySchema.parse(minimalInfra);
    expect(parsed).toEqual(minimalInfra);
  });

  it('preserves optional infrastructure_model', () => {
    const withModel = { ...minimalInfra, infrastructure_model: 'm365_sentinel' as const };
    const parsed = InfrastructureBodySchema.parse(withModel);
    expect(parsed.infrastructure_model).toBe('m365_sentinel');
  });

  it('preserves unknown passthrough keys', () => {
    const extended = { ...minimalInfra, future_infra_field: 'kept' };
    const parsed = InfrastructureBodySchema.parse(extended);
    expect((parsed as any).future_infra_field).toBe('kept');
  });

  it('rejects when required stamper_variable_map fields are missing', () => {
    const bad = {
      ...minimalInfra,
      stamper_variable_map: { subscriptionId: 's' },
    };
    const result = InfraVariableMapSchema.safeParse(bad.stamper_variable_map);
    expect(result.success).toBe(false);
  });

  it('rejects when registry_coverage is malformed', () => {
    const result = RegistryCoverageSchema.safeParse({ total_infra_entries: 'not a number' });
    expect(result.success).toBe(false);
  });
});
