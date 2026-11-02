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
//
// MG-04: `npm run fixtures:generate -- --parity-report` instead prints the
// parity diffs of every fixture customer (src/features/plan/__fixtures__/customers/)
// against Planner's goldens, grouped by allow-list entry, and writes the full
// list to $TEMP/mg04-parity-report.json. It changes no file: the allow-list is
// edited by hand and reviewed. (Planner's goldens are regenerated in ces-planner:
// `npx vite-node scripts/generate-goldens.ts`.)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

if (process.argv.includes('--parity-report')) {
  await import('fake-indexeddb/auto');
  const h = await import('../src/features/plan/__tests__/parityHarness.ts');
  const entries = h.loadAllowList();
  const report: Record<string, unknown> = {};
  const absorbedAll: Record<string, Record<string, number>> = {};
  let unallowedTotal = 0;
  for (const fx of h.fixtureKeys()) {
    const { goldens } = h.loadCustomer(fx);
    for (const producer of ['session', 'chain'] as const) {
      const muster = producer === 'session' ? await h.musterFromSession(fx) : await h.musterChainFromPlannerInputs(fx);
      const r = h.checkParity(fx, producer, goldens, muster, entries);
      for (const [id, n] of Object.entries(r.absorbed)) {
        absorbedAll[id] ??= {};
        absorbedAll[id][fx] = (absorbedAll[id][fx] ?? 0) + n;
      }
      unallowedTotal += r.unallowed.length;
      // Group unallowed diffs by artifact + path shape (bracketed keys collapsed).
      const groups: Record<string, number> = {};
      for (const d of r.unallowed) {
        const shape = `${producer}:${d.artifact}:${d.kind}:${d.path.split('/').map((s) => (s.startsWith('[') ? '*' : s)).join('/')}`;
        groups[shape] = (groups[shape] ?? 0) + 1;
      }
      report[`${fx}/${producer}`] = { total: r.total, absorbed: r.absorbed, unallowedGroups: groups, unallowed: r.unallowed, absorbedDiffs: r.absorbedDiffs };
      console.log(`fixture ${fx} ${producer}: ${r.total} diffs, ${r.total - r.unallowed.length} allow-listed, ${r.unallowed.length} NOT allow-listed`);
      for (const [shape, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${shape}`);
    }
  }
  console.log('\nAllow-list entries (absorbed per fixture vs reviewed count):');
  for (const e of entries) {
    const got = absorbedAll[e.id] ?? {};
    const fixtures = [...new Set([...Object.keys(e.count), ...Object.keys(got)])].sort();
    const cells = fixtures.map((fx) => `${fx}=${got[fx] ?? 0}/${e.count[fx] ?? 0}`);
    const ok = fixtures.every((fx) => (got[fx] ?? 0) === (e.count[fx] ?? 0));
    console.log(`  ${ok ? 'ok ' : 'OFF'} ${e.mg.padEnd(8)} ${e.id.padEnd(40)} ${cells.join(' ')}`);
  }
  const out = path.join(process.env.TEMP ?? os.tmpdir(), 'mg04-parity-report.json');
  fs.writeFileSync(out, JSON.stringify({ absorbed: absorbedAll, fixtures: report }, null, 2));
  console.log(`\n${unallowedTotal} diffs not allow-listed. Full report: ${out}`);
  process.exit(0);
}

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
