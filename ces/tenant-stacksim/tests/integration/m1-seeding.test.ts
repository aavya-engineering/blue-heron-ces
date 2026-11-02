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
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../../src/cli/commands/seed.js';
import { initTenant } from '../../src/cli/commands/init-tenant.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';

const PROFILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../profiles');

const FULL_TIER_TYPES = ['storageAccounts', 'keyVaults', 'automationAccounts', 'vnets', 'nsgs', 'managedIdentities'];
const AZURE_DOMAIN_TYPES = ['logAnalyticsWorkspaces', ...FULL_TIER_TYPES];

/**
 * M1 integration gate (PLAN.md Milestone Ladder row M1): exercises the CLI
 * command layer (seedTenant/initTenant), not just the underlying
 * ProfileLoader/SeedEngine/SimTenantConfig units, using temp dirs so it
 * never touches the real ~/.stamper or .stacksim/ trees.
 */
describe('M1 integration — CLI seed + init-tenant', () => {
  let tenantRoot: string;
  let homeDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m1-tenant-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m1-home-'));
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m1-project-'));
  });

  afterEach(async () => {
    await fs.rm(tenantRoot, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('m365_only seed via CLI: counts match manifest, zero Azure-domain objects', async () => {
    const result = await seedTenant({ stance: 'm365_only', profilesDir: PROFILES_DIR, tenantRoot });
    expect(Object.values(result.counts).some((n) => n > 0)).toBe(true);

    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    for (const type of AZURE_DOMAIN_TYPES) {
      expect(await store.list(type)).toHaveLength(0);
    }
  });

  it('m365_sentinel seed via CLI: Log Analytics/Sentinel objects only, zero full-tier objects', async () => {
    const result = await seedTenant({ stance: 'm365_sentinel', profilesDir: PROFILES_DIR, tenantRoot });
    expect(result.counts.logAnalyticsWorkspaces).toBeGreaterThan(0);

    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    for (const type of FULL_TIER_TYPES) {
      expect(await store.list(type)).toHaveLength(0);
    }
    expect(await store.list('logAnalyticsWorkspaces')).toHaveLength(result.counts.logAnalyticsWorkspaces);
  });

  it('m365_azure seed via CLI: full Azure object list present with matching counts', async () => {
    const result = await seedTenant({ stance: 'm365_azure', profilesDir: PROFILES_DIR, tenantRoot });

    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    for (const type of AZURE_DOMAIN_TYPES) {
      expect(result.counts[type]).toBeGreaterThan(0);
      expect(await store.list(type)).toHaveLength(result.counts[type]);
    }
  });

  it('init-tenant writes plan-data, and the flat TenantProbe config only with emitFlat (backlog-S3)', async () => {
    const result = await initTenant({
      stance: 'm365_azure',
      profilesDir: PROFILES_DIR,
      homeDir,
      projectRoot,
      emitPlanData: true,
      emitFlat: true,
    });

    expect(result.config.infrastructure_model).toBe('m365_azure');
    expect(result.config.endpoints.graph).toContain('http://localhost:');
    expect(result.planDataPath).toBeDefined();

    const flatRaw = await fs.readFile(result.flatPath as string, 'utf8');
    const planDataRaw = await fs.readFile(result.planDataPath as string, 'utf8');
    expect(JSON.parse(flatRaw)).toEqual(JSON.parse(planDataRaw));

    // backlog-S3 default: without emitFlat, the (temp) home dir stays untouched.
    const noFlat = await initTenant({ stance: 'm365_azure', slug: 'sim-noflat', profilesDir: PROFILES_DIR, homeDir });
    expect(noFlat.flatPath).toBeUndefined();
  });

  it('init-tenant for m365_only omits Azure endpoints/subscription in the emitted config', async () => {
    const result = await initTenant({ stance: 'm365_only', profilesDir: PROFILES_DIR, homeDir });
    expect(result.config.endpoints.arm).toBeUndefined();
    expect(result.config.endpoints.azure_auth).toBeUndefined();
    expect(result.config.subscription).toBeUndefined();
  });
});
