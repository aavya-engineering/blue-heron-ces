// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W3: DriftDetector. Unit cases (regression / improvement / decline / no change,
 * tier and source attribution, objectives from the ledger, persistence) and the run-25 replay:
 * the stored snapshots of the three E7 passes and the forced E8F pass (scrubbed fixture).
 * V43a: E8F's regressions are exactly SC.L2-3.13.15. V43b: no drift between the E7 passes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import { detectDrift, deciderOf, isEmptyDrift, writeDrift, readDrift, driftPath, summarizeDrift, pickBaseline } from '../../../src/eo/assessment/DriftDetector';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';

type Ctl = { control_id: string; status: 'met' | 'not_met' | 'partial' | 'not_assessed'; statusRationale?: string; sources?: any[] };

function snap(id: string, controls: Ctl[], generatedAt = '2026-10-28T02:44:48.000Z'): AssessmentSnapshot {
  return {
    snapshotId: id, tenantId: 'tenant-a', generatedAt,
    controls: controls.map(c => ({
      control_id: c.control_id, nist_ref: c.control_id.replace(/^[A-Z]+\.L\d-/, ''), status: c.status, classification: 'automated',
      statusRationale: c.statusRationale ?? 'No source has an opinion (every source is unread or display-only)',
      sources: c.sources ?? [], last_assessed: generatedAt, signals: [], evidenceArtifactIds: [],
    })) as unknown as AssessmentSnapshot['controls'],
    sources_merged: [], sprs_score: 0, controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0,
  } as AssessmentSnapshot;
}

const T2_EXISTS = 'Tier 2 (live read) decides: discovery/exists: anti-spam policies found';
const T2_PRESENCE = "Tier 2 (live read) decides met (presence only: 'securityAlerts' was read (/security/alerts_v2) and returned 2 objects; 'collect.securityAlerts' was read (/security/alerts_v2) and returned 2 objects): discovery/exists: Email protection configured";
const T1_NOTSAT = 'Tier 1 (current-run Stamper NOT_SAT) decides: evidence_import/missing: Create Anti-Spam Inbound Filter Rule';
const T3_SAT = 'Tier 3 (state-verified execution verdict) decides: evidence_import/imported: Create CUI Security Group; evidence_import/imported: Add User';
const T4_SAT = 'Tier 4 (evidence-only Stamper SAT) decides; state not verified: evidence_import/imported: Verify Authentication Methods Policy (state not verified)';

describe('deciderOf: the deciding tier and source from statusRationale', () => {
  it.each([
    [T2_EXISTS, 2, 'discovery/exists'],
    [T2_PRESENCE, 2, 'discovery/exists'],
    [T1_NOTSAT, 1, 'evidence_import/missing'],
    [T3_SAT, 3, 'evidence_import/imported'],
    [T4_SAT, 4, 'evidence_import/imported'],
    ['Tier 5 (EO blob capture; ranks below every Stamper verdict and live read) decides: blob_artifact/exists: x', 5, 'blob_artifact/exists'],
    ['No source has an opinion (every source is unread or display-only)', null, null],
    [undefined, null, null],
  ])('%s', (r, tier, source) => {
    expect(deciderOf(r as string | undefined)).toEqual({ tier, source });
  });
});

