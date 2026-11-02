// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { G5_IDS, G5_LICENSING } from '../../src/seed/sets/gccHighG5.js';
// @ts-expect-error plain-JS generator script (no type declarations)
import { buildAoopsScenario, loadAoopsConfig } from '../../scripts/build-aoops-scenario.mjs';

/**
 * SIMFIX / GOAL-AO-SIM-COVERAGE M1 exit criterion: `stacksim scenario aoops-g5`
 * seeds the G5 SKU (values from the tenant-object licensing constants), every
 * deliberate gap, with deterministic ids; a re-run is the reset; the generated
 * scenario never drifts from its config.
 */
const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SCENARIO_PATH = path.join(SIM_ROOT, 'scenarios', 'aoops-g5.json');

async function build(dir: string): Promise<ObjectStore> {
  const tenantRoot = path.join(dir, 'tenant');
  await fs.mkdir(tenantRoot, { recursive: true });
  await applyScenario(await loadScenario(SCENARIO_PATH), { profilesDir: PROFILES_DIR, tenantRoot });
  return new ObjectStore(path.join(tenantRoot, 'store.json'));
}

describe('aoops-g5 scenario', () => {
  let dirA: string;
  let dirB: string;
  let a: ObjectStore;
  let b: ObjectStore;

  beforeAll(async () => {
    dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-aoops-a-'));
    dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-aoops-b-'));
    a = await build(dirA);
    b = await build(dirB);
  }, 60_000);

  afterAll(async () => {
    await fs.rm(dirA, { recursive: true, force: true });
    await fs.rm(dirB, { recursive: true, force: true });
  });

  it('drift guard: the committed scenario is exactly what its config generates', () => {
    const committed = JSON.parse(readFileSync(SCENARIO_PATH, 'utf8'));
    expect(committed).toEqual(buildAoopsScenario(loadAoopsConfig()));
  });

  it('seeds the G5 SKU from the tenant-object licensing values, with one unlicensed user', async () => {
    const skus = await a.list('subscribedSkus');
    expect(skus).toHaveLength(1);
    expect(skus[0]).toMatchObject({ id: G5_IDS.m365LicenseSkuId, displayName: G5_LICENSING.primarySku });
    const users = await a.list('users');
    const unlicensed = users.filter((u) => u.userType === 'Member' && (u.assignedLicenses as unknown[]).length === 0);
    expect(unlicensed.map((u) => u.displayName)).toContain('Sim Contractor');
  });

  it('carries the deliberate gaps AO detect-type commands look for', async () => {
    const users = await a.list('users');
    expect(users.filter((u) => u.userType === 'Guest')).toHaveLength(2);
    expect(users.some((u) => Date.parse((u.signInActivity as { lastSignInDateTime: string }).lastSignInDateTime) < Date.now() - 120 * 86400000)).toBe(true);
    expect((await a.list('riskyUsers')).some((r) => r.riskLevel === 'high' && r.riskState === 'atRisk')).toBe(true);
    expect((await a.list('groups')).some((g) => g.visibility === 'Public')).toBe(true);
    expect((await a.list('roleAssignments')).some((r) => r.roleDefinitionId === '62e90394-69f5-4237-9190-012177145e10' && r.principalId === 'user-1')).toBe(true);
    expect((await a.list('applicationOwners')).some((o) => o.applicationId === 'application-2')).toBe(false);
    expect((await a.list('managedDevices')).some((d) => d.complianceState === 'noncompliant')).toBe(true);
    expect((await a.list('spoTenant'))[0].SharingCapability).toBe('ExternalUserAndGuestSharing');
    expect((await a.list('sentinelAlertRules')).some((r) => r.Enabled === false)).toBe(true);
    expect((await a.list('backupJobs')).some((j) => (j.properties as { status: string }).status === 'Failed')).toBe(true);
    expect((await a.list('unifiedAuditLog')).length).toBeGreaterThan(20);
  });

  it('deterministic ids: two builds hold the same objects under the same ids', async () => {
    for (const c of ['users', 'groups', 'groupMember', 'caPolicies', 'managedDevices', 'applications', 'unifiedAuditLog']) {
      expect((await b.list(c)).map((o) => o.id).sort(), c).toEqual((await a.list(c)).map((o) => o.id).sort());
    }
  });
});
