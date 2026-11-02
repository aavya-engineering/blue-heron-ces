// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC's own store. Records live in CesRepository (ces.db, SQLite — GD-a / DB-1), every row scoped
// by tenantSlug. Uploaded bytes stay as blob files under getEcTenantRoot(slug) — EC's module root —
// and nothing here ever writes anywhere else (in particular never into Stamper's tree).
//
// Collections (all rows carry { tenantSlug }):
//   ec_items           EcEvidenceItem metadata, id = itemId (item.sha256 references the blob). WRITE-ONCE
//   ec_runs            EcRun rows, id = runId
//   ec_findings        EcFinding rows + an internal dedupe key (stripped on output), id = findingId
//   ec_ledger_state    current EcLedgerEntry per origin:path (lastSeen refreshed per pass)
//   ec_ledger_history  EcLedgerEntry history: appended on first-seen or sha change only. WRITE-ONCE
//   ec_tenants         one row per tenant EC holds records for (control collection, listed unscoped)
//   ec_migrations      one marker row per tenant once its legacy files were imported
//
// Per-tenant files:
//   items/<itemId>.bin      uploaded bytes — the blob (never the client's filename — no traversal). WRITE-ONCE
//
// FIN-24 (CONTRACT CHANGE): ec_items rows, their blobs and ec_ledger_history rows are write-once. A
// second write to an existing item id is refused (EcWriteOnceError) before any byte is written, and
// CesRepository lists both collections as WORM. EC enforces it here too, so the rule holds whichever
// ces-shared build resolves. ec_ledger_state stays mutable (the current index, refreshed per pass).
//
// Legacy files (runs.jsonl, findings.json, ledger.jsonl, ledger-state.json, items/*.json) are
// imported once per tenant on first access (importLegacyFiles); they are left on disk untouched.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { canonicalSha256 } from 'ces-shared/crypto';
import { getCesDbPath, getCesRepository, type CesRepository } from 'ces-shared/persistence/node';
import { readJsonArtifact } from 'ces-shared/persistence/files';
import { getEcModuleRoot, getEcTenantRoot } from 'ces-shared/storage/node';
import {
  EcEvidenceItemSchema,
  EcFindingSchema,
  EcLedgerEntrySchema,
  EcRunSchema,
  type EcEvidenceItem,
  type EcFinding,
  type EcFindingSeverityType,
  type EcLedgerEntry,
  type EcLedgerOriginType,
  type EcRun,
} from 'ces-shared/types/evidence-collector';

export const ITEM_ID_RE = /^eci-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const EC_COLLECTIONS = {
  items: 'ec_items',
  runs: 'ec_runs',
  findings: 'ec_findings',
  ledgerState: 'ec_ledger_state',
  ledgerHistory: 'ec_ledger_history',
  tenants: 'ec_tenants',
  migrations: 'ec_migrations',
} as const;

export class BadTenantSlugError extends Error {}

/** FIN-24: an attempt to overwrite a write-once EC record (an item, its blob, or a ledger-history row). */
export class EcWriteOnceError extends Error {
  constructor(message: string) {
    super(`EC write-once: ${message}`);
    this.name = 'EcWriteOnceError';
  }
}

export const WRITE_ONCE_COLLECTIONS: readonly string[] = ['ec_items', 'ec_ledger_history'];

/** getEcTenantRoot throws on a bad slug (traversal guard); surface it as a typed 400 error. */
export function tenantRoot(slug: string): string {
  try {
    return getEcTenantRoot(slug);
  } catch (err) {
    throw new BadTenantSlugError((err as Error).message);
  }
}

