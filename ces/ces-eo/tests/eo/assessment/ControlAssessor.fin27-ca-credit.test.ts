// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-27 (FD-4, NS-audit F-4): CA.L2-3.12.1 / 3.12.2 / 3.12.3 are credited by EO's own assessment and POA&M
 * records, never by the presence-only Compliance Manager read; CA.L2-3.12.4 reaches met by a GD-b
 * reviewed upload of the signed SSP (every objective, reviewer not the uploader). Drives the real merge.
 */
import type { AssessmentSource } from 'ces-shared/types/controls';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import {
  ControlAssessor, objectiveIdsByControl, decideCaBySelfRecords,
  CA_SELF_RECORD_TIER, CA_SELF_RECORD_UNMET, CA_STACK_DISPLAY_ONLY, GATE_PENDING_REVIEW_RATIONALE,
  type CaSelfRecords, type DocumentReview, type EoControlAssessment,
} from '../../../src/eo/assessment/ControlAssessor';
import { deciderOf } from '../../../src/eo/assessment/DriftDetector';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const C1 = 'CA.L2-3.12.1';
const C2 = 'CA.L2-3.12.2';
const C3 = 'CA.L2-3.12.3';
const C4 = 'CA.L2-3.12.4';
const AS_OF = '2026-10-31T21:03:35.000Z';
const HASH = 'c'.repeat(64);
const UPLOADER = { subjectId: 'uploader:u1', upn: 'uploader.one@tenant.example.test' };
const REVIEWER = 'reviewer.two@tenant.example.test';

/** The R-F0b Compliance Manager source: a Tier 4 evidence-only SAT on both controls. */
const cmPresence = (result: AssessmentSource['result'] = 'imported'): AssessmentSource => ({
  type: 'evidence_import', timestamp: '2026-10-31T21:00:00.000Z', result,
  detail: result === 'imported' ? 'Compliance Assessment Evidence via Compliance Manager (state not verified)' : 'Compliance Assessment Evidence via Compliance Manager',
});
const stamper = (src: AssessmentSource = cmPresence()) => new Map<string, AssessmentSource[]>([[C1, [src]], [C3, [src]]]);

