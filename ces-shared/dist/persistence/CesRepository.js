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
import { getCesPipelineRoot } from '../storage/node.js';
/** Default on-disk DB location: {CES_PIPELINE_ROOT}/ces.db */
export function getCesDbPath() {
    return path.join(getCesPipelineRoot(), 'ces.db');
}
export class CesScopeError extends Error {
    constructor(message) {
        super(`CES scope: ${message}`);
        this.name = 'CesScopeError';
    }
}
/** Thrown when a mutation/deletion is attempted against a WORM (append-only) collection. */
export class CesWormError extends Error {
    constructor(message) {
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
export const DEFAULT_WORM_COLLECTIONS = ['adminops_evidence', 'eo_approver_token_mints'];
export class CesRepository {
    db;
    now;
    worm;
    /**
     * @param dbPath path to the SQLite file, ':memory:' for tests, or omitted for the default
     *   {CES_PIPELINE_ROOT}/ces.db.
     */
    constructor(dbPath, opts = {}) {
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
    migrate() {
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
    scopeClause(scope) {
        const conds = [];
        const params = [];
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
    hydrate(row) {
        return {
            collection: row.collection,
            id: row.id,
            customerId: row.customer_id ?? undefined,
            siBaselineId: row.si_baseline_id ?? undefined,
            tenantSlug: row.tenant_slug ?? undefined,
            tenantId: row.tenant_id ?? undefined,
            cesId: row.ces_id ?? undefined,
            data: JSON.parse(row.data),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    /** Insert or replace a record (keyed by collection+id). Preserves created_at on update. */
    put(collection, input) {
        const ts = this.now();
        const existing = this.db
            .prepare('SELECT created_at FROM ces_records WHERE collection = ? AND id = ?')
            .get(collection, input.id);
        // WORM: a new id may be written once; overwriting an existing record is refused.
        if (existing && this.worm.has(collection)) {
            throw new CesWormError(`collection "${collection}" is append-only; record "${input.id}" already exists and cannot be overwritten`);
        }
        const createdAt = existing?.created_at ?? ts;
        this.db
            .prepare(`INSERT INTO ces_records
          (collection, id, customer_id, si_baseline_id, tenant_slug, tenant_id, ces_id, data, created_at, updated_at)
         VALUES (@collection, @id, @customer_id, @si_baseline_id, @tenant_slug, @tenant_id, @ces_id, @data, @created_at, @updated_at)
         ON CONFLICT(collection, id) DO UPDATE SET
           customer_id=excluded.customer_id, si_baseline_id=excluded.si_baseline_id,
           tenant_slug=excluded.tenant_slug, tenant_id=excluded.tenant_id, ces_id=excluded.ces_id,
           data=excluded.data, updated_at=excluded.updated_at`)
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
            data: input.data,
            createdAt,
            updatedAt: ts,
        };
    }
    /** Read one record by id — only if it belongs to the named scope, else undefined (not-found). */
    get(collection, id, scope) {
        const { sql, params } = this.scopeClause(scope);
        const row = this.db
            .prepare(`SELECT * FROM ces_records WHERE collection = ? AND id = ? AND ${sql}`)
            .get(collection, id, ...params);
        return row ? this.hydrate(row) : undefined;
    }
    /** List all records in a collection that belong to the named scope. */
    list(collection, scope) {
        const { sql, params } = this.scopeClause(scope);
        const rows = this.db
            .prepare(`SELECT * FROM ces_records WHERE collection = ? AND ${sql} ORDER BY created_at`)
            .all(collection, ...params);
        return rows.map((r) => this.hydrate(r));
    }
    /** Merge a partial into a record's data — only if the record belongs to the scope. */
    update(collection, id, scope, patch) {
        if (this.worm.has(collection)) {
            throw new CesWormError(`collection "${collection}" is append-only and cannot be updated`);
        }
        const current = this.get(collection, id, scope);
        if (!current)
            return undefined;
        const merged = { ...current.data, ...patch };
        const ts = this.now();
        this.db
            .prepare('UPDATE ces_records SET data = ?, updated_at = ? WHERE collection = ? AND id = ?')
            .run(JSON.stringify(merged), ts, collection, id);
        return { ...current, data: merged, updatedAt: ts };
    }
    /**
     * Unscoped lookup by primary key. ONLY for collections whose id is a globally-unique,
     * unguessable capability (e.g. an approval UUID) where the id itself is the authorization, not
     * tenant data. Never use this for tenant-scoped domain records — use get() with a scope.
     */
    findById(collection, id) {
        const row = this.db
            .prepare('SELECT * FROM ces_records WHERE collection = ? AND id = ?')
            .get(collection, id);
        return row ? this.hydrate(row) : undefined;
    }
    /**
     * Unscoped list of a whole collection. ONLY for admin/global control collections (e.g. the
     * approvals queue). Never use this for tenant-scoped domain records — use list() with a scope.
     */
    listAll(collection) {
        const rows = this.db
            .prepare('SELECT * FROM ces_records WHERE collection = ? ORDER BY created_at')
            .all(collection);
        return rows.map((r) => this.hydrate(r));
    }
    /** Delete a record — only if it belongs to the scope. Returns true if a row was removed. */
    delete(collection, id, scope) {
        if (this.worm.has(collection)) {
            throw new CesWormError(`collection "${collection}" is append-only and cannot be deleted from`);
        }
        const { sql, params } = this.scopeClause(scope);
        const info = this.db
            .prepare(`DELETE FROM ces_records WHERE collection = ? AND id = ? AND ${sql}`)
            .run(collection, id, ...params);
        return info.changes > 0;
    }
    close() {
        this.db.close();
    }
}
// ─── Shared instance factory ─────────────────────────────────────
// One connection per DB file, memoized — avoids opening many SQLite handles to the same file
// across the stores that share it. Tests use closeCesRepository/closeAllCesRepositories before
// deleting a temp DB (Windows holds an open SQLite file locked).
const repositories = new Map();
export function getCesRepository(dbPath, opts) {
    const key = dbPath ?? getCesDbPath();
    let repo = repositories.get(key);
    if (!repo) {
        repo = new CesRepository(key, opts);
        repositories.set(key, repo);
    }
    return repo;
}
export function closeCesRepository(dbPath) {
    const key = dbPath ?? getCesDbPath();
    const repo = repositories.get(key);
    if (repo) {
        repo.close();
        repositories.delete(key);
    }
}
export function closeAllCesRepositories() {
    for (const repo of repositories.values())
        repo.close();
    repositories.clear();
}
//# sourceMappingURL=CesRepository.js.map