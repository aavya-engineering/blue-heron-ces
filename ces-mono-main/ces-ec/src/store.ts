// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC's own store. Everything lives under getEcTenantRoot(slug) — EC's module root —
// and nothing here ever writes anywhere else (in particular never into Stamper's tree).
//
// Per-tenant layout:
//   items/<itemId>.bin      uploaded bytes (never the client's filename — no traversal)
//   items/<itemId>.json     EcEvidenceItem metadata (strict contract schema)
//   runs.jsonl              EcRun rows, append-only
//   findings.json           EcFinding rows + an internal dedupe key (stripped on output)
//   ledger.jsonl            EcLedgerEntry history: appended on first-seen or sha change only
//   ledger-state.json       current EcLedgerEntry per origin:path (lastSeen refreshed per pass)

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

export class BadTenantSlugError extends Error {}

/** getEcTenantRoot throws on a bad slug (traversal guard); surface it as a typed 400 error. */
export function tenantRoot(slug: string): string {
  try {
    return getEcTenantRoot(slug);
  } catch (err) {
    throw new BadTenantSlugError((err as Error).message);
  }
}

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

function appendJsonl(file: string, row: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf-8');
}

function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/** Tenant slugs EC holds data for (subdirectories of its module root that pass the slug guard). */
export function listStoredTenants(): string[] {
  const root = getEcModuleRoot();
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      tenantRoot(e.name);
      out.push(e.name);
    } catch {
      /* not a valid slug dir — ignore */
    }
  }
  return out.sort();
}

// ─── Items ───────────────────────────────────────────────────────

export function itemsDir(slug: string): string {
  return path.join(tenantRoot(slug), 'items');
}

/** Write an item's bytes + metadata and append its ledger row. Validates the item first. */
export function writeItem(item: EcEvidenceItem, content: Buffer, now: string): EcEvidenceItem {
  const valid = EcEvidenceItemSchema.parse(item);
  if (!ITEM_ID_RE.test(valid.itemId)) throw new Error(`invalid itemId '${valid.itemId}'`);
  if (sha256Hex(content) !== valid.sha256) throw new Error('item sha256 does not match content');
  const dir = itemsDir(valid.tenantSlug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${valid.itemId}.bin`), content);
  writeJsonAtomic(path.join(dir, `${valid.itemId}.json`), valid);
  recordLedger(valid.tenantSlug, 'ec', `items/${valid.itemId}.bin`, valid.sha256, now);
  return valid;
}

export function listItems(slug: string): EcEvidenceItem[] {
  const dir = itemsDir(slug);
  if (!fs.existsSync(dir)) return [];
  const items: EcEvidenceItem[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const parsed = EcEvidenceItemSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')));
    if (parsed.success) items.push(parsed.data);
  }
  return items.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}

export function readItem(slug: string, itemId: string): { item: EcEvidenceItem; content: Buffer } | undefined {
  if (!ITEM_ID_RE.test(itemId)) return undefined;
  const dir = itemsDir(slug);
  const metaFile = path.join(dir, `${itemId}.json`);
  const binFile = path.join(dir, `${itemId}.bin`);
  if (!fs.existsSync(metaFile) || !fs.existsSync(binFile)) return undefined;
  const item = EcEvidenceItemSchema.parse(JSON.parse(fs.readFileSync(metaFile, 'utf-8')));
  return { item, content: fs.readFileSync(binFile) };
}

// ─── Runs ────────────────────────────────────────────────────────

export function appendRun(slug: string, run: EcRun): EcRun {
  const valid = EcRunSchema.parse(run);
  appendJsonl(path.join(tenantRoot(slug), 'runs.jsonl'), valid);
  return valid;
}

/** Runs, newest first. Rows carry `tenantSlug` alongside the contract fields. */
export function listRuns(slug: string): Array<EcRun & { tenantSlug: string }> {
  return readJsonl<EcRun>(path.join(tenantRoot(slug), 'runs.jsonl'))
    .map((r) => ({ ...EcRunSchema.parse(r), tenantSlug: slug }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ─── Findings ────────────────────────────────────────────────────

interface StoredFinding extends EcFinding {
  /** Internal dedupe key `${checkId}|${subject}` — stripped on output. */
  key: string;
  resolvedAt?: string;
}

function findingsFile(slug: string): string {
  return path.join(tenantRoot(slug), 'findings.json');
}

function loadFindings(slug: string): StoredFinding[] {
  const file = findingsFile(slug);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as StoredFinding[];
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
  const all = loadFindings(slug);
  const openByKey = new Map(all.filter((f) => f.status === 'open').map((f) => [f.key, f]));
  const raisedKeys = new Set<string>();
  const fresh: EcFinding[] = [];

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
    fresh.push(EcFindingSchema.parse(row));
  }

  for (const f of all) {
    if (f.status === 'open' && resolvableChecks.includes(f.checkId) && !raisedKeys.has(f.key)) {
      f.status = 'resolved';
      f.resolvedAt = now;
    }
  }

  if (fresh.length > 0 || all.length > 0) writeJsonAtomic(findingsFile(slug), all);
  return fresh;
}

/** Findings, newest first, contract-shaped (internal keys stripped). */
export function listFindings(slug: string): EcFinding[] {
  return loadFindings(slug)
    .map((f) => EcFindingSchema.parse(f))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

// ─── Ledger ──────────────────────────────────────────────────────

type LedgerState = Record<string, EcLedgerEntry>;

function ledgerStateFile(slug: string): string {
  return path.join(tenantRoot(slug), 'ledger-state.json');
}

export function ledgerHistoryFile(slug: string): string {
  return path.join(tenantRoot(slug), 'ledger.jsonl');
}

export function loadLedgerState(slug: string): LedgerState {
  const file = ledgerStateFile(slug);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as LedgerState;
}

export function saveLedgerState(slug: string, state: LedgerState): void {
  writeJsonAtomic(ledgerStateFile(slug), state);
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
  if (changed) appendJsonl(ledgerHistoryFile(slug), entry);
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

export function readLedgerHistory(slug: string): EcLedgerEntry[] {
  return readJsonl<EcLedgerEntry>(ledgerHistoryFile(slug));
}
