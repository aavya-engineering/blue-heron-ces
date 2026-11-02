// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4 (SSP consistency) on run 23's inputs (scrubbed copies in tests/fixtures/ssp-uplift):
 *  - `snapshot-run23.json` / `ledger-run23.json`: EO's snapshot (80 / 6 / 0 / 24, SPRS 33) and ledger summary (80 / 7 / 0 / 23).
 *  - `w4-run23-inputs.json`: the MP fields W4 reads (readiness posture, per-requirement readiness, milestones,
 *    user counts), the TM boundary facts, identity and TCP data_protection intent, and the stored POA&M.
 * W4.1 posture block (one assessed SPRS); W4.2 status, revision history, policy date, CA.L2-3.12.4;
 * W4.3 one source for §2.2 and Appendix B, the CUI repository interconnection, the user-count conflict;
 * W4.4 DOCX: no markdown, §14 tables, Appendix C/M/N, one CUI marking, System Type.
 */
import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { PlanOfActionMilestones } from 'ces-shared/types/poam';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import type { EoSystemSecurityPlan } from '../../src/shared/types/ssp.types.js';
import type { W4SspFields } from '../../src/eo/ssp/SspGenerator.js';
import { buildPostureReconciliation } from '../../src/eo/ssp/PostureReconciliation.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;

interface W4Inputs { missionPlan: Record<string, unknown>; tenantManifest: Record<string, unknown>; poam: PlanOfActionMilestones }
type W4Ssp = EoSystemSecurityPlan & W4SspFields;

