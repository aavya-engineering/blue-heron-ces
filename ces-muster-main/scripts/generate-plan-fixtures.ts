#!/usr/bin/env npx tsx
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Regenerate the checked-in plan fixtures with frozen entropy so they are
// byte-stable across runs. Run: npm run fixtures:generate
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Freeze entropy BEFORE importing the generators.
const { freezeEntropy, FIXTURE_RESULTS, FIXTURE_SIT_ANSWERS } = await import(
  '../src/features/plan/__tests__/fixtureInputs.ts'
);
const entropy = freezeEntropy();

try {
  const { loadBanks } = await import('../src/features/plan/__tests__/planTestSupport.ts');
  const { buildPlanArtifacts } = await import('../src/features/plan/tenantManifestAdapter.ts');

  const banks = loadBanks();
  const artifacts = buildPlanArtifacts(
    {
      sitAnswers: FIXTURE_SIT_ANSWERS,
      requirementResults: FIXTURE_RESULTS,
      tenantConfig: null,
    },
    banks,
  );

  const fixtureDir = path.join(ROOT, 'src/features/plan/__fixtures__');
  fs.mkdirSync(fixtureDir, { recursive: true });

  fs.writeFileSync(
    path.join(fixtureDir, 'manual-mission-plan.json'),
    JSON.stringify(artifacts.missionPlan, null, 2),
  );
  fs.writeFileSync(
    path.join(fixtureDir, 'tenant-manifest.json'),
    JSON.stringify(artifacts.tenantManifest, null, 2),
  );
  fs.writeFileSync(
    path.join(fixtureDir, 'si-baseline.json'),
    JSON.stringify(artifacts.siBaseline, null, 2),
  );

  // W4-MU1: the Infra Manifest golden — its own compile, its own frozen entropy.
  entropy.restore();
  const infraEntropy = freezeEntropy();
  try {
    const { buildInfraGolden } = await import('../src/features/plan/__tests__/fixtureInputs.ts');
    const golden = await buildInfraGolden(banks);
    if (!golden.infrastructureManifest) throw new Error('infra golden: generator returned null');
    fs.writeFileSync(
      path.join(fixtureDir, 'infrastructure-manifest.json'),
      JSON.stringify(golden.infrastructureManifest, null, 2),
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'tenant-config-profile.json'),
      JSON.stringify(golden.tenantConfig, null, 2),
    );
  } finally {
    infraEntropy.restore();
  }

  console.log('Fixtures written to src/features/plan/__fixtures__/');
  console.log('  infrastructure-manifest.json');
  console.log('  tenant-config-profile.json');
  console.log('  manual-mission-plan.json');
  console.log('  tenant-manifest.json');
  console.log('  si-baseline.json');
} finally {
  entropy.restore();
}
