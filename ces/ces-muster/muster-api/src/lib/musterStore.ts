// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// musterStore.ts — FIN-25 (DB-3, GD-a): Muster's engagement layer on ces.db.
//
// The 13 models that lived in Postgres through Prisma (prisma/schema.prisma, now
// removed) are CesRepository collections in the ONE CES database
// ({CES_PIPELINE_ROOT}/ces.db, ces-shared CesRepository). The store keeps the
// small Prisma-shaped surface the services already call (create / findUnique /
// findFirst / findMany / update / updateMany / upsert / delete / count, equality
// `where`, single-field `orderBy`), so no service logic changed.
//
// REQUIRED TENANT SCOPE (replaces Postgres row-level security):
//   * store.forTenant(tenantId) returns a view where every row is written with
//     ces.tenantId = tenantId and every read/update/delete is scoped to it
//     (CesRepository rejects an unscoped read). A row of another tenant is
//     simply not found. withTenant() in lib/db.ts hands routes this view.
//   * The root store (no tenant) refuses tenant data, except three documented
//     pre-tenant lookups, each through a unique-key index whose id is the key:
//       - tenant.*            the tenant list itself (global control collection;
//                             the scheduler reads it to serve every tenant);
//       - user by email       login, before a tenant is known (@unique email);
//       - deliveryGrant by token_hash  the portal capability token (@unique).
//     plus user.create / user.update for seeding an operator (scripts/seed.ts).
//   * create() refuses an id that already exists in ANY tenant, so one tenant
//     can never overwrite another tenant's row by guessing its id.
//
// Append-only (WORM) collections: the delivery audit trail and the simulated
// mail outbox (FD-6) — added to the repository's WORM set when this store opens
// it, so a record can be written once and never changed or removed.

import { randomUUID } from 'node:crypto';
import {
  CesRepository,
  CesScopeError,
  DEFAULT_WORM_COLLECTIONS,
  getCesDbPath,
  type CesRecord,
} from 'ces-shared/persistence/node';

export { CesScopeError };

/** Muster's append-only collections (in addition to ces-shared's evidence set). */
export const MUSTER_WORM_COLLECTIONS = ['muster_delivery_audit', 'muster_mail_outbox'] as const;

interface ModelDef {
  collection: string;
  /** Field that carries the owning tenant id in the row (null = scope only). */
  tenantField: string | null;
  /** Fields hydrated back to Date. */
  dates: string[];
  /** Fields stored as base64 and hydrated back to Buffer. */
  bytes?: string[];
  /** Fields that are null when not given (Prisma optional columns). */
  nullable?: string[];
  /** Field defaults (Prisma @default). A function is evaluated per row. */
  defaults?: Record<string, unknown | (() => unknown)>;
  /** @unique fields other than id — each backed by an index collection. */
  unique?: string[];
}

const now = () => new Date();