/** Text of every paragraph in a DOCX part, one line per paragraph. */
async function docxParts(buf: Buffer): Promise<{ body: string; headerFooter: string }> {
  const zip = await JSZip.loadAsync(buf);
  const text = (xml: string) => xml.split('</w:p>')
    .map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join(''))
    .join('\n')
    .replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const body = text(await zip.file('word/document.xml')!.async('string'));
  let headerFooter = '';
  for (const name of Object.keys(zip.files).filter(f => /^word\/(header|footer)\d*\.xml$/.test(f))) {
    headerFooter += `${text(await zip.file(name)!.async('string'))}\n`;
  }
  return { body, headerFooter };
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('W4 SSP consistency on run 23', () => {
  let tmp: string;
  let snapshot: AssessmentSnapshot;
  let ledger: DeterminationLedger;
  let inputs: W4Inputs;
  let ssp: W4Ssp;
  let json: string;
  let docx: { body: string; headerFooter: string };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-'));
    snapshot = readJson<AssessmentSnapshot>('snapshot-run23.json');
    ledger = readJson<DeterminationLedger>('ledger-run23.json');
    inputs = readJson<W4Inputs>('w4-run23-inputs.json');
    // Two prior SSPs for this tenant, one for another tenant, one "latest" copy (not a revision).
    const sspDir = path.join(tmp, 'ssp');
    fs.mkdirSync(sspDir, { recursive: true });
    const prior = (id: string, tenantId: string, at: string, statuses: string[]) =>
      fs.writeFileSync(path.join(sspDir, `${id}.json`), JSON.stringify({ sspId: id, tenantId, generatedAt: at, controlImplementations: statuses.map(status => ({ status })) }));
    prior('b-second', snapshot.tenantId, '2026-10-27T19:05:00.000Z', ['met', 'not_met']);
    prior('a-first', snapshot.tenantId, '2026-10-27T14:00:00.000Z', ['met', 'met', 'not_assessed']);
    prior('c-other', 'some-other-tenant', '2026-10-27T15:00:00.000Z', ['met']);
    fs.writeFileSync(path.join(sspDir, `latest-muster-partial.json`), JSON.stringify({ tenantId: snapshot.tenantId, generatedAt: '2026-10-27T19:05:00.000Z' }));

    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot,
      ledger,
      poam: inputs.poam,
      missionPlan: inputs.missionPlan,
      tenantManifest: inputs.tenantManifest,
      variables: {},
      tenantSlug: 'muster-partial',
      storageRoot: tmp,
    }) as W4Ssp;
    json = JSON.stringify(ssp);
    docx = await docxParts(await new SspDocxExporter().export(ssp));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('status counts are unchanged (80 / 6 / 0 / 24) and match the snapshot per control', () => {
    const n = (s: string) => ssp.controlImplementations.filter(c => c.status === s).length;
    expect([n('met'), n('not_met'), n('partial'), n('not_assessed')]).toEqual([80, 6, 0, 24]);
    const bySnapshot = new Map(snapshot.controls.map(c => [c.control_id, c.status]));
    for (const c of ssp.controlImplementations) expect(c.status).toBe(bySnapshot.get(c.control_id));
  });

  describe('W4.1 posture block', () => {
    test('lists EO, ledger, Muster readiness, MP readiness and the POA&M projection, each with its rule', () => {
      const pr = ssp.postureReconciliation!;
      expect(pr.rows.map(r => r.id)).toEqual(['eo-assessed', 'ledger-rollup', 'muster-readiness', 'mp-readiness', 'poam-projection']);
      for (const r of pr.rows) expect(r.rule.length).toBeGreaterThan(40);
      const row = (id: string) => pr.rows.find(r => r.id === id)!;
      expect(row('eo-assessed').counts).toEqual({ met: 80, partial: 0, notMet: 6, notAssessed: 24 });
      expect(row('ledger-rollup').counts).toEqual({ met: 80, partial: 0, notMet: 7, notAssessed: 23 });
      expect(row('muster-readiness').counts).toEqual({ met: 0, partial: 74, notMet: 31, notAssessed: 19 });
      expect(row('muster-readiness').rule).toContain('B1 (a)');
      expect(row('mp-readiness').counts).toEqual({ met: 0, partial: 63, notMet: 30, notAssessed: 17 });
      expect(row('mp-readiness').sprs).toBe(-203);
      expect(row('mp-readiness').sprsLabel).toBe('planning posture');
      expect(row('poam-projection').sprs).toBe(45);
      expect(row('poam-projection').sprsLabel).toBe('projected');
    });

    test('only EO\'s SPRS is "assessed", and the not-assessed deduction is stated', () => {
      const pr = ssp.postureReconciliation!;
      expect(pr.rows.filter(r => r.sprsLabel === 'assessed').map(r => r.id)).toEqual(['eo-assessed']);
      expect(pr.assessedSprs).toBe(33);
      expect(pr.notAssessedDeduction).toEqual({ controls: 24, points: 61 });
      expect(pr.notMetDeduction).toEqual({ controls: 6, points: 16 });
      expect(110 - pr.notMetDeduction.points - pr.notAssessedDeduction.points).toBe(33);
      expect(pr.statements[0]).toContain('24 not-assessed controls (61 points)');
    });

    test('a ledger rollup that differs from EO is named per control', () => {
      const withControls = {
        ...ledger,
        controls: [{ controlId: 'PS.L2-3.9.1', status: 'not_met', weight: 3, noPoam: true, objectives: [] }],
      } as unknown as DeterminationLedger;
      const pr = buildPostureReconciliation({ assessment: snapshot, ledger: withControls, weightFor: () => 1 });
      expect(pr.ledgerDifferences).toEqual([{ controlId: 'PS.L2-3.9.1', eoStatus: 'not_assessed', ledgerStatus: 'not_met' }]);
    });
  });

  describe('W4.2 dates and revision', () => {
    test('not yet authorized without an authorization variable; authorized only with one', async () => {
      expect(ssp.operationalStatus).toMatch(/^Not yet authorized/);
      expect(json).not.toMatch(/authorized for operation/i);
      const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
      const gen = new SspGenerator(controlsRefPath, sprsWeightsPath);
      const base = { assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot, missionPlan: inputs.missionPlan };
      const claimed = gen.generate({ ...base, variables: { operationalStatus: 'The system has been authorized for operation.' } });
      expect(claimed.operationalStatus).toMatch(/^Not yet authorized/);
      const authorized = gen.generate({ ...base, variables: { authorizationDate: '2027-02-01' } });
      expect(authorized.operationalStatus).toContain('authorized for operation on 2027-02-01');
      expect(authorized.controlImplementations.find(c => c.control_id === 'CA.L2-3.12.4')!.implementationNarrative).toContain('the SSP authorization is recorded with the date 2027-02-01');
    });

    test('CA.L2-3.12.4 no longer claims signatures', () => {
      const narrative = ssp.controlImplementations.find(c => c.control_id === 'CA.L2-3.12.4')!.implementationNarrative;
      expect(narrative).not.toMatch(/signed by/);
      expect(narrative).toContain('It is not yet signed');
    });

    test('revision history: this tenant\'s prior SSPs oldest first, then this document', () => {
      const rows = ssp.revisionHistory!;
      expect(rows.map(r => r.version)).toEqual(['Draft 1', 'Draft 2', 'Draft 3 (this document)']);
      expect(rows[0].date).toBe('2026-10-27 14:00 UTC');
      expect(rows[0].description).toContain('2 met / 0 not met / 0 partial / 1 not assessed');
      expect(rows[2].description).toContain('80 met / 6 not met / 0 partial / 24 not assessed');
      expect(rows.every(r => !/Evidence Ops$/.test(r.author))).toBe(true);
    });

    test('policies effective on approval, planned at MP milestone MS-1', () => {
      expect(ssp.policyEffectiveStatement).toBe('Policies effective on approval; planned 2026-12-29 (MP milestone MS-1).');
    });
  });

  describe('W4.3 flows and counts', () => {
    test('Appendix B equals §2.2 (one source: boundary facts + TCP data_protection)', () => {
      const rows = ssp.cuiDataFlowRows!;
      expect(rows.length).toBeGreaterThanOrEqual(10);
      expect(rows.some(r => r.source.startsWith('TCP data_protection'))).toBe(true);
      expect(rows.some(r => r.source === 'CUI boundary fact cui_ingress_channels')).toBe(true);
      const b = ssp.appendices!.find(a => a.id === 'B')!;
      const tableRows = b.summary.split('\n').slice(2).map(l => l.replace(/^\| | \|$/g, '').split(' | '));
      expect(tableRows).toEqual(rows.map(r => [r.direction, r.path, r.detail, r.source]));
      expect(ssp.cuiDataFlows!.ingress).toEqual(rows.filter(r => r.direction === 'Ingress').map(r => r.path));
      expect(json).not.toContain('SFTP/FTPS');
      expect(b.summary).not.toContain('not configured');
    });

    test('interconnections add the CUI repository location with its stated conflict', () => {
      const repo = ssp.interconnections.find(i => i.type === 'cui_repository')!;
      expect(repo.name).toBe('Azure DevOps (GCC High)');
      expect(repo.description).toContain('devops_in_scope: No');
      expect(repo.description).toContain('Stated conflict');
    });

    test('MP 50 users vs TM 0 licences is a stated conflict, not one of them', () => {
      const conflict = ssp.countConflicts!.find(c => c.quantity === 'users')!;
      const bySource = Object.fromEntries(conflict.values.map(v => [v.source, v.value]));
      expect(bySource['Mission Plan inputs.infrastructure_configuration.user_count']).toBe('50');
      expect(bySource['Tenant Manifest tenant_identity.license_count']).toBe('0');
      // W5 cycle 1: the CUI-authorised user count is a different quantity; it is never in the 'users' conflict.
      expect(bySource['CUI boundary fact cui_user_count']).toBeUndefined();
      expect(conflict.statement).toContain('uses none');
    });
  });

  describe('W4.4 DOCX', () => {
    test('no markdown in runs: 0 "##", 0 "**", 0 backticks', () => {
      expect(count(docx.body, '##')).toBe(0);
      expect(count(docx.body, '**')).toBe(0);
      expect(count(docx.body, '`')).toBe(0);
    });

    test('Appendix M resolved; Appendix N cites the Assessment Guide v2.13', () => {
      expect(count(docx.body, '[Definition not resolved')).toBe(0);
      expect(json).not.toContain('[Definition not resolved');
      expect(docx.body).toMatch(/^AC — Access Control \(control family\)$/m);
      expect(docx.body).toContain('CMMC Assessment Guide, Level 2, Version 2.13');
      expect(docx.body).not.toContain('CMMC Model Version 2.0');
    });

    test('exactly one assessed SPRS; the projection is always labelled', () => {
      expect(count(docx.body, 'SPRS (assessed)')).toBe(1);
      expect(docx.body).toContain('SPRS (assessed): 33');
      const sentences = docx.body.split(/(?<=[.!?])\s+|\n/).filter(s => /SPRS|score/i.test(s) && /(?<![\d.-])45(?!\d)/.test(s));
      expect(sentences.length).toBeGreaterThan(0);
      for (const s of sentences) expect(s).toMatch(/project/i);
    });

    test('§14 renders the POA&M items and blockers tables', () => {
      const s14 = docx.body.slice(docx.body.lastIndexOf('14. Plan of Action and Milestones'), docx.body.indexOf('15. Document Control', docx.body.lastIndexOf('14. Plan of Action and Milestones')));
      expect(s14).toContain('POA&M items (12):');
      expect(s14).toContain('Planned corrective action (first step; full text in the POA&M)');
      expect(s14).toContain('Eligibility blockers (18)');
      expect(s14).toContain('PS.L2-3.9.2');
    });

    test('one CUI marking (cover, classification, header, footer); System Type from variables only', () => {
      expect(docx.body).toContain('Classification: CUI//SP-CTI');
      expect(docx.body).not.toContain('SP-SSP');
      expect(docx.body).not.toContain('Classification: CUI Basic');
      const markings = new Set(docx.headerFooter.split('\n').map(l => l.trim()).filter(Boolean));
      expect([...markings]).toEqual(['CUI//SP-CTI']);
      expect(docx.body).toContain('System Type: Not supplied by the organisation (content gap): the System Type.'); // W5: the content-gap sentence
      expect(docx.body).not.toContain('Minor Application');
    });

    test('Appendix C embeds a rendered diagram or says "not rendered"; no Mermaid source', () => {
      const c = docx.body.slice(docx.body.indexOf('Appendix C: System Authorization Boundary Diagram'), docx.body.indexOf('Appendix D:'));
      expect(c).toContain('Diagram not rendered');
      expect(c).not.toMatch(/graph TB|subgraph/);
    });

    test('the posture block and the stated conflicts are in the DOCX', () => {
      expect(docx.body).toContain('1.1 Posture Reconciliation');
      expect(docx.body).toContain('0 met / 31 not met / 74 partial / 19 unknown (124 requirement ids)');
      expect(docx.body).toContain('-203 (planning posture, not an assessment');
      expect(docx.body).toContain('Stated conflicts in the inputs:');
      expect(docx.body).not.toMatch(/authorized for operation/i);
    });
  });
});
