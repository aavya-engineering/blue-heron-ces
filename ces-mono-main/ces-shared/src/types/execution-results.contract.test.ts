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
  ExecutionResultsManifestSchema,
  ControlExecutionResultSchema,
  EXECUTION_RESULTS_CONTRACT_VERSION,
  SUPPORTED_EXECUTION_RESULTS_VERSIONS,
  summarizeResults,
  type ExecutionResultsManifest,
  type ControlExecutionResult,
} from './execution-results.contract.js';

function makeResult(overrides: Partial<ControlExecutionResult> = {}): ControlExecutionResult {
  return {
    controlId: 'AC.L2-3.1.1',
    directive: 'automated',
    verdict: 'sat',
    outcome: 'success',
    timestampUtc: '2026-09-26T12:00:00.000Z',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<ExecutionResultsManifest> = {}): ExecutionResultsManifest {
  return {
    contractVersion: EXECUTION_RESULTS_CONTRACT_VERSION,
    runId: 'run-001',
    planId: 'plan-001',
    cesId: 'ces-test-001',
    tenantSlug: 'contoso',
    completedAt: '2026-09-26T12:30:00.000Z',
    totalControls: 1,
    results: [makeResult()],
    ...overrides,
  };
}

describe('ControlExecutionResultSchema', () => {
  it('accepts a conforming result', () => {
    const result = ControlExecutionResultSchema.safeParse(makeResult());
    expect(result.success).toBe(true);
  });

  it('accepts all 4 verdict values', () => {
    for (const verdict of ['sat', 'not_sat', 'provisional', 'not_applicable'] as const) {
      const result = ControlExecutionResultSchema.safeParse(makeResult({ verdict }));
      expect(result.success, `verdict '${verdict}' should be accepted`).toBe(true);
    }
  });

  it('accepts all directive values', () => {
    const directives = [
      'automated', 'validation', 'manual_gate',
      'document-absence', 'document-prohibition', 'document-renderable',
      'inherit-fedramp', 'eo-tooled', 'nonstack', 'skip',
    ] as const;
    for (const directive of directives) {
      const result = ControlExecutionResultSchema.safeParse(makeResult({ directive }));
      expect(result.success, `directive '${directive}' should be accepted`).toBe(true);
    }
  });

  it('rejects an unknown verdict', () => {
    const result = ControlExecutionResultSchema.safeParse(makeResult({ verdict: 'SAT' as any }));
    expect(result.success).toBe(false);
  });
});

describe('ExecutionResultsManifestSchema', () => {
  it('accepts a conforming manifest', () => {
    const result = ExecutionResultsManifestSchema.safeParse(makeManifest());
    expect(result.success).toBe(true);
  });

  it('rejects unknown contractVersion', () => {
    const result = ExecutionResultsManifestSchema.safeParse(
      makeManifest({ contractVersion: '99.0.0' as any })
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing planId', () => {
    const { planId, ...rest } = makeManifest();
    const result = ExecutionResultsManifestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('preserves cesId', () => {
    const m = ExecutionResultsManifestSchema.parse(makeManifest({ cesId: 'ces-abc' }));
    expect(m.cesId).toBe('ces-abc');
  });
});

describe('summarizeResults', () => {
  it('counts verdicts correctly', () => {
    const manifest = makeManifest({
      totalControls: 4,
      results: [
        makeResult({ controlId: 'AC.L2-3.1.1', verdict: 'sat' }),
        makeResult({ controlId: 'AC.L2-3.1.2', verdict: 'sat' }),
        makeResult({ controlId: 'IA.L2-3.5.3', verdict: 'not_sat' }),
        makeResult({ controlId: 'PE.L2-3.10.3', verdict: 'not_applicable' }),
      ],
    });
    const summary = summarizeResults(manifest);
    expect(summary.sat).toBe(2);
    expect(summary.notSat).toBe(1);
    expect(summary.notApplicable).toBe(1);
    expect(summary.provisional).toBe(0);
    expect(summary.total).toBe(4);
  });
});

describe('FX-SH3 executablePlanId (contract 1.1.0, REQ-ces-shared-execution-results-executable-plan-id)', () => {
  it('current version is 1.1.0 and 1.0.0 remains supported', () => {
    expect(EXECUTION_RESULTS_CONTRACT_VERSION).toBe('1.1.0');
    expect([...SUPPORTED_EXECUTION_RESULTS_VERSIONS]).toEqual(['1.0.0', '1.1.0']);
  });

  it('a manifest with executablePlanId parses and the field survives parse()', () => {
    const parsed = ExecutionResultsManifestSchema.parse(
      makeManifest({ planId: 'plan-001', executablePlanId: 'translated-plan-001' }),
    );
    expect(parsed.planId).toBe('plan-001');
    expect(parsed.executablePlanId).toBe('translated-plan-001');
  });

  it('a 1.0.0 manifest without executablePlanId still parses', () => {
    const m = makeManifest({ contractVersion: '1.0.0' });
    delete (m as any).executablePlanId;
    const r = ExecutionResultsManifestSchema.safeParse(m);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.executablePlanId).toBeUndefined();
  });

  it('rejects an empty executablePlanId', () => {
    expect(ExecutionResultsManifestSchema.safeParse(makeManifest({ executablePlanId: '' })).success).toBe(false);
  });
});
