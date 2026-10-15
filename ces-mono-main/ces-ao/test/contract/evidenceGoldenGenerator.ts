// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A4 (AE-R2): golden generator for persisted AdminOps evidence rows.
//
// Drives the REAL persist path — executeAoCommand (CommandExecutor → SimOnlyRail →
// CmmcScopeGate → SodGate → ParameterMapper → EvidenceEmitter → CesRepository) and
// ApprovalStore.recordApprovalDecision — against a throwaway temp database, then reads
// every row back from the repository and returns the exact persisted `data` JSON
// ({ evidence, metadata, ces }) keyed by path name.
//
// Sim only: the tenant is `kind:'sim'` with loopback endpoints, and the ONLY mocked seam
// is the PowerShell execution boundary (`ces-stamper/adapters/powershell`), which the
// CALLER must vi.mock (vi.mock only works inside vitest — see
// test/contract/adminopsEvidence.conformance.test.ts). Nothing reaches a real tenant.
//
// Row shape (A4): `data.metadata` IS toContractRow() output (current ADMINOPS_EVIDENCE_CONTRACT_VERSION) and nothing
// else; `data.evidence` is AO's StructuredEvidence unchanged; CES identity (including
// customerName, which CesRecord columns drop) is the sibling `data.ces`.
//
// Used by:
//   - the conformance/drift test (regenerates in memory, compares to the committed golden);
//   - scripts/write-evidence-golden.ts (runs that test with AO_WRITE_EVIDENCE_GOLDEN=1,
//     which rewrites test/fixtures/contract/adminops-evidence-rows.golden.json).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeAoCommand } from '../../src/execution/CommandExecutor.js';
import { createApprovalRequest, recordApprovalDecision } from '../../src/execution/ApprovalStore.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { makeAoCommand, verifiedApprover } from '../fixtures.js';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv } from '../stacksimEnv.js';

export const GOLDEN_PATHS = [
  'success',
  'failure',
  'denied_cmmc',
  'denied_cui',
  'dry_run',
  'dry_run+deny',
  'pending',
  'rejected',
  'sim-only refusal',
] as const;
export type GoldenPath = (typeof GOLDEN_PATHS)[number];

/** Expected contract-level shape of each path's persisted metadata. */
export const GOLDEN_EXPECTATIONS: Record<
  GoldenPath,
  { outcome: string; mode: 'live' | 'dry_run'; dryRun: boolean; targetUPN?: string }
> = {
  // FX-AO6 / contract 1.3.0: success runs a command declaring `targetUPN`, so its row
  // carries the target user; rejected carries it from the approval's bound inputs.
  success: { outcome: 'executed', mode: 'live', dryRun: false, targetUPN: 'target@golden.onmicrosoft.us' },
  failure: { outcome: 'failed', mode: 'live', dryRun: false },
  denied_cmmc: { outcome: 'denied_cmmc', mode: 'live', dryRun: false },
  denied_cui: { outcome: 'denied_cui', mode: 'live', dryRun: false },
  dry_run: { outcome: 'dry_run', mode: 'dry_run', dryRun: true },
  'dry_run+deny': { outcome: 'denied_cmmc', mode: 'dry_run', dryRun: true },
  pending: { outcome: 'blocked_pending_approval', mode: 'live', dryRun: false },
  // F-4: an approval_rejected row is a live-mode row.
  rejected: { outcome: 'approval_rejected', mode: 'live', dryRun: false, targetUPN: 'target@golden.onmicrosoft.us' },
  // Contract 1.2.0 (ces-shared FX-SH1): dedicated sim-only refusal outcome
  // (closes docs/requirements/REQ-shared-adminops-evidence-sim-refusal-outcome.md).
  'sim-only refusal': { outcome: 'denied_sim_only', mode: 'live', dryRun: false },
};

export interface GoldenAdapterControl {
  /** Switch the mocked PowerShell boundary between deterministic success and failure. */
  setFailure(fail: boolean): void;
}

const TENANT_ID = 'golden-sim-tenant';
const REQUESTOR = 'requestor@golden.onmicrosoft.us';
const APPROVER = 'approver@golden.onmicrosoft.us';
const TARGET = 'target@golden.onmicrosoft.us';

function makeSimTenant(root: string, overrides: Record<string, unknown> = {}): TenantConfig {
  const certPath = path.join(root, 'golden.pfx');
  if (!fs.existsSync(certPath)) fs.writeFileSync(certPath, 'dummy-cert');
  return {
    tenantSlug: 'golden-sim',
    tenantId: TENANT_ID,
    appId: 'golden-app-id',
    certPath,
    certThumbprint: 'A4A4000000000000000000000000000000000000',
    domain: 'golden.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: {
      graph: 'http://127.0.0.1:4390',
      login: 'http://127.0.0.1:4390',
    },
    subscription: { subscription_id: 'golden-sub', resource_group: 'golden-rg', location: 'usgovvirginia' },
    subscriptionId: 'golden-sub',
    resources: { operatorUPN: 'operator@golden.onmicrosoft.us' },
    clientName: 'Golden Sim Tenant',
    storageRoot: path.join(root, 'stamper'),
    stateDir: path.join(root, 'stamper', 'state'),
    evidenceDir: path.join(root, 'stamper', 'evidence'),
    logDir: path.join(root, 'stamper', 'logs'),
    ...overrides,
  } as unknown as TenantConfig;
}

