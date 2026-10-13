// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/**
 * Run a callback inside a transaction that has `app.tenant_id` set, so the
 * Postgres RLS policies on parties / interview_sessions / contracts resolve to
 * the caller's tenant. Every RLS-protected query in Phase 2+ MUST go through
 * this helper — a bare `db.party.findMany()` will otherwise see zero rows
 * (or, if connected as a BYPASSRLS role, ALL tenants' rows).
 *
 * SET LOCAL is scoped to the surrounding transaction, so tenant context can
 * never leak across pooled connections.
 *
 * @param client - Prisma client (or compatible mock) to use for the transaction.
 *   Defaults to the global `db` singleton. Pass the injected db from a router
 *   factory so unit tests can substitute an in-memory mockDb whose $transaction
 *   is a passthrough (fn receives the mock itself as the transaction client).
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = db
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.$transaction(async (tx: any) => {
    // set_config(..., is_local => true) is transaction-scoped like SET LOCAL,
    // but takes a bound parameter — no string interpolation, no injection.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
