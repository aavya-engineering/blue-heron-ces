import type { CesIdentity } from '../config/cesConfig.contract.js';
/** Default on-disk DB location: {CES_PIPELINE_ROOT}/ces.db */
export declare function getCesDbPath(): string;
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
export declare class CesScopeError extends Error {
    constructor(message: string);
}
/** Thrown when a mutation/deletion is attempted against a WORM (append-only) collection. */
export declare class CesWormError extends Error {
    constructor(message: string);
}
/**
 * Collections that are append-only (write-once-read-many) by default. Evidence integrity is the
 * product: an emitted evidence record — its hash, verdict, executor, timestamp — must never be
 * silently overwritten or deleted after the fact. Records here may be inserted (a new id) but not
 * put-over-an-existing-id, updated, or deleted. Callers can extend via CesRepositoryOptions.
 */
export declare const DEFAULT_WORM_COLLECTIONS: readonly ["adminops_evidence", "eo_approver_token_mints"];
export interface CesRepositoryOptions {
    /** Injectable clock for deterministic tests. Defaults to ISO-8601 now. */
    now?: () => string;
    /** Append-only collection names. Defaults to DEFAULT_WORM_COLLECTIONS (evidence). */
    wormCollections?: readonly string[];
}
export declare class CesRepository {
    private db;
    private now;
    private worm;
    /**
     * @param dbPath path to the SQLite file, ':memory:' for tests, or omitted for the default
     *   {CES_PIPELINE_ROOT}/ces.db.
     */
    constructor(dbPath?: string, opts?: CesRepositoryOptions);
    private migrate;
    /** Build the WHERE fragment + params that enforce a scope. Throws on an empty scope. */
    private scopeClause;
    private hydrate;
    /** Insert or replace a record (keyed by collection+id). Preserves created_at on update. */
    put<T = unknown>(collection: string, input: CesRecordInput): CesRecord<T>;
    /** Read one record by id — only if it belongs to the named scope, else undefined (not-found). */
    get<T = unknown>(collection: string, id: string, scope: CesScope): CesRecord<T> | undefined;
    /** List all records in a collection that belong to the named scope. */
    list<T = unknown>(collection: string, scope: CesScope): CesRecord<T>[];
    /** Merge a partial into a record's data — only if the record belongs to the scope. */
    update<T = Record<string, unknown>>(collection: string, id: string, scope: CesScope, patch: Partial<T>): CesRecord<T> | undefined;
    /**
     * Unscoped lookup by primary key. ONLY for collections whose id is a globally-unique,
     * unguessable capability (e.g. an approval UUID) where the id itself is the authorization, not
     * tenant data. Never use this for tenant-scoped domain records — use get() with a scope.
     */
    findById<T = unknown>(collection: string, id: string): CesRecord<T> | undefined;
    /**
     * Unscoped list of a whole collection. ONLY for admin/global control collections (e.g. the
     * approvals queue). Never use this for tenant-scoped domain records — use list() with a scope.
     */
    listAll<T = unknown>(collection: string): CesRecord<T>[];
    /** Delete a record — only if it belongs to the scope. Returns true if a row was removed. */
    delete(collection: string, id: string, scope: CesScope): boolean;
    close(): void;
}
export declare function getCesRepository(dbPath?: string, opts?: CesRepositoryOptions): CesRepository;
export declare function closeCesRepository(dbPath?: string): void;
export declare function closeAllCesRepositories(): void;
//# sourceMappingURL=CesRepository.d.ts.map