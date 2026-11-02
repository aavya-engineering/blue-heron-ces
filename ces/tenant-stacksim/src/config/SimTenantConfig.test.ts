// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSimTenantConfig,
  flatTenantConfigPath,
  planDataTenantConfigPath,
  writeSimTenantConfig,
} from './SimTenantConfig.js';

describe('buildSimTenantConfig', () => {
  it('m365_only omits endpoints.arm/azure_auth and subscription', () => {
    const config = buildSimTenantConfig({ slug: 'sim-m365-only', tenantStance: 'm365_only' });
    expect(config.endpoints.arm).toBeUndefined();
    expect(config.endpoints.azure_auth).toBeUndefined();
    expect(config.subscription).toBeUndefined();
    expect(config.endpoints.graph).toContain('http://localhost:');
    expect(config.infrastructure_model).toBe('m365_only');
  });

  it('m365_sentinel includes endpoints.arm/azure_auth and subscription', () => {
    const config = buildSimTenantConfig({ slug: 'sim-m365-sentinel', tenantStance: 'm365_sentinel' });
    expect(config.endpoints.arm).toBeDefined();
    expect(config.endpoints.azure_auth).toBeDefined();
    expect(config.subscription).toBeDefined();
  });

  it('m365_azure includes endpoints.arm/azure_auth and subscription', () => {
    const config = buildSimTenantConfig({ slug: 'sim-m365-azure', tenantStance: 'm365_azure' });
    expect(config.endpoints.arm).toBeDefined();
    expect(config.endpoints.azure_auth).toBeDefined();
    expect(config.subscription).toBeDefined();
  });

  it('respects a custom port', () => {
    const config = buildSimTenantConfig({ slug: 'sim-test', tenantStance: 'm365_only', port: 9999 });
    expect(config.endpoints.graph).toBe('http://localhost:9999/graph');
  });

  it('includes required TenantConfig-compatible fields', () => {
    const config = buildSimTenantConfig({ slug: 'sim-test', tenantStance: 'm365_only' });
    expect(config.tenant.tenant_id).toBeTruthy();
    expect(config.auth.app_id).toBeTruthy();
    expect(config.auth.cert_path).toBeTruthy();
    expect(config.auth.cert_thumbprint).toBeTruthy();
    expect(config.client.slug).toBe('sim-test');
  });

  it('resources are tiered to the stack concept (2026-07-10 full-parameter emit)', () => {
    const only = buildSimTenantConfig({ slug: 's', tenantStance: 'm365_only' });
    const sentinel = buildSimTenantConfig({ slug: 's', tenantStance: 'm365_sentinel' });
    const azure = buildSimTenantConfig({ slug: 's', tenantStance: 'm365_azure' });

    // Identity/M365 keys on every stance, pointing at REAL seeded objects.
    for (const cfg of [only, sentinel, azure]) {
      expect(cfg.tenant.environment).toBe('gcc-high-sim');
      expect(cfg.onboarding?.cert_expires).toBeTruthy();
      expect(cfg.resources?.operator_upn).toBe('sim.user1@simtenant.onmicrosoft.us');
      expect(cfg.resources?.breakglass_upn).toBe('sim.user2@simtenant.onmicrosoft.us');
      // SIMFIX (REQ ao-source-keys): aligned with the seeded group-1 name.
      expect(cfg.resources?.cui_group_name).toBe('CUI-Authorized-Users');
      // Stamper REQ sim-tenant-secret-variables: every stance, clearly fake.
      expect(cfg.resources?.approver_upn).toBe('sim.user3@simtenant.onmicrosoft.us');
      expect(cfg.resources?.initial_password).toMatch(/Sim-Only/);
      expect(Buffer.from(cfg.resources?.tou_file_base64 ?? '', 'base64').toString('utf8')).toMatch(/SIMULATED TERMS OF USE/);
      expect(cfg.resources?.eo_sp_object_id).toBe('sp-1');
    }

    // Sentinel tier: LAW appears; full-tier Azure resources do not.
    expect(only.resources?.law_name).toBeUndefined();
    expect(sentinel.resources?.law_name).toBe('sim-law-1');
    expect(sentinel.resources?.kv_name).toBeUndefined();
    expect(sentinel.resources?.storage_account_name).toBeUndefined();

    // Full tier: everything, named after the seeded objects.
    expect(azure.resources?.law_name).toBe('sim-law-1');
    expect(azure.resources?.kv_name).toBe('sim-kv-1');
    expect(azure.resources?.storage_account_name).toBe('simstorage1');
    expect(azure.resources?.vnet_name).toBe('sim-vnet-1');
    expect(azure.resources?.nsg_name).toBe('sim-nsg-1');
    expect(azure.resources?.cmk_key_name).toBe('sim-storage-key-1');
    expect(azure.resources?.storage_resource_id).toContain('/subscriptions/sim-sub-s/resourceGroups/sim-rg-s/');
  });
});

describe('writeSimTenantConfig', () => {
  let homeDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-home-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-project-'));
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('backlog-S3: does NOT write the flat ~/.stamper path by default', async () => {
    const result = await writeSimTenantConfig(
      { slug: 'sim-m365-only', tenantStance: 'm365_only' },
      { homeDir },
    );
    expect(result.flatPath).toBeUndefined();
    expect(result.planDataPath).toBeUndefined();
    // Nothing created under the (temp) home dir at all.
    await expect(fs.access(path.join(homeDir, '.stamper'))).rejects.toThrow();
  });

  it('backlog-S3: writes the flat TenantProbe path only when emitFlat is set', async () => {
    const result = await writeSimTenantConfig(
      { slug: 'sim-m365-only', tenantStance: 'm365_only' },
      { homeDir, emitFlat: true },
    );
    expect(result.flatPath).toBe(flatTenantConfigPath('sim-m365-only', homeDir));

    const raw = await fs.readFile(result.flatPath as string, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.client.slug).toBe('sim-m365-only');
  });

  it('also writes the nested plan-data path when emitPlanData is set', async () => {
    const result = await writeSimTenantConfig(
      { slug: 'sim-m365-azure', tenantStance: 'm365_azure' },
      { homeDir, projectRoot, emitPlanData: true },
    );
    expect(result.planDataPath).toBe(planDataTenantConfigPath('sim-m365-azure', projectRoot));

    const raw = await fs.readFile(result.planDataPath as string, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.infrastructure_model).toBe('m365_azure');
    expect(parsed.subscription).toBeDefined();
  });
});
