// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-SH step 1 (2026-09-28): secret-reference shape in the Infra Manifest, the same three
// provisioning inputs on the Tenant Manifest for m365-only sessions, and re-export verification.
// REQs answered: ../ces-muster/docs/requirements/REQ-ces-shared-im-secret-values.md,
// ../ces-muster/docs/requirements/REQ-ces-shared-export-provisioning-vars.md.
import { describe, it, expect } from 'vitest';
import {
  SecretReferenceSchema,
  ProvisioningInputsSchema,
  TenantManifestBodySchema,
  InfraManifestSchema,
  STAMPER_PROVISIONING_REQUIRED_VARIABLES,
  INFRA_VARIABLE_ALIASES,
  normalizeInfraVariableMap,
} from './mission-plan.contract.js';

function baseInfraBody(vm: Record<string, unknown> = {}) {
  return {
    identity: [], logging: [], security: [], storage: [], network: [], automation: [], diagnostics: [],
    stamper_variable_map: {
      subscriptionId: 's', resourceGroup: 'rg', location: 'l', lawWorkspaceName: 'law', eoAppDisplayName: 'eo',
      storageAccountName: '', keyVaultName: '', cmkKeyName: '', vnetName: '', vnetCidr: '', subnetPeName: '',
      subnetPeCidr: '', nsgPeName: '', automationAccountName: '', ...vm,
    },
    registry_coverage: { total_infra_entries: 0, covered_entry_ids: [], uncovered_entry_ids: [], coverage_pct: 0 },
    provenance: [],
  };
}

describe('SecretReferenceSchema', () => {
  it('parses the one_time_operator_held shape Muster emits today, unchanged', () => {
    const ref = { variable: 'initialPassword', form: 'one_time_operator_held', ref: 'secretref:one-time:uuid-1' };
    const r = SecretReferenceSchema.safeParse(ref);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(ref);
  });

  it('parses the key_vault_secret shape', () => {
    const ref = { variable: 'initialPassword', form: 'key_vault_secret', vault: 'kv-example', name: 'initial-password' };
    expect(SecretReferenceSchema.safeParse(ref).success).toBe(true);
  });

  it('rejects a reference carrying a plain value/secret/password key (strict — never a plain value)', () => {
    const withValue = { variable: 'initialPassword', form: 'one_time_operator_held', ref: 'secretref:x', value: 'P@ssw0rd!' };
    expect(SecretReferenceSchema.safeParse(withValue).success).toBe(false);
    const withSecret = { variable: 'initialPassword', form: 'key_vault_secret', vault: 'v', name: 'n', secret: 'P@ssw0rd!' };
    expect(SecretReferenceSchema.safeParse(withSecret).success).toBe(false);
  });

  it('rejects an unknown form', () => {
    expect(SecretReferenceSchema.safeParse({ variable: 'initialPassword', form: 'plaintext', ref: 'x' }).success).toBe(false);
  });
});

describe('InfrastructureBodySchema / InfraManifestSchema — secret_references', () => {
  it('an Infra Manifest with secret_references parses under the exported schema', () => {
    const body = baseInfraBody();
    (body as any).secret_references = [
      { variable: 'initialPassword', form: 'one_time_operator_held', ref: 'secretref:one-time:uuid-2' },
    ];
    const r = InfraManifestSchema.safeParse({
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: '2026-09-28', intent: 'test' },
      infrastructure: body,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.infrastructure.secret_references).toEqual(body.secret_references);
  });

  it('rejects a manifest that puts initialPassword as a plain value in stamper_variable_map', () => {
    const body = baseInfraBody({ initialPassword: 'P@ssw0rd!' });
    const r = InfraManifestSchema.safeParse({
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: '2026-09-28', intent: 'test' },
      infrastructure: body,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'infrastructure.stamper_variable_map.initialPassword')).toBe(true);
    }
  });

  it('rejects a plain value for any variable a secret_references entry itself names as secret', () => {
    const body = baseInfraBody({ customSecretVar: 'literal-value' });
    (body as any).secret_references = [
      { variable: 'customSecretVar', form: 'one_time_operator_held', ref: 'secretref:one-time:uuid-3' },
    ];
    const r = InfraManifestSchema.safeParse({
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: '2026-09-28', intent: 'test' },
      infrastructure: body,
    });
    expect(r.success).toBe(false);
  });

  it('a manifest with no secret variables set still parses (back-compat)', () => {
    const body = baseInfraBody();
    const r = InfraManifestSchema.safeParse({
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: '2026-09-28', intent: 'test' },
      infrastructure: body,
    });
    expect(r.success).toBe(true);
  });
});