describe('detectDrift: classification', () => {
  const prev = snap('s1', [
    { control_id: 'SC.L2-3.13.15', status: 'met', statusRationale: T2_PRESENCE },
    { control_id: 'RA.L2-3.11.3', status: 'not_met', statusRationale: 'Tier 2 (live read) decides: discovery/missing: x' },
    { control_id: 'AU.L2-3.3.6', status: 'not_assessed' },
    { control_id: 'IR.L2-3.6.1', status: 'met', statusRationale: T3_SAT },
    { control_id: 'AC.L1-3.1.2', status: 'met', statusRationale: T3_SAT },
  ]);

  it('regression (met -> worse), improvement, decline and tier-only no_change, each with tier and source on both sides', () => {
    const cur = snap('s2', [
      { control_id: 'SC.L2-3.13.15', status: 'not_met', statusRationale: T1_NOTSAT },          // regression
      { control_id: 'RA.L2-3.11.3', status: 'not_assessed' },                                 // improvement (not_met -> not_assessed)
      { control_id: 'AU.L2-3.3.6', status: 'not_met', statusRationale: T1_NOTSAT },             // decline (not from met)
      { control_id: 'IR.L2-3.6.1', status: 'met', statusRationale: T2_EXISTS },                 // no_change, Tier 3 -> 2
      { control_id: 'AC.L1-3.1.2', status: 'met', statusRationale: T3_SAT },                    // identical: not listed
    ], '2026-10-28T02:46:30.000Z');
    const d = detectDrift({ previous: prev, current: cur });
    expect(d.baseline).toBe(false);
    expect(d.previousSnapshotId).toBe('s1');
    expect(d.controls.map(c => [c.controlId, c.change])).toEqual([
      ['AU.L2-3.3.6', 'decline'],
      ['IR.L2-3.6.1', 'no_change'],
      ['RA.L2-3.11.3', 'improvement'],
      ['SC.L2-3.13.15', 'regression'],
    ]);
    expect(d.regressions).toEqual([{
      controlId: 'SC.L2-3.13.15', change: 'regression',
      previous: { status: 'met', tier: 2, source: 'discovery/exists' },
      current: { status: 'not_met', tier: 1, source: 'evidence_import/missing' },
    }]);
    const ir = d.controls.find(c => c.controlId === 'IR.L2-3.6.1')!;
    expect([ir.previous.tier, ir.current.tier, ir.previous.source, ir.current.source]).toEqual([3, 2, 'evidence_import/imported', 'discovery/exists']);
    expect(d.summary).toMatchObject({ controlsCompared: 5, regressions: 1, improvements: 1, declines: 1, tierOrSourceOnly: 1 });
    expect(isEmptyDrift(d)).toBe(false);
  });

  it('met -> partial and met -> not_assessed are regressions too', () => {
    const cur = snap('s2', [
      { control_id: 'SC.L2-3.13.15', status: 'partial', statusRationale: T2_EXISTS },
      { control_id: 'RA.L2-3.11.3', status: 'not_met', statusRationale: 'Tier 2 (live read) decides: discovery/missing: x' },
      { control_id: 'AU.L2-3.3.6', status: 'not_assessed' },
      { control_id: 'IR.L2-3.6.1', status: 'not_assessed' },
      { control_id: 'AC.L1-3.1.2', status: 'met', statusRationale: T3_SAT },
    ]);
    expect(detectDrift({ previous: prev, current: cur }).regressions.map(r => r.controlId)).toEqual(['IR.L2-3.6.1', 'SC.L2-3.13.15']);
  });

  it('identical snapshots: no change, empty record', () => {
    const d = detectDrift({ previous: prev, current: { ...prev, snapshotId: 's2' } });
    expect(isEmptyDrift(d)).toBe(true);
    expect(d.regressions).toEqual([]);
    expect(d.summary.controlsCompared).toBe(5);
  });

  it('no previous snapshot: a baseline record with nothing compared', () => {
    const d = detectDrift({ previous: null, current: prev });
    expect(d).toMatchObject({ baseline: true, previousSnapshotId: null, regressions: [], controls: [], objectives: [] });
    expect(d.summary.controlsCompared).toBe(0);
  });
});

