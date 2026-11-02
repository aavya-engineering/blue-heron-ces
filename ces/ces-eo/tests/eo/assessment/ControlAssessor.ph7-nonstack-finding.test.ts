// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH7-EO (V59, S3-D09 "No DLP policy"): Stamper's DLP entries name MP.L2-3.8.9 (backup confidentiality), a non-stack
 * control, so DEPTH-11 shows them display only and the control stays not_assessed. The control now carries a finding
 * (NON_STACK_NOT_DECIDED_FINDING) naming the records and the deciding route; the SSP and the POA&M carry it. Status
 * and SPRS do not move. Replays the R-F3 S3 sources against the real Stamper registry and drives the real merge, SSP
 * and POA&M generators.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSource } from 'ces-shared/types/controls';
import type { CommandRegistryFile } from 'ces-shared/types/registry';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import {
  ControlAssessor, NON_STACK_NOT_DECIDED_FINDING, NON_STACK_REVIEW_ROUTE, objectiveIdsByControl, type DocumentReview, type EoControlAssessment,
} from '../../../src/eo/assessment/ControlAssessor';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator';
import { PoamGenerator } from '../../../src/eo/poam/PoamGenerator';
import { SspGenerator } from '../../../src/eo/ssp/SspGenerator';
import { buildGoldenTenantManifest, buildGoldenInfraManifest, buildGoldenManifests } from '../../ssp/golden-fixtures';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = require.resolve('ces-shared/data/sprs-weights');
const registry: CommandRegistryFile = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json'), 'utf-8').replace(/^﻿/, ''));

const T = '2026-11-01T04:06:17.739Z';
const EXEC = ' [executor stamper/2.2.3@no-mgcontext]';
const sat = (label: string): AssessmentSource => ({ type: 'evidence_import', timestamp: T, result: 'imported', detail: `${label}${EXEC}` });
const DLP_P = 'Create DLP Compliance Policy to Enforce CUI Blocking';
const DLP_R = 'Create DLP Compliance Rule to Block CUI and Notify Owner';
const MP = 'MP.L2-3.8.9';

const s3Sources = () => new Map<string, AssessmentSource[]>([[MP, [sat(DLP_P), sat(DLP_R)]]]);
const merge = (reviews: DocumentReview[] = [], ec: EcEvidenceItem[] = [], stamper = s3Sources()) =>
  new ControlAssessor(controlsRefPath, [registry]).merge('ph7-s3', [], [], [], [], stamper, undefined, undefined, ec, undefined, reviews);
const ctl = (snap: ReturnType<typeof merge>, id = MP) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;

const UPLOADER = { subjectId: 'uploader:u1', upn: 'uploader.one@tenant.example.test' };
const REVIEWER = 'reviewer.two@tenant.example.test';
const HASH = 'e'.repeat(64);

describe('PH7-EO (V59, S3-D09): a non-stack control left not_assessed names its display-only Stamper records', () => {
  it('MP.L2-3.8.9 stays not_assessed; the finding names both DLP records and the GD-b route, without the executor label', () => {
    const c = ctl(merge());
    expect(c.status).toBe('not_assessed');
    expect(c.assessmentFinding).toBe(`${NON_STACK_NOT_DECIDED_FINDING}: 2 Stamper record(s) on it are display only, their entries name no tenant-evidenced objective of it (DEPTH-11): "${DLP_P}"; "${DLP_R}"; decided only by ${NON_STACK_REVIEW_ROUTE}`);
    expect(c.assessmentFinding).toMatch(/DLP/);
    expect(c.assessmentFinding).not.toContain('[executor');
  });

  it('no score moves: SPRS equals the snapshot without the finding', () => {
    const snap = merge();
    const calc = new SprsCalculator();
    const without = snap.controls.map(x => { const { assessmentFinding: _f, ...rest } = x as EoControlAssessment; return rest; });
    expect(calc.calculate(snap.controls).score).toBe(calc.calculate(without as typeof snap.controls).score);
  });

  it('a non-stack control with no Stamper record gets no finding', () => {
    const c = ctl(merge([], [], new Map()));
    expect(c.status).toBe('not_assessed');
    expect(c.assessmentFinding).toBeUndefined();
  });

  it('GD-b reviews still decide it; the decided finding replaces the not-decided one', () => {
    const item = {
      contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
      itemId: `item-${MP}`, tenantSlug: 'ph7-s3', controlIds: [MP], source: 'manual_upload',
      filename: 'backup-encryption.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 100,
      collectedAt: '2026-11-01T00:00:00.000Z', submittedByRole: 'compliance_officer', uploadedBy: UPLOADER, mode: 'sim',
    } as EcEvidenceItem;
    const reviews: DocumentReview[] = objectiveIdsByControl().get(MP)!.map((o, i) => ({
      reviewId: `r-${i}`, tenantSlug: 'ph7-s3', controlId: MP, objectiveId: o, artifactHash: HASH, verdict: 'met',
      reviewer: { upn: REVIEWER, subjectId: `ao-approver:${REVIEWER}`, tokenId: `jti-${i}` }, uploader: UPLOADER, ecItemIds: [item.itemId], reviewedAt: T,
    }));
    const c = ctl(merge(reviews, [item]));
    expect(c.status).toBe('met');
    expect(c.assessmentFinding?.startsWith(NON_STACK_NOT_DECIDED_FINDING)).not.toBe(true);
  });

  it('the SSP carries the finding on the not_assessed control; the POA&M item names it after "Control not yet assessed"', () => {
    const snap = merge();
    const ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: snap, tenantManifest: buildGoldenTenantManifest(), infraManifest: buildGoldenInfraManifest(),
      manifests: buildGoldenManifests(), variables: { organizationName: 'Golden Reference Defense Co.' },
    });
    const sspCtl = ssp.controlImplementations.find(x => x.control_id === MP)!;
    expect(sspCtl.status).toBe('not_assessed');
    expect(sspCtl.assessmentFinding).toBe(ctl(snap).assessmentFinding);
    // Another not_assessed control without the finding keeps none.
    const other = ssp.controlImplementations.find(x => x.status === 'not_assessed' && x.control_id !== MP)!;
    expect(other.assessmentFinding).toBeUndefined();

    const poam = new PoamGenerator(controlsRefPath, sprsWeightsPath, [registry]).generate({ assessment: snap });
    const mpItem = poam.items.find(i => i.control_id === MP)!;
    expect(mpItem.deficiencyDescription).toBe(`Control not yet assessed. ${ctl(snap).assessmentFinding}`);
    const plain = poam.items.find(i => i.control_id !== MP && snap.controls.find(x => x.control_id === i.control_id)?.status === 'not_assessed')!;
    expect(plain.deficiencyDescription).toBe('Control not yet assessed');
  });
});
