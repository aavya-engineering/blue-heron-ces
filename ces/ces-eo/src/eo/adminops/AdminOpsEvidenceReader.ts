// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { AssessmentSource } from 'ces-shared/types/controls';
import { getCesRepository } from 'ces-shared/persistence/node';
import {
  AdminOpsEvidenceSchema,
  AdminOpsEvidenceOutcome,
  isLiveExecution,
  isDryRun,
  isDenial,
  isBlocked,
  type AdminOpsEvidence,
} from 'ces-shared/types/adminops-evidence';
import { STATE_NOT_VERIFIED } from '../evidence/StamperEvidenceLoader.js';

/**
 * W2 (synthetic-customer plan AD-6, founder decision B27): how a parsed AO row stands as evidence.
 *  - `apply_confirmed`: a live executed write whose confirming read after the apply succeeded
 *    (AO's get-then-set post-read: `postStateOutput` present and non-empty). The only Tier 3 kind.
 *  - `apply_unconfirmed`: a live executed write (it carries the pre-read) without that post-read.
 *  - `read`: a live executed read-only op (the read path carries neither pre- nor post-read).
 *  - `dry_run`, `denied`, `blocked`, `failed`: no state change; never a status source.
 */
export type AdminOpsEvidenceKind = 'apply_confirmed' | 'apply_unconfirmed' | 'read' | 'dry_run' | 'denied' | 'blocked' | 'failed';

/** AD-6: a confirming read follows the apply (field present and the read returned state). */
export function hasConfirmingRead(ev: AdminOpsEvidence): boolean {
  return isLiveExecution(ev) && typeof ev.postStateOutput === 'string' && ev.postStateOutput.trim() !== '';
}

export function adminOpsEvidenceKind(ev: AdminOpsEvidence): AdminOpsEvidenceKind {
  if (isDryRun(ev)) return 'dry_run';
  if (isDenial(ev)) return 'denied';
  if (isBlocked(ev)) return 'blocked';
  if (!isLiveExecution(ev)) return 'failed';
  if (hasConfirmingRead(ev)) return 'apply_confirmed';
  return ev.preStateOutput !== undefined ? 'apply_unconfirmed' : 'read';
}

/** W2 (C10): optional scope of one read: row time (the contract `timestamp`) and tenant slug. */
export interface AdminOpsReadOptions {
  /** Rows timed at or after (ISO). */
  from?: string;
  /** Rows timed at or before (ISO). */
  to?: string;
  /** Rows whose contract row names another tenant slug are skipped (rows without a slug are kept). */
  tenantSlug?: string;
}

/**
 * W2 follow-up (per-run isolation): the run window start of a simulator run, as an ISO time in this
 * env var on the EO process. When set, every read skips AdminOps rows timed before it, so an
 * assess sees only the rows of the run that set it (the harness sets it to its E1 start; ces.db
 * is append-only and shared across runs). Unset, as in production, nothing changes: a real
 * deployment reads its whole six-year retained history. The window is a simulator property,
 * not a retention rule.
 */
export const ADMINOPS_SINCE_ENV = 'CES_EO_ADMINOPS_SINCE';

/** The run window start from ADMINOPS_SINCE_ENV, or undefined when unset or blank. */
export function adminOpsRunWindowStart(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[ADMINOPS_SINCE_ENV]?.trim();
  return v ? v : undefined;
}

/** The later of two ISO times (either may be absent). */
function laterOf(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * AO-1 (gap plan G-AO): the assessment objective ids AO wrote beside the contract row
 * (`data.evidenceObjectives`). Display only: never part of the contract parse, credit or SPRS (AR5).
 * Undefined when the row has none (rows written before AO-1) or the value is not a string array.
 */
export function rowEvidenceObjectives(data: Record<string, unknown> | undefined): string[] | undefined {
  const v = data?.evidenceObjectives;
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x !== '')) return undefined;
  return [...v] as string[];
}

export interface AdminOpsReadResult {
  sources: Map<string, AssessmentSource[]>;
  parsed: AdminOpsEvidence[];
  /** FX-EO2: parsed rows paired with their ces.db row id (stable, unique per execution). */
  entries: Array<{ rowId: string; evidence: AdminOpsEvidence; evidenceObjectives?: string[] }>;
  stats: {
    total: number;
    live: number;
    dryRun: number;
    denied: number;
    blocked: number;
    failed: number;
    unparsed: number;
    legacy: number;
  };
}

const COLLECTION = 'adminops_evidence';

export class AdminOpsEvidenceReader {
  private readonly tenantId: string;
  private readonly dbPath?: string;

