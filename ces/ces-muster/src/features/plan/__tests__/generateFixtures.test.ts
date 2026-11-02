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
import { createHash } from 'node:crypto';
import { FIXTURE_RESULTS, FIXTURE_SIT_ANSWERS, FROZEN_TIME, freezeEntropy } from './fixtureInputs';
import { CUSTOMERS_DIR, fixtureKeys, loadCustomer } from './parityHarness';

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

// MG-04: the fixture customers' Planner goldens are fresh (generated from the
// planner-inputs.json now committed, on the shared frozen clock) and complete,
// and the fixtures hold synthetic data only. Regenerate stale goldens in
// ces-planner: `npx vite-node scripts/generate-goldens.ts`.
describe('MG-04 fixture customers: goldens fresh, fixtures synthetic', () => {
  test.each(fixtureKeys())('fixture %s: goldens match the committed Planner inputs', (fx) => {
    const c = loadCustomer(fx);
    const inputsSha = createHash('sha256').update(c.inputsText.replace(/\r\n/g, '\n')).digest('hex');
    expect(c.meta.inputsSha256, 'planner-inputs.json changed: regenerate the goldens').toBe(inputsSha);
    expect(c.meta.frozenTime).toBe(new Date(FROZEN_TIME).toISOString());
    expect(c.meta.generator).toMatch(/^ces-planner\/scripts\/generate-goldens\.ts/);
    const files = fs.readdirSync(c.goldenDir).filter((f) => f !== 'golden-meta.json').map((f) => f.replace(/\.json$/, ''));
    expect(files.sort()).toEqual([...c.meta.artifacts].sort());
    expect(c.inputs.fixture).toBe(fx);
    expect(c.musterSession.fixture).toBe(fx);
  });

  test('fixtures hold synthetic identifiers only (domains, mail addresses, tenant GUIDs, organisation names)', () => {
    const offenders: string[] = [];
    const walkDir = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) { walkDir(file); continue; }
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(CUSTOMERS_DIR, file);
        // Every e-mail-like address and tenant domain is a simtenant one.
        for (const m of text.matchAll(/[A-Za-z0-9._%+{}-]+@([A-Za-z0-9.{}-]+\.[A-Za-z]{2,})/g)) {
          if (!/^simtenant-[a-z]+\.onmicrosoft\.us$/.test(m[1])) offenders.push(`${rel}: address ${m[0]}`);
        }
        for (const m of text.matchAll(/[A-Za-z0-9-]+\.onmicrosoft\.(com|us)/g)) {
          if (!/^simtenant-[a-z]+\.onmicrosoft\.us$/.test(m[0])) offenders.push(`${rel}: tenant domain ${m[0]}`);
        }
        // Hosts and GUIDs: only the two input files can carry customer data (the
        // goldens add public documentation links and Microsoft role-template ids
        // from Planner's knowledge banks). Tenant/workspace GUIDs are the
        // synthetic 00000000-0000-400x-8000-... pattern.
        if (/^(planner-inputs|muster-session)\.json$/.test(name)) {
          for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
            if (!/^simtenant-[a-z]+\.sharepoint\.us$/.test(m[1])) offenders.push(`${rel}: host ${m[1]}`);
          }
          for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
            if (!/^00000000-0000-400[0-9]-8000-0000000000[0-9a-f]{2}$/i.test(m[0])) offenders.push(`${rel}: guid ${m[0]}`);
          }
        }
      }
    };
    walkDir(CUSTOMERS_DIR);
    for (const fx of fixtureKeys()) {
      const c = loadCustomer(fx);
      expect(c.inputs.synthetic).toBe(true);
      expect(c.musterSession.synthetic).toBe(true);
      expect(c.inputs.org).toMatch(/^Simtenant /);
      expect(c.musterSession.party.name).toBe(c.inputs.org);
    }
    expect(offenders.slice(0, 20)).toEqual([]);
  });
});
