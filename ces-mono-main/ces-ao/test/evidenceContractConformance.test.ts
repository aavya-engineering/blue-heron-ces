// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AE-R2: schema-conformance test — every AO execution path must produce a row
// that passes AdminOpsEvidenceSchema.parse(). Tests the contract round-trip from
// AO's internal EvidenceOutcome through normalizeOutcome + toContractRow to the
// shared Zod schema.
//
// Dry-run-mode denials/blocks (dryRun=true + outcome denied_cmmc|denied_cui|
// blocked_pending_approval) are valid under F-4 since ces-shared S2 (8697ecd, contract
// 1.1.0); REQ-shared-adminops-evidence-dryrun-invariant is closed. The persisted-row
// golden conformance lives in test/contract/adminopsEvidence.conformance.test.ts.

import { describe, it, expect } from 'vitest';
import {
  AdminOpsEvidenceSchema,
  ADMINOPS_EVIDENCE_CONTRACT_VERSION,
} from 'ces-shared/types/adminops-evidence';
import { normalizeOutcome, toContractRow } from '../src/execution/EvidenceEmitter.js';
import type { StructuredEvidence, EvidenceOutcome } from '../src/types/StamperTypes.js';
import type { EvidencePersistenceOptions } from '../src/execution/EvidenceEmitter.js';

function makeEvidence(overrides: Partial<StructuredEvidence> & {
  outcome: EvidenceOutcome;
  dryRun: boolean;
  mode: 'dry_run' | 'live';
}): StructuredEvidence {
  return {
    rawResponse: 'test output',
    outcome: overrides.outcome,
    outcomeRationale: 'test',
    complianceVerdict: overrides.complianceVerdict ?? 'NOT_APPLICABLE',
    verdictRationale: overrides.verdictRationale ?? 'test',
    metadata: {
      controlIds: ['AC.L2-3.1.5'],
      timestamp: new Date().toISOString(),
      executorIdentity: 'cse-ao-service',
      commandExecuted: 'Get-TestCommand',
      sha256Hash: 'abc123def456',
      dryRun: overrides.dryRun,
      mode: overrides.mode,
    },
  };
}

function makeOpts(overrides?: Partial<EvidencePersistenceOptions>): EvidencePersistenceOptions {
  return {
    commandId: 'A-01',
    tenantId: 'tid-conformance',
    executionId: 'exec-001',
    domain: 'A',
    ...overrides,
  };
}