  constructor(tenantId: string, dbPath?: string) {
    this.tenantId = tenantId;
    this.dbPath = dbPath;
  }

  read(opts: AdminOpsReadOptions = {}): AdminOpsReadResult {
    const repo = getCesRepository(this.dbPath);
    const scope: AdminOpsReadOptions = { ...opts, from: laterOf(opts.from, adminOpsRunWindowStart()) };
    const rows = repo.list<Record<string, unknown>>(COLLECTION, { tenantId: this.tenantId })
      .filter(row => this.inScope(row.data as Record<string, any>, scope));

    const sources = new Map<string, AssessmentSource[]>();
    const parsed: AdminOpsEvidence[] = [];
    const entries: Array<{ rowId: string; evidence: AdminOpsEvidence; evidenceObjectives?: string[] }> = [];
    const stats = { total: 0, live: 0, dryRun: 0, denied: 0, blocked: 0, failed: 0, unparsed: 0, legacy: 0 };

    for (const row of rows) {
      stats.total++;

      const rawData = row.data as Record<string, any>;

      if (this.isLegacyRow(rawData)) {
        stats.legacy++;
        continue;
      }

      const normalized = this.normalizeRow(rawData);
      const result = AdminOpsEvidenceSchema.safeParse(normalized);

      if (!result.success) {
        // E5: strict shared-contract parse failure -> excluded from credit/SPRS/CRM and logged.
        // Log identifiers + zod issue paths only (never UPNs or raw output).
        stats.unparsed++;
        const issues = result.error.issues
          .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        console.warn(
          `[AdminOpsEvidenceReader] row excluded (strict contract parse failed): ` +
          `commandId=${String(normalized.commandId ?? '?')} ` +
          `correlationId=${String(normalized.correlationId ?? '?')} — ${issues}`,
        );
        continue;
      }

      const ev = result.data;
      parsed.push(ev);
      const evidenceObjectives = rowEvidenceObjectives(rawData);
      entries.push({ rowId: row.id, evidence: ev, ...(evidenceObjectives ? { evidenceObjectives } : {}) });

      if (isDryRun(ev)) {
        stats.dryRun++;
        continue;
      }

      if (isDenial(ev)) {
        stats.denied++;
        continue;
      }

      if (isBlocked(ev)) {
        stats.blocked++;
        continue;
      }

      if (ev.outcome === 'failed') {
        stats.failed++;
        continue;
      }

      if (isLiveExecution(ev)) {
        stats.live++;
        const isSat = ev.verdict === 'SAT';
        // AD-6 / B27: only a write with a confirming read ranks Tier 3 (state verified); a read-only
        // or unconfirmed row carries the "state not verified" suffix and ranks Tier 4 (ControlAssessor).
        const kind = adminOpsEvidenceKind(ev);
        const base = ev.correlationId ? `${ev.commandId} (${ev.correlationId})` : ev.commandId;
        const detail = kind === 'apply_confirmed' ? base
          : `${base} ${kind === 'read' ? 'read-only op' : 'apply without a confirming read'} (${STATE_NOT_VERIFIED})`;
        for (const controlId of ev.controlIds) {
          const existing = sources.get(controlId) || [];
          existing.push({
            type: 'adminops_execution',
            timestamp: ev.timestamp,
            detail,
            result: isSat ? 'imported' : 'missing',
          });
          sources.set(controlId, existing);
        }
      }
    }

    if (stats.legacy > 0) {
      console.warn(`[AdminOpsEvidenceReader] ${stats.legacy} legacy row(s) excluded (no mode/contractVersion)`);
    }

    return { sources, parsed, entries, stats };
  }

  /** W2 (C10): the row's time and slug as normalizeRow reads them (data.metadata wins). */
  private inScope(data: Record<string, any> | undefined, opts: AdminOpsReadOptions): boolean {
    if (opts.from === undefined && opts.to === undefined && opts.tenantSlug === undefined) return true;
    const outer = data?.metadata ?? {};
    const inner = data?.evidence?.metadata ?? {};
    if (opts.tenantSlug !== undefined) {
      const slug = outer.tenantSlug ?? inner.tenantSlug;
      if (slug !== undefined && slug !== opts.tenantSlug) return false;
    }
    if (opts.from !== undefined || opts.to !== undefined) {
      const t = Date.parse(String(outer.timestamp ?? inner.timestamp ?? ''));
      if (!Number.isFinite(t)) return false;
      if (opts.from !== undefined && t < Date.parse(opts.from)) return false;
      if (opts.to !== undefined && t > Date.parse(opts.to)) return false;
    }
    return true;
  }