describe('detectDrift: objectives from the determination ledger', () => {
  const CATALOG = [
    { objectiveId: 'SC.L2-3.13.15[a]', controlId: 'SC.L2-3.13.15', description: 'authenticity is protected', methods: ['test'] },
    { objectiveId: 'PS.L2-3.9.1[a]', controlId: 'PS.L2-3.9.1', description: 'individuals are screened', methods: ['examine'] },
  ];
  const ledgerOf = (s: AssessmentSnapshot, ps: 'met' | 'not_met') => buildDeterminationLedger({
    tenantId: s.tenantId, generatedAt: s.generatedAt, snapshot: s, objectivesCatalog: CATALOG, sprsWeights: { '3.13.15': 5, '3.9.1': 3 },
    manualControlStatus: { 'PS.L2-3.9.1': { status: ps, source: 'personnel', rationale: 'screening' } },
  });

  it('an objective regression carries the control tier on digital-signal objectives; a personnel objective carries none', () => {
    const p = snap('s1', [{ control_id: 'SC.L2-3.13.15', status: 'met', statusRationale: T2_EXISTS }, { control_id: 'PS.L2-3.9.1', status: 'not_assessed' }]);
    const c = snap('s2', [{ control_id: 'SC.L2-3.13.15', status: 'not_met', statusRationale: T1_NOTSAT }, { control_id: 'PS.L2-3.9.1', status: 'not_assessed' }]);
    const d = detectDrift({ previous: p, current: c, previousLedger: ledgerOf(p, 'not_met'), currentLedger: ledgerOf(c, 'met') });
    expect(d.objectives).toEqual([
      { objectiveId: 'PS.L2-3.9.1[a]', controlId: 'PS.L2-3.9.1', change: 'improvement',
        previous: { status: 'other_than_satisfied', source: 'personnel', tier: null }, current: { status: 'satisfied', source: 'personnel', tier: null } },
      { objectiveId: 'SC.L2-3.13.15[a]', controlId: 'SC.L2-3.13.15', change: 'regression',
        previous: { status: 'satisfied', source: 'digital-signal', tier: 2 }, current: { status: 'other_than_satisfied', source: 'digital-signal', tier: 1 } },
    ]);
    expect(d.summary).toMatchObject({ objectivesCompared: 2, objectiveRegressions: 1, objectiveImprovements: 1 });
    // The alert list stays control-level.
    expect(d.regressions.map(r => r.controlId)).toEqual(['SC.L2-3.13.15']);
  });

  it('without both ledgers, objectives are not compared', () => {
    const p = snap('s1', [{ control_id: 'SC.L2-3.13.15', status: 'met', statusRationale: T2_EXISTS }]);
    const d = detectDrift({ previous: p, current: { ...p, snapshotId: 's2' }, previousLedger: null, currentLedger: ledgerOf(p, 'met') });
    expect(d.summary.objectivesCompared).toBe(0);
    expect(d.objectives).toEqual([]);
  });
});

describe('drift.json beside the snapshot', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-drift-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('is written to assessments/<snapshotId>/drift.json and read back for its own tenant only', () => {
    const d = detectDrift({ previous: null, current: snap('0bed3302-a912-472a-86e5-de992e55a80f', []) });
    const p = writeDrift(tmp, d);
    expect(p).toBe(path.join(tmp, 'assessments', '0bed3302-a912-472a-86e5-de992e55a80f', 'drift.json'));
    expect(readDrift(tmp, d.snapshotId, 'tenant-a')).toEqual(d);
    expect(readDrift(tmp, d.snapshotId, 'tenant-b')).toBeNull();
    expect(readDrift(tmp, 'missing', 'tenant-a')).toBeNull();
  });

  it('refuses snapshot ids that are not plain folder names', () => {
    expect(driftPath(tmp, '../x')).toBeNull();
    expect(driftPath(tmp, '')).toBeNull();
    expect(() => writeDrift(tmp, detectDrift({ previous: null, current: snap('a/b', []) }))).toThrow(/invalid snapshot id/);
  });

  it('the SSE summary carries ids, counts and the regression list only', () => {
    const d = detectDrift({ previous: snap('s1', [{ control_id: 'SC.L2-3.13.15', status: 'met', statusRationale: T2_EXISTS }]),
      current: snap('s2', [{ control_id: 'SC.L2-3.13.15', status: 'not_met', statusRationale: T1_NOTSAT }]) });
    const s = summarizeDrift(d);
    expect(Object.keys(s).sort()).toEqual(['baseline', 'empty', 'previousSnapshotId', 'regressions', 'summary']);
    expect(s.regressions.map(r => r.controlId)).toEqual(['SC.L2-3.13.15']);
  });
});

