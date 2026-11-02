// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-AO-CMMC-BOUND-1 M2: audit CMMC-level migration coverage across the tenant registry.
// Run via: npx tsx scripts/audit-cmmc-migration.ts (or npm run audit-cmmc-migration)

import { getTenantRegistry } from '../src/tenant/aoTenants.js';

async function main(): Promise<void> {
  const registry = getTenantRegistry();
  const live = await registry.listByKind('live');
  const sim = await registry.listByKind('sim');
  const records = [...live, ...sim];

  const total = records.length;
  const exempt: string[] = [];
  let migrated = 0;

  for (const record of records) {
    const r = record as unknown as { tenantSlug: string; cmmcLevel?: string; cmmcMigrationExempt?: boolean };
    if (r.cmmcMigrationExempt) {
      exempt.push(r.tenantSlug);
      continue;
    }
    if (r.cmmcLevel) {
      migrated += 1;
    }
  }

  const denominator = total - exempt.length;
  const coverage = denominator > 0 ? `${((migrated / denominator) * 100).toFixed(1)}%` : 'N/A';

  console.log('[audit-cmmc-migration] CMMC-level migration coverage report');
  console.log(`  total tenants:     ${total}`);
  console.log(`  exempt:            ${exempt.length}${exempt.length ? ` (${exempt.join(', ')})` : ''}`);
  console.log(`  migrated:          ${migrated}`);
  console.log(`  coverage:          ${coverage}`);
}

main().catch((err) => {
  console.error('[audit-cmmc-migration] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