/** The 13 Prisma models plus the FD-6 mail outbox. */
export const MODELS = {
  tenant: { collection: 'muster_tenants', tenantField: 'id', dates: ['created_at'], defaults: { created_at: now } },
  user: {
    collection: 'muster_users',
    tenantField: 'tenant_id',
    dates: ['created_at'],
    nullable: ['party_id'],
    defaults: { created_at: now },
    unique: ['email'],
  },
  engagement: {
    collection: 'muster_engagements',
    tenantField: 'tenant_id',
    dates: ['created_at', 'live_access_set_at'],
    nullable: ['live_access_set_by', 'live_access_set_at', 'live_consent', 'live_area_consents'],
    defaults: { created_at: now, live_access_enabled: false },
  },
  party: {
    collection: 'muster_parties',
    tenantField: 'tenant_id',
    dates: ['created_at', 'last_activity_at'],
    nullable: ['uei', 'cage', 'last_activity_at'],
    defaults: { created_at: now, lifecycle: 'invited' },
  },
  interviewSession: {
    collection: 'muster_interview_sessions',
    tenantField: null,
    dates: ['created_at', 'completed_at'],
    nullable: ['current_question_index', 'completed_at'],
    defaults: { created_at: now, selected_stacks: () => [] },
  },
  contract: {
    collection: 'muster_contracts',
    tenantField: null,
    dates: ['award_date', 'pop_start', 'pop_end', 'created_at'],
    nullable: ['cage_code', 'uei', 'contracting_office', 'co_name', 'award_date', 'pop_start', 'pop_end'],
    defaults: { created_at: now },
  },
  nudgeEvent: {
    collection: 'muster_nudge_events',
    tenantField: null,
    dates: ['sent_at'],
    nullable: ['payload'],
    defaults: { sent_at: now },
  },
  disposition: {
    collection: 'muster_dispositions',
    tenantField: null,
    dates: ['set_at'],
    nullable: ['notes'],
    defaults: { set_at: now },
  },
  hilItem: {
    collection: 'muster_hil_items',
    tenantField: 'tenant_id',
    dates: ['created_at', 'resolved_at'],
    nullable: ['session_id', 'resolved_at', 'resolved_by_user_id', 'advisor_minutes'],
    defaults: { created_at: now },
  },
  touchEvent: {
    collection: 'muster_touch_events',
    tenantField: 'tenant_id',
    dates: ['created_at'],
    defaults: { created_at: now, minutes: 0 },
  },
  deliveryArtifact: {
    collection: 'muster_delivery_artifacts',
    tenantField: 'tenant_id',
    dates: ['delivered_at', 'purged_at'],
    bytes: ['content'],
    nullable: ['purged_at', 'purge_reason'],
    defaults: { delivered_at: now },
  },
  deliveryGrant: {
    collection: 'muster_delivery_grants',
    tenantField: 'tenant_id',
    dates: ['expires_at', 'revoked_at', 'created_at'],
    nullable: ['revoked_at'],
    defaults: { created_at: now },
    unique: ['token_hash'],
  },
  deliveryAuditEntry: {
    collection: 'muster_delivery_audit',
    tenantField: 'tenant_id',
    dates: ['created_at'],
    nullable: ['artifact_id', 'grant_id', 'detail'],
    defaults: { created_at: now },
  },
  mailOutbox: {
    collection: 'muster_mail_outbox',
    tenantField: 'tenant_id',
    dates: ['created_at'],
    defaults: { created_at: now },
  },
} satisfies Record<string, ModelDef>;

export type ModelName = keyof typeof MODELS;
const MODEL_DEFS: Record<string, ModelDef> = MODELS;

/** The 13 engagement-layer models moved from Postgres (the outbox is new in FIN-25). */
export const ENGAGEMENT_MODELS = (Object.keys(MODELS) as ModelName[]).filter((m) => m !== 'mailOutbox');

const indexCollection = (def: ModelDef, field: string) => `${def.collection}_by_${field}`;

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

// ─── serialization ──────────────────────────────────────────────────────────

function encode(def: ModelDef, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (def.bytes?.includes(k) && v != null) {
      const buf = Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array);
      out[k] = { $bytes: buf.toString('base64') };
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function decode(def: ModelDef, data: Row): Row {
  const out: Row = { ...data };
  for (const f of def.dates) {
    const v = out[f];
    if (typeof v === 'string' || typeof v === 'number') out[f] = new Date(v);
  }
  for (const f of def.bytes ?? []) {
    const v = out[f] as { $bytes?: string } | null | undefined;
    if (v && typeof v === 'object' && typeof v.$bytes === 'string') out[f] = Buffer.from(v.$bytes, 'base64');
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (b === null) return a == null;
  if (b instanceof Date) return a instanceof Date ? a.getTime() === b.getTime() : new Date(String(a)).getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.getTime() === new Date(b).getTime();
  return a === b;
}

function matches(row: Row, where?: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => v === undefined || same(row[k], v));
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (!spec || typeof spec !== 'object') return rows;
  const [field, dir] = Object.entries(spec as Record<string, string>)[0] ?? [];
  if (!field) return rows;
  const key = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? -Infinity : (v as number | string));
  const sign = dir === 'desc' ? -1 : 1;
  // Stable: ties keep insertion order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = key(x.r[field]);
      const b = key(y.r[field]);
      if (a < b) return -sign;
      if (a > b) return sign;
      return x.i - y.i;
    })
    .map((x) => x.r);
}