function commandId(p: GoldenPath): string {
  return `GOLD-${p.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;

/**
 * Run all 9 paths through the real persist path in a fresh temp database and return the
 * persisted `data` JSON per path (JSON round-tripped, exactly as a reader would see it).
 */
export async function generateGoldenRows(adapter: GoldenAdapterControl): Promise<Record<GoldenPath, any>> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-golden-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): most golden paths run a kind:'sim' tenant — route this process
  // to stacksim so the executor's isStacksimModeActive() check doesn't refuse them.
  const stacksim = activateStacksimEnv();
  adapter.setFailure(false);

  const corr = (p: GoldenPath) => `golden-corr-${commandId(p).toLowerCase()}`;
  const run = (
    p: GoldenPath,
    tenant: TenantConfig,
    dryRun: boolean,
    extra: Record<string, unknown> = {},
    inputs: Record<string, unknown> = {},
  ) =>
    executeAoCommand(
      makeAoCommand({ id: commandId(p), cmmcPractices: ['AC.L1-3.1.1'], ...extra }),
      tenant,
      inputs,
      dryRun,
      { requestorUPN: REQUESTOR, correlationId: corr(p) },
    );

  try {
    await run('success', makeSimTenant(root), false, {
      parameters: [{ name: 'targetUPN', label: 'Target UPN', type: 'text', required: true }],
    }, { targetUPN: TARGET });

    adapter.setFailure(true);
    await run('failure', makeSimTenant(root), false);
    adapter.setFailure(false);

    // L2-only practice against an L1 tenant → CMMC scope denial.
    await run('denied_cmmc', makeSimTenant(root, { cmmcLevel: 'L1' }), false, { cmmcPractices: ['AC.L2-3.1.5'] });

    // Out-of-boundary resource → CUI boundary denial (same recipe as cmmcExecutorGate.test.ts).
    // A migration-exempt record skips the CUI check, so this tenant is a migrated L2 record.
    await run('denied_cui', makeSimTenant(root, {
      cmmcMigrationExempt: false,
      resources: { storageAccountName: 'sa-outside-boundary' },
      cuiBoundary: { resourceAllowlist: ['sa-inside-boundary'] },
    }), false, {
      cmmcPractices: ['SC.L2-3.13.16'],
      parameters: [
        { name: 'storageAccountName', label: 'Storage', type: 'text', source: 'resources.storageAccountName', required: true },
      ],
    });

    await run('dry_run', makeSimTenant(root), true);

    await run('dry_run+deny', makeSimTenant(root, { cmmcLevel: 'L1' }), true, { cmmcPractices: ['AC.L2-3.1.5'] });

    // Tier 3 with no approvalId → pending-approval stop (live request).
    await run('pending', makeSimTenant(root), false, { sodTier: 'Tier 3' });

    // Rejection is written by the approval store on a live request (F-4).
    const rejectedCmd = makeAoCommand({ id: commandId('rejected'), sodTier: 'Tier 3', cmmcPractices: ['AC.L2-3.1.5'] });
    const request = await createApprovalRequest({
      commandId: rejectedCmd.id,
      commandTitle: rejectedCmd.title,
      domain: rejectedCmd.domain,
      tenantId: TENANT_ID,
      sodTier: rejectedCmd.sodTier,
      requestorUPN: REQUESTOR,
      inputs: { targetUPN: TARGET },
      controlIds: rejectedCmd.cmmcPractices,
    });
    await recordApprovalDecision(request.approvalId, verifiedApprover(APPROVER, TENANT_ID), 'reject', 'Golden fixture rejection');

    // CES_AO_SIM_ONLY=1 refuses a non-sim tenant before anything else runs.
    process.env.CES_AO_SIM_ONLY = '1';
    await run('sim-only refusal', makeSimTenant(root, { kind: 'live' }), false);
    delete process.env.CES_AO_SIM_ONLY;

    const all = getCesRepository().listAll<any>('adminops_evidence');
    const out = {} as Record<GoldenPath, any>;
    for (const p of GOLDEN_PATHS) {
      const rows = all.filter((r) => r.data?.metadata?.commandId === commandId(p));
      if (rows.length !== 1) {
        throw new Error(`golden path '${p}' persisted ${rows.length} rows (expected exactly 1)`);
      }
      out[p] = JSON.parse(JSON.stringify(rows[0].data));
    }
    return out;
  } finally {
    adapter.setFailure(false);
    closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
    stacksim.restore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ─── Drift normalizer ────────────────────────────────────────────
// Rules (the ONLY things ignored when comparing a regenerated row to the golden):
//   1. Values of keys `timestamp`, `executionTimestamp`, `decidedAt`, `createdAt`,
//      `approvalId` are replaced by `<volatile:KEY>` (wall clock / random ids).
//   2. UUID-shaped substrings inside any string are replaced by `<uuid>` (execution and
//      approval ids that leak into messages).
//   3. ISO-8601 timestamps inside any string are replaced by `<iso-ts>`.
// Everything else — outcome, mode, dryRun, verdict, sha256, controlIds, UPNs, correlation
// ids, rationales, contractVersion, ces — is compared exactly.
const VOLATILE_KEYS = new Set(['timestamp', 'executionTimestamp', 'decidedAt', 'createdAt', 'approvalId']);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;

export function normalizeForDrift(value: unknown, key?: string): unknown {
  if (key && VOLATILE_KEYS.has(key) && value !== undefined && value !== null) return `<volatile:${key}>`;
  if (typeof value === 'string') return value.replace(UUID_RE, '<uuid>').replace(ISO_RE, '<iso-ts>');
  if (Array.isArray(value)) return value.map((v) => normalizeForDrift(v));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = normalizeForDrift(v, k);
    return o;
  }
  return value;
}
