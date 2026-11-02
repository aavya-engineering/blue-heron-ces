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
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { Ledger } from '../../src/ledger/Ledger.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { SeedEngine } from '../../src/seed/SeedEngine.js';
import { loadProfile, resolveProfilePath } from '../../src/profiles/ProfileLoader.js';
import { BASE_BUILTINS } from '../../src/seed/sets/base.js';

/**
 * FX-07: every scenario carries the built-in EXO/Teams singletons (base seed).
 * FX-08: seeded users carry sign-in data covering recent / stale / none, and
 * a new DLP rule reports DistributionStatus 'Success'.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SCENARIOS_DIR = path.join(SIM_ROOT, 'scenarios');
const DAY = 86400000;

describe('FX-07/FX-08 base seed', () => {
  let dir: string;
  let tenantRoot: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fx-p14-'));
    tenantRoot = path.join(dir, 'tenant');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function buildMusterPartial(): Promise<{ store: ObjectStore; table: ResolverTable; seedCounts: Record<string, number> }> {
    const scenario = await loadScenario(path.join(SCENARIOS_DIR, 'muster-partial.json'));
    // EO-collection B20 (2026-10-27): muster-partial now opts into the log-record
    // set 'eo-collection-b20' only; it still never gets the gcc-high-g5 set.
    expect(scenario.seedSets ?? []).not.toContain('gcc-high-g5');
    const result = await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot });
    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    const table = new ResolverTable(store, new StackShapeGate('m365_azure'));
    return { store, table, seedCounts: result.seedCounts };
  }

  it('FX-07: muster-partial seeds malware filter "Default" and Teams "Global"; named Set-* calls find them', async () => {
    const { store, table, seedCounts } = await buildMusterPartial();
    for (const [collection, objects] of Object.entries(BASE_BUILTINS)) {
      expect(seedCounts[collection], `seeded: line lists ${collection}`).toBe(objects.length);
      expect((await store.list(collection)).map((o) => o.id)).toEqual(objects.map((o) => o.id));
    }
    await table.resolveCmdlet('Set-MalwareFilterPolicy', ['-Identity', 'Default', '-EnableFileFilter', true]);
    expect((await store.read('malwareFilterPolicy', 'Default'))?.EnableFileFilter).toBe(true);
    await table.resolveCmdlet('Set-CsExternalAccessPolicy', ['-Identity', 'Global', '-EnableFederationAccess', false]);
    expect((await store.read('csExternalAccessPolicy', 'Global'))?.EnableFederationAccess).toBe(false);
  });

  it('FX-07: the gcc-high-g5 profile still holds each built-in exactly once', async () => {
    const store = new ObjectStore(path.join(dir, 'g5-store.json'));
    const ledger = new Ledger(path.join(dir, 'g5-ledger.jsonl'));
    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    const result = await new SeedEngine(store, ledger).seed(profile);
    for (const [collection, objects] of Object.entries(BASE_BUILTINS)) {
      expect(result.counts[collection]).toBe(objects.length);
      expect(await store.list(collection)).toHaveLength(objects.length);
    }
  });

  // W5c2 (2026-10-28): muster-partial's own set (muster-partial-config) now
  // gives every user a recent sign-in, so the base seed's spread is tested on
  // muster-bare, which carries the base seed and no named set.
  it('FX-08: seeded users cover recent, older-than-90-days and never-signed-in (muster-bare, base seed only)', async () => {
    const scenario = await loadScenario(path.join(SCENARIOS_DIR, 'muster-bare.json'));
    expect(scenario.seedSets ?? []).toEqual([]);
    await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot });
    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    const age = async (id: string): Promise<number | null> => {
      const u = (await store.read('users', id)) as Record<string, unknown>;
      const s = u.signInActivity as { lastSignInDateTime?: string } | undefined;
      return s?.lastSignInDateTime ? (Date.now() - Date.parse(s.lastSignInDateTime)) / DAY : null;
    };
    expect(await age('user-1')).toBeLessThan(1);
    expect(await age('user-2')).toBeGreaterThan(90);
    expect(await age('user-3')).toBeLessThan(90);
    expect(await age('user-4')).toBeGreaterThan(90);
    expect(await age('user-5')).toBeNull();
  });

  it('FX-08: a gcc-high-g5 tenant keeps the set\'s own sign-in values for user-1..5', async () => {
    const store = new ObjectStore(path.join(dir, 'g5-store.json'));
    const ledger = new Ledger(path.join(dir, 'g5-ledger.jsonl'));
    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    await new SeedEngine(store, ledger).seed(profile);
    const u2 = (await store.read('users', 'user-2')) as unknown as { signInActivity: { lastSignInDateTime: string } };
    const days = (Date.now() - Date.parse(u2.signInActivity.lastSignInDateTime)) / DAY;
    expect(Math.round(days)).toBe(60);
    const u5 = (await store.read('users', 'user-5')) as unknown as { signInActivity?: unknown };
    expect(u5.signInActivity).toBeDefined();
  });

  it('FX-08: New-DlpComplianceRule stores DistributionStatus "Success"', async () => {
    const { table } = await buildMusterPartial();
    await table.resolveCmdlet('New-DlpComplianceRule', ['-Name', 'CMMC-CUI-Block-Rule', '-Policy', 'CMMC-CUI-Block', '-BlockAccess', true]);
    const rules = (await table.resolveCmdlet('Get-DlpComplianceRule', ['-Policy', 'CMMC-CUI-Block'])) as Array<Record<string, unknown>>;
    const rule = (Array.isArray(rules) ? rules : [rules]).find((r) => r.Name === 'CMMC-CUI-Block-Rule');
    expect(rule?.DistributionStatus).toBe('Success');
  });

  // synthetic-customer W3 (2026-10-28): the create response says 'Pending',
  // every later Get- says 'Success' (exoResolvers.ts New-DlpCompliancePolicy).
  it('W3: New-DlpCompliancePolicy answers DistributionStatus "Pending"; a later Get-DlpCompliancePolicy -Identity returns "Success"', async () => {
    const { store, table } = await buildMusterPartial();
    // S1's case: the policy is not there before the create.
    await store.delete('dlpCompliancePolicy', 'CMMC-CUI-Block');
    expect(await store.read('dlpCompliancePolicy', 'CMMC-CUI-Block')).toBeUndefined();
    const created = (await table.resolveCmdlet('New-DlpCompliancePolicy', [
      '-Name', 'CMMC-CUI-Block', '-ExchangeLocation', 'All', '-SharePointLocation', 'All', '-OneDriveLocation', 'All', '-Mode', 'Enable',
    ])) as Record<string, unknown>;
    expect(created.Name).toBe('CMMC-CUI-Block');
    expect(created.DistributionStatus).toBe('Pending');
    const got = (await table.resolveCmdlet('Get-DlpCompliancePolicy', ['-Identity', 'CMMC-CUI-Block'])) as unknown;
    const policy = (Array.isArray(got) ? got : [got]) as Array<Record<string, unknown>>;
    expect(policy).toHaveLength(1);
    expect(policy[0].DistributionStatus).toBe('Success');
    expect(policy[0].Mode).toBe('Enable');
    // The stored object never carries the response-only value.
    expect(((await store.read('dlpCompliancePolicy', 'CMMC-CUI-Block')) as Record<string, unknown>).DistributionStatus).toBe('Success');
  });

  it('W3: muster-partial seeds CMMC-CUI-Block before Stamper (Get path reads "Success")', async () => {
    const { table, seedCounts } = await buildMusterPartial();
    expect(seedCounts.dlpCompliancePolicy).toBe(1);
    const got = (await table.resolveCmdlet('Get-DlpCompliancePolicy', ['-Identity', 'CMMC-CUI-Block'])) as unknown;
    const policy = (Array.isArray(got) ? got : [got]) as Array<Record<string, unknown>>;
    expect(policy).toHaveLength(1);
    expect(policy[0].DistributionStatus).toBe('Success');
  });
});
