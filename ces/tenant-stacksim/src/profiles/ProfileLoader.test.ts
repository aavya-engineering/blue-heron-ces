// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile, resolveProfilePath, validateProfile, type Profile } from './ProfileLoader.js';

const PROFILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../profiles');

describe('ProfileLoader — loading real manifests', () => {
  it('loads m365-only.json with tenantStance m365_only and no Azure-domain counts', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_only', PROFILES_DIR));
    expect(profile.tenantStance).toBe('m365_only');
    expect(profile.counts.users).toBeGreaterThan(0);
    expect(profile.counts.logAnalyticsWorkspaces).toBeUndefined();
    expect(profile.counts.storageAccounts).toBeUndefined();
    expect(profile.counts.keyVaults).toBeUndefined();
    expect(profile.counts.vnets).toBeUndefined();
    expect(profile.counts.nsgs).toBeUndefined();
    expect(profile.counts.automationAccounts).toBeUndefined();
    expect(profile.counts.managedIdentities).toBeUndefined();
  });

  it('loads m365-sentinel.json with only logAnalyticsWorkspaces as Azure-domain count', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_sentinel', PROFILES_DIR));
    expect(profile.tenantStance).toBe('m365_sentinel');
    expect(profile.counts.logAnalyticsWorkspaces).toBeGreaterThan(0);
    expect(profile.counts.storageAccounts).toBeUndefined();
    expect(profile.counts.keyVaults).toBeUndefined();
    expect(profile.counts.vnets).toBeUndefined();
    expect(profile.counts.nsgs).toBeUndefined();
    expect(profile.counts.automationAccounts).toBeUndefined();
    expect(profile.counts.managedIdentities).toBeUndefined();
  });

  it('loads m365-azure.json with the full Azure object list', async () => {
    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    expect(profile.tenantStance).toBe('m365_azure');
    for (const type of [
      'logAnalyticsWorkspaces',
      'storageAccounts',
      'keyVaults',
      'automationAccounts',
      'vnets',
      'nsgs',
      'managedIdentities',
    ]) {
      expect(profile.counts[type]).toBeGreaterThan(0);
    }
  });
});

describe('ProfileLoader — validateProfile', () => {
  function baseManifest(overrides: Partial<Profile> = {}): Partial<Profile> {
    return {
      tenantStance: 'm365_only',
      slug: 'test-slug',
      counts: { users: 1 },
      ...overrides,
    };
  }

  it('throws on missing tenantStance', () => {
    const manifest = baseManifest();
    delete (manifest as Record<string, unknown>).tenantStance;
    expect(() => validateProfile(manifest)).toThrow();
  });

  it('throws on unknown object type', () => {
    expect(() =>
      validateProfile(baseManifest({ counts: { notARealType: 1 } })),
    ).toThrow();
  });

  it('throws when m365_only manifest declares a full-tier Azure object type', () => {
    expect(() =>
      validateProfile(baseManifest({ tenantStance: 'm365_only', counts: { users: 1, storageAccounts: 1 } })),
    ).toThrow();
  });

  it('throws when m365_only manifest declares a sentinel-tier object type', () => {
    expect(() =>
      validateProfile(
        baseManifest({ tenantStance: 'm365_only', counts: { users: 1, logAnalyticsWorkspaces: 1 } }),
      ),
    ).toThrow();
  });

  it('throws when m365_sentinel manifest declares a full-tier Azure object type', () => {
    expect(() =>
      validateProfile(
        baseManifest({ tenantStance: 'm365_sentinel', counts: { users: 1, storageAccounts: 1 } }),
      ),
    ).toThrow();
  });

  it('allows m365_sentinel manifest to declare logAnalyticsWorkspaces', () => {
    expect(() =>
      validateProfile(
        baseManifest({ tenantStance: 'm365_sentinel', counts: { users: 1, logAnalyticsWorkspaces: 1 } }),
      ),
    ).not.toThrow();
  });

  it('allows m365_azure manifest to declare the full Azure list', () => {
    expect(() =>
      validateProfile(
        baseManifest({
          tenantStance: 'm365_azure',
          counts: { users: 1, storageAccounts: 1, logAnalyticsWorkspaces: 1 },
        }),
      ),
    ).not.toThrow();
  });
});