// Byte-level SHA-256. ces-shared's crypto helper (canonicalSha256) hashes the canonical JSON of a
// value, not raw bytes, so it cannot replace this without changing every recorded digest.
export function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function newItemId(): string {
  return `eci-${crypto.randomUUID()}`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

// ─── Repository access + one-time legacy import ──────────────────

interface StoredFinding extends EcFinding {
  /** Internal dedupe key `${checkId}|${subject}` — stripped on output. */
  key: string;
  resolvedAt?: string;
}

type LedgerState = Record<string, EcLedgerEntry>;

interface LedgerStateRow {
  key: string;
  entry: EcLedgerEntry;
}

/** History row: `seq` keeps append order (created_at ties within one millisecond). */
interface LedgerHistoryRow {
  seq: number;
  entry: EcLedgerEntry;
}

const imported = new Set<string>();

/** The shared CesRepository, after this tenant's legacy files (if any) were imported once. */
function repoFor(slug: string): CesRepository {
  tenantRoot(slug);
  const repo = getCesRepository();
  const memo = `${getCesDbPath()}|${slug}`;
  if (!imported.has(memo)) {
    importLegacyFiles(slug, repo);
    imported.add(memo);
  }
  return repo;
}

function scope(slug: string): { tenantSlug: string } {
  return { tenantSlug: slug };
}

function putRow(repo: CesRepository, collection: string, slug: string, id: string, data: unknown): void {
  if (WRITE_ONCE_COLLECTIONS.includes(collection) && repo.findById(collection, id)) {
    throw new EcWriteOnceError(`${collection} row '${id}' already exists and cannot be overwritten`);
  }
  repo.put(collection, { id, ces: { tenantSlug: slug }, data });
}

function markTenant(repo: CesRepository, slug: string): void {
  if (!repo.get(EC_COLLECTIONS.tenants, slug, scope(slug))) {
    putRow(repo, EC_COLLECTIONS.tenants, slug, slug, { tenantSlug: slug });
  }
}

function ledgerStateId(slug: string, key: string): string {
  return `${slug}|${key}`;
}

function putHistory(repo: CesRepository, slug: string, seq: number, entry: EcLedgerEntry): void {
  const id = `${slug}|${canonicalSha256(entry)}`;
  // Write-once; the same entry recorded again (an interrupted legacy import's re-run) is left as it is.
  if (repo.findById(EC_COLLECTIONS.ledgerHistory, id)) return;
  const row: LedgerHistoryRow = { seq, entry };
  putRow(repo, EC_COLLECTIONS.ledgerHistory, slug, id, row);
}

/**
 * Import a tenant's pre-DB-1 files into CesRepository. Idempotent: a marker row in ec_migrations
 * stops re-runs, and every row is keyed by a stable id (itemId, runId, findingId, origin:path,
 * canonical hash of a history entry), so an interrupted import re-run rewrites the same rows.
 * Legacy files are only read, never modified or removed. Returns the number of rows imported.
 */
export function importLegacyFiles(slug: string, repo: CesRepository = getCesRepository()): number {
  const root = tenantRoot(slug);
  const markerId = `legacy-import|${slug}`;
  if (repo.get(EC_COLLECTIONS.migrations, markerId, scope(slug))) return 0;
  if (!fs.existsSync(root)) return 0;
  let rows = 0;

  const dir = path.join(root, 'items');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.json')) continue;
      const parsed = EcEvidenceItemSchema.safeParse(readJsonArtifact(path.join(dir, name)));
      if (!parsed.success || parsed.data.tenantSlug !== slug || !ITEM_ID_RE.test(parsed.data.itemId)) continue;
      // FIN-24: write-once; an item already in the DB (re-run of an interrupted import) is kept as it is.
      if (repo.findById(EC_COLLECTIONS.items, parsed.data.itemId)) continue;
      putRow(repo, EC_COLLECTIONS.items, slug, parsed.data.itemId, parsed.data);
      rows++;
    }
  }
  for (const r of readJsonl<EcRun>(path.join(root, 'runs.jsonl'))) {
    const run = EcRunSchema.parse(r);
    putRow(repo, EC_COLLECTIONS.runs, slug, run.runId, run);
    rows++;
  }
  for (const f of readJsonArtifact<StoredFinding[]>(path.join(root, 'findings.json')) ?? []) {
    putRow(repo, EC_COLLECTIONS.findings, slug, f.findingId, f);
    rows++;
  }
  const state = readJsonArtifact<LedgerState>(path.join(root, 'ledger-state.json')) ?? {};
  for (const [key, entry] of Object.entries(state)) {
    const row: LedgerStateRow = { key, entry: EcLedgerEntrySchema.parse(entry) };
    putRow(repo, EC_COLLECTIONS.ledgerState, slug, ledgerStateId(slug, key), row);
    rows++;
  }
  readJsonl<EcLedgerEntry>(path.join(root, 'ledger.jsonl')).forEach((h, seq) => {
    putHistory(repo, slug, seq, EcLedgerEntrySchema.parse(h));
    rows++;
  });

  if (rows > 0) markTenant(repo, slug);
  putRow(repo, EC_COLLECTIONS.migrations, slug, markerId, { importedRows: rows });
  return rows;
}

/** Tenant slugs EC holds data for: ec_tenants rows ∪ subdirectories of its module root that pass the slug guard. */
export function listStoredTenants(): string[] {
  const out = new Set<string>();
  for (const r of getCesRepository().listAll<{ tenantSlug: string }>(EC_COLLECTIONS.tenants)) {
    out.add(r.data.tenantSlug);
  }
  const root = getEcModuleRoot();
  if (fs.existsSync(root)) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try {
        tenantRoot(e.name);
        out.add(e.name);
      } catch {
        /* not a valid slug dir — ignore */
      }
    }
  }
  return [...out].sort();
}

