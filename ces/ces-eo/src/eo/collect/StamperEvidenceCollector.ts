// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure FLOW-4, collector C11 (`collect.stamperEvidence`). Stamper's evidence enters EO's
 * hash-chained store (W1 store, EvidenceStore.ts) before each assessment, and the assessment reads
 * the chained items instead of Stamper's files (assessment-router.ts Phase 1.5).
 *
 * One store record per new item (payload = the item), modelled on C10 (adminOpsCollector.ts):
 *  - `file`: one Stamper evidence file EO assesses from (`plan-data/<slug>/evidence/**.json`, the set
 *    StamperEvidenceLoader keeps), with the sha256 of its bytes, the parsed document and the loader's
 *    parsed item. Id `file:<relPath>@<sha256>`, so a rewritten file is a new record.
 *  - `row`: one `stamper_evidence_metadata` row of the tenant in `ces.db` (WORM since FLOW-2, ids
 *    `<plan>:<task>:<artifact>#<n>`), with the row's hash and the sha256 of the file it references
 *    now (null when absent); `latest` marks the highest attempt per artifact. Id `row:<rowId>`.
 *  - `index`: the read's file ids in loader order and its row ids. Id `index:<window end>`, so every
 *    collection run writes one; the assessment reads the index of its own run.
 * Every item's time is the read's window end (a file's own timestamp could predate the watermark).
 * No windowed view: the chained items feed the assessment directly (stamperEvidenceFromChain).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getCesDbPath, getCesRepository } from 'ces-shared/persistence/node';
import { getStamperTenantRoot } from 'ces-shared/storage/node';
import { StamperEvidenceLoader, gateContextOf, manualGateOf, type StamperEvidence } from '../evidence/StamperEvidenceLoader.js';
import type { EvidenceStore } from '../evidence/store/EvidenceStore.js';
import { isoTime, type Collector, type CollectorRead, type CollectorReader } from './Collector.js';
import { yieldToEventLoop, type CollectorRunResult } from './CollectorRunner.js';

/** Store source id of C11 records. */
export const STAMPER_EVIDENCE_SOURCE = 'collect.stamperEvidence';
/** Endpoint (and record endpoint prefix) of C11 records; not a registry endpoint. */
export const STAMPER_EVIDENCE_ENDPOINT = 'stamper_evidence';
/** The ces.db collection Stamper's EvidenceStore writes (FLOW-2: WORM). */
export const STAMPER_EVIDENCE_META_COLLECTION = 'stamper_evidence_metadata';

/** C11 makes no Graph or PowerShell read; a run passes this reader. */
export const NO_COLLECTOR_READER: CollectorReader = {
  fetchGraphCollection: () => Promise.reject(new Error('C11 reads no Graph collection')),
  searchUnifiedAuditLog: () => Promise.reject(new Error('C11 reads no audit log')),
};

export interface StamperEvidenceFileItem {
  kind: 'file';
  id: string;
  /** Path below `plan-data/<slug>/evidence`, forward slashes. */
  relPath: string;
  /** sha256 of the file's bytes. */
  fileSha256: string;
  observedAt: string;
  controlIds: string[];
  /** The file as parsed JSON. */
  document: unknown;
  /** StamperEvidenceLoader's item for the file (what the assessment uses). */
  evidence: StamperEvidence;
}

export interface StamperEvidenceRowItem {
  kind: 'row';
  id: string;
  rowId: string;
  /** `#<n>` of the row id; 0 for a legacy un-suffixed row. */
  attempt: number;
  /** The highest attempt of its `<plan>:<task>:<artifact>` (FLOW-2: the one that counts). */
  latest: boolean;
  /** The row's `sha256_hash`. */
  metaSha256: string;
  storageLocation: string;
  /** sha256 of the referenced file's bytes now; null when the file is absent. */
  fileSha256: string | null;
  observedAt: string;
  controlIds: string[];
  /** The row's data as Stamper wrote it. */
  row: unknown;
  /** FIN-14 (C11 tenant id): the tenant id the row carries in ces.db (Stamper's config TENANT_ID). */
  rowTenantId: string | null;
  /**
   * FIN-14: how the row was bound to this tenant: `tenantId` when its tenant id equals EO's, else
   * `tenantSlug` (its tenant slug is this tenant's) or `storagePath` (no slug; its file lies under
   * this tenant's Stamper folder).
   */
  scopedBy: 'tenantId' | 'tenantSlug' | 'storagePath';
  /** FIN-14: true when the row's tenant id equals EO's tenant id. */
  tenantIdMatches: boolean;
}