describe('run 25 replay (stored snapshots, scrubbed): V43a and V43b', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/drift/run25-snapshots.json'), 'utf-8'));
  const S = (k: string) => fx.snapshots[k] as AssessmentSnapshot;
  const ledger = (s: AssessmentSnapshot) => buildDeterminationLedger({ tenantId: s.tenantId, generatedAt: s.generatedAt, snapshot: s });
  const drift = (a: string, b: string) => detectDrift({ previous: S(a), current: S(b), previousLedger: ledger(S(a)), currentLedger: ledger(S(b)) });

  it('fixture counts match the run (81/5/0/24 on the E7 passes, 80/6/0/24 on E8F)', () => {
    for (const k of ['r25-p1', 'r25-p2', 'r25-p3']) {
      expect([S(k).controls_met, S(k).controls_not_met, S(k).controls_partial, S(k).controls_not_assessed]).toEqual([81, 5, 0, 24]);
    }
    expect([S('r25-e8f').controls_met, S('r25-e8f').controls_not_met]).toEqual([80, 6]);
  });

  it('V43b: E7 passes 2 and 3 show no drift against the pass before (controls and objectives)', () => {
    for (const [a, b] of [['r25-p1', 'r25-p2'], ['r25-p2', 'r25-p3']]) {
      const d = drift(a, b);
      expect(isEmptyDrift(d)).toBe(true);
      expect(d.regressions).toEqual([]);
      expect(d.summary.objectivesCompared).toBe(320);
    }
  });

  it('V43a: E8F against E7 pass 3 regresses exactly SC.L2-3.13.15 (Tier 2 live read -> Tier 1 Stamper NOT_SAT)', () => {
    const d = drift('r25-p3', 'r25-e8f');
    expect(d.regressions).toEqual([{
      controlId: 'SC.L2-3.13.15', change: 'regression',
      previous: { status: 'met', tier: 2, source: 'discovery/exists' },
      current: { status: 'not_met', tier: 1, source: 'evidence_import/missing' },
    }]);
    expect(d.controls).toHaveLength(1);
    expect(d.objectives.map(o => [o.objectiveId, o.change])).toEqual([['SC.L2-3.13.15[a]', 'regression']]);
  });

  it('E7 pass 1 against the previous run\'s E8F: improvements and tier moves, no regression', () => {
    const d = drift('r24-e8f', 'r25-p1');
    expect(d.regressions).toEqual([]);
    expect(d.controls.map(c => [c.controlId, c.change, c.previous.tier, c.current.tier])).toEqual([
      ['IR.L2-3.6.1', 'no_change', 3, 2],
      ['RA.L2-3.11.3', 'improvement', 2, null],
      ['SC.L2-3.13.15', 'improvement', 1, 2],
      ['SI.L2-3.14.7', 'no_change', 4, 2],
    ]);
  });
});

describe('drift baseline: forced-failure snapshots are skipped (S1 run 28)', () => {
  const forced = (x: AssessmentSnapshot) => ({ ...x, metadata: { forced: true } });
  const e7 = snap('run27-e7-pass3', [{ control_id: 'MP.L2-3.8.9', status: 'not_met', statusRationale: T1_NOTSAT }], '2026-10-27T10:00:00.000Z');
  const e8f = forced(snap('run27-e8f', [{ control_id: 'MP.L2-3.8.9', status: 'met', statusRationale: T3_SAT }], '2026-10-27T10:10:00.000Z'));

  it('picks the newest non-forced snapshot when the newest is forced, in any input order', () => {
    expect(pickBaseline([e8f, e7])?.snapshotId).toBe('run27-e7-pass3');
    expect(pickBaseline([e7, e8f])?.snapshotId).toBe('run27-e7-pass3');
  });

  it('none, or only forced ones: null (the drift record is a baseline)', () => {
    expect(pickBaseline([])).toBeNull();
    expect(pickBaseline([e8f])).toBeNull();
    expect(detectDrift({ previous: pickBaseline([]), current: e7 })).toMatchObject({ baseline: true, previousSnapshotId: null, regressions: [] });
  });

  it("the next run's pass 1 against that baseline shows no regression for a control not met in both E7s", () => {
    const pass1 = snap('run28-e7-pass1', [{ control_id: 'MP.L2-3.8.9', status: 'not_met', statusRationale: T1_NOTSAT }], '2026-10-28T10:00:00.000Z');
    const withForced = detectDrift({ previous: e8f, current: pass1 });
    expect(withForced.regressions.map(r => r.controlId)).toEqual(['MP.L2-3.8.9']);   // the run-28 false regression
    const d = detectDrift({ previous: pickBaseline([e7, e8f]), current: pass1 });
    expect(d).toMatchObject({ previousSnapshotId: 'run27-e7-pass3', regressions: [] });
    expect(isEmptyDrift(d)).toBe(true);
  });
});