export class MusterStoreError extends Error {
  constructor(message: string) {
    super(`muster store: ${message}`);
    this.name = 'MusterStoreError';
  }
}

// ─── tenant-scoped model ────────────────────────────────────────────────────

class ScopedModel {
  constructor(
    private readonly repo: CesRepository,
    private readonly def: ModelDef,
    private readonly tenantId: string,
  ) {}

  private get scope() {
    return { tenantId: this.tenantId };
  }

  private all(): Row[] {
    return this.repo.list<Row>(this.def.collection, this.scope).map((r: CesRecord<Row>) => decode(this.def, r.data));
  }

  private byUniqueIndex(field: string, value: unknown): Row | null {
    const idx = this.repo.findById<{ id: string; tenant_id: string }>(indexCollection(this.def, field), String(value));
    if (!idx || idx.data.tenant_id !== this.tenantId) return null;
    const rec = this.repo.get<Row>(this.def.collection, idx.data.id, this.scope);
    return rec ? decode(this.def, rec.data) : null;
  }

  private locate(where: Where): Row | null {
    if (typeof where.id === 'string') {
      const rec = this.repo.get<Row>(this.def.collection, where.id, this.scope);
      const row = rec ? decode(this.def, rec.data) : null;
      return row && matches(row, where) ? row : null;
    }
    for (const f of this.def.unique ?? []) {
      if (where[f] !== undefined) {
        const row = this.byUniqueIndex(f, where[f]);
        return row && matches(row, where) ? row : null;
      }
    }
    return this.all().find((r) => matches(r, where)) ?? null;
  }

  private write(row: Row): void {
    this.repo.put(this.def.collection, { id: String(row.id), ces: { tenantId: this.tenantId }, data: encode(this.def, row) });
  }

  private checkTenantField(data: Row): void {
    const f = this.def.tenantField;
    if (f && data[f] !== undefined && data[f] !== this.tenantId) {
      throw new CesScopeError(`${this.def.collection}: a row for tenant ${String(data[f])} cannot be written in tenant ${this.tenantId}`);
    }
  }

  private claimUnique(row: Row, previous?: Row): void {
    for (const f of this.def.unique ?? []) {
      const v = row[f];
      if (previous && same(previous[f], v)) continue;
      if (v == null) continue;
      const coll = indexCollection(this.def, f);
      if (this.repo.findById(coll, String(v))) {
        throw new MusterStoreError(`unique constraint failed on ${this.def.collection}.${f}`);
      }
    }
    for (const f of this.def.unique ?? []) {
      const v = row[f];
      if (previous && same(previous[f], v)) continue;
      if (previous && previous[f] != null) this.repo.delete(indexCollection(this.def, f), String(previous[f]), this.scope);
      if (v != null) {
        this.repo.put(indexCollection(this.def, f), {
          id: String(v),
          ces: { tenantId: this.tenantId },
          data: { id: row.id, tenant_id: this.tenantId },
        });
      }
    }
  }

  async create({ data }: { data: Row }): Promise<Row> {
    this.checkTenantField(data);
    const row: Row = {};
    for (const f of this.def.nullable ?? []) row[f] = null;
    for (const [k, v] of Object.entries(this.def.defaults ?? {})) row[k] = typeof v === 'function' ? (v as () => unknown)() : v;
    Object.assign(
      row,
      Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    );
    row.id = (data.id as string | undefined) ?? randomUUID();
    if (this.def.tenantField) row[this.def.tenantField] = this.tenantId;
    // An id is unique across ALL tenants: refuse instead of overwriting.
    if (this.repo.findById(this.def.collection, String(row.id))) {
      throw new MusterStoreError(`unique constraint failed on ${this.def.collection}.id`);
    }
    this.claimUnique(row);
    this.write(row);
    return decode(this.def, encode(this.def, row));
  }

  async findUnique({ where }: { where: Where }): Promise<Row | null> {
    return this.locate(where);
  }

