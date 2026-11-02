// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// db.ts — FIN-25: muster-api's database handle. Prisma/Postgres is gone; the
// engagement layer lives in ces.db (lib/musterStore.ts, GD-a one DBMS).
//
// `db` is the shared MusterStore for {CES_PIPELINE_ROOT}/ces.db, opened lazily
// on first use, so importing this module never creates a database file.

import { CesScopeError, getMusterStore, type MusterStore, type TenantView } from './musterStore.js';

/** The root store, opened on first property access. */
export const db: MusterStore = new Proxy({} as MusterStore, {
  get(_target, prop) {
    const store = getMusterStore();
    const value = Reflect.get(store, prop, store);
    return typeof value === 'function' ? value.bind(store) : value;
  },
  has(_target, prop) {
    return Reflect.has(getMusterStore(), prop);
  },
});

/**
 * Run `fn` against the tenant-scoped view of the store — the REQUIRED tenant
 * scope that replaced Postgres row-level security. Every row `fn` writes is
 * stamped with the tenant; every read sees only that tenant's rows.
 *
 * @param client - a MusterStore (default: the shared `db`), or a test double
 *   with a passthrough `$transaction` (tests/helpers/mockDb.ts).
 */
export async function withTenant<T>(
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (tx: any) => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = db
): Promise<T> {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new CesScopeError('withTenant: a tenant id is required');
  }
  if (client && typeof client.forTenant === 'function') {
    return fn(client.forTenant(tenantId) as TenantView);
  }
  if (client && typeof client.$transaction === 'function') {
    return client.$transaction(fn);
  }
  return fn(client);
}
