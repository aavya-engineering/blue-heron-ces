// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W2, collector C10 (`collect.adminOps`). AD-1 tool boundary: AdminOps never
 * writes EO's store; EO pulls AdminOps' rows from the shared DB (`{CES_PIPELINE_ROOT}\ces.db`,
 * collection `adminops_evidence`, read through AdminOpsEvidenceReader, tenant scoped) and appends
 * one hash-chained store record per row. De-duplicated by the ces.db row id (`<commandId>:<executionId>`),
 * watermarked by the row's contract `timestamp`.
 *
 * The record carries the op id, requestor, approver, mode (dry run / apply), outcome, verdict and
 * whether a confirming read followed the apply (AD-6). Its endpoint names the evidence kind, so the
 * method label can tell a confirmed apply (test) from a read (examine) (MethodLabeler.ts).
 * No windowed view: the status source of an AdminOps row stays the reader's (Tier 3 or Tier 4);
 * the store record adds provenance, not a second positive source (AD-6).
 */
import * as fs from 'node:fs';
import { getCesDbPath } from 'ces-shared/persistence/node';
import { canonicalSha256 } from 'ces-shared/crypto';
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';
import {
  AdminOpsEvidenceReader, adminOpsEvidenceKind, adminOpsRunWindowStart, hasConfirmingRead, type AdminOpsEvidenceKind,
} from '../adminops/AdminOpsEvidenceReader.js';
import { COLLECTED, isoTime, type Collector, type CollectorRead } from './Collector.js';

/** Endpoint (and record endpoint prefix) of C10 records; not a registry endpoint. */
export const ADMIN_OPS_ENDPOINT = 'adminops_evidence';

/** The payload of one C10 record: one AdminOps evidence row. */
export interface AdminOpsCollectedRow {
  /** ces.db row id (`<commandId>:<executionId>`). */
  rowId: string;
  /** The op id (AO command id, e.g. A-02). */
  opId: string;
  requestorUPN: string | null;
  approverUPN: string | null;
  approvalId: string | null;
  /** `dry_run` or `apply` (the contract's `live`). */
  mode: 'dry_run' | 'apply';
  /** Contract outcome (executed, dry_run, blocked_pending_approval, ...). */
  result: string;
  verdict: string;
  /** AD-6: a confirming read followed the apply (non-empty `postStateOutput` on a live executed row). */
  confirmingRead: boolean;
  kind: AdminOpsEvidenceKind;
  /** The row's time (contract `timestamp`). */
  timestamp: string;
  controlIds: string[];
  /** AO's own evidence hash (contract `sha256`). */
  aoSha256: string;
  /** canonicalSha256 of `row` (the parsed contract row). */
  rowSha256: string;
  /** The parsed contract row (data.metadata of the ces.db row). */
  row: AdminOpsEvidence;
  /**
   * FIN-14 (V76): the assessment objective ids AO wrote beside the row (`data.evidenceObjectives`,
   * slice AO-1). Display and provenance only, never credit (AR5). Absent when the row has none.
   */
  evidenceObjectives?: string[];
}

export function toCollectedRow(rowId: string, ev: AdminOpsEvidence, evidenceObjectives?: string[]): AdminOpsCollectedRow {
  return {
    rowId,
    opId: ev.commandId,
    requestorUPN: ev.requestorUPN ?? null,
    approverUPN: ev.approverUPN ?? null,
    approvalId: ev.approvalId ?? null,
    mode: ev.mode === 'live' && !ev.dryRun ? 'apply' : 'dry_run',
    result: ev.outcome,
    verdict: ev.verdict,
    confirmingRead: hasConfirmingRead(ev),
    kind: adminOpsEvidenceKind(ev),
    timestamp: ev.timestamp,
    controlIds: [...ev.controlIds],
    aoSha256: ev.sha256,
    rowSha256: canonicalSha256(ev),
    row: ev,
    ...(evidenceObjectives && evidenceObjectives.length > 0 ? { evidenceObjectives: [...evidenceObjectives] } : {}),
  };
}

const asRow = (it: unknown): Partial<AdminOpsCollectedRow> => (it ?? {}) as Partial<AdminOpsCollectedRow>;

export const adminOpsCollector: Collector = {
  planId: 'C10',
  sourceId: COLLECTED.ADMIN_OPS,
  endpoint: ADMIN_OPS_ENDPOINT,
  signalSource: 'manual',
  host: 'ces.db',
  permission: 'read access to the shared DB ({CES_PIPELINE_ROOT}\\ces.db, collection adminops_evidence)',
  cadenceMinutes: 15,
  initialLookbackMinutes: 365 * 24 * 60,
  // A row is timed when AO builds its evidence, a moment before the row is committed; a day of
  // overlap re-reads that span, and rows already collected are dropped by row id.
  overlapMinutes: 24 * 60,
  viewDays: 365,
  idOf: (it) => String(asRow(it).rowId ?? ''),
  timeOf: (it) => isoTime(asRow(it).timestamp),
  recordPerItem: {
    controlIdsOf: (it) => [...(asRow(it).controlIds ?? [])],
    endpointOf: (it) => `${ADMIN_OPS_ENDPOINT}/${asRow(it).kind ?? 'unknown'}`,
    queryOf: (it) => `${ADMIN_OPS_ENDPOINT}/${asRow(it).rowId ?? ''}`,
  },
  noView: true,
  async read(_reader, window, scope): Promise<CollectorRead> {
    // The reader also applies the simulator run window (ADMINOPS_SINCE_ENV), when set; the query names it.
    const since = adminOpsRunWindowStart();
    const query = `SELECT ${ADMIN_OPS_ENDPOINT} WHERE tenantId=${scope?.tenantId ?? '?'} AND timestamp >= ${window.start}${since ? ` AND timestamp >= ${since}` : ''}`;
    if (!scope) return { status: 'error', items: [], query, error: 'no tenant scope' };
    try {
      const dbPath = getCesDbPath();
      // Read only: an absent DB means AdminOps has written nothing; it is never created here.
      if (!fs.existsSync(dbPath)) return { status: 'success', items: [], query };
      const res = new AdminOpsEvidenceReader(scope.tenantId, dbPath).read({ from: window.start });
      return { status: 'success', items: res.entries.map((e) => toCollectedRow(e.rowId, e.evidence, e.evidenceObjectives)), query };
    } catch (e) {
      return { status: 'error', items: [], query, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
