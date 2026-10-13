// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// seed-rls-fixtures.ts — G-MUSTER-PL-1 H2. Seeds the two-tenant fixture the live
// RLS suite (tests/rls.test.ts) needs so the 3 env-gated tests actually pass
// against a real Postgres, instead of only the cross-tenant-isolation checks
// that need no rows. Specifically it satisfies the positive-visibility test:
//   "withTenant(tenant-B) sees tenant-B parties" → needs one tenant-B party.
//
// Idempotent: re-running is a no-op once the tenant-B party exists.
// Requires DATABASE_URL (reads .env via dotenv). The DB role MUST NOT be a
// superuser / BYPASSRLS role, or the isolation tests would falsely pass — the
// party insert below deliberately relies on the RLS WITH CHECK to scope the row.
import 'dotenv/config';
import { db, withTenant } from '../src/lib/prisma.js';

// The exact tenant IDs tests/rls.test.ts asserts against.
const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

async function main(): Promise<number> {
  // Tenants + engagements have no RLS — create them on the plain connection.
  await db.tenant.upsert({
    where: { id: TENANT_A },
    update: {},
    create: { id: TENANT_A, name: 'RLS Fixture Tenant A' },
  });
  await db.tenant.upsert({
    where: { id: TENANT_B },
    update: {},
    create: { id: TENANT_B, name: 'RLS Fixture Tenant B' },
  });

  // Already seeded? (Query under tenant-B's own RLS context.)
  const existing = await withTenant(TENANT_B, (tx) =>
    (tx as { party: { findMany: () => Promise<unknown[]> } }).party.findMany()
  );
  if (existing.length > 0) {
    console.log('RLS fixtures already present — nothing to do.');
    return 0;
  }

  const engagement = await db.engagement.create({
    data: { tenant_id: TENANT_B, engagement_kind: 'individual_contractor' },
  });

  // parties has RLS: the row's tenant_id must match app.tenant_id (the policy's
  // USING doubles as WITH CHECK), so the insert MUST run inside withTenant(B).
  await withTenant(TENANT_B, (tx) =>
    (tx as {
      party: { create: (a: unknown) => Promise<unknown> };
    }).party.create({
      data: {
        tenant_id: TENANT_B,
        engagement_id: engagement.id,
        name: 'RLS Fixture Party (Tenant B)',
        on_prem_ot: 'no',
      },
    })
  );

  console.log('Seeded tenant-A, tenant-B, and one tenant-B party for the live RLS suite.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
