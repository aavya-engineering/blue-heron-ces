// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W3 (B19): evidence freshness per objective. Thresholds per family (fresh <= 1 x
 * cadence < aging <= 2 x cadence < stale), the Stamper-file floor, and the ledger's B19 rule: a
 * satisfied objective whose dated evidence is all stale becomes not_assessed with the age printed.
 * Ends with the run-25 E8F snapshot: same-day, nothing demoted; the same snapshot read 2 days later
 * demotes exactly the satisfied objectives that rest on Stamper files alone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import {
  FAMILY_CADENCE_MINUTES, DEFAULT_CADENCE_MINUTES, STAMPER_FILE_FLOOR_MINUTES,
  cadenceMinutesFor, classifyAge, evidenceFreshness, formatAge, familyOf,
} from '../../../src/eo/assessment/EvidenceFreshness';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';
import type { EvidenceRef } from '../../../src/eo/evidence/store/types';

const AT = '2026-10-28T12:00:00.000Z';
const minus = (minutes: number): string => new Date(Date.parse(AT) - minutes * 60000).toISOString();

describe('cadence per family (plan §5) and thresholds', () => {
  it('family cadences and the defaults', () => {
    expect(FAMILY_CADENCE_MINUTES).toEqual({ AC: 15, AU: 60, IR: 15, SI: 1440, RA: 1440, CM: 1440 });
    expect(DEFAULT_CADENCE_MINUTES).toBe(1440);
    expect(STAMPER_FILE_FLOOR_MINUTES).toBe(1440);
    expect(familyOf('AC.L2-3.1.7[a]')).toBe('AC');
    expect(cadenceMinutesFor('AC.L2-3.1.7[a]', 'evidence-store')).toBe(15);
    expect(cadenceMinutesFor('AC.L2-3.1.7[a]', 'stamper-file')).toBe(1440);   // floor
    expect(cadenceMinutesFor('AU.L2-3.3.1[a]', 'evidence-store')).toBe(60);
    expect(cadenceMinutesFor('SC.L2-3.13.15[a]', 'evidence-store')).toBe(1440); // no §5 collector: daily
  });

  it.each([
    // [objective, minutes old, basis, expected]
    ['AC.L2-3.1.7[a]', 15, 'evidence-store', 'fresh'],
    ['AC.L2-3.1.7[a]', 16, 'evidence-store', 'aging'],
    ['AC.L2-3.1.7[a]', 30, 'evidence-store', 'aging'],
    ['AC.L2-3.1.7[a]', 31, 'evidence-store', 'stale'],
    ['AU.L2-3.3.1[a]', 60, 'evidence-store', 'fresh'],
    ['AU.L2-3.3.1[a]', 120, 'evidence-store', 'aging'],
    ['AU.L2-3.3.1[a]', 121, 'evidence-store', 'stale'],
    ['SI.L2-3.14.6[a]', 1440, 'evidence-store', 'fresh'],
    ['SI.L2-3.14.6[a]', 2880, 'evidence-store', 'aging'],
    ['SI.L2-3.14.6[a]', 2881, 'evidence-store', 'stale'],
    ['AC.L1-3.1.2[a]', 31, 'stamper-file', 'fresh'],
    ['AC.L1-3.1.2[a]', 2881, 'stamper-file', 'stale'],
  ] as const)('%s, %i min, %s -> %s', (objectiveId, minutes, basis, expected) => {
    const f = evidenceFreshness(objectiveId, [{ at: minus(minutes), basis }], AT)!;
    expect(f.freshness).toBe(expected);
    expect(f.evidenceAge).toMatchObject({ minutes, basis, family: familyOf(objectiveId), cadenceMinutes: cadenceMinutesFor(objectiveId, basis) });
    expect(classifyAge(minutes, cadenceMinutesFor(objectiveId, basis))).toBe(expected);
  });

  it('the freshest item wins; future evidence is age 0; undated evidence gives null', () => {
    const f = evidenceFreshness('AC.L2-3.1.7[a]', [{ at: minus(100), basis: 'evidence-store' }, { at: minus(60), basis: 'stamper-file' }], AT)!;
    expect(f).toMatchObject({ freshness: 'fresh', evidenceAge: { basis: 'stamper-file', minutes: 60 } });
    expect(evidenceFreshness('AC.L2-3.1.7[a]', [{ at: '2026-10-28T13:00:00.000Z', basis: 'evidence-store' }], AT)!.evidenceAge.minutes).toBe(0);
    expect(evidenceFreshness('AC.L2-3.1.7[a]', [{ at: 'not a date', basis: 'evidence-store' }], AT)).toBeNull();
    expect(evidenceFreshness('AC.L2-3.1.7[a]', [], AT)).toBeNull();
  });

  it('formatAge', () => {
    expect([formatAge(0), formatAge(45), formatAge(60), formatAge(125), formatAge(1440), formatAge(4440)]).toEqual(['0 min', '45 min', '1 h', '2 h 5 min', '1 d', '3 d 2 h']);
  });
});