export interface StamperEvidenceIndexItem {
  kind: 'index';
  id: string;
  observedAt: string;
  /** The read's file item ids, in loader order. */
  fileIds: string[];
  rowIds: string[];
}

export type StamperEvidenceItem = StamperEvidenceFileItem | StamperEvidenceRowItem | StamperEvidenceIndexItem;

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const asItem = (it: unknown): Partial<StamperEvidenceItem> => (it ?? {}) as Partial<StamperEvidenceItem>;

function attemptOf(id: string): number {
  const m = /#(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** The file items, in loader order. */
export function readStamperEvidenceFiles(tenantSlug: string, observedAt: string): StamperEvidenceFileItem[] {
  const evidenceDir = path.join(getStamperTenantRoot(tenantSlug), 'evidence');
  const out: StamperEvidenceFileItem[] = [];
  for (const evidence of new StamperEvidenceLoader(tenantSlug).loadEvidenceForTenant()) {
    const file = evidence.evidenceFilePath as string;
    const bytes = fs.readFileSync(file);
    const fileSha256 = sha256Of(bytes);
    const relPath = path.relative(evidenceDir, file).replace(/\\/g, '/');
    out.push({
      kind: 'file', id: `file:${relPath}@${fileSha256}`, relPath, fileSha256, observedAt,
      controlIds: [...evidence.controlIds], document: JSON.parse(bytes.toString('utf-8')), evidence,
    });
  }
  return out;
}

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** FIN-14: true when `file` lies under `dir` (resolved; case-insensitive on Windows). */
export function isUnderDir(file: string, dir: string): boolean {
  if (!file || !dir) return false;
  const f = path.resolve(file);
  const d = path.resolve(dir);
  return f.length > d.length && samePath(f.slice(0, d.length), d) && (f[d.length] === path.sep || f[d.length] === '/');
}

/**
 * The tenant's `stamper_evidence_metadata` rows; [] when ces.db does not exist (it is never created here).
 * FIN-14 (FLOW-4 open item 2, C11 tenant id): Stamper scopes its rows by its own config TENANT_ID,
 * which need not equal EO's tenant id (the harness's Stamper writes the all-zero id). Rows under EO's
 * tenant id come first; with `tenantSlug`, a row under another tenant id is also this tenant's when
 * its tenant slug is `tenantSlug`, or, when it carries no slug, when its file lies under this
 * tenant's Stamper folder (`plan-data/<slug>`). A row of another slug is never taken. Each row item
 * records the id it carries and how it was bound.
 */
export function readStamperEvidenceRows(tenantId: string, observedAt: string, tenantSlug?: string): StamperEvidenceRowItem[] {
  const dbPath = getCesDbPath();
  if (!fs.existsSync(dbPath)) return [];
  const repo = getCesRepository(dbPath);
  const scoped = repo.list<Record<string, unknown>>(STAMPER_EVIDENCE_META_COLLECTION, { tenantId });
  const scopedBy = new Map<string, StamperEvidenceRowItem['scopedBy']>(scoped.map((r) => [r.id, 'tenantId']));
  // PH-11 (LOG-PH9-TS.md open item 1): the newest-run filter covers the rows under EO's tenant id too, which now
  // accumulate across Stamper runs in the long-lived ces.db; the newest run is chosen over both sets.
  const runOf = (id: string): string => id.slice(0, id.indexOf(':') > 0 ? id.indexOf(':') : id.length);
  const candidates: Array<{ r: (typeof scoped)[number]; by: StamperEvidenceRowItem['scopedBy'] }> = scoped.map((r) => ({ r, by: 'tenantId' }));
  if (tenantSlug) {
    const tenantRoot = getStamperTenantRoot(tenantSlug);
    // R-F2 (2026-10-31): an indexed read of this slug's rows plus the slug-less rows, never the whole
    // collection (28k rows across every tenant and round made each assess take minutes).
    for (const r of repo.list<Record<string, unknown>>(STAMPER_EVIDENCE_META_COLLECTION, { tenantSlug })) {
      if (!scopedBy.has(r.id)) candidates.push({ r, by: 'tenantSlug' });
    }
    for (const r of repo.listWithoutTenantSlug<Record<string, unknown>>(STAMPER_EVIDENCE_META_COLLECTION)) {
      if (!scopedBy.has(r.id) && isUnderDir(String((r.data ?? {}).storage_location ?? ''), tenantRoot)) candidates.push({ r, by: 'storagePath' });
    }
  }
  // Rows accumulate across Stamper runs (the id begins with the run's plan id). Only the newest run's rows are this
  // tenant's current evidence; older runs' rows are history.
  const newest = candidates.reduce<{ run: string; at: string } | null>(
    (acc, { r }) => (!acc || r.createdAt > acc.at ? { run: runOf(r.id), at: r.createdAt } : acc), null);
  const rows: Array<(typeof scoped)[number]> = [];
  for (const { r, by } of candidates) {
    if (newest && runOf(r.id) !== newest.run) continue;
    scopedBy.set(r.id, by);
    rows.push(r);
  }
  const top = new Map<string, number>();
  for (const r of rows) {
    const a = attemptOf(r.id);
    const base = a > 0 ? r.id.slice(0, r.id.lastIndexOf('#')) : r.id;
    top.set(base, Math.max(top.get(base) ?? -1, a));
  }
  // PH-12 (C11 event-loop block): many rows reference the same file (R-F8: 1092 rows, 155 files); hash each file once per read.
  const fileShas = new Map<string, string | null>();
  const fileShaOf = (loc: string): string | null => {
    if (!fileShas.has(loc)) fileShas.set(loc, fs.existsSync(loc) ? sha256Of(fs.readFileSync(loc)) : null);
    return fileShas.get(loc) ?? null;
  };
  return rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const attempt = attemptOf(r.id);
    const base = attempt > 0 ? r.id.slice(0, r.id.lastIndexOf('#')) : r.id;
    const storageLocation = String(data.storage_location ?? '');
    const fileSha256 = storageLocation ? fileShaOf(storageLocation) : null;
    return {
      kind: 'row', id: `row:${r.id}`, rowId: r.id, attempt, latest: top.get(base) === attempt,
      metaSha256: String(data.sha256_hash ?? ''), storageLocation, fileSha256, observedAt,
      controlIds: Array.isArray(data.control_ids) ? data.control_ids.map(String) : [], row: r.data,
      rowTenantId: r.tenantId ?? null, scopedBy: scopedBy.get(r.id) ?? 'tenantId', tenantIdMatches: r.tenantId === tenantId,
    };
  });
}

