// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// mockDb.ts — hand-rolled in-memory Prisma-like fake for unit tests.
// Implements create/findUnique/findMany/update/updateMany/delete with simple
// key-value filtering. Keeps insertion order; ignores orderBy.
// Uses crypto.randomUUID() (Node 18+ global) for generated IDs.

function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const stored = record[k];
    if (v === null) return stored == null; // match both null and undefined
    return stored === v;
  });
}

function makeModel<T extends Record<string, unknown>>(initial: T[] = []) {
  const records: T[] = [...initial];

  return {
    _records: records,

    async create({ data }: { data: Record<string, unknown> }): Promise<T> {
      const record = {
        id: (data.id as string | undefined) ?? crypto.randomUUID(),
        created_at: new Date(),
        ...data,
      } as unknown as T;
      records.push(record);
      return record;
    },

    async findUnique({ where }: { where: Record<string, unknown> }): Promise<T | null> {
      return records.find((r) => matches(r, where)) ?? null;
    },

    async findMany(args?: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<T[]> {
      const where = args?.where;
      if (!where) return [...records];
      return records.filter((r) => matches(r, where));
    },

    async update({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<T> {
      const idx = records.findIndex((r) => matches(r, where));
      if (idx === -1) throw new Error('Record not found for update');
      records[idx] = { ...records[idx], ...data } as T;
      return records[idx];
    },

    async updateMany({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }> {
      let count = 0;
      records.forEach((r, idx) => {
        if (matches(r, where)) {
          records[idx] = { ...r, ...data } as T;
          count++;
        }
      });
      return { count };
    },

    async delete({ where }: { where: Record<string, unknown> }): Promise<T> {
      const idx = records.findIndex((r) => matches(r, where));
      if (idx === -1) throw new Error('Record not found for delete');
      const [deleted] = records.splice(idx, 1);
      return deleted;
    },
  };
}

export function createMockDb() {
  const mockDb = {
    party: makeModel(),
    engagement: makeModel(),
    contract: makeModel(),
    interviewSession: makeModel(),
    hilItem: makeModel(),
    touchEvent: makeModel(),
    disposition: makeModel(),
    nudgeEvent: makeModel(),
    user: makeModel(),
    deliveryArtifact: makeModel(),
    deliveryGrant: makeModel(),
    deliveryAuditEntry: makeModel(),

    /**
     * Passthrough $transaction: immediately calls fn with this mockDb as the
     * transaction client. withTenant() uses this so route handlers can be tested
     * without a real Postgres connection — the RLS GUC set_config call is a
     * noop via $executeRaw below, and service factories receive mockDb as tx.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn(mockDb);
    },

    /**
     * Noop $executeRaw: called by withTenant as a tagged-template literal to
     * set app.tenant_id. In-memory mockDb has no Postgres session, so this is
     * silently ignored — the tenant scoping that matters (row filtering) is
     * handled by the real DB in live tests and not needed in unit tests.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $executeRaw(..._args: any[]): Promise<void> {
      return Promise.resolve();
    },
  };
  return mockDb;
}

export type MockDb = ReturnType<typeof createMockDb>;
