// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.1 (P1 #6, B11): the append-only evidence store, one per tenant, at
 * `<EoConfig.storageRoot>/evidence-store/<tenantId>/` (see types.ts for the layout).
 *
 * - Append only. There is no update or delete. A payload file is written once ('wx'); an existing
 *   one is reused only when its bytes still hash to its name. A record id already in the chain is
 *   refused. Before every append the store checks that records.jsonl still matches manifest.json
 *   (line count and head hash) and refuses to append when it does not: a rewritten log is refused.
 * - Hash chain. Each record carries `prevRecordSha256` and its own `recordSha256`
 *   (canonicalSha256 of the record without that field). `verify()` recomputes the whole chain and
 *   every payload hash and compares the head and count with the manifest.
 * - Tenant isolation. A store serves exactly one tenant id: an append for another tenant is
 *   refused, and reads return only records whose `tenantId` is the store's.
 * - All file I/O is synchronous, so one process never interleaves two appends.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonStringify, canonicalSha256 } from 'ces-shared/crypto';
import { EVIDENCE_STORE_DIRNAME, RETENTION_POLICY_ID, retainUntil } from './RetentionPolicy.js';
import { Watermarks } from './Watermarks.js';
import type {
  AppendInput, ChainVerification, EvidenceManifest, EvidenceRecord, EvidenceRef, StoreQuery,
} from './types.js';

export const RECORDS_FILE = 'records.jsonl';
export const MANIFEST_FILE = 'manifest.json';
export const PAYLOADS_DIR = 'payloads';
export const GENESIS_SHA256 = '0'.repeat(64);

const TENANT_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export class EvidenceStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceStoreIntegrityError';
  }
}

/** `<storageRoot>/evidence-store`. */
export function evidenceStoreRootOf(storageRoot: string): string {
  return path.join(storageRoot, EVIDENCE_STORE_DIRNAME);
}