  async findFirst(args: { where?: Where; orderBy?: unknown } = {}): Promise<Row | null> {
    return (await this.findMany(args))[0] ?? null;
  }

  async findMany(args: { where?: Where; orderBy?: unknown } = {}): Promise<Row[]> {
    const rows = this.all().filter((r) => matches(r, args.where));
    return args.orderBy ? sortRows(rows, args.orderBy) : rows;
  }

  async count(args: { where?: Where } = {}): Promise<number> {
    return (await this.findMany(args)).length;
  }

  async update({ where, data }: { where: Where; data: Row }): Promise<Row> {
    const current = this.locate(where);
    if (!current) throw new MusterStoreError(`record not found for update in ${this.def.collection}`);
    return this.apply(current, data);
  }

  private apply(current: Row, data: Row): Row {
    this.checkTenantField(data);
    if (data.id !== undefined && data.id !== current.id) throw new MusterStoreError('the id of a record cannot change');
    const next: Row = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
    this.claimUnique(next, current);
    this.write(next);
    return decode(this.def, encode(this.def, next));
  }

  async updateMany({ where, data }: { where?: Where; data: Row }): Promise<{ count: number }> {
    const rows = this.all().filter((r) => matches(r, where));
    for (const r of rows) this.apply(r, data);
    return { count: rows.length };
  }

  async upsert({ where, create, update }: { where: Where; create: Row; update: Row }): Promise<Row> {
    const current = this.locate(where);
    return current ? this.apply(current, update) : this.create({ data: create });
  }

  async delete({ where }: { where: Where }): Promise<Row> {
    const current = this.locate(where);
    if (!current) throw new MusterStoreError(`record not found for delete in ${this.def.collection}`);
    this.repo.delete(this.def.collection, String(current.id), this.scope);
    for (const f of this.def.unique ?? []) {
      if (current[f] != null) this.repo.delete(indexCollection(this.def, f), String(current[f]), this.scope);
    }
    return current;
  }

  async deleteMany({ where }: { where?: Where } = {}): Promise<{ count: number }> {
    const rows = this.all().filter((r) => matches(r, where));
    for (const r of rows) await this.delete({ where: { id: r.id } });
    return { count: rows.length };
  }
}

export type MusterModel = Pick<
  ScopedModel,
  'create' | 'findUnique' | 'findFirst' | 'findMany' | 'count' | 'update' | 'updateMany' | 'upsert' | 'delete' | 'deleteMany'
>;

/** A tenant-bound view: the `tx` that withTenant() hands to services. */
export type TenantView = { [K in ModelName]: MusterModel } & {
  readonly tenantId: string;
  $transaction<T>(fn: (tx: TenantView) => Promise<T>): Promise<T>;
};

// ─── the store ──────────────────────────────────────────────────────────────

export class MusterStore {
  readonly repo: CesRepository;
  private views = new Map<string, TenantView>();

  constructor(dbPath?: string) {
    this.repo = new CesRepository(dbPath ?? getCesDbPath(), {
      wormCollections: [...DEFAULT_WORM_COLLECTIONS, ...MUSTER_WORM_COLLECTIONS],
    });
    // Any other root model access is refused: a tenant scope is required.
    for (const name of Object.keys(MODELS)) {
      if (name === 'tenant' || name === 'user' || name === 'deliveryGrant') continue;
      Object.defineProperty(this, name, {
        enumerable: false,
        get: () => this.refuse(name, 'access'),
      });
    }
  }