describe('TenantManifestBodySchema — provisioning_inputs (founder decision 2026-09-28 #11)', () => {
  const okBody = () => ({
    manifest_id: 'tm-1', tech_stack_id: 1,
    normative_controls: [{ control_id: 'AC.L1-3.1.1', required_state: 'enforced', verification: [], evidence_artifacts: [] }],
    assets: [],
    config_intents: [{
      id: 'ci-1', title: 't', control_ids: ['AC.L1-3.1.1'], desired_config: {},
      source_of_truth: 'platform_setting', query_method: 'api',
    }],
    evidence_monitors: [{
      id: 'em-1', control_ids: ['AC.L1-3.1.1'], signal: 's', collection_method: 'api_poll',
      cadence: 'daily', retention_days: 365, on_drift: 'alert',
    }],
    drift_policies: [{
      id: 'dp-1', scope: 'tenant', severity: 'low', detection: ['d1'], response_playbook: ['p1'],
    }],
  });

  it('accepts the three provisioning inputs for an m365-only session, initial password as a SecretReference', () => {
    const body = {
      ...okBody(),
      provisioning_inputs: {
        approver_upn: 'approver@example.onmicrosoft.com',
        terms_of_use_file: { file_name: 'tou.pdf', content_base64: 'ZmFrZQ==' },
        initial_password_ref: { variable: 'initialPassword', form: 'one_time_operator_held', ref: 'secretref:one-time:uuid-4' },
      },
    };
    const r = TenantManifestBodySchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.provisioning_inputs).toEqual(body.provisioning_inputs);
  });

  it('rejects provisioning_inputs.initial_password_ref as a plain string (must be a SecretReference)', () => {
    const body = {
      ...okBody(),
      provisioning_inputs: {
        approver_upn: 'approver@example.onmicrosoft.com',
        terms_of_use_file: { file_name: 'tou.pdf', content_base64: 'ZmFrZQ==' },
        initial_password_ref: 'P@ssw0rd!',
      },
    };
    expect(TenantManifestBodySchema.safeParse(body).success).toBe(false);
  });

  it('provisioning_inputs is optional (non-m365-only sessions parse unchanged)', () => {
    expect(TenantManifestBodySchema.safeParse(okBody()).success).toBe(true);
  });

  it('ProvisioningInputsSchema is exported standalone', () => {
    expect(ProvisioningInputsSchema).toBeDefined();
  });
});

describe('REQ-ces-shared-export-provisioning-vars — already satisfied via export * (FX-SH2, 2.5.0)', () => {
  it('STAMPER_PROVISIONING_REQUIRED_VARIABLES, INFRA_VARIABLE_ALIASES, normalizeInfraVariableMap import from ./mission-plan.contract.js', () => {
    expect(Array.isArray(STAMPER_PROVISIONING_REQUIRED_VARIABLES)).toBe(true);
    expect(STAMPER_PROVISIONING_REQUIRED_VARIABLES.length).toBeGreaterThan(0);
    expect(INFRA_VARIABLE_ALIASES).toEqual({ fwSubnetCidr: 'firewallSubnetCidr' });
    expect(typeof normalizeInfraVariableMap).toBe('function');
  });
});