/** recordSha256 of a record: canonical SHA-256 of every field but recordSha256. */
export function computeRecordSha256(record: Omit<EvidenceRecord, 'recordSha256'> | EvidenceRecord): string {
  const { recordSha256: _omit, ...rest } = record as EvidenceRecord;
  return canonicalSha256(rest);
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class EvidenceStore {
  readonly tenantId: string;
  readonly tenantDir: string;
  readonly watermarks: Watermarks;

  /** @param storeRoot `<storageRoot>/evidence-store` */
  constructor(storeRoot: string, tenantId: string) {
    if (!TENANT_DIR_RE.test(tenantId) || tenantId.includes('..')) {
      throw new Error(`EvidenceStore: invalid tenant id '${tenantId}'`);
    }
    this.tenantId = tenantId;
    this.tenantDir = path.join(storeRoot, tenantId);
    this.watermarks = new Watermarks(this.tenantDir);
  }

  /** The store for `tenantId` under an EO storage root (`EoConfig.storageRoot`). */
  static forStorageRoot(storageRoot: string, tenantId: string): EvidenceStore {
    return new EvidenceStore(evidenceStoreRootOf(storageRoot), tenantId);
  }

  private get recordsFile(): string { return path.join(this.tenantDir, RECORDS_FILE); }
  private get manifestFile(): string { return path.join(this.tenantDir, MANIFEST_FILE); }
  payloadPath(sha256: string): string { return path.join(this.tenantDir, PAYLOADS_DIR, `${sha256}.json`); }

  /** Every line of records.jsonl as written (no tenant filter, no verification). */
  private readRaw(): EvidenceRecord[] {
    if (!fs.existsSync(this.recordsFile)) return [];
    return fs.readFileSync(this.recordsFile, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as EvidenceRecord);
  }

  readManifest(): EvidenceManifest | null {
    if (!fs.existsSync(this.manifestFile)) return null;
    return JSON.parse(fs.readFileSync(this.manifestFile, 'utf-8')) as EvidenceManifest;
  }

  /** Write the payload once, by content hash. Returns the hash. */
  private putPayload(payload: unknown): string {
    const text = canonicalJsonStringify(payload === undefined ? null : payload);
    const sha = sha256Bytes(Buffer.from(text, 'utf-8'));
    const file = this.payloadPath(sha);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      if (sha256Bytes(fs.readFileSync(file)) !== sha) {
        throw new EvidenceStoreIntegrityError(`payload ${sha} on disk no longer matches its hash; refusing to rewrite it`);
      }
      return sha;
    }
    fs.writeFileSync(file, text, { encoding: 'utf-8', flag: 'wx' });
    return sha;
  }

  /** Refuse to append onto a log that no longer matches its manifest. */
  private assertAppendable(records: EvidenceRecord[]): void {
    const manifest = this.readManifest();
    if (!manifest) {
      if (records.length > 0) throw new EvidenceStoreIntegrityError('records.jsonl exists without manifest.json; refusing to append');
      return;
    }
    if (manifest.tenantId !== this.tenantId) {
      throw new EvidenceStoreIntegrityError(`manifest tenant ${manifest.tenantId} is not ${this.tenantId}`);
    }
    if (records.length !== manifest.recordCount) {
      throw new EvidenceStoreIntegrityError(`records.jsonl has ${records.length} records, manifest says ${manifest.recordCount}: log rewritten; refusing to append`);
    }
    const head = records.length ? records[records.length - 1] : null;
    const headSha = head ? computeRecordSha256(head) : GENESIS_SHA256;
    if (head && head.recordSha256 !== headSha) {
      throw new EvidenceStoreIntegrityError(`head record ${head.recordId} does not hash to its recordSha256: log rewritten; refusing to append`);
    }
    if (headSha !== manifest.headSha256) {
      throw new EvidenceStoreIntegrityError('head hash does not match manifest.json: log rewritten; refusing to append');
    }
  }

  /** Append one record (and its payload); returns the record as written. */
  append(input: AppendInput): EvidenceRecord {
    return this.appendMany([input])[0];
  }

  /**
   * PH-12 (C11 event-loop block, LOG-PH12-EO.md): append several records in one pass. The result is
   * the chain a loop of `append` calls in the same order writes (same seq, prevRecordSha256 and
   * recordSha256 for the same record ids; the same manifest chain), but records.jsonl and the
   * manifest are read once and written once, so n records cost O(n), not O(n^2). Still one
   * synchronous call: no other append can interleave with the batch. Every check runs before any
   * record is written (tenant, log matches manifest, ids new in the chain and in the batch,
   * watermarks forward), so a refused batch writes no record. A source may carry at most one
   * watermark per batch; it is saved after the records, with the record that carried it.
   */
  appendMany(inputs: readonly AppendInput[]): EvidenceRecord[] {
    if (inputs.length === 0) return [];
    for (const input of inputs) {
      if (input.tenantId !== this.tenantId) {
        throw new EvidenceStoreIntegrityError(`record for tenant ${input.tenantId} refused by the store of ${this.tenantId}`);
      }
    }
    fs.mkdirSync(this.tenantDir, { recursive: true });
    const records = this.readRaw();
    this.assertAppendable(records);

    const known = new Set(records.map((r) => r.recordId));
    const recordIds = inputs.map((input) => {
      const recordId = input.recordId ?? randomUUID();
      if (known.has(recordId)) {
        throw new EvidenceStoreIntegrityError(`record ${recordId} already exists; records are never rewritten`);
      }
      known.add(recordId);
      return recordId;
    });
    const marked = new Set<string>();
    for (const input of inputs) {
      if (!input.watermark) continue;
      if (marked.has(input.sourceId)) {
        throw new EvidenceStoreIntegrityError(`batch carries more than one watermark for ${input.sourceId}`);
      }
      marked.add(input.sourceId);
      this.watermarks.assertForward(input.sourceId, input.watermark);
    }

    let prev = records.length ? records[records.length - 1].recordSha256 : GENESIS_SHA256;
    const written: EvidenceRecord[] = inputs.map((input, i) => {
      const payloadSha256 = this.putPayload(input.payload);
      const body: Omit<EvidenceRecord, 'recordSha256'> = {
        schema: 'ces-eo/evidence-record@1',
        seq: records.length + i + 1,
        recordId: recordIds[i],
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        sourceId: input.sourceId,
        collector: input.collector,
        host: input.host,
        endpoint: input.endpoint,
        query: input.query,
        window: input.window,
        collectedAt: input.collectedAt,
        status: input.status,
        itemCount: input.itemCount,
        payloadSha256,
        controlIds: [...(input.controlIds ?? [])].sort(),
        objectiveIds: [...(input.objectiveIds ?? [])].sort(),
        retentionPolicy: RETENTION_POLICY_ID,
        retainUntil: retainUntil(input.collectedAt),
        ...(input.error !== undefined ? { error: input.error } : {}),
        prevRecordSha256: prev,
      };
      const record: EvidenceRecord = { ...body, recordSha256: computeRecordSha256(body) };
      prev = record.recordSha256;
      return record;
    });
    fs.appendFileSync(this.recordsFile, written.map((r) => JSON.stringify(r) + '\n').join(''), 'utf-8');

    const old = this.readManifest();
    const head = written[written.length - 1];
    const manifest: EvidenceManifest = {
      schema: 'ces-eo/evidence-manifest@1',
      tenantId: this.tenantId,
      tenantSlug: inputs[inputs.length - 1].tenantSlug,
      hashAlgorithm: 'sha256/canonical-json',
      recordCount: head.seq,
      headSha256: head.recordSha256,
      genesisSha256: GENESIS_SHA256,
      retentionPolicy: RETENTION_POLICY_ID,
      updatedAt: new Date().toISOString(),
      chain: [...(old?.chain ?? []), ...written.map((r) => ({
        seq: r.seq, recordId: r.recordId, recordSha256: r.recordSha256, payloadSha256: r.payloadSha256,
        sourceId: r.sourceId, collectedAt: r.collectedAt,
      }))],
    };
    const tmp = `${this.manifestFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, this.manifestFile);

    inputs.forEach((input, i) => {
      if (input.watermark) this.watermarks.advance(input.sourceId, input.watermark, recordIds[i]);
    });
    return written;
  }

  /** This tenant's records, in chain order (records naming another tenant are never returned). */
  records(): EvidenceRecord[] {
    return this.readRaw().filter((r) => r.tenantId === this.tenantId);
  }

  /** Read API: by source, by control or objective, by collection window (inclusive). */
  query(q: StoreQuery = {}): EvidenceRecord[] {
    const from = q.from !== undefined ? Date.parse(q.from) : null;
    const to = q.to !== undefined ? Date.parse(q.to) : null;
    return this.records().filter((r) => {
      if (q.sourceId !== undefined && r.sourceId !== q.sourceId) return false;
      if (q.controlId !== undefined && !r.controlIds.includes(q.controlId)) return false;
      if (q.objectiveId !== undefined && !r.objectiveIds.includes(q.objectiveId)) return false;
      const t = Date.parse(r.collectedAt);
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }

  /** A record by id, this tenant's only. */
  get(recordId: string): EvidenceRecord | undefined {
    return this.records().find((r) => r.recordId === recordId);
  }

  /** The payload of a record, after checking its bytes still hash to `payloadSha256`. */
  readPayload(record: Pick<EvidenceRecord, 'payloadSha256'>): unknown {
    if (!SHA_RE.test(record.payloadSha256)) throw new Error('invalid payload hash');
    const bytes = fs.readFileSync(this.payloadPath(record.payloadSha256));
    if (sha256Bytes(bytes) !== record.payloadSha256) {
      throw new EvidenceStoreIntegrityError(`payload ${record.payloadSha256} does not match its hash`);
    }
    return JSON.parse(bytes.toString('utf-8'));
  }

  /** Recompute the chain and every payload hash; compare head and count with manifest.json. */
  verify(): ChainVerification {
    const problems: string[] = [];
    let firstBreakSeq: number | undefined;
    const brk = (seq: number, msg: string) => {
      problems.push(msg);
      if (firstBreakSeq === undefined) firstBreakSeq = seq;
    };
    let raw: EvidenceRecord[] = [];
    try {
      raw = this.readRaw();
    } catch (e) {
      problems.push(`records.jsonl unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
    let prev = GENESIS_SHA256;
    raw.forEach((r, i) => {
      const seq = i + 1;
      if (r.tenantId !== this.tenantId) brk(seq, `record ${seq} names tenant ${r.tenantId}`);
      if (r.seq !== seq) brk(seq, `record ${seq} carries seq ${r.seq}`);
      if (r.prevRecordSha256 !== prev) brk(seq, `record ${seq} prevRecordSha256 does not match record ${seq - 1}`);
      const sha = computeRecordSha256(r);
      if (sha !== r.recordSha256) brk(seq, `record ${seq} (${r.recordId}) does not hash to its recordSha256`);
      const pfile = this.payloadPath(r.payloadSha256);
      if (!SHA_RE.test(r.payloadSha256) || !fs.existsSync(pfile)) brk(seq, `record ${seq} payload ${r.payloadSha256} missing`);
      else if (sha256Bytes(fs.readFileSync(pfile)) !== r.payloadSha256) brk(seq, `record ${seq} payload ${r.payloadSha256} does not match its hash`);
      prev = r.recordSha256;
    });
    const headSha256 = raw.length ? raw[raw.length - 1].recordSha256 : GENESIS_SHA256;
    const manifest = this.readManifest();
    const matches = manifest !== null
      && manifest.tenantId === this.tenantId
      && manifest.recordCount === raw.length
      && manifest.headSha256 === headSha256;
    if (manifest === null && raw.length > 0) problems.push('manifest.json missing');
    else if (manifest !== null && !matches) problems.push(`manifest (count ${manifest.recordCount}, head ${manifest.headSha256}) does not match the log (count ${raw.length}, head ${headSha256})`);
    return {
      ok: problems.length === 0,
      tenantId: this.tenantId,
      recordCount: raw.length,
      headSha256,
      manifest: {
        present: manifest !== null,
        recordCount: manifest?.recordCount ?? null,
        headSha256: manifest?.headSha256 ?? null,
        matches: manifest === null ? raw.length === 0 : matches,
      },
      ...(firstBreakSeq !== undefined ? { firstBreakSeq } : {}),
      problems,
    };
  }

  /**
   * W1.5 provenance: the store records behind an 800-171A objective (newest per source, any
   * status), as `evidenceRefs` for the ledger. Objectives are matched by id; a bare control id
   * matches the records mapped to that control.
   */
  evidenceRefsFor(objectiveOrControlId: string): EvidenceRef[] {
    return refsFromRecords(this.records(), objectiveOrControlId);
  }
}

