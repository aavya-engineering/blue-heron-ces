// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * E5: every adminops test row is DERIVED FROM AO's committed golden
 * (ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json, commit 96b7935),
 * read-only by path — never copied into ces-eo. The golden is the exact persisted `data`
 * of AO's real persist path (EvidenceEmitter.persistEvidenceArtifact):
 *
 *   repo.put('adminops_evidence', { id, ces, data: { evidence, metadata, ces } })
 *
 *   data.evidence  = StructuredEvidence (rich AO outcome, complianceVerdict, inner metadata)
 *   data.metadata  = the shared-contract row (contractVersion 1.1.0, commandId, tenantSlug …)
 *
 * makeRealShapeRow() deep-clones the golden row for the requested execution path and then
 * overrides only identity/test-specific fields; the structure is always AO's.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AO_GOLDEN_PATH = path.resolve(
  __dirname,
  '../../../../../ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json',
);

export type GoldenKey =
  | 'success' | 'failure' | 'denied_cmmc' | 'denied_cui' | 'dry_run'
  | 'dry_run+deny' | 'pending' | 'rejected' | 'sim-only refusal';

export function loadAoGolden(): Record<GoldenKey, any> {
  return JSON.parse(fs.readFileSync(AO_GOLDEN_PATH, 'utf-8'));
}

export interface RealShapeOpts {
  id?: string;
  /** Explicit golden template; otherwise chosen from outcome + mode. */
  golden?: GoldenKey;
  commandId?: string;
  tenantId?: string;
  tenantSlug?: string;
  tenantKind?: string;
  executionId?: string;
  mode?: 'dry_run' | 'live';
  dryRun?: boolean;
  /** AO rich outcome (automated_success, failed_no_remediation …) or contract outcome. */
  outcome?: string;
  controlIds?: string[];
  timestamp?: string;
  verdict?: string;
  verdictRationale?: string;
  sha256Hash?: string;
  contractVersion?: string;
  requestorUPN?: string;
  approverUPN?: string;
  approvalId?: string;
  correlationId?: string;
  preStateOutput?: string;
  postStateOutput?: string;
  /** Applied last to data.evidence.metadata (conflict/drift cases). */
  innerOverrides?: Record<string, unknown>;
  /** Applied last to data.metadata (conflict/corruption cases). */
  outerOverrides?: Record<string, unknown>;
}

function pickGolden(outcome: string | undefined, dryRun: boolean): GoldenKey {
  switch (outcome) {
    case undefined:
    case 'executed':
    case 'automated_success':
    case 'policy_compliance':
      return dryRun ? 'dry_run' : 'success';
    case 'failed':
    case 'failed_no_remediation':
    case 'failed_remediation_available':
      return 'failure';
    case 'denied_cmmc':
      return dryRun ? 'dry_run+deny' : 'denied_cmmc';
    case 'denied_cui':
      return 'denied_cui';
    case 'dry_run':
      return 'dry_run';
    case 'blocked_pending_approval':
      return 'pending';
    case 'approval_rejected':
      return 'rejected';
    default:
      throw new Error(`makeRealShapeRow: no golden template for outcome '${outcome}'`);
  }
}

export function makeRealShapeRow(opts: RealShapeOpts = {}) {
  const dryRunReq = opts.dryRun ?? (opts.mode === 'dry_run');
  const key = opts.golden ?? pickGolden(opts.outcome, dryRunReq);
  const data = structuredClone(loadAoGolden()[key]);
  const ev = data.evidence;
  const meta = data.metadata;

  const commandId = opts.commandId ?? 'F-13';
  const executionId = opts.executionId ?? 'exec-001';
  const tenantId = opts.tenantId ?? 'test-tenant';

  // Contract row (data.metadata) — identity/test fields only; structure stays AO's.
  meta.commandId = commandId;
  meta.tenantId = tenantId;
  if (opts.tenantSlug !== undefined) meta.tenantSlug = opts.tenantSlug;
  if (opts.tenantKind !== undefined) meta.tenantKind = opts.tenantKind;
  if (opts.correlationId !== undefined) meta.correlationId = opts.correlationId;
  if (opts.requestorUPN !== undefined) meta.requestorUPN = opts.requestorUPN;
  if (opts.approverUPN !== undefined) meta.approverUPN = opts.approverUPN;
  if (opts.approvalId !== undefined) meta.approvalId = opts.approvalId;
  if (opts.contractVersion !== undefined) meta.contractVersion = opts.contractVersion;
  // Tests default to one control so negative (no-credit) assertions are never vacuous.
  const controlIds = opts.controlIds ?? ['SC.L2-3.13.1'];
  meta.controlIds = controlIds; ev.metadata.controlIds = controlIds;
  if (opts.timestamp !== undefined) { meta.timestamp = opts.timestamp; ev.metadata.timestamp = opts.timestamp; }
  if (opts.sha256Hash !== undefined) { meta.sha256 = opts.sha256Hash; ev.metadata.sha256Hash = opts.sha256Hash; }
  if (opts.verdict !== undefined) { meta.verdict = opts.verdict; ev.complianceVerdict = opts.verdict; }
  if (opts.verdictRationale !== undefined) { meta.verdictRationale = opts.verdictRationale; ev.verdictRationale = opts.verdictRationale; }
  if (opts.preStateOutput !== undefined) meta.preStateOutput = opts.preStateOutput;
  if (opts.postStateOutput !== undefined) meta.postStateOutput = opts.postStateOutput;
  if (opts.mode !== undefined || opts.dryRun !== undefined) {
    const mode = opts.mode ?? (dryRunReq ? 'dry_run' : 'live');
    meta.mode = mode; meta.dryRun = dryRunReq;
    ev.metadata.mode = mode; ev.metadata.dryRun = dryRunReq;
  }
  if (data.ces) data.ces.tenantId = tenantId;

  Object.assign(ev.metadata, opts.innerOverrides ?? {});
  Object.assign(meta, opts.outerOverrides ?? {});

  return {
    id: opts.id ?? `${commandId}:${executionId}`,
    ces: { tenantId },
    data,
  };
}

export function seedRealRow(
  dbPath: string,
  opts: RealShapeOpts,
  getCesRepository: (path?: string) => any,
) {
  const row = makeRealShapeRow(opts);
  getCesRepository(dbPath).put('adminops_evidence', row);
  return row;
}
