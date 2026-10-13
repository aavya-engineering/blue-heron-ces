// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// seed.ts — bootstrap the first tenant + operator user on a fresh database.
// A brand-new Postgres has /auth/login but no users, so the API is a locked
// door until this runs once.
//
// Usage (from muster-api/):
//   npx tsx scripts/seed.ts --email ops@example.com --password <pw> \
//     [--tenant "Blue Heron Defense"] [--role bhd_operator]
//
// Idempotent: re-running with the same email updates the password hash and
// role instead of failing. Requires DATABASE_URL (reads .env via dotenv).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/prisma.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const VALID_ROLES = ['prime', 'sub', 'bhd_operator', 'assessor_read_only'] as const;
type SeedRole = (typeof VALID_ROLES)[number];

async function main(): Promise<number> {
  const email = arg('email');
  const password = arg('password') ?? process.env.SEED_PASSWORD;
  const tenantName = arg('tenant') ?? 'Blue Heron Defense';
  const role = (arg('role') ?? 'bhd_operator') as SeedRole;

  if (!email || !password) {
    console.error(
      'usage: npx tsx scripts/seed.ts --email <e> --password <pw> [--tenant name] [--role role]'
    );
    return 2;
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`invalid --role ${role}; one of: ${VALID_ROLES.join(', ')}`);
    return 2;
  }

  const tenant =
    (await db.tenant.findFirst({ where: { name: tenantName } })) ??
    (await db.tenant.create({ data: { name: tenantName } }));

  const password_hash = await bcrypt.hash(password, 10);
  const existing = await db.user.findUnique({ where: { email } });
  const user = existing
    ? await db.user.update({ where: { email }, data: { password_hash, role } })
    : await db.user.create({
        data: { tenant_id: tenant.id, email, password_hash, role },
      });

  console.log(
    JSON.stringify(
      { tenant: { id: tenant.id, name: tenant.name }, user: { id: user.id, email: user.email, role: user.role } },
      null,
      2
    )
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