describe('AdminOps evidence contract conformance (AE-R2)', () => {
  describe('normalizeOutcome mapping', () => {
    const cases: Array<{ local: EvidenceOutcome; mode: 'dry_run' | 'live'; expected: string }> = [
      { local: 'dry_run', mode: 'dry_run', expected: 'dry_run' },
      { local: 'automated_success', mode: 'live', expected: 'executed' },
      { local: 'automated_success', mode: 'dry_run', expected: 'dry_run' },
      { local: 'policy_compliance', mode: 'live', expected: 'executed' },
      { local: 'policy_compliance', mode: 'dry_run', expected: 'dry_run' },
      { local: 'manual_action', mode: 'live', expected: 'executed' },
      { local: 'exception_granted', mode: 'live', expected: 'executed' },
      { local: 'outside_action', mode: 'live', expected: 'executed' },
      { local: 'partial_success', mode: 'live', expected: 'executed' },
      { local: 'denied_cmmc', mode: 'live', expected: 'denied_cmmc' },
      { local: 'denied_cui', mode: 'live', expected: 'denied_cui' },
      { local: 'denied_sim_only', mode: 'live', expected: 'denied_sim_only' },
      { local: 'blocked_pending_approval', mode: 'live', expected: 'blocked_pending_approval' },
      { local: 'approval_rejected', mode: 'live', expected: 'approval_rejected' },
      { local: 'failed_remediation_available', mode: 'live', expected: 'failed' },
      { local: 'failed_no_remediation', mode: 'live', expected: 'failed' },
      { local: 'not_applicable', mode: 'live', expected: 'failed' },
      { local: 'inherited', mode: 'live', expected: 'failed' },
      { local: 'verification_pending', mode: 'live', expected: 'failed' },
      { local: 'unknown_legacy', mode: 'live', expected: 'failed' },
    ];

    for (const { local, mode, expected } of cases) {
      it(`${local} (${mode}) → ${expected}`, () => {
        expect(normalizeOutcome(local, mode)).toBe(expected);
      });
    }
  });

  describe('toContractRow → schema round-trip', () => {
    it('live execution (SAT-eligible)', () => {
      const ev = makeEvidence({ outcome: 'automated_success', dryRun: false, mode: 'live', complianceVerdict: 'SAT' });
      const row = toContractRow(ev, makeOpts());
      expect(row.contractVersion).toBe(ADMINOPS_EVIDENCE_CONTRACT_VERSION);
      expect(row.outcome).toBe('executed');
      expect(row.mode).toBe('live');
      expect(row.dryRun).toBe(false);
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('live execution failure', () => {
      const ev = makeEvidence({ outcome: 'failed_no_remediation', dryRun: false, mode: 'live', complianceVerdict: 'NOT_SAT' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('failed');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('dry-run preview', () => {
      const ev = makeEvidence({ outcome: 'dry_run', dryRun: true, mode: 'dry_run' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('dry_run');
      expect(row.dryRun).toBe(true);
      expect(row.mode).toBe('dry_run');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('dry-run preview must NOT carry SAT', () => {
      const ev = makeEvidence({ outcome: 'dry_run', dryRun: true, mode: 'dry_run', complianceVerdict: 'SAT' });
      const row = toContractRow(ev, makeOpts());
      expect(() => AdminOpsEvidenceSchema.parse(row)).toThrow(/SAT/);
    });

    it('live-mode CMMC denial', () => {
      const ev = makeEvidence({ outcome: 'denied_cmmc', dryRun: false, mode: 'live' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('denied_cmmc');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('live-mode CUI denial', () => {
      const ev = makeEvidence({ outcome: 'denied_cui', dryRun: false, mode: 'live' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('denied_cui');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('live-mode blocked_pending_approval', () => {
      const ev = makeEvidence({ outcome: 'blocked_pending_approval', dryRun: false, mode: 'live' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('blocked_pending_approval');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('live-mode approval_rejected', () => {
      const ev = makeEvidence({ outcome: 'approval_rejected', dryRun: false, mode: 'live' });
      const row = toContractRow(ev, makeOpts());
      expect(row.outcome).toBe('approval_rejected');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('optional fields threaded', () => {
      const ev = makeEvidence({ outcome: 'automated_success', dryRun: false, mode: 'live', complianceVerdict: 'SAT' });
      const row = toContractRow(ev, makeOpts({
        tenantSlug: 'contoso',
        tenantKind: 'gcc-high',
        requestorUPN: 'req@contoso.us',
        approverUPN: 'apr@contoso.us',
        approvalId: 'apr-001',
        correlationId: 'corr-001',
      }));
      expect(row.tenantSlug).toBe('contoso');
      expect(row.tenantKind).toBe('gcc-high');
      expect(row.requestorUPN).toBe('req@contoso.us');
      expect(row.approverUPN).toBe('apr@contoso.us');
      expect(row.approvalId).toBe('apr-001');
      expect(row.correlationId).toBe('corr-001');
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    // F-4 (ces-shared S2, 8697ecd): dry-run-mode denials/blocks now parse.
    it('dry-run-mode CMMC denial (F-4)', () => {
      const ev = makeEvidence({ outcome: 'denied_cmmc', dryRun: true, mode: 'dry_run' });
      const row = toContractRow(ev, makeOpts());
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('dry-run-mode blocked_pending_approval (F-4)', () => {
      const ev = makeEvidence({ outcome: 'blocked_pending_approval', dryRun: true, mode: 'dry_run' });
      const row = toContractRow(ev, makeOpts());
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('dry-run-mode CUI denial (F-4)', () => {
      const ev = makeEvidence({ outcome: 'denied_cui', dryRun: true, mode: 'dry_run' });
      const row = toContractRow(ev, makeOpts());
      expect(() => AdminOpsEvidenceSchema.parse(row)).not.toThrow();
    });

    it('dry-run-mode approval_rejected is refused (F-4: a rejection is a live-mode row)', () => {
      const ev = makeEvidence({ outcome: 'approval_rejected', dryRun: true, mode: 'dry_run' });
      const row = toContractRow(ev, makeOpts());
      expect(() => AdminOpsEvidenceSchema.parse(row)).toThrow(/dry-run row/);
    });
  });
});