describe('ledger: freshness fields and the B19 demotion', () => {
  const CATALOG = [
    { objectiveId: 'AC.L1-3.1.2[a]', controlId: 'AC.L1-3.1.2', description: 'transactions are limited', methods: ['examine'] },
    { objectiveId: 'AC.L1-3.1.2[b]', controlId: 'AC.L1-3.1.2', description: 'functions are limited', methods: ['examine'] },
    { objectiveId: 'AU.L2-3.3.6[a]', controlId: 'AU.L2-3.3.6', description: 'reduction is provided', methods: ['test'] },
    { objectiveId: 'SC.L2-3.13.15[a]', controlId: 'SC.L2-3.13.15', description: 'authenticity is protected', methods: ['test'] },
  ];
  const WEIGHTS = { '3.1.2': 1, '3.3.6': 1, '3.13.15': 5 };
  const ctl = (control_id: string, status: string, sources: Array<{ type: string; result: string; timestamp: string }>) => ({
    control_id, nist_ref: control_id, status, classification: 'automated', sources, last_assessed: AT, signals: [], evidenceArtifactIds: [],
  });
  const snapshot = (controls: unknown[]): AssessmentSnapshot => ({
    snapshotId: 's', tenantId: 't', generatedAt: AT, controls, sources_merged: [], sprs_score: 0,
    controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0,
  } as unknown as AssessmentSnapshot);
  const ref = (minutes: number, status?: string): EvidenceRef => ({ recordId: `r${minutes}`, tenantId: 't', sourceId: 'x', sha256: 'h', collectedAt: minus(minutes), ...(status ? { status } : {}) } as EvidenceRef);
  const build = (controls: unknown[], refs: Record<string, EvidenceRef[]> = {}) => buildDeterminationLedger({
    tenantId: 't', generatedAt: AT, snapshot: snapshot(controls), objectivesCatalog: CATALOG, sprsWeights: WEIGHTS,
    evidenceRefsLookup: (id) => refs[id] ?? [],
  });
  const obj = (l: ReturnType<typeof build>, id: string) => l.objectives.find(o => o.objectiveId === id)!;

  it('a satisfied objective on a stale-only Stamper file becomes not_assessed, with the age printed; the control and deficiencies follow', () => {
    const l = build([ctl('AC.L1-3.1.2', 'met', [{ type: 'evidence_import', result: 'imported', timestamp: minus(3 * 1440 + 120) }])]);
    const a = obj(l, 'AC.L1-3.1.2[a]');
    expect(a.status).toBe('not_assessed');
    expect(a.freshness).toBe('stale');
    expect(a.staleDemoted).toBe(true);
    expect(a.evidenceAge).toMatchObject({ basis: 'stamper-file', text: '3 d 2 h', family: 'AC', cadenceMinutes: 1440 });
    expect(a.rationale).toMatch(/^stale evidence not counted \(B19\): the newest Stamper evidence file behind this objective is 3 d 2 h old \(2026-10-25T10:00:00.000Z\), older than 2 x the AC cadence of 1 d; was: AC\.L1-3\.1\.2\[a\] \(transactions are limited\) is satisfied: no source decides AC\.L1-3\.1\.2 \(met\); 1 counted Stamper record\(s\) for the control\.$/); // W5: the objective's own rationale
    expect(l.controls.find(c => c.controlId === 'AC.L1-3.1.2')!.status).toBe('not_assessed');
    expect(l.deficiencies.map(d => d.key)).toEqual(expect.arrayContaining(['AC.L1-3.1.2[a]', 'AC.L1-3.1.2[b]']));
  });

  it('a fresh store record next to the stale file keeps the objective satisfied (the freshest evidence decides)', () => {
    const l = build([ctl('AC.L1-3.1.2', 'met', [{ type: 'evidence_import', result: 'imported', timestamp: minus(5000) }])], { 'AC.L1-3.1.2[a]': [ref(10, 'success')] });
    expect(obj(l, 'AC.L1-3.1.2[a]')).toMatchObject({ status: 'satisfied', freshness: 'fresh', evidenceAge: { basis: 'evidence-store', minutes: 10 } });
    expect(obj(l, 'AC.L1-3.1.2[b]')).toMatchObject({ status: 'not_assessed', freshness: 'stale', staleDemoted: true });
  });

  it('an aging objective is still counted', () => {
    const l = build([ctl('AC.L1-3.1.2', 'met', [])], { 'AC.L1-3.1.2[a]': [ref(20, 'empty')] });
    expect(obj(l, 'AC.L1-3.1.2[a]')).toMatchObject({ status: 'satisfied', freshness: 'aging' });
    expect(obj(l, 'AC.L1-3.1.2[a]').staleDemoted).toBeUndefined();
  });

  it('a failed or unauthorised store read is not dated evidence', () => {
    const l = build([ctl('AC.L1-3.1.2', 'met', [{ type: 'evidence_import', result: 'imported', timestamp: minus(5000) }])],
      { 'AC.L1-3.1.2[a]': [ref(1, 'error'), ref(1, 'not_assessed'), ref(1, 'gap')] });
    expect(obj(l, 'AC.L1-3.1.2[a]')).toMatchObject({ status: 'not_assessed', staleDemoted: true, evidenceAge: { basis: 'stamper-file' } });
  });

  it('a stale negative stays negative; an empty-payload SAT (no_query) is not evidence; no dated evidence adds no field', () => {
    const l = build([
      ctl('AU.L2-3.3.6', 'not_met', [{ type: 'evidence_import', result: 'missing', timestamp: minus(9000) }]),
      ctl('SC.L2-3.13.15', 'met', [{ type: 'evidence_import', result: 'no_query', timestamp: minus(9000) }]),
    ]);
    expect(obj(l, 'AU.L2-3.3.6[a]')).toMatchObject({ status: 'other_than_satisfied', freshness: 'stale' });
    expect(obj(l, 'AU.L2-3.3.6[a]').staleDemoted).toBeUndefined();
    const sc = obj(l, 'SC.L2-3.13.15[a]');
    expect(sc.status).toBe('satisfied');
    expect(sc.freshness).toBeUndefined();
    expect(sc.evidenceAge).toBeUndefined();
  });
});

