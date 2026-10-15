// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-15 (area 3: auto-score) — pins the current NIST SP 800-30 Rev 1 composite
 * risk matrix and tests autoScoreRegister against real RiskAssessmentStore-backed fixtures
 * for every source type the code derives scoring for.
 *
 * NIST matrix check: grepped this repo (docs/, src/) for an actual copy of NIST SP 800-30
 * Rev 1 Appendix I / Table I-2 to cross-reference mechanically -- none exists (only code
 * comments/templates that CITE the table, not its contents). The code's 5x5
 * COMPOSITE_RISK_MATRIX was compared against Table I-2 from the assistant's own knowledge
 * of the published standard (each likelihood row read as VL/VL/L/L/M, VL/L/L/M/M, L/L/M/M/H,
 * L/M/M/H/VH, M/M/H/VH/VH for very_low..very_high likelihood in turn) and appears to match --
 * but that recall is NOT independently verifiable against an in-repo source, so this is
 * reported as "no defect found, unverified against a primary copy" rather than a confirmed
 * pass. Recommend a founder/SME spot-check against the actual NIST SP 800-30 Rev 1 PDF if
 * certainty beyond model recall is needed. The matrix is pinned as-is either way, per
 * instructions ("if it looks wrong, report it; do not redesign it").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { computeCompositeRisk, NIST_SP_800_30_SCALE } from '../../../src/eo/risk-assessment/NistScoringMatrix';
import {
  autoScoreRegister,
  deriveImpactFromMaxScore,
  deriveLikelihoodFromGap,
} from '../../../src/eo/risk-assessment/SecureScoreAutoScorer';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';
import type { RiskEntry } from '../../../src/shared/types/risk-assessment.types';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';

describe('NIST SP 800-30 Rev 1 composite risk matrix (pinned)', () => {
  it('matches Table I-2 exactly for every likelihood/impact cell', () => {
    const expected: Record<string, string[]> = {
      very_low: ['very_low', 'very_low', 'low', 'low', 'moderate'],
      low: ['very_low', 'low', 'low', 'moderate', 'moderate'],
      moderate: ['low', 'low', 'moderate', 'moderate', 'high'],
      high: ['low', 'moderate', 'moderate', 'high', 'very_high'],
      very_high: ['moderate', 'moderate', 'high', 'very_high', 'very_high'],
    };
    const scale = ['very_low', 'low', 'moderate', 'high', 'very_high'] as const;
    for (const likelihood of scale) {
      for (let i = 0; i < scale.length; i++) {
        const impact = scale[i];
        expect(computeCompositeRisk(likelihood, impact)).toBe(expected[likelihood][i]);
      }
    }
  });

  it('exposes the same scale via NIST_SP_800_30_SCALE for config storage', () => {
    expect(NIST_SP_800_30_SCALE.methodology).toBe('nist_sp_800_30_rev1');
    expect(NIST_SP_800_30_SCALE.likelihoodScale).toEqual(scaleOrder());
    expect(NIST_SP_800_30_SCALE.impactScale).toEqual(scaleOrder());
  });
});

function scaleOrder() {
  return ['very_low', 'low', 'moderate', 'high', 'very_high'];
}

describe('deriveImpactFromMaxScore / deriveLikelihoodFromGap (secure_score heuristic)', () => {
  it('impact bands by maxScore', () => {
    expect(deriveImpactFromMaxScore(10)).toBe('very_high');
    expect(deriveImpactFromMaxScore(7)).toBe('high');
    expect(deriveImpactFromMaxScore(5)).toBe('moderate');
    expect(deriveImpactFromMaxScore(3)).toBe('low');
    expect(deriveImpactFromMaxScore(1)).toBe('very_low');
    expect(deriveImpactFromMaxScore(undefined)).toBe('moderate');
  });

  it('likelihood bands by implementation gap ratio', () => {
    expect(deriveLikelihoodFromGap(0, 10)).toBe('very_high'); // gap 1.0
    expect(deriveLikelihoodFromGap(1, 10)).toBe('very_high'); // gap 0.9
    expect(deriveLikelihoodFromGap(3, 10)).toBe('high'); // gap 0.7
    expect(deriveLikelihoodFromGap(5, 10)).toBe('moderate'); // gap 0.5
    expect(deriveLikelihoodFromGap(7, 10)).toBe('low'); // gap 0.3
    expect(deriveLikelihoodFromGap(9, 10)).toBe('very_low'); // gap 0.1
    expect(deriveLikelihoodFromGap(undefined, 10)).toBe('moderate');
    expect(deriveLikelihoodFromGap(1, 0)).toBe('moderate'); // maxScore 0 guarded
  });
});

