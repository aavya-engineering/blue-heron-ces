// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * DEPTH-11 (NS-audit F-8): on a non-stack control a Stamper record counts only for the objectives its registry
 * entry names that KB-1 marks tenant-evidenced (stack_signal). Replays the R-F1 S1 sources of MA.L2-3.7.1/3.7.2
 * and MP.L2-3.8.4/3.8.9 against the real Stamper registry and drives the real merge.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSource, ControlAssessment } from 'ces-shared/types/controls';
import type { CommandRegistryFile } from 'ces-shared/types/registry';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import {
  ControlAssessor, NON_STACK_PROXY_PARTIAL, NON_STACK_PROXY_UNCOUNTED, NON_STACK_REVIEW_ROUTE, NON_TENANT_PRACTICES,
  nonStackObjectiveRoutes, objectiveIdsByControl, tenantEvidencedObjectivesByControl,
  type DocumentReview, type EoControlAssessment,
} from '../../../src/eo/assessment/ControlAssessor';
import { NON_STACK_CONTROL_IDS } from '../../../src/eo/evidence/StamperEvidenceLoader';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const registry: CommandRegistryFile = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json'), 'utf-8').replace(/^﻿/, ''));

const T = '2026-10-31T22:30:00.000Z';
const EXEC = ' [executor stamper/2.2.3@no-mgcontext]';
const sat = (label: string, suffix = ''): AssessmentSource => ({ type: 'evidence_import', timestamp: T, result: 'imported', detail: `${label}${EXEC}${suffix}` });
const notSat = (entryId: string, label: string): AssessmentSource =>
  ({ type: 'evidence_import', timestamp: T, result: 'missing', detail: `${label}${EXEC}`, entryId, outcomeRationale: 'failed' } as AssessmentSource);

const RING = 'Deploy Windows Update for Business Ring via Intune';
const LABEL = 'Create CUI Sensitivity Label with Encryption';
const DLP_P = 'Create DLP Compliance Policy to Enforce CUI Blocking';
const DLP_R = 'Create DLP Compliance Rule to Block CUI and Notify Owner';

/** The R-F1 S1 (and S2, S3, mp) Stamper sources on the four F-8 controls, plus the stack control MP.L2-3.8.1. */
const f8Sources = () => new Map<string, AssessmentSource[]>([
  ['MA.L2-3.7.1', [sat(RING)]],
  ['MA.L2-3.7.2', [sat(RING)]],
  ['MP.L2-3.8.4', [sat(LABEL)]],
  ['MP.L2-3.8.9', [sat(DLP_P), sat(DLP_R)]],
  ['MP.L2-3.8.1', [sat(LABEL)]],
]);

const UPLOADER = { subjectId: 'uploader:u1', upn: 'uploader.one@tenant.example.test' };
const REVIEWER = 'reviewer.two@tenant.example.test';
const HASH = 'd'.repeat(64);
const item = (controlId: string): EcEvidenceItem => ({
  contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
  itemId: `item-${controlId}`, tenantSlug: 'd11-tenant', controlIds: [controlId], source: 'manual_upload',
  filename: 'record.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 100,
  collectedAt: '2026-10-31T00:00:00.000Z', submittedByRole: 'compliance_officer', uploadedBy: UPLOADER, mode: 'sim',
} as EcEvidenceItem);
let n = 0;
const reviews = (controlId: string, objectives: string[], upn = REVIEWER): DocumentReview[] => objectives.map(o => {
  n++;
  return { reviewId: `r-${n}`, tenantSlug: 'd11-tenant', controlId, objectiveId: o, artifactHash: HASH, verdict: 'met',
    reviewer: { upn, subjectId: `ao-approver:${upn}`, tokenId: `jti-${n}` }, uploader: UPLOADER, ecItemIds: [`item-${controlId}`], reviewedAt: T };
});

