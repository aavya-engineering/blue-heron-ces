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

export interface AdminOpsReadResult {
  sources: Map<string, AssessmentSource[]>;
  parsed: AdminOpsEvidence[];
  /** FX-EO2: parsed rows paired with their ces.db row id (stable, unique per execution). */
  entries: Array<{ rowId: string; evidence: AdminOpsEvidence }>;
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

  read(): AdminOpsReadResult {
    const repo = getCesRepository(this.dbPath);
    const rows = repo.list<Record<string, unknown>>(COLLECTION, { tenantId: this.tenantId });

    const sources = new Map<string, AssessmentSource[]>();
    const parsed: AdminOpsEvidence[] = [];
    const entries: Array<{ rowId: string; evidence: AdminOpsEvidence }> = [];
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
      entries.push({ rowId: row.id, evidence: ev });

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
        for (const controlId of ev.controlIds) {
          const existing = sources.get(controlId) || [];
          existing.push({
            type: 'adminops_execution',
            timestamp: ev.timestamp,
            detail: ev.correlationId ? `${ev.commandId} (${ev.correlationId})` : ev.commandId,
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