describe('run 25: E8F snapshot (scrubbed fixture)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/drift/run25-snapshots.json'), 'utf-8'));
  const e8f = fx.snapshots['r25-e8f'] as AssessmentSnapshot;
  const at = (generatedAt: string) => buildDeterminationLedger({ tenantId: e8f.tenantId, generatedAt, snapshot: { ...e8f, generatedAt } });

  it('same day (no store): nothing is stale, nothing demoted, objective counts unchanged from a ledger without freshness', () => {
    const l = at(e8f.generatedAt);
    expect(l.objectives.filter(o => o.freshness === 'stale')).toEqual([]);
    expect(l.objectives.filter(o => o.staleDemoted)).toEqual([]);
    expect(l.objectives.filter(o => o.freshness).every(o => o.freshness === 'fresh')).toBe(true);
  });

  it('read 49 hours later: exactly the satisfied objectives on Stamper files alone are demoted (B19)', () => {
    const later = new Date(Date.parse(e8f.generatedAt) + 49 * 3600000).toISOString();
    const same = at(e8f.generatedAt);
    const l = at(later);
    const expected = same.objectives.filter(o => o.status === 'satisfied' && o.evidenceAge?.basis === 'stamper-file').map(o => o.objectiveId);
    expect(expected.length).toBeGreaterThan(0);
    expect(l.objectives.filter(o => o.staleDemoted).map(o => o.objectiveId)).toEqual(expected);
    for (const o of l.objectives.filter(x => x.staleDemoted)) expect(o.rationale).toMatch(/^stale evidence not counted \(B19\): .* is 2 d 1 h old/);
  });
});