function merge(opts: { stamper?: Map<string, AssessmentSource[]>; signals?: Map<string, ControlAssessment>; ecItems?: EcEvidenceItem[]; reviews?: DocumentReview[]; registries?: CommandRegistryFile[] } = {}) {
  const snap = new ControlAssessor(controlsRefPath, opts.registries ?? [registry]).merge('d11-tenant', [], [], [], [], opts.stamper ?? f8Sources(),
    opts.signals, undefined, opts.ecItems ?? [], undefined, opts.reviews ?? []);
  const byId = (id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;
  return { snap, byId };
}

describe('DEPTH-11 (F-8): non-stack proxies count per objective', () => {
  it('KB-1 marks only five objectives of the 28 non-stack controls tenant-evidenced', () => {
    const t = tenantEvidencedObjectivesByControl();
    const ns = [...NON_STACK_CONTROL_IDS].flatMap(c => [...(t.get(c) ?? [])]).sort();
    expect(ns).toEqual(['AT.L2-3.2.1[c]', 'AT.L2-3.2.1[d]', 'AT.L2-3.2.3[b]', 'PS.L2-3.9.2[b]', 'PS.L2-3.9.2[c]']);
  });

  it('the update ring, CUI label and DLP no longer credit MA.L2-3.7.1/3.7.2 or MP.L2-3.8.4/3.8.9; the sources stay, display only', () => {
    const { byId } = merge();
    for (const id of ['MA.L2-3.7.1', 'MA.L2-3.7.2', 'MP.L2-3.8.4', 'MP.L2-3.8.9']) {
      const c = byId(id);
      expect(c.status).toBe('not_assessed');
      const shown = c.sources.filter(s => s.type === 'evidence_import');
      expect(shown.length).toBeGreaterThan(0);
      for (const s of shown) {
        expect(s.result).toBe('no_query');
        expect(s.detail.endsWith(`(${NON_STACK_PROXY_UNCOUNTED})`)).toBe(true);
      }
    }
  });

  it('a stack control credited by the same entry is untouched (MP.L2-3.8.1 stays met at Tier 3)', () => {
    const { byId } = merge();
    expect(byId('MP.L2-3.8.1').status).toBe('met');
    expect(byId('MP.L2-3.8.1').statusRationale.startsWith('Tier 3 (state-verified execution verdict) decides')).toBe(true);
  });

  it('the predicted SPRS move is -10 (3 + 5 + 1 + 1)', () => {
    const calc = new SprsCalculator();
    const after = calc.calculate(merge().snap.controls).score;
    // Before DEPTH-11 the four were met at Tier 3: model it by marking them met on the same snapshot.
    const before = calc.calculate(merge().snap.controls.map(c =>
      ['MA.L2-3.7.1', 'MA.L2-3.7.2', 'MP.L2-3.8.4', 'MP.L2-3.8.9'].includes(c.control_id) ? { ...c, status: 'met' as const } : c)).score;
    expect(before - after).toBe(10);
  });

  it('a proxy NOT_SAT naming no tenant-evidenced objective decides neither way (not_assessed, not not_met)', () => {
    const { byId } = merge({ stamper: new Map([['MA.L2-3.7.1', [notSat('MA.L2-3.7.1.update-ring', RING)]]]) });
    expect(byId('MA.L2-3.7.1').status).toBe('not_assessed');
  });

  it('an unknown entry (no registry match) fails closed: display only', () => {
    const { byId } = merge({ stamper: new Map([['MA.L2-3.7.1', [sat('Some Unregistered Maintenance Check')]]]) });
    expect(byId('MA.L2-3.7.1').status).toBe('not_assessed');
    expect(byId('MA.L2-3.7.1').sources[0].detail).toContain(NON_STACK_PROXY_UNCOUNTED);
  });

  it('a rejected manual gate (an operator record, FIN-10) is not a proxy: it stays a negative', () => {
    const { byId } = merge({ stamper: new Map([['PE.L1-3.10.1', [notSat('PE.L1-3.10.1.physical-access', 'Limit Physical Access to Organizational Systems')]]]) });
    expect(byId('PE.L1-3.10.1').status).toBe('not_met');
  });

  it('an assessor built without a registry skips the rule (EO\'s assess route always passes one)', () => {
    const { byId } = merge({ registries: [] });
    expect(byId('MA.L2-3.7.1').status).toBe('met');
  });

  it('GD-b still decides: reviews of every objective credit MA.L2-3.7.2 over the uncounted proxy', () => {
    const objs = objectiveIdsByControl().get('MA.L2-3.7.2')!;
    const { byId } = merge({ ecItems: [item('MA.L2-3.7.2')], reviews: reviews('MA.L2-3.7.2', objs) });
    expect(byId('MA.L2-3.7.2').status).toBe('met');
    expect(byId('MA.L2-3.7.2').statusRationale.startsWith('GD-b (document review of every objective')).toBe(true);
  });

  it('PS.L2-3.9.2: the leaver-workflow NOT_SAT names [b] (tenant-evidenced) and still decides not_met at Tier 1', () => {
    const { byId } = merge({ stamper: new Map([['PS.L2-3.9.2', [
      notSat('PS.L2-3.9.2.leaver-workflow', 'Verify a scheduled leaver lifecycle workflow that disables or deletes the account'),
      sat('Personnel Termination and Transfer Account Disable Evidence', ' (state not verified)'),
    ]]]) });
    expect(byId('PS.L2-3.9.2').status).toBe('not_met');
    expect(byId('PS.L2-3.9.2').statusRationale.startsWith('Tier 1')).toBe(true);
  });

  it('PS.L2-3.9.2: a counted proxy covers only [b]; met needs [a] and [c] by GD-b review', () => {
    const src = () => new Map([['PS.L2-3.9.2', [sat('Personnel Termination and Transfer Account Disable Evidence', ' (state not verified)')]]]);
    const alone = merge({ stamper: src() }).byId('PS.L2-3.9.2');
    expect(alone.status).toBe('not_assessed');
    expect(alone.statusRationale.startsWith(NON_STACK_PROXY_PARTIAL)).toBe(true);
    expect(alone.statusRationale).toContain('not evidenced: PS.L2-3.9.2[a], PS.L2-3.9.2[c]');
    expect(alone.statusRationale).toContain(NON_STACK_REVIEW_ROUTE);

    const both = merge({ stamper: src(), ecItems: [item('PS.L2-3.9.2')], reviews: reviews('PS.L2-3.9.2', ['PS.L2-3.9.2[a]', 'PS.L2-3.9.2[c]']) }).byId('PS.L2-3.9.2');
    expect(both.status).toBe('met');
    expect(both.statusRationale.startsWith('Tier 4 (evidence-only Stamper SAT) decides')).toBe(true);
    expect(both.statusRationale).toContain('per objective (DEPTH-11): objectives by Stamper entry: PS.L2-3.9.2[b]; by GD-b review: PS.L2-3.9.2[a], PS.L2-3.9.2[c]');

    // A self-review never fills an objective (GD-b).
    const self = merge({ stamper: src(), ecItems: [item('PS.L2-3.9.2')], reviews: reviews('PS.L2-3.9.2', ['PS.L2-3.9.2[a]', 'PS.L2-3.9.2[c]'], UPLOADER.upn) }).byId('PS.L2-3.9.2');
    expect(self.status).toBe('not_assessed');
  });

  it('AT.L2-3.2.3: the insider-threat entry names [a] (not tenant-evidenced) and is display only; the live read still decides', () => {
    const signal: ControlAssessment = {
      control_id: 'AT.L2-3.2.3', nist_ref: '3.2.3', family: 'AT', practice: 'x', status: 'met', classification: 'automated', signals: [],
      sources: [{ type: 'discovery', timestamp: T, result: 'exists', detail: '43/43 users completed insider-threat awareness training' }],
    } as unknown as ControlAssessment;
    const { byId } = merge({ stamper: new Map([['AT.L2-3.2.3', [sat('Insider Threat Awareness Program Evidence', ' (state not verified)')]]]),
      signals: new Map([['AT.L2-3.2.3', signal]]) });
    expect(byId('AT.L2-3.2.3').status).toBe('met');
    expect(byId('AT.L2-3.2.3').statusRationale.startsWith('Tier 2 (live read)')).toBe(true);
    expect(byId('AT.L2-3.2.3').sources.find(s => s.type === 'evidence_import')!.detail).toContain(NON_STACK_PROXY_UNCOUNTED);
  });
});

describe('DEPTH-11: non-tenant practices route to documents and attestation (GD-b)', () => {
  it('the 12 non-tenant practices are all non-stack controls', () => {
    expect(NON_TENANT_PRACTICES.size).toBe(12);
    for (const c of NON_TENANT_PRACTICES) expect(NON_STACK_CONTROL_IDS.has(c)).toBe(true);
  });

  it('the route table has the 73 non-stack objectives; only the five KB-1 tenant rows are `tenant`', () => {
    const rows = nonStackObjectiveRoutes();
    expect(rows).toHaveLength(73);
    expect(new Set(rows.map(r => r.controlId)).size).toBe(28);
    expect(rows.filter(r => r.coverage === 'tenant').map(r => r.objectiveId).sort())
      .toEqual(['AT.L2-3.2.1[c]', 'AT.L2-3.2.1[d]', 'AT.L2-3.2.3[b]', 'PS.L2-3.9.2[b]', 'PS.L2-3.9.2[c]']);
    for (const r of rows.filter(x => x.nonTenantPractice)) {
      expect(['document', 'manual']).toContain(r.coverage);
      expect(r.route).toBe(NON_STACK_REVIEW_ROUTE);
    }
  });

  it('a Stamper SAT on a non-tenant practice never credits it (MA.L2-3.7.3); only reviews of every objective do', () => {
    const src = new Map([['MA.L2-3.7.3', [sat(RING)]]]);
    expect(merge({ stamper: src }).byId('MA.L2-3.7.3').status).toBe('not_assessed');
    const objs = objectiveIdsByControl().get('MA.L2-3.7.3')!;
    const met = merge({ stamper: new Map([['MA.L2-3.7.3', [sat(RING)]]]), ecItems: [item('MA.L2-3.7.3')], reviews: reviews('MA.L2-3.7.3', objs) }).byId('MA.L2-3.7.3');
    expect(met.status).toBe('met');
    expect(met.statusRationale.startsWith('GD-b')).toBe(true);
  });
});
