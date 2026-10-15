// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * DeterminationLedger — the unified per-objective status spine.
 * Verifies source precedence, control rollup, and deterministic deficiency keys.
 */
import { describe, test, expect } from '@jest/globals';
import { buildDeterminationLedger, type BuildLedgerInput } from '../../src/eo/assessment/DeterminationLedger.js';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';

// A small injected catalog so the test is deterministic (not the full 320).
const CATALOG = [
  { objectiveId: 'AC.L2-3.1.7[a]', controlId: 'AC.L2-3.1.7', description: 'privileged functions are defined', methods: ['examine', 'interview', 'test'] },
  { objectiveId: 'AC.L2-3.1.7[b]', controlId: 'AC.L2-3.1.7', description: 'non-privileged users are defined', methods: ['examine'] },
  { objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1', description: 'authorized users are identified', methods: ['examine'] },
  { objectiveId: 'AT.L2-3.2.1[a]', controlId: 'AT.L2-3.2.1', description: 'managers are made aware', methods: ['interview'] },
  { objectiveId: 'PE.L1-3.10.1[a]', controlId: 'PE.L1-3.10.1', description: 'physical access is limited', methods: ['examine'] },
];
const WEIGHTS: Record<string, number> = { '3.1.7': 5, '3.1.1': 5, '3.2.1': 3, '3.10.1': 1 };

function snapshot(controls: Array<{ control_id: string; status: 'met' | 'not_met' | 'not_assessed' }>): AssessmentSnapshot {
  return {
    snapshotId: 's1', tenantId: 't', generatedAt: '2026-07-03T00:00:00Z',
    controls: controls.map(c => ({
      control_id: c.control_id, nist_ref: c.control_id, status: c.status, classification: 'automated',
      sources: [], last_assessed: '2026-07-03T00:00:00Z', signals: [], evidenceArtifactIds: [],
      automationSource: 'graph', lastFetchedAt: '2026-07-03T00:00:00Z',
    })) as AssessmentSnapshot['controls'],
    sources_merged: [], sprs_score: 0, controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0,
  };
}

const base = (over: Partial<BuildLedgerInput>): BuildLedgerInput => ({
  tenantId: 't', generatedAt: '2026-07-03T00:00:00Z',
  snapshot: snapshot([{ control_id: 'AC.L2-3.1.7', status: 'not_met' }, { control_id: 'AC.L1-3.1.1', status: 'met' }]),
  objectivesCatalog: CATALOG, sprsWeights: WEIGHTS, ...over,
});

describe('DeterminationLedger source precedence', () => {
  test('tenant-suite evidence overrides inherited digital control status per objective', () => {
    const ledger = buildDeterminationLedger(base({
      // control AC.L2-3.1.7 is not_met, but the suite examined [a] as satisfied
      objectiveEvidence: { 'AC.L2-3.1.7[a]': 'satisfied' },
    }));
    const a = ledger.objectives.find(o => o.objectiveId === 'AC.L2-3.1.7[a]')!;
    const b = ledger.objectives.find(o => o.objectiveId === 'AC.L2-3.1.7[b]')!;
    expect(a.status).toBe('satisfied');
    expect(a.source).toBe('tenant-suite');
    expect(b.status).toBe('other_than_satisfied');   // no suite evidence -> inherits not_met
    expect(b.source).toBe('digital-signal');
  });

  test('non-digital manual status drives a control with no digital signal', () => {
    const ledger = buildDeterminationLedger(base({
      manualControlStatus: { 'AT.L2-3.2.1': { status: 'not_met', source: 'training', rationale: '2/5 personnel overdue' } },
    }));
    const at = ledger.objectives.find(o => o.controlId === 'AT.L2-3.2.1')!;
    expect(at.status).toBe('other_than_satisfied');
    expect(at.source).toBe('training');
    expect(at.rationale).toMatch(/overdue/);
  });

  test('disposition wins over everything and is not a deficiency', () => {
    const ledger = buildDeterminationLedger(base({
      dispositions: { 'PE.L1-3.10.1': 'ATTEST' },
      objectiveEvidence: { 'PE.L1-3.10.1[a]': 'other_than_satisfied' },   // should be ignored
    }));
    const pe = ledger.objectives.find(o => o.controlId === 'PE.L1-3.10.1')!;
    expect(pe.status).toBe('satisfied');
    expect(pe.source).toBe('disposition');
    expect(ledger.deficiencies.some(d => d.controlId === 'PE.L1-3.10.1')).toBe(false);
  });
});

describe('DeterminationLedger rollup + deficiencies', () => {
  test('control rollup: any other_than_satisfied -> not_met; all satisfied -> met; mix sat/na -> partial', () => {
    const ledger = buildDeterminationLedger(base({
      objectiveEvidence: { 'AC.L2-3.1.7[a]': 'satisfied' },  // [b] inherits not_met
    }));
    expect(ledger.controls.find(c => c.controlId === 'AC.L2-3.1.7')!.status).toBe('not_met');
    expect(ledger.controls.find(c => c.controlId === 'AC.L1-3.1.1')!.status).toBe('met');
  });

  test('deficiency keys are the stable objectiveId (reconcilable across runs)', () => {
    const ledger = buildDeterminationLedger(base({}));
    const defKeys = ledger.deficiencies.map(d => d.key).sort();
    // AC.L2-3.1.7 not_met -> both objectives deficient; AT.L2-3.2.1 + PE not_assessed (no source) deficient too
    expect(defKeys).toContain('AC.L2-3.1.7[a]');
    expect(defKeys).toContain('AC.L2-3.1.7[b]');
    for (const d of ledger.deficiencies) expect(d.key).toBe(d.objectiveId);   // deterministic, not a UUID
  });

  test('5-point deficiencies are counted as certification blockers', () => {
    const ledger = buildDeterminationLedger(base({}));
    // AC.L2-3.1.7 (weight 5) not_met -> its 2 deficient objectives are cert-blockers
    const blockers = ledger.deficiencies.filter(d => d.noPoam);
    expect(blockers.length).toBeGreaterThanOrEqual(2);
    expect(ledger.summary.certificationBlockers).toBe(blockers.length);
    expect(blockers.every(d => d.weight >= 5)).toBe(true);
  });

  test('summary totals are internally consistent', () => {
    const ledger = buildDeterminationLedger(base({ objectiveEvidence: { 'AC.L2-3.1.7[a]': 'satisfied' } }));
    const s = ledger.summary;
    expect(s.objectivesTotal).toBe(CATALOG.length);
    expect(s.objectivesSatisfied + s.objectivesOther + s.objectivesNotAssessed).toBe(CATALOG.length);
  });
});