  private isLegacyRow(data: Record<string, any>): boolean {
    const evidence = data.evidence;
    if (!evidence) return true;

    const innerMeta = evidence.metadata ?? {};
    const outerMeta = data.metadata ?? {};

    const hasMode = innerMeta.mode !== undefined || outerMeta.mode !== undefined;
    const hasContractVersion = innerMeta.contractVersion !== undefined || outerMeta.contractVersion !== undefined;

    return !hasMode && !hasContractVersion;
  }

  private normalizeRow(data: Record<string, unknown>): Record<string, unknown> {
    const evidence = (data as any).evidence;
    const innerMeta = (evidence.metadata ?? {}) as Record<string, unknown>;
    const outerMeta = ((data as any).metadata ?? {}) as Record<string, unknown>;
    // E1: data.metadata (AO's contract row since A4) wins field by field over evidence.metadata.
    const merged = { ...innerMeta, ...outerMeta };

    // Dry-run is sticky: either level saying dry-run makes the row a dry run.
    const stickyDryRun =
      innerMeta.dryRun === true || innerMeta.mode === 'dry_run' ||
      outerMeta.dryRun === true || outerMeta.mode === 'dry_run';

    // E5: no permissive defaults — a missing required field fails the strict shared parse.
    return {
      contractVersion: merged.contractVersion,
      commandId: merged.commandId,
      tenantId: merged.tenantId ?? this.tenantId,
      tenantSlug: merged.tenantSlug,
      tenantKind: merged.tenantKind,
      mode: stickyDryRun ? 'dry_run' : merged.mode,
      dryRun: stickyDryRun ? true : merged.dryRun,
      outcome: this.normalizeOutcome(evidence, merged, stickyDryRun),
      controlIds: merged.controlIds,
      correlationId: merged.correlationId,
      requestorUPN: merged.requestorUPN,
      approverUPN: merged.approverUPN,
      approvalId: merged.approvalId,
      // FX-EO4: offboarding target identity (contract 1.3.0).
      targetUPN: merged.targetUPN,
      targetObjectId: merged.targetObjectId,
      timestamp: merged.timestamp,
      executionTimestamp: merged.executionTimestamp,
      preStateOutput: merged.preStateOutput,
      postStateOutput: merged.postStateOutput,
      verdict: merged.verdict ?? evidence.complianceVerdict ?? merged.complianceVerdict,
      verdictRationale: merged.verdictRationale ?? evidence.verdictRationale,
      sha256: merged.sha256 ?? merged.sha256Hash,
    };
  }

  private normalizeOutcome(
    evidence: Record<string, unknown>,
    merged: Record<string, unknown>,
    stickyDryRun: boolean,
  ): string | undefined {
    // A4+ rows: data.metadata.outcome is already a contract outcome — authoritative, never
    // coerced (a sticky dry run + 'executed' must FAIL the shared F-4 refine, not be rewritten).
    const contractOutcome = AdminOpsEvidenceOutcome.safeParse(merged.outcome);
    if (contractOutcome.success) return contractOutcome.data;

    // Pre-A4 1.0.0 rows: map AO's rich outcome via the mapping documented in the shared contract.
    const rich = typeof merged.outcome === 'string' ? merged.outcome : evidence.outcome;
    if (typeof rich === 'string') {
      const mapped = this.mapLegacyOutcome(rich, merged, stickyDryRun);
      if (mapped) return mapped;
      return rich; // unknown value -> strict parse rejects it
    }
    // No outcome anywhere: never infer one from the verdict — strict parse rejects the row.
    return undefined;
  }

  private mapLegacyOutcome(
    outcome: string,
    merged: Record<string, unknown>,
    stickyDryRun: boolean,
  ): string | undefined {
    if (outcome === 'dry_run') return 'dry_run';
    if (outcome === 'denied_cmmc') return 'denied_cmmc';
    if (outcome === 'denied_cui') return 'denied_cui';
    if (outcome === 'blocked_pending_approval') return 'blocked_pending_approval';
    if (outcome === 'approval_rejected') return 'approval_rejected';
    if (outcome === 'automated_success' || outcome === 'policy_compliance') {
      return stickyDryRun ? 'dry_run' : 'executed';
    }
    if (
      outcome === 'failed_remediation_available' ||
      outcome === 'failed_no_remediation'
    ) {
      const cmmcGate = merged.cmmcGate as Record<string, unknown> | undefined;
      if (cmmcGate && cmmcGate.allow === false) return 'denied_cmmc';
      return 'failed';
    }
    return undefined;
  }
}