describe('autoScoreRegister', () => {
  let tmpDir: string;
  let store: RiskAssessmentStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  const tenantA = 'autoscore-tenant-a';
  const tenantB = 'autoscore-tenant-b';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-autoscore-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    store = new RiskAssessmentStore(tmpDir);
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const base = (over: Partial<RiskEntry>): Omit<RiskEntry, 'id' | 'firstIdentified'> => ({
    threatSource: 'non_adversarial',
    threatEvent: 'event',
    vulnerability: { type: 'organizational', description: 'vuln' },
    affectedAssets: [],
    affectedOperations: [],
    treatmentRecommendation: 'mitigate',
    treatmentStatus: 'recommended',
    lastReviewed: '2026-01-01T00:00:00Z',
    nextReviewDue: '2027-01-01T00:00:00Z',
    source: { type: 'manual', description: 'x' },
    ...over,
  });

  it('scores a secure_score entry from maxScore/currentScore and writes an audit note', () => {
    const entry = store.addEntry(tenantA, base({
      source: { type: 'secure_score', controlName: 'MFA', score: 1, maxScore: 10 }, // gap 0.9 -> very_high likelihood; maxScore 10 -> very_high impact
    }));
    const result = autoScoreRegister(store, tenantA);
    expect(result.scored).toBe(1);
    expect(result.skipped).toBe(0);

    const scored = store.getEntry(tenantA, entry.id)!;
    expect(scored.likelihood).toBe('very_high');
    expect(scored.impact).toBe('very_high');
    expect(scored.compositeRisk).toBe('very_high');
    expect(scored.notes).toContain('AUTO-SCORED');
  });

  it('scores defender_for_cloud entries by severity', () => {
    const entry = store.addEntry(tenantA, base({
      source: { type: 'defender_for_cloud', alertId: 'a1', severity: 'high' },
    }));
    autoScoreRegister(store, tenantA);
    const scored = store.getEntry(tenantA, entry.id)!;
    expect(scored.likelihood).toBe('high');
    expect(scored.impact).toBe('high');
    expect(scored.compositeRisk).toBe('high');
  });

  it('scores plan_output NOT MET entries as high-likelihood/moderate-impact', () => {
    const entry = store.addEntry(tenantA, base({
      source: { type: 'plan_output', controlId: 'AC.L2-3.1.1', status: 'NOT MET' },
    }));
    autoScoreRegister(store, tenantA);
    const scored = store.getEntry(tenantA, entry.id)!;
    expect(scored.likelihood).toBe('high');
    expect(scored.impact).toBe('moderate');
    expect(scored.compositeRisk).toBe('moderate');
  });

  it('skips manual entries (left for a human to score)', () => {
    store.addEntry(tenantA, base({ source: { type: 'manual', description: 'human-authored' } }));
    const result = autoScoreRegister(store, tenantA);
    expect(result.scored).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips entries already fully scored (does not re-score)', () => {
    const entry = store.addEntry(tenantA, base({
      source: { type: 'defender_for_cloud', alertId: 'a2', severity: 'low' },
      likelihood: 'high', impact: 'high', compositeRisk: 'high',
    }));
    const result = autoScoreRegister(store, tenantA);
    expect(result.skipped).toBe(1);
    expect(result.scored).toBe(0);
    expect(store.getEntry(tenantA, entry.id)!.compositeRisk).toBe('high'); // unchanged
  });

  // --- DEFECT FIX: the sentinel_alert VulnerabilitySource schema had no `severity` field
  // (only incidentId/title), yet SecureScoreAutoScorer's deriveScoring read
  // `(source as any).severity` for sentinel_alert entries. That field was never populated
  // by VulnerabilityIngestionService.ingestSentinelIncidents either (source built as
  // {type, incidentId, title} only), so severity was ALWAYS undefined by construction and
  // every Sentinel-sourced entry silently auto-scored moderate/moderate regardless of the
  // real incident severity. Fixed: added optional `severity` to the sentinel_alert variant
  // in both shared/types/risk-assessment.types.ts and server/validation-schemas.ts's
  // duplicate schema, populated at ingest (VulnerabilityIngestionService.ts), and
  // deriveScoring now reads the typed field (no more `as any`). Fail-first proven: before
  // the fix this same assertion (severity: 'high' -> very_high/very_high) returned
  // moderate/moderate.
  it('a high-severity sentinel_alert entry scores very_high/very_high, not moderate/moderate', () => {
    const entry = store.addEntry(tenantA, base({
      threatSource: 'adversarial',
      source: { type: 'sentinel_alert', incidentId: 'inc-1', title: 'Critical incident', severity: 'high' },
    }));
    autoScoreRegister(store, tenantA);
    const scored = store.getEntry(tenantA, entry.id)!;
    expect(scored.likelihood).toBe('very_high');
    expect(scored.impact).toBe('very_high');
    expect(scored.compositeRisk).toBe('very_high');
  });

  it('a sentinel_alert entry with no severity still falls back to moderate/moderate (unknown severity default)', () => {
    const entry = store.addEntry(tenantA, base({
      threatSource: 'adversarial',
      source: { type: 'sentinel_alert', incidentId: 'inc-2', title: 'Unknown severity incident' },
    }));
    autoScoreRegister(store, tenantA);
    const scored = store.getEntry(tenantA, entry.id)!;
    expect(scored.likelihood).toBe('moderate');
    expect(scored.impact).toBe('moderate');
  });

  it('tenant isolation: auto-scoring tenant A does not touch tenant B entries', () => {
    const entryA = store.addEntry(tenantA, base({ source: { type: 'defender_for_cloud', alertId: 'a3', severity: 'high' } }));
    const entryB = store.addEntry(tenantB, base({ source: { type: 'defender_for_cloud', alertId: 'a4', severity: 'high' } }));
    autoScoreRegister(store, tenantA);
    expect(store.getEntry(tenantA, entryA.id)!.compositeRisk).toBe('high');
    expect(store.getEntry(tenantB, entryB.id)!.compositeRisk).toBeUndefined();
  });
});
