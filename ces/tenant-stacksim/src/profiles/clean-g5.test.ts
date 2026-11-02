// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_SET_NAMES, buildSeedSet } from '../seed/sets/gccHighG5.js';
import {
  CLEAN_G5_BREAK_GLASS_UPNS,
  CLEAN_G5_COUNT_OVERRIDES,
  CLEAN_G5_GRAPH_APP_ROLES,
  CLEAN_G5_ROLE_DEFINITIONS,
  buildCleanG5Seed,
  cleanG5AppRoleId,
} from './clean-g5.js';

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('FIN-21 clean-g5 profile', () => {
  it('is a registered seed set, built by the seed-set dispatcher', () => {
    expect(SEED_SET_NAMES).toContain('clean-g5');
    expect(Object.keys(buildSeedSet('clean-g5', 0).add).sort()).toEqual(Object.keys(buildCleanG5Seed(0).add).sort());
  });

  it('scenarios/clean-g5.json matches the profile (drift guard)', () => {
    const sc = JSON.parse(readFileSync(path.join(SIM_ROOT, 'scenarios', 'clean-g5.json'), 'utf8'));
    expect(sc).toMatchObject({ name: 'clean-g5', stance: 'm365_azure', seedSets: ['clean-g5'], steps: [] });
    expect(sc.countOverrides).toEqual(CLEAN_G5_COUNT_OVERRIDES);
    const profile = JSON.parse(readFileSync(path.join(SIM_ROOT, 'profiles', 'm365-azure.json'), 'utf8'));
    for (const k of Object.keys(CLEAN_G5_COUNT_OVERRIDES)) expect(profile.counts, k).toHaveProperty(k);
  });

  it('carries no CES app, Security Defaults on, two cloud-only break-glass Global Administrators, free G5 seats', () => {
    const s = buildCleanG5Seed(Date.UTC(2026, 9, 31));
    expect(s.add.applications).toBeUndefined();
    expect(s.add.servicePrincipalAppRoleAssignments).toBeUndefined();
    expect(s.add.identitySecurityDefaultsEnforcementPolicy[0].isEnabled).toBe(true);
    const users = s.add.users as Array<Record<string, any>>;
    const bg = users.filter((u) => (CLEAN_G5_BREAK_GLASS_UPNS as readonly string[]).includes(u.userPrincipalName));
    expect(bg).toHaveLength(2);
    expect(bg.every((u) => u.accountEnabled === true && u.onPremisesSyncEnabled === null)).toBe(true);
    const ga = (s.add.roleAssignments as Array<Record<string, any>>).filter((r) => r.roleDefinitionId === CLEAN_G5_ROLE_DEFINITIONS[0].id);
    expect(ga.map((r) => r.principalId).sort()).toEqual(expect.arrayContaining(bg.map((u) => u.id)));
    const sku = s.add.subscribedSkus[0] as Record<string, any>;
    expect(sku.prepaidUnits.enabled - sku.consumedUnits).toBeGreaterThan(0);
    expect(sku.consumedUnits).toBe(users.filter((u) => u.assignedLicenses.length > 0).length);
    expect((s.add.armResources as Array<Record<string, any>>).map((r) => r.type)).toEqual(['Microsoft.Resources/subscriptions']);
  });

  it('the Graph service principal offers every permission the bootstrap script asks for', () => {
    const ps1 = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'scripts', 'New-TenantBootstrap.ps1');
    if (!existsSync(ps1)) return;
    const block = readFileSync(ps1, 'utf8').match(/\$requiredPermissions = @\(([\s\S]*?)\n\)/)?.[1] ?? '';
    const code = block.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
    const wanted = code.match(/"[^"]+"/g)?.map((x) => x.slice(1, -1)) ?? [];
    expect(wanted.length).toBeGreaterThan(20);
    for (const p of wanted) expect(CLEAN_G5_GRAPH_APP_ROLES as readonly string[], p).toContain(p);
  });

  it('app-role ids are deterministic and distinct per resource', () => {
    expect(cleanG5AppRoleId('graph', 'X')).toBe(cleanG5AppRoleId('graph', 'X'));
    expect(cleanG5AppRoleId('graph', 'X')).not.toBe(cleanG5AppRoleId('exo', 'X'));
    const ids = CLEAN_G5_GRAPH_APP_ROLES.map((v) => cleanG5AppRoleId('graph', v));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