  /** The tenant-scoped view. An empty tenant id is refused (no unscoped reads). */
  forTenant(tenantId: string): TenantView {
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new CesScopeError('muster store: a tenant id is required');
    }
    let view = this.views.get(tenantId);
    if (!view) {
      const v: Record<string, unknown> = { tenantId };
      for (const [name, def] of Object.entries(MODELS)) v[name] = new ScopedModel(this.repo, def, tenantId);
      v.$transaction = <T>(fn: (tx: TenantView) => Promise<T>) => fn(v as unknown as TenantView);
      view = v as unknown as TenantView;
      this.views.set(tenantId, view);
    }
    return view;
  }

  /** Ids of every tenant on record — the scheduler serves each of them. */
  tenantIds(): string[] {
    return this.repo.listAll<Row>(MODELS.tenant.collection).map((r) => String(r.data.id));
  }

  private resolveUnique(model: string, field: string, value: unknown): { id: string; tenant_id: string } | undefined {
    const def = MODEL_DEFS[model];
    return this.repo.findById<{ id: string; tenant_id: string }>(indexCollection(def, field), String(value))?.data;
  }

  private refuse(model: string, op: string): never {
    throw new CesScopeError(`muster store: ${model}.${op} needs a tenant scope; call it through withTenant()`);
  }

  // Root (pre-tenant) surface — see the header for why each one exists.

  readonly tenant = {
    create: async ({ data }: { data: Row }) => {
      const id = (data.id as string | undefined) ?? randomUUID();
      return this.forTenant(id).tenant.create({ data: { ...data, id } });
    },
    findUnique: async ({ where }: { where: Where }) =>
      typeof where.id === 'string' && this.repo.findById(MODELS.tenant.collection, where.id)
        ? this.forTenant(where.id).tenant.findUnique({ where })
        : null,
    findMany: async (args: { where?: Where; orderBy?: unknown } = {}) => {
      const rows = this.repo.listAll<Row>(MODELS.tenant.collection).map((r) => decode(MODELS.tenant, r.data)).filter((r) => matches(r, args.where));
      return args.orderBy ? sortRows(rows, args.orderBy) : rows;
    },
    findFirst: async (args: { where?: Where; orderBy?: unknown } = {}) => (await this.tenant.findMany(args))[0] ?? null,
    upsert: async ({ where, create, update }: { where: Where; create: Row; update: Row }) => {
      const found = await this.tenant.findUnique({ where });
      return found ? this.forTenant(String(found.id)).tenant.update({ where: { id: found.id }, data: update }) : this.tenant.create({ data: { ...create, id: where.id ?? create.id } });
    },
  };

  readonly user = {
    findUnique: async ({ where }: { where: Where }) => {
      if (where.email === undefined) this.refuse('user', 'findUnique by anything but email');
      const hit = this.resolveUnique('user', 'email', where.email);
      return hit ? this.forTenant(hit.tenant_id).user.findUnique({ where }) : null;
    },
    create: async ({ data }: { data: Row }) => {
      if (typeof data.tenant_id !== 'string') this.refuse('user', 'create without tenant_id');
      return this.forTenant(data.tenant_id as string).user.create({ data });
    },
    update: async ({ where, data }: { where: Where; data: Row }) => {
      if (where.email === undefined) this.refuse('user', 'update by anything but email');
      const hit = this.resolveUnique('user', 'email', where.email);
      if (!hit) throw new MusterStoreError('record not found for update in muster_users');
      return this.forTenant(hit.tenant_id).user.update({ where, data });
    },
  };

  readonly deliveryGrant = {
    findUnique: async ({ where }: { where: Where }) => {
      if (where.token_hash === undefined) this.refuse('deliveryGrant', 'findUnique by anything but token_hash');
      const hit = this.resolveUnique('deliveryGrant', 'token_hash', where.token_hash);
      return hit ? this.forTenant(hit.tenant_id).deliveryGrant.findUnique({ where }) : null;
    },
  };

  $transaction<T>(fn: (tx: MusterStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  close(): void {
    this.repo.close();
    this.views.clear();
  }
}

// ─── shared instance ────────────────────────────────────────────────────────
// One handle per ces.db file, opened on first use (never at import time, so a
// module import never creates a database).

const stores = new Map<string, MusterStore>();

export function getMusterStore(dbPath?: string): MusterStore {
  const key = dbPath ?? getCesDbPath();
  let s = stores.get(key);
  if (!s) {
    s = new MusterStore(key);
    stores.set(key, s);
  }
  return s;
}

export function closeMusterStores(): void {
  for (const s of stores.values()) s.close();
  stores.clear();
}