const hoursAgo = (h: number) => new Date(Date.parse(AS_OF) - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const records = (o: Partial<CaSelfRecords> = {}): CaSelfRecords => ({
  assessments: [{ snapshotId: 'snap-2', generatedAt: hoursAgo(1) }, { snapshotId: 'snap-1', generatedAt: hoursAgo(2) }],
  poamLedger: { poamId: 'poam-2', generatedAt: hoursAgo(1) },
  asOf: AS_OF,
  ...o,
});

function merge(opts: { stamperSources?: Map<string, AssessmentSource[]>; ca?: CaSelfRecords; ecItems?: EcEvidenceItem[]; reviews?: DocumentReview[] } = {}) {
  const snap = new ControlAssessor(controlsRefPath).merge('fin27-tenant', [], [], [], [], opts.stamperSources ?? stamper(), undefined, undefined,
    opts.ecItems ?? [], undefined, opts.reviews ?? [], opts.ca);
  const byId = (id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;
  return { snap, byId };
}

describe('FIN-27: CA.L2-3.12.1 / 3.12.3 from EO\'s own records', () => {
  it('the presence-only Compliance Manager read alone no longer credits either control', () => {
    const { byId } = merge();
    for (const id of [C1, C3]) {
      expect(byId(id).status).toBe('not_assessed');
      expect(byId(id).statusRationale).toContain(CA_SELF_RECORD_UNMET);
      expect(byId(id).statusRationale).toContain('the records were not supplied');
      // the source stays on the control for display
      expect(byId(id).sources.some(s => s.detail.includes('Compliance Manager'))).toBe(true);
    }
  });

  it('EO records with prior assessments and a POA&M ledger decide met at the published Tier 3 prefix', () => {
    const { byId } = merge({ ca: records() });
    for (const id of [C1, C3]) {
      const c = byId(id);
      expect(c.status).toBe('met');
      expect(c.statusRationale.startsWith(`${CA_SELF_RECORD_TIER} decides: eo_assessment/exists: `)).toBe(true);
      expect(c.presenceOnly).toBeUndefined();
      expect(c.assessmentFinding).toContain('poam-2');
      expect(deciderOf(c.statusRationale)).toEqual({ tier: 3, source: 'eo_assessment/exists' });
    }
  });

  it('the Compliance Manager record is shown display only (no_query + suffix), so the ledger never counts it', () => {
    const { byId } = merge({ ca: records() });
    for (const id of [C1, C3]) {
      const cm = byId(id).sources.filter(s => s.detail.includes('Compliance Manager'));
      expect(cm).toHaveLength(1);
      expect(cm[0].result).toBe('no_query');
      expect(cm[0].detail.endsWith(`(${CA_STACK_DISPLAY_ONLY})`)).toBe(true);
    }
    // a non-CA control keeps its imported Stamper source
    const src = new Map(stamper());
    src.set('AC.L1-3.1.1', [cmPresence()]);
    expect(merge({ stamperSources: src }).byId('AC.L1-3.1.1').sources[0].result).toBe('imported');
  });

  it('a Compliance Manager NEGATIVE (Stamper NOT_SAT) does not decide either; EO records do', () => {
    const { byId } = merge({ stamperSources: stamper(cmPresence('missing')), ca: records() });
    expect(byId(C1).status).toBe('met');
    expect(byId(C3).status).toBe('met');
  });

  it('forced assessments never count; no ledger means no credit', () => {
    const forced = merge({ ca: records({ assessments: [{ snapshotId: 'f', generatedAt: hoursAgo(1), forced: true }] }) }).byId;
    expect(forced(C1).status).toBe('not_assessed');
    expect(forced(C1).statusRationale).toContain('found 0');
    const noLedger = merge({ ca: records({ poamLedger: null }) }).byId;
    expect(noLedger(C1).status).toBe('not_assessed');
    expect(noLedger(C3).statusRationale).toContain('POA&M ledger reconciled within 30 days (none)');
  });

  it('3.12.1 needs one prior assessment in 365 days; 3.12.3 needs two, the newest within 30 days', () => {
    const one = merge({ ca: records({ assessments: [{ snapshotId: 's', generatedAt: hoursAgo(1) }] }) }).byId;
    expect(one(C1).status).toBe('met');
    expect(one(C3).status).toBe('not_assessed');

    const stale = records({ assessments: [{ snapshotId: 'a', generatedAt: daysAgo(40) }, { snapshotId: 'b', generatedAt: daysAgo(41) }], poamLedger: { poamId: 'p', generatedAt: daysAgo(40) } });
    const s = merge({ ca: stale }).byId;
    expect(s(C1).status).toBe('met'); // within the annual period
    expect(s(C3).status).toBe('not_assessed'); // not ongoing

    const old = decideCaBySelfRecords(C1, records({ assessments: [{ snapshotId: 'o', generatedAt: daysAgo(400) }], poamLedger: { poamId: 'p', generatedAt: daysAgo(400) } }), AS_OF);
    expect(old.decision).toBeUndefined();
    expect(old.reason).toContain('within 365 days');
  });

  it('a record dated after the assessment time (or unparseable) is ignored', () => {
    const r = decideCaBySelfRecords(C1, records({ assessments: [{ snapshotId: 'x', generatedAt: hoursAgo(-1) }, { snapshotId: 'y', generatedAt: 'garbage' }] }), AS_OF);
    expect(r.decision).toBeUndefined();
  });

  it("CA.L2-3.12.2: its Compliance Manager POA&M read no longer credits; EO's own POA&M ledger does", () => {
    const src = new Map(stamper());
    const cmPoam: AssessmentSource = { type: 'evidence_import', timestamp: AS_OF, detail: 'Renderable: POA&M Improvement Actions Evidence via Compliance Manager', result: 'imported' };
    src.set(C2, [cmPoam]);
    const unwired = merge({ stamperSources: src }).byId(C2);
    expect(unwired.status).toBe('not_assessed');
    expect(unwired.statusRationale).toContain(CA_SELF_RECORD_UNMET);
    expect(unwired.sources.find(s => s.detail.includes('POA&M Improvement'))!.result).toBe('no_query');
    const wired = merge({ stamperSources: src, ca: records() }).byId(C2);
    expect(wired.status).toBe('met');
    expect(wired.statusRationale.startsWith(`${CA_SELF_RECORD_TIER} decides: eo_poam/exists: POA&M ledger poam-2`)).toBe(true);
    expect(deciderOf(wired.statusRationale)).toEqual({ tier: 3, source: 'eo_poam/exists' });
  });

  it('CA.L2-3.12.2 with no Stamper source at all (the mp case) is met from EO records alone', () => {
    const { byId } = merge({ stamperSources: new Map(), ca: records() });
    expect(byId(C2).status).toBe('met');
  });

  it('CA.L2-3.12.2 needs both the ledger and a prior assessment, within 365 days', () => {
    expect(merge({ ca: records({ poamLedger: null }) }).byId(C2).status).toBe('not_assessed');
    expect(merge({ ca: records({ assessments: [] }) }).byId(C2).status).toBe('not_assessed');
    const old = decideCaBySelfRecords(C2, records({ poamLedger: { poamId: 'p', generatedAt: daysAgo(400) } }), AS_OF);
    expect(old.decision).toBeUndefined();
    expect(old.reason).toContain('POA&M ledger generated within 365 days');
    const stale = decideCaBySelfRecords(C2, records({ assessments: [{ snapshotId: 'a', generatedAt: daysAgo(40) }], poamLedger: { poamId: 'p', generatedAt: daysAgo(40) } }), AS_OF);
    expect(stale.decision?.status).toBe('met');
  });

  it('SPRS: the wired and unwired outcomes differ by exactly 13 points (3.12.1 + 3.12.2 + 3.12.3)', () => {
    const calc = new SprsCalculator();
    const wired = calc.calculate(merge({ ca: records() }).snap.controls).score;
    const unwired = calc.calculate(merge().snap.controls).score;
    expect(wired - unwired).toBe(13);
  });

  it('a pending gate on a CA self-record control keeps the FD-2 prefix and adds the EO-records reason', () => {
    const gate: AssessmentSource = { type: 'evidence_import', timestamp: AS_OF, result: 'no_query',
      detail: 'gate (manual-gate approval; pending_review: a gate approval never credits a non-stack control (FD-2))' };
    const { byId } = merge({ stamperSources: new Map([[C1, [gate]]]) });
    expect(byId(C1).status).toBe('not_assessed');
    expect(byId(C1).statusRationale.startsWith(GATE_PENDING_REVIEW_RATIONALE)).toBe(true);
    expect(byId(C1).statusRationale).toContain(CA_SELF_RECORD_UNMET);
  });
});

describe('FIN-27: CA.L2-3.12.4 by a GD-b reviewed upload of the signed SSP', () => {
  const sspItem = (overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem => ({
    contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
    itemId: 'item-ssp', tenantSlug: 'fin27-tenant', controlIds: [C4], source: 'manual_upload',
    filename: 'ssp-signed.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 100,
    collectedAt: '2026-10-31T00:00:00.000Z', submittedByRole: 'compliance_officer', uploadedBy: UPLOADER, mode: 'sim',
    ...overrides,
  });
  let n = 0;
  const reviewsFor = (objectives: string[], verdict: 'met' | 'not_met' = 'met', upn = REVIEWER): DocumentReview[] => objectives.map(o => {
    n++;
    return { reviewId: `r-${n}`, tenantSlug: 'fin27-tenant', controlId: C4, objectiveId: o, artifactHash: HASH, verdict,
      reviewer: { upn, subjectId: `ao-approver:${upn}`, tokenId: `jti-${n}` }, uploader: UPLOADER, ecItemIds: ['item-ssp'], reviewedAt: AS_OF };
  });
  const gatePending: AssessmentSource = { type: 'evidence_import', timestamp: AS_OF, result: 'no_query',
    detail: 'Renderable: System Security Plan Documentation (Manual Gate) (manual-gate approval; pending_review: a gate approval never credits a non-stack control (FD-2))' };
  const objectives = () => objectiveIdsByControl().get(C4)!;

  it('the reference has 8 objectives for 3.12.4', () => expect(objectives()).toHaveLength(8));

  it('an independent met review of every objective decides met, above a pending gate approval', () => {
    const { byId } = merge({ stamperSources: new Map([[C4, [gatePending]]]), ecItems: [sspItem()], reviews: reviewsFor(objectives()) });
    expect(byId(C4).status).toBe('met');
    expect(byId(C4).statusRationale.startsWith('GD-b (document review of every objective')).toBe(true);
  });

  it('7 of 8 objectives reviewed stays not_assessed (pending gate rationale)', () => {
    const { byId } = merge({ stamperSources: new Map([[C4, [gatePending]]]), ecItems: [sspItem()], reviews: reviewsFor(objectives().slice(1)) });
    expect(byId(C4).status).toBe('not_assessed');
    expect(byId(C4).statusRationale.startsWith(GATE_PENDING_REVIEW_RATIONALE)).toBe(true);
  });

  it('the uploader reviewing their own SSP credits nothing; an unknown uploader credits nothing', () => {
    expect(merge({ ecItems: [sspItem()], reviews: reviewsFor(objectives(), 'met', UPLOADER.upn) }).byId(C4).status).toBe('not_assessed');
    expect(merge({ ecItems: [sspItem({ uploadedBy: null })], reviews: reviewsFor(objectives()) }).byId(C4).status).toBe('not_assessed');
  });

  it('a not_met review (e.g. the SSP is unsigned) decides not_met; 3.12.4 is weight 0 in SPRS', () => {
    const { byId, snap } = merge({ ecItems: [sspItem()], reviews: [...reviewsFor(objectives().slice(1)), ...reviewsFor(objectives().slice(0, 1), 'not_met')] });
    expect(byId(C4).status).toBe('not_met');
    const calc = new SprsCalculator();
    const met = merge({ ecItems: [sspItem()], reviews: reviewsFor(objectives()) }).snap;
    expect(calc.calculate(snap.controls).score).toBe(calc.calculate(met.controls).score);
  });

  it('GD-b also credits 3.12.1 when EO records do not decide it', () => {
    const objs = objectiveIdsByControl().get(C1)!;
    const item = sspItem({ itemId: 'item-ca1', controlIds: [C1], filename: 'assessment-report.pdf' });
    const reviews = objs.map((o, i) => ({ reviewId: `c1-${i}`, tenantSlug: 'fin27-tenant', controlId: C1, objectiveId: o, artifactHash: HASH, verdict: 'met' as const,
      reviewer: { upn: REVIEWER, subjectId: 'x', tokenId: `t-${i}` }, uploader: UPLOADER, ecItemIds: ['item-ca1'], reviewedAt: AS_OF }));
    const { byId } = merge({ ecItems: [item], reviews });
    expect(byId(C1).status).toBe('met');
    expect(byId(C1).statusRationale.startsWith('GD-b')).toBe(true);
  });
});
