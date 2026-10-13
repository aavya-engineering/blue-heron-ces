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
import { ObjectStore } from '../store/ObjectStore.js';
import { Ledger } from '../ledger/Ledger.js';
import { SeedEngine } from './SeedEngine.js';
import { buildSeedSet } from './sets/gccHighG5.js';
import { loadProfile, resolveProfilePath } from '../profiles/ProfileLoader.js';

const PROFILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../profiles');

const FULL_TIER_TYPES = ['storageAccounts', 'keyVaults', 'automationAccounts', 'vnets', 'nsgs', 'managedIdentities'];
const AZURE_DOMAIN_TYPES = ['logAnalyticsWorkspaces', ...FULL_TIER_TYPES];

describe('SeedEngine', () => {
  let dir: string;
  let store: ObjectStore;
  let ledger: Ledger;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-seed-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('m365_only: seeded counts match the manifest and zero Azure-domain objects exist', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_only', PROFILES_DIR));
    const engine = new SeedEngine(store, ledger);
    const result = await engine.seed(profile);

    for (const [type, count] of Object.entries(profile.counts)) {
      expect(result.counts[type]).toBe(count);
    }

    for (const azureType of AZURE_DOMAIN_TYPES) {
      const objects = await store.list(azureType);
      expect(objects).toHaveLength(0);
    }
  });

  it('m365_sentinel: seeded counts match the manifest; logAnalyticsWorkspaces present, full-tier absent', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_sentinel', PROFILES_DIR));
    const engine = new SeedEngine(store, ledger);
    const result = await engine.seed(profile);

    for (const [type, count] of Object.entries(profile.counts)) {
      expect(result.counts[type]).toBe(count);
    }

    const workspaces = await store.list('logAnalyticsWorkspaces');
    expect(workspaces.length).toBeGreaterThan(0);

    for (const fullType of FULL_TIER_TYPES) {
      const objects = await store.list(fullType);
      expect(objects).toHaveLength(0);
    }
  });

  it('m365_azure: seeded counts match the manifest across the full Azure object list', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    const engine = new SeedEngine(store, ledger);
    const result = await engine.seed(profile);

    // SIMFIX FIX-S2: m365_azure also applies the gcc-high-g5 seed set - each
    // collection holds its generator count PLUS that set's additions, and
    // result.counts reports exactly what is in the store.
    const set = buildSeedSet('gcc-high-g5');
    expect(profile.seedSets).toEqual(['gcc-high-g5']);
    for (const [type, count] of Object.entries(profile.counts)) {
      expect(result.counts[type]).toBe(count + (set.add[type]?.length ?? 0));
    }
    for (const [type, n] of Object.entries(result.counts)) {
      expect(await store.list(type)).toHaveLength(n);
    }

    for (const azureType of AZURE_DOMAIN_TYPES) {
      const objects = await store.list(azureType);
      expect(objects.length).toBeGreaterThan(0);
    }
  });

  it('logs one ledger create entry per seeded object', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_only', PROFILES_DIR));
    const engine = new SeedEngine(store, ledger);
    const result = await engine.seed(profile);

    const totalSeeded = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    const entries = await ledger.query({ type: 'create' });
    expect(entries).toHaveLength(totalSeeded);
  });
});
