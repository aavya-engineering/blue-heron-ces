// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G2 — unified, SQLite-backed CES persistence. NODE-ONLY (better-sqlite3 + node:*).
// Do NOT import from FE/browser code.
//
// One read/write/update/delete interface for every persistent CES object, replacing scattered
// raw-JSON-file persistence. Every row carries the G1 identity (customerId/siBaselineId/tenantSlug/
// cesId); EVERY read is scoped, so cross-tenant leakage is impossible — there is no API to read a
// row without naming the scope it must belong to. See docs/adr/ADR-002-unified-persistence.md.

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

import type { CesIdentity } from '../config/cesConfig.contract.js';
import { getCesPipelineRoot } from '../storage/node.js';

/** Default on-disk DB location: {CES_PIPELINE_ROOT}/ces.db */
export function getCesDbPath(): string {
  return path.join(getCesPipelineRoot(), 'ces.db');
}

/**
 * The isolation scope every read/update/delete must name. At least one field is required — an empty
 * scope is rejected, which is what makes unscoped (leak-prone) reads impossible.
 */
export interface CesScope {
  customerId?: number;
  siBaselineId?: number;
  tenantSlug?: string;
  tenantId?: string;
}

export interface CesRecordInput {
  id: string;
  ces: CesIdentity;
  data: unknown;
}

export interface CesRecord<T = unknown> {
  collection: string;
  id: string;
  customerId?: number;
  siBaselineId?: number;
  tenantSlug?: string;
  tenantId?: string;
  cesId?: string;
  data: T;
  createdAt: string;
  updatedAt: string;
}

export class CesScopeError extends Error {
  constructor(message: string) {
    super(`CES scope: ${message}`);
    this.name = 'CesScopeError';
  }
}

/** Thrown when a mutation/deletion is attempted against a WORM (append-only) collection. */
export class CesWormError extends Error {
  constructor(message: string) {
    super(`CES WORM: ${message}`);
    this.name = 'CesWormError';
  }
}

/**
 * Collections that are append-only (write-once-read-many) by default. Evidence integrity is the
 * product: an emitted evidence record — its hash, verdict, executor, timestamp — must never be
 * silently overwritten or deleted after the fact. Records here may be inserted (a new id) but not
 * put-over-an-existing-id, updated, or deleted. Callers can extend via CesRepositoryOptions.
 */
export const DEFAULT_WORM_COLLECTIONS = ['adminops_evidence', 'eo_approver_token_mints'] as const;

interface RawRow {
  collection: string;
  id: string;
  customer_id: number | null;
  si_baseline_id: number | null;
  tenant_slug: string | null;
  tenant_id: string | null;
  ces_id: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface CesRepositoryOptions {
  /** Injectable clock for deterministic tests. Defaults to ISO-8601 now. */
  now?: () => string;
  /** Append-only collection names. Defaults to DEFAULT_WORM_COLLECTIONS (evidence). */
  wormCollections?: readonly string[];
}

export class CesRepository {
  private db: Database.Database;
  private now: () => string;
  private worm: Set<string>;