export const stamperEvidenceCollector: Collector = {
  planId: 'C11',
  sourceId: STAMPER_EVIDENCE_SOURCE,
  endpoint: STAMPER_EVIDENCE_ENDPOINT,
  signalSource: 'manual',
  host: 'stamper',
  permission: 'read access to Stamper\'s tenant evidence folder ({CES_PIPELINE_ROOT}\\Stamper\\plan-data\\<slug>\\evidence) and the shared DB (collection stamper_evidence_metadata)',
  cadenceMinutes: 15,
  initialLookbackMinutes: 0,
  overlapMinutes: 0,
  // Items already collected inside this period are not recorded again (de-duplicated by id).
  viewDays: 6 * 365,
  idOf: (it) => String(asItem(it).id ?? ''),
  timeOf: (it) => isoTime(asItem(it).observedAt),
  recordPerItem: {
    controlIdsOf: (it) => [...(asItem(it).kind === 'index' ? [] : ((asItem(it) as { controlIds?: string[] }).controlIds ?? []))],
    endpointOf: (it) => `${STAMPER_EVIDENCE_ENDPOINT}/${asItem(it).kind ?? 'unknown'}`,
    queryOf: (it) => `${STAMPER_EVIDENCE_ENDPOINT}/${asItem(it).id ?? ''}`,
  },
  noView: true,
  async read(_reader, window, scope): Promise<CollectorRead> {
    const query = `READ ${STAMPER_EVIDENCE_ENDPOINT} WHERE tenantSlug=${scope?.tenantSlug ?? '?'} AND tenantId=${scope?.tenantId ?? '?'}`;
    if (!scope) return { status: 'error', items: [], query, error: 'no tenant scope' };
    try {
      const files = readStamperEvidenceFiles(scope.tenantSlug, window.end);
      await yieldToEventLoop(); // PH-12: let pending I/O run between the file read and the ces.db read
      const rows = readStamperEvidenceRows(scope.tenantId, window.end, scope.tenantSlug);
      const index: StamperEvidenceIndexItem = {
        kind: 'index', id: `index:${window.end}`, observedAt: window.end, fileIds: files.map((f) => f.id), rowIds: rows.map((r) => r.rowId),
      };
      return { status: 'success', items: [...files, ...rows, index], query };
    } catch (e) {
      return { status: 'error', items: [], query, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** What the assessment reads back from the chain. */
export interface ChainedStamperEvidence {
  /** The loader items of the run's index, in its order (those found in the chain). */
  evidence: StamperEvidence[];
  indexRecordId: string | null;
  /** Index file ids with no record in the chain. */
  missing: string[];
  error?: string;
}

/**
 * The Stamper evidence of one C11 run, read from the store: the run's index record, then for each
 * of its file ids the payload of the record holding it (ids carry the file hash, so any record of an
 * id holds the same file). Payloads are hash-checked by readPayload.
 */
export function stamperEvidenceFromChain(store: EvidenceStore, run: CollectorRunResult | undefined): ChainedStamperEvidence {
  const runIds = new Set((run?.records ?? []).map((r) => r.recordId));
  const records = store.query({ sourceId: STAMPER_EVIDENCE_SOURCE }).filter((r) => r.status === 'success');
  const indexRec = records.filter((r) => runIds.has(r.recordId) && r.endpoint === `${STAMPER_EVIDENCE_ENDPOINT}/index`).pop();
  if (!indexRec) {
    return { evidence: [], indexRecordId: null, missing: [], error: run?.error ?? 'no C11 index record from this collection run' };
  }
  const index = store.readPayload(indexRec) as StamperEvidenceIndexItem;
  const wanted = new Set(index.fileIds.map((id) => `${STAMPER_EVIDENCE_ENDPOINT}/${id}`));
  const byId = new Map<string, StamperEvidenceFileItem>();
  for (const r of records) {
    if (r.endpoint !== `${STAMPER_EVIDENCE_ENDPOINT}/file` || !wanted.has(r.query)) continue;
    const item = store.readPayload(r) as StamperEvidenceFileItem;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const evidence: StamperEvidence[] = [];
  const missing: string[] = [];
  for (const id of index.fileIds) {
    const item = byId.get(id);
    if (!item) { missing.push(id); continue; }
    // FIN-10: a file chained before the loader parsed manual gates carries no `gate`; take it from
    // the chained document, so an old record and a fresh file read give the same item.
    const gate = item.evidence.gate ?? manualGateOf(item.document);
    // PH7-EO: the same for a record run inside a manual gate (metadata.gateContext).
    const gateContext = item.evidence.gateContext ?? gateContextOf(item.document);
    evidence.push(gate && !item.evidence.gate || gateContext && !item.evidence.gateContext
      ? { ...item.evidence, ...(gate ? { gate } : {}), ...(gateContext ? { gateContext } : {}) }
      : item.evidence);
  }
  return { evidence, indexRecordId: indexRec.recordId, missing };
}