function refsFromRecords(records: EvidenceRecord[], objectiveOrControlId: string): EvidenceRef[] {
  const isObjective = objectiveOrControlId.includes('[');
  const hits = records.filter((r) => (isObjective
    ? r.objectiveIds.includes(objectiveOrControlId)
    : r.controlIds.includes(objectiveOrControlId)));
  const newest = new Map<string, EvidenceRecord>();
  for (const r of hits) {
    const cur = newest.get(r.sourceId);
    if (!cur || Date.parse(r.collectedAt) >= Date.parse(cur.collectedAt)) newest.set(r.sourceId, r);
  }
  return [...newest.values()]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .map((r) => ({ recordId: r.recordId, tenantId: r.tenantId, sourceId: r.sourceId, sha256: r.payloadSha256, collectedAt: r.collectedAt, status: r.status, endpoint: r.endpoint }));
}

/**
 * W1.5 (owed one-liner for DeterminationLedger.ts): the evidence refs for one objective of one
 * tenant, read from `<storageRoot>/evidence-store/<tenantId>/`. Returns [] when the tenant has no
 * store or the tenant id is not a valid store id. Never throws.
 */
export function evidenceRefsForObjective(storageRoot: string, tenantId: string, objectiveId: string): EvidenceRef[] {
  return evidenceRefsLookup(storageRoot, tenantId)(objectiveId);
}

/** The same, reading the tenant's log once for many objectives. Never throws. */
export function evidenceRefsLookup(storageRoot: string, tenantId: string): (objectiveId: string) => EvidenceRef[] {
  let records: EvidenceRecord[];
  try {
    records = EvidenceStore.forStorageRoot(storageRoot, tenantId).records();
  } catch {
    return () => [];
  }
  return (objectiveId: string) => refsFromRecords(records, objectiveId);
}
