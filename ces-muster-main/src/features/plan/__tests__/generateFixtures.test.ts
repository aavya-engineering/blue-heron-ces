// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M1 (N-7): compare test — generates fixtures in memory with frozen entropy
// and asserts they match the checked-in files byte-for-byte. If they differ,
// run `npm run fixtures:generate` to update.
import { describe, test, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FIXTURE_RESULTS, FIXTURE_SIT_ANSWERS, freezeEntropy } from './fixtureInputs';

const FIXTURE_DIR = path.resolve(__dirname, '../__fixtures__');

// Freeze entropy BEFORE generating — same order as the script.
const entropy = freezeEntropy();

// Import AFTER freezing so generators see frozen Date/Math.random at call time.
const { loadBanks } = await import('./planTestSupport');
const { buildPlanArtifacts } = await import('../tenantManifestAdapter');

const BANKS = loadBanks();
const artifacts = buildPlanArtifacts(
  {
    sitAnswers: FIXTURE_SIT_ANSWERS,
    requirementResults: FIXTURE_RESULTS,
    tenantConfig: null,
  },
  BANKS,
);

entropy.restore();

// W4-MU1: the Infra Manifest golden — its own compile, its own frozen entropy
// (same order as scripts/generate-plan-fixtures.ts).
const { buildInfraGolden } = await import('./fixtureInputs');
const infraEntropy = freezeEntropy();
const infraGolden = await buildInfraGolden(BANKS);
infraEntropy.restore();

afterAll(() => {
  entropy.restore();
});

describe('fixture freshness (M1 N-7)', () => {
  test('generated MP matches checked-in fixture', () => {
    const generated = JSON.stringify(artifacts.missionPlan, null, 2);
    const checkedIn = fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8');
    expect(generated).toBe(checkedIn);
  });

  test('generated TM matches checked-in fixture', () => {
    const generated = JSON.stringify(artifacts.tenantManifest, null, 2);
    const checkedIn = fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8');
    expect(generated).toBe(checkedIn);
  });

  test('W4-MU1: generated Infra Manifest matches the checked-in golden', () => {
    expect(infraGolden.infrastructureManifest).not.toBeNull();
    const generated = JSON.stringify(infraGolden.infrastructureManifest, null, 2);
    const checkedIn = fs.readFileSync(path.join(FIXTURE_DIR, 'infrastructure-manifest.json'), 'utf8');
    expect(generated).toBe(checkedIn);
  });

  test('W4-MU1: generated Tenant Config Profile matches the checked-in golden', () => {
    const generated = JSON.stringify(infraGolden.tenantConfig, null, 2);
    const checkedIn = fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-config-profile.json'), 'utf8');
    expect(generated).toBe(checkedIn);
  });

  test('generated SI baseline matches checked-in fixture', () => {
    const generated = JSON.stringify(artifacts.siBaseline, null, 2);
    const checkedIn = fs.readFileSync(path.join(FIXTURE_DIR, 'si-baseline.json'), 'utf8');
    expect(generated).toBe(checkedIn);
  });
});
