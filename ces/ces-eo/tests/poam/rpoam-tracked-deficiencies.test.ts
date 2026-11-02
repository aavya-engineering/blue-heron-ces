// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * R-POAM: every not_met / not_assessed control is a tracked entry in items[] (with corrective action,
 * owner, date); the ones CMMC does not allow on a POA&M (32 CFR 170.21) are flagged, stay eligibility
 * blockers, and add nothing to totalWeightOnPoam / projectedScoreAfterPoam.
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { PoamGenerator, NOT_POAM_ELIGIBLE_NOTE } from '../../src/eo/poam/PoamGenerator';
import { PoamDocxExporter } from '../../src/eo/poam/PoamDocxExporter';
import { reconcilePoamLifecycle, LEDGER_NOT_POAM_ELIGIBLE_NOTE } from '../../src/eo/poam/PoamLifecycle';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const weights: { controls: Array<{ nist_ref: string; control_id: string; weight: number; poam_allowed: boolean }>; poam_prohibited: string[] } =
  JSON.parse(fs.readFileSync(sprsWeightsPath, 'utf-8'));

function snapshot(notMet: string[], notAssessed: string[] = []): any {
  return {
    snapshotId: 'rpoam-snap', tenantId: '00000000-0000-4000-8000-00000000r0am', generatedAt: '2026-10-31T00:00:00Z',
    controls: weights.controls.map(w => ({
      control_id: w.control_id, nist_ref: w.nist_ref, sources: [],
      status: notMet.includes(w.control_id) ? 'not_met' : notAssessed.includes(w.control_id) ? 'not_assessed' : 'met',
    })),
  };
}

const idOf = (ref: string) => weights.controls.find(w => w.nist_ref === ref)!.control_id;
// The S1 (gc-rf3-s1-mach) shape: three 1-point not_assessed items, three 5-point blockers.
const ONE = ['3.3.4', '3.3.8', '3.5.11'].map(idOf);
const FIVE = ['3.6.2', '3.8.3', '3.9.2'].map(idOf);
const gen = () => new PoamGenerator(controlsRefPath, sprsWeightsPath, []);

describe('R-POAM: every deficiency is a tracked entry', () => {
  const mp = {
    outputs: { human_readable_mission_plan: { milestones: [], steps: FIVE.map(c => ({
      id: `step_task_${c}`, control_coverage: [{ control_id: c }], owner_role: 'security_admin', what_to_do: `Fix ${c}`, target_date: '2027-01-15',
    })) } },
  };
  const poam = gen().generate({ assessment: snapshot(FIVE, ONE), missionPlan: mp });

  it('items[] holds all six with the item fields; eligible ones carry no note', () => {
    expect(poam.items.map(i => i.control_id).sort()).toEqual([...ONE, ...FIVE].sort());
    for (const i of poam.items) {
      expect(i.status).toBe('open');
      expect(typeof i.plannedCorrectiveAction).toBe('string');
      expect(i.itemId).toBeTruthy();
    }
    for (const c of ONE) {
      const i = poam.items.find(x => x.control_id === c)!;
      expect(i.poamEligible).toBe(true);
      expect(i.eligibilityNote).toBeUndefined();
    }
  });

  it('5-point entries are flagged, carry corrective action, owner and date, and stay blockers', () => {
    for (const c of FIVE) {
      const i = poam.items.find(x => x.control_id === c)!;
      expect(i.poamEligible).toBe(false);
      expect(i.eligibilityNote).toBe(NOT_POAM_ELIGIBLE_NOTE);
      expect(i.eligibilityNote).toBe('not CMMC POA&M-eligible (32 CFR 170.21): close before assessment');
      expect(i.weight).toBe(5);
      expect(i.plannedCorrectiveAction).toBe(`Fix ${c}`);
      expect(i.responsibleParty).toBe('security_admin');
      expect(i.estimatedCompletionDate).toBe('2027-01-15');
    }
    expect(poam.eligibility.blockers.map(b => b.control_id).sort()).toEqual([...FIVE].sort());
  });

  it('eligibility and the projection are unchanged (only eligible weight counts)', () => {
    expect(poam.eligibility.eligible).toBe(false);
    expect(poam.eligibility.certificationPath).toBe('blocked');
    expect(poam.eligibility.weightRuleMet).toBe(false);
    expect(poam.summary.totalWeightOnPoam).toBe(3);
    expect(poam.summary.projectedScoreAfterPoam).toBe(poam.sprsScore + 3);
    expect(poam.summary.totalItems).toBe(6);
    expect(poam.summary.totalItems).toBe(poam.items.length);
    expect(poam.summary.eligibleItems).toBe(3);
    expect(poam.summary.notEligibleItems).toBe(3);
  });

  it('a prohibited (non-5-point) control is tracked too, flagged', () => {
    const prohibited = weights.controls.find(w => weights.poam_prohibited.includes(w.nist_ref) && w.weight < 5);
    if (!prohibited) return;
    const p = gen().generate({ assessment: snapshot([prohibited.control_id]) });
    const i = p.items.find(x => x.control_id === prohibited.control_id)!;
    expect(i.poamEligible).toBe(false);
    expect(p.summary.totalWeightOnPoam).toBe(0);
    expect(p.eligibility.prohibitedControlsMet).toBe(false);
  });

  it('the DOCX lists the not-eligible entries in their own section', async () => {
    const buf = await new PoamDocxExporter().export(poam as any);
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Tracked Deficiencies Not POA&amp;M-Eligible (close before assessment)');
    expect(xml).toContain('32 CFR 170.21');
    const section = xml.slice(xml.indexOf('Tracked Deficiencies Not'));
    for (const c of FIVE) expect(section).toContain(c);
    const itemsSection = xml.slice(xml.indexOf('POA&amp;M Items'), xml.indexOf('Tracked Deficiencies Not'));
    for (const c of FIVE) expect(itemsSection).not.toContain(c);
    for (const c of ONE) expect(itemsSection).toContain(c);
  });

  it('the ledger marks noPoam entries with the note and keeps the counts', () => {
    const def = (controlId: string, weight: number) => ({
      key: `${controlId}[a]`, objectiveId: `${controlId}[a]`, controlId, statement: 's', weight, noPoam: weight >= 5, source: 'test',
    }) as any;
    const led = reconcilePoamLifecycle(null, [def(ONE[0], 1), def(FIVE[0], 5)], '2026-10-31T00:00:00Z', 'p1', 't1');
    expect(led.items.find(i => i.controlId === FIVE[0])!.eligibilityNote).toBe(LEDGER_NOT_POAM_ELIGIBLE_NOTE);
    expect(led.items.find(i => i.controlId === ONE[0])!.eligibilityNote).toBeUndefined();
    expect(led.summary.open).toBe(1);
    expect(led.summary.certificationBlockers).toBe(1);
    const again = reconcilePoamLifecycle(led, [def(FIVE[0], 5)], '2026-11-01T00:00:00Z', 'p2', 't1');
    expect(again.items.find(i => i.controlId === FIVE[0])!.eligibilityNote).toBe(LEDGER_NOT_POAM_ELIGIBLE_NOTE);
  });
});
