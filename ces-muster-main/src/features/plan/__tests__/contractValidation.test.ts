// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R1: contract validation gate — validates that Muster-generated MP and TM
// pass the shared contract, and that violations are caught before artifacts
// leave Muster.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkMissionPlanCore, checkTenantManifestCore } from '../missionPlanContract';
import { buildPlanArtifacts, type MusterRequirementResult } from '../tenantManifestAdapter';
import { loadBanks, sitAnswers } from './planTestSupport';

const FIXTURE_DIR = path.resolve(__dirname, '../__fixtures__');

const BANKS = loadBanks();
const RESULTS: MusterRequirementResult[] = [
  { requirement_id: 'AC.L2-3.1.1', status: 'not_met' },
  { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
  { requirement_id: 'AU.L2-3.3.1', status: 'met' },
];
const artifacts = buildPlanArtifacts(
  { sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }), requirementResults: RESULTS, tenantConfig: null },
  BANKS,
);

describe('MS-R1: mission plan contract validation', () => {
  test('Muster-generated MP passes the contract', () => {
    const r = checkMissionPlanCore(artifacts.missionPlan);
    if (!r.ok) console.error('contract failures:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('Muster-generated TM passes the contract', () => {
    const r = checkTenantManifestCore(artifacts.tenantManifest);
    if (!r.ok) console.error('contract failures:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('checked-in MP fixture passes the contract', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
    const r = checkMissionPlanCore(mp);
    if (!r.ok) console.error('fixture contract failures:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('checked-in TM fixture passes the contract', () => {
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
    const r = checkTenantManifestCore(tm);
    if (!r.ok) console.error('fixture contract failures:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('unknown ces.version is rejected with a clear error', () => {
    const mp = JSON.parse(JSON.stringify(artifacts.missionPlan));
    mp.ces.version = '99.0.0';
    const r = checkMissionPlanCore(mp);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m: string) => m.includes('99.0.0') && m.includes('not a known contract version'))).toBe(true);
  });

  test('unknown ces.version on TM is rejected', () => {
    const tm = JSON.parse(JSON.stringify(artifacts.tenantManifest));
    tm.ces.version = '99.0.0';
    const r = checkTenantManifestCore(tm);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m: string) => m.includes('99.0.0'))).toBe(true);
  });

  test('MP with missing control_directives is rejected', () => {
    const mp = JSON.parse(JSON.stringify(artifacts.missionPlan));
    delete mp.outputs.human_readable_mission_plan.control_directives;
    const r = checkMissionPlanCore(mp);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('human_readable_mission_plan.control_directives[]');
  });

  test('MP with invalid generated_on format is rejected', () => {
    const mp = JSON.parse(JSON.stringify(artifacts.missionPlan));
    mp.ces.generated_on = '2026-09-27T03:23:34.377Z';
    const r = checkMissionPlanCore(mp);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m: string) => m.includes('YYYY-MM-DD'))).toBe(true);
  });

  test('MP with unknown directive value is rejected', () => {
    const mp = JSON.parse(JSON.stringify(artifacts.missionPlan));
    mp.outputs.human_readable_mission_plan.control_directives[0].directive = 'bogus-action';
    const r = checkMissionPlanCore(mp);
    expect(r.ok).toBe(false);
    expect(r.missing.some((m: string) => m.includes('bogus-action'))).toBe(true);
  });

  test('TM with missing tenant_manifest body is rejected', () => {
    const tm = JSON.parse(JSON.stringify(artifacts.tenantManifest));
    delete tm.tenant_manifest;
    const r = checkTenantManifestCore(tm);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('tenant_manifest');
  });
});
