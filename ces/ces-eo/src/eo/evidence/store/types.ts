// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.1 (B11): the shapes of EvidenceOps' append-only evidence store.
 *
 * Layout, per tenant, under `<EoConfig.storageRoot>/evidence-store/<tenantId>/`:
 *   records.jsonl          one EvidenceRecord per line, append only, hash-chained
 *   payloads/<sha256>.json the raw payload of a read, canonical JSON, written once ('wx')
 *   manifest.json          count, head hash and the chain (rewritten after every append)
 *   watermarks.json        per-source resume point, forward only
 */

export type EvidenceRecordStatus = 'success' | 'empty' | 'error' | 'not_assessed' | 'gap';

export interface CollectorInfo {
  /** The code that made the read, e.g. `ces-eo/ComplianceSignalFetcher`. */
  name: string;
  /** EO's package version. */
  version: string;
  /** `ces-eo/<version>@<ClientId>` (ClientId from Get-MgContext; `no-mgcontext` when unreadable). */
  identity: string;
}

/** The time span a read covers. `start` is null for a point-in-time (current-state) read. */
export interface TimeWindow {
  start: string | null;
  end: string;
}

export interface EvidenceRecord {
  schema: 'ces-eo/evidence-record@1';
  /** 1-based position in the tenant's chain. */
  seq: number;
  recordId: string;
  tenantId: string;
  tenantSlug: string;
  /** The read's signal id (one source = one read). */
  sourceId: string;
  collector: CollectorInfo;
  host: string;
  /** The registry endpoint the mapper matches. */
  endpoint: string;
  /** The request actually sent (URI with query string, or the cmdlet line). */
  query: string;
  window: TimeWindow;
  collectedAt: string;
  status: EvidenceRecordStatus;
  itemCount: number;
  /** SHA-256 (hex) of the canonical JSON of the raw payload; also the payload file's name. */
  payloadSha256: string;
  /** Controls the mapper matched this read to. */
  controlIds: string[];
  /** 800-171A objectives of those controls. */
  objectiveIds: string[];
  /** B12: retention policy id and the date the record may be disposed of (collectedAt + 6 years). */
  retentionPolicy: string;
  retainUntil: string;
  /** Error or permission text for `error` / `not_assessed` / `gap` reads. */
  error?: string;
  /** recordSha256 of the previous record; 64 zeros for the first. */
  prevRecordSha256: string;
  /** canonicalSha256 of this record without this field. */
  recordSha256: string;
}

/** What a caller supplies; the store fills seq, ids, hashes and retention. */
export interface AppendInput {
  tenantId: string;
  tenantSlug: string;
  sourceId: string;
  collector: CollectorInfo;
  host: string;
  endpoint: string;
  query: string;
  window: TimeWindow;
  collectedAt: string;
  status: EvidenceRecordStatus;
  itemCount: number;
  payload: unknown;
  controlIds?: string[];
  objectiveIds?: string[];
  error?: string;
  /** Optional caller-chosen id; an id already in the chain is refused. */
  recordId?: string;
  /** Optional watermark advance, validated before the record is written and saved after it. */
  watermark?: WatermarkUpdate;
}

export interface ManifestChainEntry {
  seq: number;
  recordId: string;
  recordSha256: string;
  payloadSha256: string;
  sourceId: string;
  collectedAt: string;
}

export interface EvidenceManifest {
  schema: 'ces-eo/evidence-manifest@1';
  tenantId: string;
  tenantSlug: string;
  hashAlgorithm: 'sha256/canonical-json';
  recordCount: number;
  headSha256: string;
  genesisSha256: string;
  retentionPolicy: string;
  updatedAt: string;
  chain: ManifestChainEntry[];
}

export interface Watermark {
  sourceId: string;
  /** Newest event time collected from the source (log sources; W2). */
  lastEventTime: string | null;
  /** Id of that event (log sources; W2). */
  lastId: string | null;
  /** End of the last window read successfully. */
  lastWindowEnd: string | null;
  /** Re-read this many minutes before lastEventTime; overlap rows are dropped by id. */
  overlapMinutes: number;
  /** Ids collected inside the overlap span, for de-duplication. */
  seenIds: string[];
  updatedAt: string;
  /** The record whose append moved the watermark. */
  recordId: string;
}

export type WatermarkUpdate = Partial<Pick<Watermark, 'lastEventTime' | 'lastId' | 'lastWindowEnd' | 'overlapMinutes' | 'seenIds'>>;

export interface StoreQuery {
  sourceId?: string;
  controlId?: string;
  objectiveId?: string;
  /** collectedAt at or after. */
  from?: string;
  /** collectedAt at or before. */
  to?: string;
}

export interface ChainVerification {
  ok: boolean;
  tenantId: string;
  recordCount: number;
  headSha256: string;
  manifest: { present: boolean; recordCount: number | null; headSha256: string | null; matches: boolean };
  /** seq of the first record that does not verify, when any. */
  firstBreakSeq?: number;
  problems: string[];
}

/** W1.5 provenance pointer, one per store record behind an objective. */
export interface EvidenceRef {
  recordId: string;
  tenantId: string;
  sourceId: string;
  sha256: string;
  collectedAt: string;
  /** EO-collection W3: the record's read status; freshness (B19) counts only `success` and `empty` reads. */
  status?: EvidenceRecordStatus;
  /** Synthetic-customer W2: the record's endpoint (C10 names the AdminOps evidence kind there; MethodLabeler). */
  endpoint?: string;
}
