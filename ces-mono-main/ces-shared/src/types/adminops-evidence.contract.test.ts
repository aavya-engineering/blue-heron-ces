// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import {
  AdminOpsEvidenceSchema,
  ADMINOPS_EVIDENCE_CONTRACT_VERSION,
  SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS,
  isLiveExecution,
  isDryRun,
  isDenial,
  isBlocked,
  type AdminOpsEvidence,
  type AdminOpsEvidenceOutcomeType,
} from './adminops-evidence.contract.js';

function makeRow(overrides: Partial<AdminOpsEvidence> = {}): AdminOpsEvidence {
  return {
    contractVersion: ADMINOPS_EVIDENCE_CONTRACT_VERSION,
    commandId: 'A-01-disable-legacy-auth',
    tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantSlug: 'contoso',
    tenantKind: 'gcc_high',
    mode: 'live',
    dryRun: false,
    outcome: 'executed',
    controlIds: ['AC.L2-3.1.1'],
    correlationId: 'corr-001',
    requestorUPN: 'admin@contoso.us',
    timestamp: '2026-09-26T12:00:00.000Z',
    verdict: 'SAT',
    sha256: 'abc123def456',
    ...overrides,
  };
}

describe('AdminOpsEvidenceSchema', () => {
  it('accepts a conforming live-execution row', () => {
    const row = makeRow();
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts a conforming dry-run row', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'dry_run',
      verdict: 'NOT_APPLICABLE',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts a denied_cmmc row', () => {
    const row = makeRow({
      outcome: 'denied_cmmc',
      verdict: 'NOT_APPLICABLE',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts a denied_cui row', () => {
    const row = makeRow({
      outcome: 'denied_cui',
      verdict: 'NOT_APPLICABLE',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts a blocked_pending_approval row', () => {
    const row = makeRow({
      outcome: 'blocked_pending_approval',
      verdict: 'NOT_APPLICABLE',
      approverUPN: 'securitylead@contoso.us',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts an approval_rejected row', () => {
    const row = makeRow({
      outcome: 'approval_rejected',
      verdict: 'NOT_SAT',
      approverUPN: 'securitylead@contoso.us',
      approvalId: 'apr-001',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('accepts a failed row', () => {
    const row = makeRow({
      outcome: 'failed',
      verdict: 'NOT_SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  // ─── Version gate ──────────────────────────────────────────────

  it('rejects a row with an unknown contractVersion', () => {
    const row = makeRow({ contractVersion: '2.0.0' as any });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects a row with missing contractVersion', () => {
    const { contractVersion, ...noVersion } = makeRow();
    const result = AdminOpsEvidenceSchema.safeParse(noVersion);
    expect(result.success).toBe(false);
  });

  // ─── Required fields ──────────────────────────────────────────

  it('rejects a row missing commandId', () => {
    const { commandId, ...row } = makeRow();
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects a row missing tenantId', () => {
    const { tenantId, ...row } = makeRow();
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects a row with empty controlIds', () => {
    const row = makeRow({ controlIds: [] });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects a row with unknown outcome', () => {
    const row = makeRow({ outcome: 'automated_success' as any });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  // ─── SPRS integrity (never inflate) ────────────────────────────

  it('rejects dry_run mode with executed outcome (F-4)', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'executed',
      verdict: 'SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('outcome'))).toBe(true);
    }
  });

  it('rejects dryRun=true with executed outcome (F-4)', () => {
    const row = makeRow({
      mode: 'live' as any,
      dryRun: true,
      outcome: 'executed',
      verdict: 'SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects dry_run outcome with SAT verdict', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'dry_run',
      verdict: 'SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('inflate SPRS'))).toBe(true);
    }
  });

  it('rejects denied_cmmc with SAT verdict', () => {
    const row = makeRow({ outcome: 'denied_cmmc', verdict: 'SAT' });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects denied_cui with SAT verdict', () => {
    const row = makeRow({ outcome: 'denied_cui', verdict: 'SAT' });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects blocked_pending_approval with SAT verdict', () => {
    const row = makeRow({ outcome: 'blocked_pending_approval', verdict: 'SAT' });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects approval_rejected with SAT verdict', () => {
    const row = makeRow({ outcome: 'approval_rejected', verdict: 'SAT' });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects failed with SAT verdict', () => {
    const row = makeRow({ outcome: 'failed', verdict: 'SAT' });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });
});

describe('F-4 dry-run invariant', () => {
  it('accepts dry-run with denied_cmmc outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'denied_cmmc',
      verdict: 'NOT_APPLICABLE',
    });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('accepts dry-run with denied_cui outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'denied_cui',
      verdict: 'NOT_APPLICABLE',
    });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('accepts dry-run with blocked_pending_approval outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'blocked_pending_approval',
      verdict: 'NOT_APPLICABLE',
    });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('rejects dry-run with executed outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'executed',
      verdict: 'NOT_APPLICABLE',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('outcome'))).toBe(true);
    }
  });

  it('rejects dry-run with approval_rejected outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'approval_rejected',
      verdict: 'NOT_SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects dry-run with failed outcome', () => {
    const row = makeRow({
      mode: 'dry_run',
      dryRun: true,
      outcome: 'failed',
      verdict: 'NOT_SAT',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });

  it('rejects any dry-run outcome with SAT verdict', () => {
    for (const outcome of ['dry_run', 'denied_cmmc', 'denied_cui', 'blocked_pending_approval'] as const) {
      const row = makeRow({
        mode: 'dry_run',
        dryRun: true,
        outcome,
        verdict: 'SAT',
      });
      const result = AdminOpsEvidenceSchema.safeParse(row);
      expect(result.success, `${outcome} with SAT should be rejected`).toBe(false);
    }
  });

  it('accepts a 1.0.0 row (backward compat)', () => {
    const row = makeRow({ contractVersion: '1.0.0' as any });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('accepts a 1.1.0 row', () => {
    const row = makeRow({ contractVersion: '1.1.0' as any });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('rejects an unknown contractVersion with a path-bearing issue', () => {
    const row = makeRow({ contractVersion: '2.0.0' as any });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('contractVersion'))).toBe(true);
    }
  });
});

describe('predicate helpers', () => {
  it('isLiveExecution', () => {
    expect(isLiveExecution(makeRow())).toBe(true);
    expect(isLiveExecution(makeRow({ mode: 'dry_run', dryRun: true, outcome: 'dry_run', verdict: 'NOT_APPLICABLE' }))).toBe(false);
    expect(isLiveExecution(makeRow({ outcome: 'failed', verdict: 'NOT_SAT' }))).toBe(false);
  });

  it('isDryRun', () => {
    expect(isDryRun(makeRow({ mode: 'dry_run', dryRun: true, outcome: 'dry_run', verdict: 'NOT_APPLICABLE' }))).toBe(true);
    expect(isDryRun(makeRow())).toBe(false);
  });

  it('isDenial', () => {
    expect(isDenial(makeRow({ outcome: 'denied_sim_only', verdict: 'NOT_APPLICABLE' }))).toBe(true);
    expect(isDenial(makeRow({ outcome: 'denied_cmmc', verdict: 'NOT_APPLICABLE' }))).toBe(true);
    expect(isDenial(makeRow({ outcome: 'denied_cui', verdict: 'NOT_APPLICABLE' }))).toBe(true);
    expect(isDenial(makeRow())).toBe(false);
  });

  it('isBlocked', () => {
    expect(isBlocked(makeRow({ outcome: 'blocked_pending_approval', verdict: 'NOT_APPLICABLE' }))).toBe(true);
    expect(isBlocked(makeRow({ outcome: 'approval_rejected', verdict: 'NOT_SAT' }))).toBe(true);
    expect(isBlocked(makeRow())).toBe(false);
  });
});

describe('FX-SH1 denied_sim_only outcome (contract 1.2.0)', () => {
  it('1.2.0 is supported alongside all prior versions', () => {
    expect([...SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS]).toEqual(expect.arrayContaining(['1.0.0', '1.1.0', '1.2.0']));
  });

  it('a current-version (1.3.0) row may carry denied_sim_only', () => {
    const row = makeRow({ outcome: 'denied_sim_only', verdict: 'NOT_APPLICABLE' });
    expect(row.contractVersion).toBe('1.3.0');
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('parses a 1.2.0 denied_sim_only row with a non-SAT verdict', () => {
    const row = makeRow({
      contractVersion: '1.2.0' as any,
      outcome: 'denied_sim_only',
      verdict: 'NOT_APPLICABLE',
      verdictRationale: 'CES_AO_SIM_ONLY=1 refuses non-sim tenant',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome).toBe('denied_sim_only');
      expect(result.data.verdict).not.toBe('SAT');
    }
  });

  it('parses a dry-run denied_sim_only row', () => {
    const row = makeRow({
      mode: 'dry_run', dryRun: true, outcome: 'denied_sim_only', verdict: 'NOT_APPLICABLE',
    });
    expect(AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
  });

  it('rejects denied_sim_only with verdict SAT (live and dry-run)', () => {
    for (const dry of [false, true]) {
      const row = makeRow({
        mode: dry ? 'dry_run' : 'live', dryRun: dry, outcome: 'denied_sim_only', verdict: 'SAT',
      });
      const result = AdminOpsEvidenceSchema.safeParse(row);
      expect(result.success, `dry=${dry}`).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.includes('verdict'))).toBe(true);
      }
    }
  });

  it('rejects denied_sim_only on a pre-1.2.0 row', () => {
    for (const v of ['1.0.0', '1.1.0']) {
      const row = makeRow({ contractVersion: v as any, outcome: 'denied_sim_only', verdict: 'NOT_APPLICABLE' });
      const result = AdminOpsEvidenceSchema.safeParse(row);
      expect(result.success, v).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.includes('outcome'))).toBe(true);
      }
    }
  });

  it('1.1.0 and 1.0.0 rows with every pre-existing outcome still parse', () => {
    const legacy: Array<[AdminOpsEvidenceOutcomeType, string]> = [
      ['executed', 'SAT'], ['dry_run', 'NOT_APPLICABLE'], ['denied_cmmc', 'NOT_APPLICABLE'],
      ['denied_cui', 'NOT_APPLICABLE'], ['blocked_pending_approval', 'NOT_APPLICABLE'],
      ['approval_rejected', 'NOT_SAT'], ['failed', 'NOT_SAT'],
    ];
    for (const v of ['1.0.0', '1.1.0']) {
      for (const [outcome, verdict] of legacy) {
        const dry = outcome === 'dry_run';
        const row = makeRow({
          contractVersion: v as any, outcome, verdict,
          mode: dry ? 'dry_run' : 'live', dryRun: dry,
        });
        expect(AdminOpsEvidenceSchema.safeParse(row).success, `${v} ${outcome}`).toBe(true);
      }
    }
  });
});

describe('FX-SH3 target identity (contract 1.3.0, REQ-ces-shared-adminops-target-identity)', () => {
  it('current contract version is 1.3.0 and all prior versions remain supported', () => {
    expect(ADMINOPS_EVIDENCE_CONTRACT_VERSION).toBe('1.3.0');
    expect([...SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS]).toEqual(['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
  });

  it('parses and preserves targetUPN / targetObjectId (not stripped)', () => {
    const row = makeRow({
      commandId: 'A-02-disable-account',
      requestorUPN: 'operator@contoso.us',
      targetUPN: 'departing.user@contoso.us',
      targetObjectId: '11111111-2222-3333-4444-555555555555',
    });
    const result = AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetUPN).toBe('departing.user@contoso.us');
      expect(result.data.targetObjectId).toBe('11111111-2222-3333-4444-555555555555');
      // target is distinct from the operator
      expect(result.data.targetUPN).not.toBe(result.data.requestorUPN);
    }
  });

  it('target fields are optional: rows without them parse on every supported version', () => {
    for (const v of SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS) {
      const row = makeRow({ contractVersion: v });
      delete (row as any).targetUPN;
      delete (row as any).targetObjectId;
      expect(AdminOpsEvidenceSchema.safeParse(row).success, v).toBe(true);
    }
  });

  it('rejects an empty targetUPN / targetObjectId', () => {
    expect(AdminOpsEvidenceSchema.safeParse(makeRow({ targetUPN: '' })).success).toBe(false);
    expect(AdminOpsEvidenceSchema.safeParse(makeRow({ targetObjectId: '' })).success).toBe(false);
  });
});