  /**
   * @param dbPath path to the SQLite file, ':memory:' for tests, or omitted for the default
   *   {CES_PIPELINE_ROOT}/ces.db.
   */
  constructor(dbPath?: string, opts: CesRepositoryOptions = {}) {
    const target = dbPath ?? getCesDbPath();
    if (target !== ':memory:') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    }
    this.db = new Database(target);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.now = opts.now ?? (() => new Date().toISOString());
    this.worm = new Set(opts.wormCollections ?? DEFAULT_WORM_COLLECTIONS);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ces_records (
        collection      TEXT NOT NULL,
        id              TEXT NOT NULL,
        customer_id     INTEGER,
        si_baseline_id  INTEGER,
        tenant_slug     TEXT,
        tenant_id       TEXT,
        ces_id          TEXT,
        data            TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_ces_records_tuple
        ON ces_records (collection, customer_id, si_baseline_id);
      CREATE INDEX IF NOT EXISTS idx_ces_records_tenant
        ON ces_records (collection, tenant_slug);
      CREATE INDEX IF NOT EXISTS idx_ces_records_tenant_id
        ON ces_records (collection, tenant_id);
    `);
  }

  /** Build the WHERE fragment + params that enforce a scope. Throws on an empty scope. */
  private scopeClause(scope: CesScope): { sql: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (scope.customerId !== undefined) {
      conds.push('customer_id = ?');
      params.push(scope.customerId);
    }
    if (scope.siBaselineId !== undefined) {
      conds.push('si_baseline_id = ?');
      params.push(scope.siBaselineId);
    }
    if (scope.tenantSlug !== undefined) {
      conds.push('tenant_slug = ?');
      params.push(scope.tenantSlug);
    }
    if (scope.tenantId !== undefined) {
      conds.push('tenant_id = ?');
      params.push(scope.tenantId);
    }
    if (conds.length === 0) {
      throw new CesScopeError('a read/update/delete must name at least one scope field');
    }
    return { sql: conds.join(' AND '), params };
  }

  private hydrate<T>(row: RawRow): CesRecord<T> {
    return {
      collection: row.collection,
      id: row.id,
      customerId: row.customer_id ?? undefined,
      siBaselineId: row.si_baseline_id ?? undefined,
      tenantSlug: row.tenant_slug ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      cesId: row.ces_id ?? undefined,
      data: JSON.parse(row.data) as T,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Insert or replace a record (keyed by collection+id). Preserves created_at on update. */
  put<T = unknown>(collection: string, input: CesRecordInput): CesRecord<T> {
    const ts = this.now();
    const existing = this.db
      .prepare('SELECT created_at FROM ces_records WHERE collection = ? AND id = ?')
      .get(collection, input.id) as { created_at: string } | undefined;
    // WORM: a new id may be written once; overwriting an existing record is refused.
    if (existing && this.worm.has(collection)) {
      throw new CesWormError(
        `collection "${collection}" is append-only; record "${input.id}" already exists and cannot be overwritten`,
      );
    }
    const createdAt = existing?.created_at ?? ts;

    this.db
      .prepare(
        `INSERT INTO ces_records
          (collection, id, customer_id, si_baseline_id, tenant_slug, tenant_id, ces_id, data, created_at, updated_at)
         VALUES (@collection, @id, @customer_id, @si_baseline_id, @tenant_slug, @tenant_id, @ces_id, @data, @created_at, @updated_at)
         ON CONFLICT(collection, id) DO UPDATE SET
           customer_id=excluded.customer_id, si_baseline_id=excluded.si_baseline_id,
           tenant_slug=excluded.tenant_slug, tenant_id=excluded.tenant_id, ces_id=excluded.ces_id,
           data=excluded.data, updated_at=excluded.updated_at`,
      )
      .run({
        collection,
        id: input.id,
        customer_id: input.ces.customerId ?? null,
        si_baseline_id: input.ces.siBaselineId ?? null,
        tenant_slug: input.ces.tenantSlug ?? null,
        tenant_id: input.ces.tenantId ?? null,
        ces_id: input.ces.cesId ?? null,
        data: JSON.stringify(input.data),
        created_at: createdAt,
        updated_at: ts,
      });

    return {
      collection,
      id: input.id,
      customerId: input.ces.customerId,
      siBaselineId: input.ces.siBaselineId,
      tenantSlug: input.ces.tenantSlug,
      tenantId: input.ces.tenantId,
      cesId: input.ces.cesId,
      data: input.data as T,
      createdAt,
      updatedAt: ts,
    };
  }

  /** Read one record by id — only if it belongs to the named scope, else undefined (not-found). */
  get<T = unknown>(collection: string, id: string, scope: CesScope): CesRecord<T> | undefined {
    const { sql, params } = this.scopeClause(scope);
    const row = this.db
      .prepare(`SELECT * FROM ces_records WHERE collection = ? AND id = ? AND ${sql}`)
      .get(collection, id, ...params) as RawRow | undefined;
    return row ? this.hydrate<T>(row) : undefined;
  }

  /** List all records in a collection that belong to the named scope. */
  list<T = unknown>(collection: string, scope: CesScope): CesRecord<T>[] {
    const { sql, params } = this.scopeClause(scope);
    const rows = this.db
      .prepare(`SELECT * FROM ces_records WHERE collection = ? AND ${sql} ORDER BY created_at`)
      .all(collection, ...params) as RawRow[];
    return rows.map((r) => this.hydrate<T>(r));
  }

  /** Merge a partial into a record's data — only if the record belongs to the scope. */
  update<T = Record<string, unknown>>(
    collection: string,
    id: string,
    scope: CesScope,
    patch: Partial<T>,
  ): CesRecord<T> | undefined {
    if (this.worm.has(collection)) {
      throw new CesWormError(`collection "${collection}" is append-only and cannot be updated`);
    }
    const current = this.get<T>(collection, id, scope);
    if (!current) return undefined;
    const merged = { ...(current.data as Record<string, unknown>), ...(patch as Record<string, unknown>) };
    const ts = this.now();
    this.db
      .prepare('UPDATE ces_records SET data = ?, updated_at = ? WHERE collection = ? AND id = ?')
      .run(JSON.stringify(merged), ts, collection, id);
    return { ...current, data: merged as T, updatedAt: ts };
  }

  /**
   * Unscoped lookup by primary key. ONLY for collections whose id is a globally-unique,
   * unguessable capability (e.g. an approval UUID) where the id itself is the authorization, not
   * tenant data. Never use this for tenant-scoped domain records — use get() with a scope.
   */
  findById<T = unknown>(collection: string, id: string): CesRecord<T> | undefined {
    const row = this.db
      .prepare('SELECT * FROM ces_records WHERE collection = ? AND id = ?')
      .get(collection, id) as RawRow | undefined;
    return row ? this.hydrate<T>(row) : undefined;
  }

  /**
   * Unscoped list of a whole collection. ONLY for admin/global control collections (e.g. the
   * approvals queue). Never use this for tenant-scoped domain records — use list() with a scope.
   */
  listAll<T = unknown>(collection: string): CesRecord<T>[] {
    const rows = this.db
      .prepare('SELECT * FROM ces_records WHERE collection = ? ORDER BY created_at')
      .all(collection) as RawRow[];
    return rows.map((r) => this.hydrate<T>(r));
  }

  /** Delete a record — only if it belongs to the scope. Returns true if a row was removed. */
  delete(collection: string, id: string, scope: CesScope): boolean {
    if (this.worm.has(collection)) {
      throw new CesWormError(`collection "${collection}" is append-only and cannot be deleted from`);
    }
    const { sql, params } = this.scopeClause(scope);
    const info = this.db
      .prepare(`DELETE FROM ces_records WHERE collection = ? AND id = ? AND ${sql}`)
      .run(collection, id, ...params);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

// ─── Shared instance factory ─────────────────────────────────────
// One connection per DB file, memoized — avoids opening many SQLite handles to the same file
// across the stores that share it. Tests use closeCesRepository/closeAllCesRepositories before
// deleting a temp DB (Windows holds an open SQLite file locked).

const repositories = new Map<string, CesRepository>();

export function getCesRepository(dbPath?: string, opts?: CesRepositoryOptions): CesRepository {
  const key = dbPath ?? getCesDbPath();
  let repo = repositories.get(key);
  if (!repo) {
    repo = new CesRepository(key, opts);
    repositories.set(key, repo);
  }
  return repo;
}

export function closeCesRepository(dbPath?: string): void {
  const key = dbPath ?? getCesDbPath();
  const repo = repositories.get(key);
  if (repo) {
    repo.close();
    repositories.delete(key);
  }
}

export function closeAllCesRepositories(): void {
  for (const repo of repositories.values()) repo.close();
  repositories.clear();
}
