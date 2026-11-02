// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M3 — Beat 5 (AO) evidence reader + the artifact judges.
 *
 * Finding #2 (grounded in `docs/demo/E2E-GROUNDING-EVIDENCE.md`): AO evidence
 * lands in SQLite at `{CES_PIPELINE_ROOT}/ces.db`, collection
 * `adminops_evidence` — NOT the filesystem path AO's own docstring claims; the
 * returned `evidencePath` is a locator string
 * (`adminops_evidence/<commandId>:<executionId>`).
 *
 * Finding #6: a row is written on EVERY path including dry-run, and a
 * persistence failure is silently swallowed — so a green AO run proves
 * nothing on its own. The judges here are the artifacts (row-count delta +
 * the row's own metadata + a stacksim ledger MUTATION), never an exit code
 * and never a GUI badge.
 *
 * Three M0-measured corrections are baked in (docs/context/IMPLEMENTATION_LOG.md,
 * "GP-DEMO-3 — M0 Drivability Spike"), each of which silently breaks the
 * assertion if re-derived from the plan text alone:
 *   1. the fields live at `data.evidence.metadata.*`, NOT `data.metadata.*`
 *      (plan predicate 7 names the wrong path);
 *   2. rows are scoped by `tenant_id` (`sim-tenant-<slug>`) — `tenant_slug`
 *      is NULL on every observed row, so scoping by slug returns nothing;
 *   3. the stacksim ledger records READS as well as writes
 *      (`type: 'create' | 'mutate' | 'read-serve'`), so every ledger
 *      assertion must filter `type === 'mutate'` — a raw length delta is
 *      contaminated by the harness's own reads.
 *
 * Finding #6b: `preStateOutput`/`postStateOutput` are stub strings even on a
 * live, state-changing apply (both AO pre/post reads hardcode `dryRun=true`).
 * They are surfaced here for transparency but are deliberately NOT part of the
 * verdict, and the beat must never narrate pre-state capture.
 *
 * Everything except `readAoEvidence` is pure and unit-tested; `better-sqlite3`
 * is loaded lazily inside the reader so the pure tests never touch a native
 * binding.
 */

import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import type { LedgerEntry } from '../stacksim-client/types.js';

/** The AO evidence collection in `ces.db`'s `ces_records` table. */
export const AO_EVIDENCE_COLLECTION = 'adminops_evidence';

/** The `sim-tenant-<slug>` id AO stamps on rows for a sim tenant (registry-authored). */
export function simTenantId(slug: string): string {
  return `sim-tenant-${slug}`;
}

/** One `ces_records` row exactly as SQLite returns it (`data` is a JSON STRING). */
export interface AoEvidenceRawRow {
  readonly collection: string;
  readonly id: string;
  readonly tenant_id: string | null;
  readonly tenant_slug: string | null;
  readonly created_at: string;
  readonly data: string;
}

/** `data.evidence.metadata` — the M0-verified location of predicate 7's fields. */
export interface AoEvidenceMetadata {
  readonly stateChanged?: boolean;
  readonly commandExecuted?: string;
  readonly sha256Hash?: string;
  readonly controlIds?: readonly string[];
  readonly executorIdentity?: string;
  readonly timestamp?: string;
  /** Finding #6b: a stub string even on a live apply. Never assert on it. */
  readonly preStateOutput?: string;
  /** Finding #6b: a stub string even on a live apply. Never assert on it. */
  readonly postStateOutput?: string;
}

/** ces-ao FX-AO7: every AO web UI execute sends `ao-ui-<uuid>` (`public/index.html` `newCorrelationId`). */
export const AO_UI_CORRELATION_PREFIX = 'ao-ui-';

export interface AoEvidenceRow {
  readonly id: string;
  readonly tenantId?: string;
  readonly createdAt: string;
  /** `data.evidence.outcome` — e.g. `automated_success`. */
  readonly outcome?: string;
  /** `data.evidence.complianceVerdict` — e.g. `SAT` (the GUI fails to render it — finding #8). */
  readonly complianceVerdict?: string;
  readonly metadata: AoEvidenceMetadata;
  /**
   * `data.metadata.correlationId` — the AdminOps evidence CONTRACT row (A4 / AE-R2:
   * AO persists `data: { evidence, metadata, ces }`, `metadata` being the contract
   * row), NOT `data.evidence.metadata`. The AO web UI sends a fresh `ao-ui-<uuid>`
   * per execute since ces-ao FX-AO7 (`e53e708`).
   */
  readonly correlationId?: string;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readMetadata(node: unknown): AoEvidenceMetadata {
  const m = (node ?? {}) as Record<string, unknown>;
  return {
    stateChanged: typeof m.stateChanged === 'boolean' ? m.stateChanged : undefined,
    commandExecuted: asString(m.commandExecuted),
    sha256Hash: asString(m.sha256Hash),
    controlIds: Array.isArray(m.controlIds) ? m.controlIds.filter((c): c is string => typeof c === 'string') : undefined,
    executorIdentity: asString(m.executorIdentity),
    timestamp: asString(m.timestamp),
    preStateOutput: asString(m.preStateOutput),
    postStateOutput: asString(m.postStateOutput),
  };
}

/**
 * Parse one raw row into the shape the judges use. Pure. Returns undefined for
 * a row whose `data` is not parseable JSON or is not an object — an
 * unparseable row must never be silently treated as a passing one.
 */
export function parseAoEvidenceRow(raw: AoEvidenceRawRow): AoEvidenceRow | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const evidence = (data as { evidence?: unknown }).evidence as Record<string, unknown> | undefined;
  const contract = (data as { metadata?: unknown }).metadata as Record<string, unknown> | undefined;
  const correlationId = asString(contract?.correlationId);
  return {
    id: raw.id,
    tenantId: raw.tenant_id ?? undefined,
    createdAt: raw.created_at,
    outcome: asString(evidence?.outcome),
    complianceVerdict: asString(evidence?.complianceVerdict),
    metadata: readMetadata(evidence?.metadata),
    ...(correlationId ? { correlationId } : {}),
  };
}

/** Newest row by `created_at` (the row id carries a timestamp but is not sortable-safe). Pure. */
export function newestAoEvidenceRow(rows: readonly AoEvidenceRow[]): AoEvidenceRow | undefined {
  let newest: AoEvidenceRow | undefined;
  for (const r of rows) {
    if (!newest || r.createdAt > newest.createdAt) newest = r;
  }
  return newest;
}

/** Rows present in `after` but not in `before`, by id. Pure — the snapshot/diff half of the beat. */
export function diffAoEvidenceRows(
  before: readonly AoEvidenceRow[],
  after: readonly AoEvidenceRow[],
): readonly AoEvidenceRow[] {
  const seen = new Set(before.map((r) => r.id));
  return after.filter((r) => !seen.has(r.id));
}

/**
 * Ledger mutations only. The stacksim ledger records reads (`read-serve`) and
 * the seed's own `create` entries too — M0 measured 85/21/7 on a fresh seed —
 * so a raw length delta says nothing about whether AO wrote anything. Pure.
 */
export function countLedgerMutations(entries: readonly LedgerEntry[]): number {
  return entries.filter((e) => e.type === 'mutate').length;
}

export interface AoEvidenceInput {
  /** Rows read (scoped by tenant_id) BEFORE the AO window opened. */
  readonly rowsBefore: readonly AoEvidenceRow[];
  /** Rows read (same scope) AFTER the AO window closed. */
  readonly rowsAfter: readonly AoEvidenceRow[];
  /** Ledger entries snapshotted before the AO window (unfiltered — filtered here). */
  readonly ledgerBefore: readonly LedgerEntry[];
  /** Ledger entries snapshotted after the AO window (unfiltered — filtered here). */
  readonly ledgerAfter: readonly LedgerEntry[];
}

export interface AoEvidenceVerdict {
  /** Amended success predicate 7, all clauses together. */
  readonly satisfied: boolean;
  readonly rowCountDelta: number;
  readonly ledgerMutationDelta: number;
  readonly newest?: AoEvidenceRow;
  readonly stateChanged: boolean;
  readonly hasCommandExecuted: boolean;
  readonly hasSha256Hash: boolean;
  /** Human-readable reason per unmet clause — printed on screen, never hidden. */
  readonly failures: readonly string[];
}

/**
 * The amended success predicate 7 (`docs/demo/PLAN-E2E-AO-DEMO.md`, with the
 * M0 corrections): the row count for this tenant INCREASED in AO's window, and
 * the newest row carries `stateChanged === true`, a resolved `commandExecuted`
 * and a `sha256Hash` at `data.evidence.metadata.*`, AND the stacksim ledger
 * gained at least one `type === 'mutate'` entry in the same window.
 *
 * All clauses are required together: a dry run also writes a row, and a
 * persistence failure is swallowed (finding #6). Pure.
 */
export function evaluateAoEvidence(input: AoEvidenceInput): AoEvidenceVerdict {
  const rowCountDelta = input.rowsAfter.length - input.rowsBefore.length;
  const ledgerMutationDelta = countLedgerMutations(input.ledgerAfter) - countLedgerMutations(input.ledgerBefore);
  const added = diffAoEvidenceRows(input.rowsBefore, input.rowsAfter);
  const newest = newestAoEvidenceRow(added.length > 0 ? added : input.rowsAfter);

  const stateChanged = newest?.metadata.stateChanged === true;
  const hasCommandExecuted = (newest?.metadata.commandExecuted ?? '').length > 0;
  const hasSha256Hash = (newest?.metadata.sha256Hash ?? '').length > 0;

  const failures: string[] = [];
  if (rowCountDelta <= 0) failures.push(`no new ${AO_EVIDENCE_COLLECTION} row for this tenant (delta ${rowCountDelta})`);
  if (!newest) failures.push('no evidence row to judge');
  if (newest && !stateChanged) failures.push(`newest row stateChanged=${String(newest.metadata.stateChanged)} (expected true)`);
  if (newest && !hasCommandExecuted) failures.push('newest row has no resolved commandExecuted');
  if (newest && !hasSha256Hash) failures.push('newest row has no sha256Hash');
  if (ledgerMutationDelta < 1) failures.push(`stacksim ledger shows no mutate entry in AO's window (delta ${ledgerMutationDelta})`);

  return {
    satisfied: failures.length === 0,
    rowCountDelta,
    ledgerMutationDelta,
    newest,
    stateChanged,
    hasCommandExecuted,
    hasSha256Hash,
    failures,
  };
}

/**
 * Read `adminops_evidence` rows for one tenant from a run-scoped `ces.db`,
 * oldest-first by `created_at`.
 *
 * Scoped by `tenant_id` — never by `tenant_slug` (NULL on every observed row)
 * and never by row id (`<commandId>:<executionId>`, non-deterministic). A
 * missing DB file returns `[]` rather than throwing: AO writes the DB lazily,
 * so "no file yet" is a legitimate before-snapshot, not an error.
 *
 * `better-sqlite3` is required lazily so the pure helpers above can be
 * unit-tested without loading a native binding.
 */
export function readAoEvidence(dbPath: string, tenantId: string): readonly AoEvidenceRow[] {
  const require = createRequire(import.meta.url);
  let Database: typeof BetterSqlite3;
  try {
    Database = require('better-sqlite3') as typeof BetterSqlite3;
  } catch {
    return [];
  }
  let db: BetterSqlite3.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return []; // DB not created yet — a legitimate empty snapshot.
  }
  try {
    const raw = db
      .prepare(
        'SELECT collection, id, tenant_id, tenant_slug, created_at, data FROM ces_records ' +
          'WHERE collection = ? AND tenant_id = ? ORDER BY created_at',
      )
      .all(AO_EVIDENCE_COLLECTION, tenantId) as AoEvidenceRawRow[];
    return raw.map(parseAoEvidenceRow).filter((r): r is AoEvidenceRow => r !== undefined);
  } catch {
    return []; // table absent on a fresh pipeline root.
  } finally {
    db.close();
  }
}