// ─── Items ───────────────────────────────────────────────────────

export function itemsDir(slug: string): string {
  return path.join(tenantRoot(slug), 'items');
}

/** Write an item's bytes (blob) + metadata row and append its ledger row. Validates the item first. */
export function writeItem(item: EcEvidenceItem, content: Buffer, now: string): EcEvidenceItem {
  const valid = EcEvidenceItemSchema.parse(item);
  if (!ITEM_ID_RE.test(valid.itemId)) throw new Error(`invalid itemId '${valid.itemId}'`);
  if (sha256Hex(content) !== valid.sha256) throw new Error('item sha256 does not match content');
  const repo = repoFor(valid.tenantSlug);
  const dir = itemsDir(valid.tenantSlug);
  const binFile = path.join(dir, `${valid.itemId}.bin`);
  // FIN-24: write-once. Refused before any byte is written, so the original record and blob stay intact.
  if (repo.findById(EC_COLLECTIONS.items, valid.itemId) || fs.existsSync(binFile)) {
    throw new EcWriteOnceError(`item '${valid.itemId}' already exists and cannot be overwritten`);
  }
  ensureDir(dir);
  fs.writeFileSync(binFile, content, { flag: 'wx' });
  putRow(repo, EC_COLLECTIONS.items, valid.tenantSlug, valid.itemId, valid);
  markTenant(repo, valid.tenantSlug);
  recordLedger(valid.tenantSlug, 'ec', `items/${valid.itemId}.bin`, valid.sha256, now);
  return valid;
}

/** An item's metadata record (unvalidated row data), or undefined if no row exists for this tenant. */
export function getItemRecord(slug: string, itemId: string): unknown {
  if (!ITEM_ID_RE.test(itemId)) return undefined;
  return repoFor(slug).get(EC_COLLECTIONS.items, itemId, scope(slug))?.data;
}

