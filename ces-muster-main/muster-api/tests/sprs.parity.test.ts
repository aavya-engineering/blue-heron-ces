// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// SPRS cross-copy parity test.
// Both implementations — the api copy (muster-api/src/services/sprsCalc.ts) and the
// SPA original (src/features/scoring/sprsCalc.ts) — are run against the committed
// sprs-parity.json fixture and independently against shared edge-case inputs.
// Any divergence between the two is a blocking failure.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeSprs as apiComputeSprs } from '../src/services/sprsCalc.js';

// SPA original imported via relative path — cross-package, no shared bundle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let spaComputeSprs: (requirementResults: Array<{ requirement_id: string; status: string }>) => any;

// Fixture committed at first sprsCalc.test.ts run (SPA suite generates it).
// Resolved relative to this test file, not CWD, so it works from any working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_PATH = resolve(__dirname, '../../src/features/scoring/__tests__/__fixtures__/sprs-parity.json');

// Load the SPA module and fixture synchronously before tests run.
// Dynamic import cannot be top-level in vitest without a beforeAll; use a module-level
// import() resolved before the describe block via Promise resolution at module eval time.
// Pattern: wrap in a module-level IIFE that tests await via a lazy check.
let fixtureData: {
  input: Array<{ requirement_id: string; status: string }>;
  expected: { sprs: number; assessed_count: number; deductions: Array<{ requirement_id: string; weight: number }> };
} | null = null;

// Load SPA module — vitest resolves TypeScript files natively
const spaModulePromise = import('../../src/features/scoring/sprsCalc.js').then((m) => {
  spaComputeSprs = m.computeSprs;
});

function loadFixture() {
  if (fixtureData) return fixtureData;
  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
  fixtureData = JSON.parse(raw);
  return fixtureData!;
}

// ── Shared edge cases — run both implementations against identical inputs ────

const EDGE_CASES = [
  {
    label: 'all-met → sprs 110',
    input: [
      { requirement_id: 'AC.L1-3.1.1', status: 'met' },
      { requirement_id: 'IA.L2-3.5.3', status: 'met' },
    ],
    expectedSprs: 110,
  },
  {
    label: 'empty input → sprs 110',
    input: [],
    expectedSprs: 110,
  },
  {
    label: 'one 5-weight not_met → sprs 105',
    input: [{ requirement_id: 'AC.L1-3.1.1', status: 'not_met' }],
    expectedSprs: 105,
  },
  {
    label: 'unknown counts as not met → sprs 105',
    input: [{ requirement_id: 'IA.L2-3.5.3', status: 'unknown' }],
    expectedSprs: 105,
  },
  {
    label: 'partial counts as not met → sprs 105',
    input: [{ requirement_id: 'IA.L2-3.5.3', status: 'partial' }],
    expectedSprs: 105,
  },
  {
    label: 'floor never below -203',
    input: Array.from({ length: 400 }, (_, i) => ({
      requirement_id: `FAKE.${i}`,
      status: 'not_met',
    })),
    expectedSprs: -203,
  },
];

describe('SPRS cross-copy parity — edge cases', () => {
  for (const { label, input, expectedSprs } of EDGE_CASES) {
    it(`api: ${label}`, () => {
      const result = apiComputeSprs(input);
      expect(result.sprs).toBe(expectedSprs);
    });

    it(`spa: ${label}`, async () => {
      await spaModulePromise;
      const result = spaComputeSprs(input);
      expect(result.sprs).toBe(expectedSprs);
    });

    it(`api === spa: ${label}`, async () => {
      await spaModulePromise;
      const apiResult = apiComputeSprs(input);
      const spaResult = spaComputeSprs(input);
      expect(apiResult).toEqual(spaResult);
    });
  }
});

describe('SPRS cross-copy parity — committed fixture (sprs-parity.json)', () => {
  it('fixture file is readable', () => {
    const fixture = loadFixture();
    expect(fixture).toBeDefined();
    expect(fixture.input).toBeDefined();
    expect(fixture.expected).toBeDefined();
  });

  it('api implementation matches fixture expected value', () => {
    const fixture = loadFixture();
    const result = apiComputeSprs(fixture.input);
    expect(result).toEqual(fixture.expected);
  });

  it('spa implementation matches fixture expected value', async () => {
    await spaModulePromise;
    const fixture = loadFixture();
    const result = spaComputeSprs(fixture.input);
    expect(result).toEqual(fixture.expected);
  });

  it('api and spa produce identical output for fixture input', async () => {
    await spaModulePromise;
    const fixture = loadFixture();
    const apiResult = apiComputeSprs(fixture.input);
    const spaResult = spaComputeSprs(fixture.input);
    expect(apiResult).toEqual(spaResult);
  });
});