/** Items whose blob is present (a row whose bytes were removed from disk is not listed). */
export function listItems(slug: string): EcEvidenceItem[] {
  const dir = itemsDir(slug);
  const items: EcEvidenceItem[] = [];
  for (const r of repoFor(slug).list(EC_COLLECTIONS.items, scope(slug))) {
    const parsed = EcEvidenceItemSchema.safeParse(r.data);
    if (parsed.success && fs.existsSync(path.join(dir, `${parsed.data.itemId}.bin`))) items.push(parsed.data);
  }
  return items.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

export function readItem(slug: string, itemId: string): { item: EcEvidenceItem; content: Buffer } | undefined {
  if (!ITEM_ID_RE.test(itemId)) return undefined;
  const row = repoFor(slug).get(EC_COLLECTIONS.items, itemId, scope(slug));
  const binFile = path.join(itemsDir(slug), `${itemId}.bin`);
  if (!row || !fs.existsSync(binFile)) return undefined;
  const item = EcEvidenceItemSchema.parse(row.data);
  return { item, content: fs.readFileSync(binFile) };
}

// ─── Runs ────────────────────────────────────────────────────────

export function appendRun(slug: string, run: EcRun): EcRun {
  const valid = EcRunSchema.parse(run);
  const repo = repoFor(slug);
  putRow(repo, EC_COLLECTIONS.runs, slug, valid.runId, valid);
  markTenant(repo, slug);
  return valid;
}

/** Runs, newest first. Rows carry `tenantSlug` alongside the contract fields. */
export function listRuns(slug: string): Array<EcRun & { tenantSlug: string }> {
  return repoFor(slug)
    .list<EcRun>(EC_COLLECTIONS.runs, scope(slug))
    .map((r) => ({ ...EcRunSchema.parse(r.data), tenantSlug: slug }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ─── Findings ────────────────────────────────────────────────────

function loadFindings(slug: string): StoredFinding[] {
  return repoFor(slug)
    .list<StoredFinding>(EC_COLLECTIONS.findings, scope(slug))
    .map((r) => r.data);
}

export interface FindingInput {
  checkId: string;
  subject: string;
  severity: EcFindingSeverityType;
  detail: string;
}

/**
 * Batch-apply one pass's findings: raise each input (deduped — an OPEN finding with the
 * same checkId+subject is kept, not re-emitted) and resolve open findings of the
 * `resolvableChecks` whose subject was not re-raised this time. Returns newly raised rows.
 */
export function applyFindings(
  slug: string,
  raised: FindingInput[],
  resolvableChecks: string[],
  now: string,
): EcFinding[] {
  const repo = repoFor(slug);
  const all = loadFindings(slug);
  const openByKey = new Map(all.filter((f) => f.status === 'open').map((f) => [f.key, f]));
  const raisedKeys = new Set<string>();
  const fresh: EcFinding[] = [];
  const dirty = new Set<StoredFinding>();

  for (const r of raised) {
    const key = `${r.checkId}|${r.subject}`;
    raisedKeys.add(key);
    if (openByKey.has(key)) continue;
    const row: StoredFinding = {
      findingId: `ecf-${crypto.randomUUID()}`,
      checkId: r.checkId,
      detectedAt: now,
      severity: r.severity,
      status: 'open',
      tenantSlug: slug,
      detail: r.detail,
      key,
    };
    EcFindingSchema.parse(row);
    all.push(row);
    openByKey.set(key, row);
    dirty.add(row);
    fresh.push(EcFindingSchema.parse(row));
  }

  for (const f of all) {
    if (f.status === 'open' && resolvableChecks.includes(f.checkId) && !raisedKeys.has(f.key)) {
      f.status = 'resolved';
      f.resolvedAt = now;
      dirty.add(f);
    }
  }

  for (const f of dirty) putRow(repo, EC_COLLECTIONS.findings, slug, f.findingId, f);
  if (dirty.size > 0) markTenant(repo, slug);
  return fresh;
}

/** Findings, newest first, contract-shaped (internal keys stripped). */
export function listFindings(slug: string): EcFinding[] {
  return loadFindings(slug)
    .map((f) => EcFindingSchema.parse(f))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

// ─── Ledger ──────────────────────────────────────────────────────

export function loadLedgerState(slug: string): LedgerState {
  const state: LedgerState = {};
  for (const r of repoFor(slug).list<LedgerStateRow>(EC_COLLECTIONS.ledgerState, scope(slug))) {
    state[r.data.key] = r.data.entry;
  }
  return state;
}

/** Persist `state`: upsert each entry that is new or whose stored value changed. */
export function saveLedgerState(slug: string, state: LedgerState): void {
  const repo = repoFor(slug);
  const stored = loadLedgerState(slug);
  let wrote = false;
  for (const [key, entry] of Object.entries(state)) {
    if (JSON.stringify(stored[key]) === JSON.stringify(entry)) continue;
    const row: LedgerStateRow = { key, entry };
    putRow(repo, EC_COLLECTIONS.ledgerState, slug, ledgerStateId(slug, key), row);
    wrote = true;
  }
  if (wrote) markTenant(repo, slug);
}

export function ledgerKey(origin: EcLedgerOriginType, relPath: string): string {
  return `${origin}:${relPath}`;
}

export interface LedgerUpdate {
  entry: EcLedgerEntry;
  previousSha?: string;
  isNew: boolean;
}

/**
 * Update one ledger entry in `state` (mutates) and append a history row when the entry is
 * new or its sha changed. Caller persists `state` via saveLedgerState.
 */
export function upsertLedger(
  slug: string,
  state: LedgerState,
  origin: EcLedgerOriginType,
  relPath: string,
  sha: string,
  now: string,
): LedgerUpdate {
  const key = ledgerKey(origin, relPath);
  const prev = state[key];
  const entry = EcLedgerEntrySchema.parse({
    tenantSlug: slug,
    path: relPath,
    sha256: sha,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    origin,
  });
  state[key] = entry;
  const changed = !prev || prev.sha256 !== sha;
  if (changed) {
    const repo = repoFor(slug);
    const seq = repo.list(EC_COLLECTIONS.ledgerHistory, scope(slug)).length;
    putHistory(repo, slug, seq, entry);
  }
  return { entry, previousSha: prev?.sha256, isNew: !prev };
}

/** Single-entry convenience used by ingest. */
export function recordLedger(
  slug: string,
  origin: EcLedgerOriginType,
  relPath: string,
  sha: string,
  now: string,
): LedgerUpdate {
  const state = loadLedgerState(slug);
  const u = upsertLedger(slug, state, origin, relPath, sha, now);
  saveLedgerState(slug, state);
  return u;
}

/** Ledger history in append order. */
export function readLedgerHistory(slug: string): EcLedgerEntry[] {
  return repoFor(slug)
    .list<LedgerHistoryRow>(EC_COLLECTIONS.ledgerHistory, scope(slug))
    .map((r) => r.data)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.entry);
}
