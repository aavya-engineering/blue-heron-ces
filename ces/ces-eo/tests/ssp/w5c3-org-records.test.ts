// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 3 (P11): organisation records uploaded through the Evidence Collector fill the "records that
 * evidence this control" content gap and appendices F / G; statuses never change (verify V27).
 * Fixtures: tests/fixtures/w5c3-records = a copy of six of the fictional S1 record files and their catalog
 * (run package customers/s1-mach/records, scripts/build-customer-records.mjs). Item ids are fixed here; in a
 * run EC assigns them per upload, so the stable reference is the sha256. Names are the fictional S1 roster.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import {
  applyOrganisationRecords, parseOrganisationRecord, readOrganisationRecords, recordsSentence, personnelLedger, trainingMatrix,
  ORGANISATION_RECORD_METHOD, RECORDS_LABEL, type OrganisationRecord,
} from '../../src/eo/ssp/OrganisationRecords.js';
import { NOT_SUPPLIED, notSupplied } from '../../src/eo/ssp/ContentGap.js';

const DIR = path.resolve(__dirname, '../fixtures/w5c3-records');
interface CatalogItem { file: string; control_ids: string[]; sha256: string; media_type: string; collected_at: string; record_kind: string }
const catalog = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8')) as { items: CatalogItem[] };
const PRESENT = ['training-role-based.json', 'personnel-screening.json', 'personnel-lifecycle.json', 'audit-log-reviews.json', 'physical-access-devices.json'];

function ecItem(file: string, content: Buffer, controlIds: string[], over: Partial<EcEvidenceItem> = {}): EcEvidenceItem {
  return {
    contractVersion: '1.0.0', itemId: `eci-fixture-${file.replace(/\.json$/, '')}`, tenantSlug: 's1-mach', controlIds, source: 'manual_upload',
    filename: file, mediaType: 'application/json', sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.length,
    collectedAt: '2026-09-30T17:00:00.000Z', submittedByRole: 'compliance_officer', mode: 'sim', ...over,
  };
}
function fixtureRecords(): OrganisationRecord[] {
  return PRESENT.map(file => {
    const c = catalog.items.find(i => i.file === file)!;
    const content = fs.readFileSync(path.join(DIR, file));
    const item = ecItem(file, content, c.control_ids);
    expect(item.sha256).toBe(c.sha256); // the fixture is the generator's file, byte for byte
    return parseOrganisationRecord(item, content)!;
  }).sort((a, b) => (a.filename < b.filename ? -1 : 1));
}

const gap = (kind: string) => notSupplied(`the ${kind} records that evidence this control`);
const LONG = 'The organisation requires this practice in its policy set; the ISSO owns the procedure and keeps the operating records.';
function fixtureSsp() {
  const ctl = (control_id: string, status: string, kind?: string) => ({
    control_id, nist_ref: control_id.split('-')[1], family: control_id.slice(0, 2), status,
    implementationNarrative: `${LONG}${kind ? `\n\n${gap(kind)}` : ''}\n\nPolicy: training policy.`,
    evidenceReferences: [`evidence/${control_id}.json`], evidenceDetails: [{ sha256: 'a'.repeat(64) }], evidenceArtifactIds: ['art-1'],
    relatedPolicies: [], odpValues: [],
  });
  return {
    controlImplementations: [
      ctl('AT.L2-3.2.2', 'not_met', 'training'),
      ctl('AU.L2-3.3.8', 'not_met', 'audit process'),
      ctl('AU.L2-3.3.9', 'partial', 'audit process'),
      ctl('PE.L1-3.10.5', 'not_assessed', 'physical security'),
      ctl('RA.L2-3.11.1', 'not_met', 'risk assessment'),
      ctl('AT.L2-3.2.1', 'met'),
      ctl('PS.L2-3.9.2', 'not_met'),
    ],
    appendices: [
      { id: 'E', documentId: 'POLICY-SET MANIFEST', summary: 'policy index' },
      { id: 'F', documentId: NOT_SUPPLIED, summary: 'Personnel security screening ledger with screening states and evidence artifact counts.' },
      { id: 'G', documentId: NOT_SUPPLIED, summary: 'Training compliance matrix with required courses, completion status, and compliance percentage per person.' },
    ],
    contentProvenance: [{ field: 'cageCode', provenance: 'organisation profile' as const, source: 'policy-inputs profile organization.cage_code (PI.ORG.006)' }],
  };
}

describe('W5c3 P11: organisation records fill the records content gaps and appendices F / G', () => {
  test('golden: the AT.L2-3.2.2 narrative names the record kind, count, date range, file and hash reference', () => {
    const ssp = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    const at = ssp.controlImplementations.find(c => c.control_id === 'AT.L2-3.2.2')!;
    expect(at.implementationNarrative).toBe(
      `${LONG}\n\n**Organisation-supplied records (examine):** 4 role-based security training completion records dated 2026-07-08 to 2026-08-04 `
      + '(training-role-based.json, EC item eci-fixture-training-role-based, sha256 b4adb605f302..., marked SIMULATED CUSTOMER (FICTIONAL)). '
      + 'The organisation supplied these records through the Evidence Collector; they are listed for an assessor to examine and, on their own, '
      + "are not a tested condition and do not set this control's status; a document review of an objective (GD-b) or a records-store decision can, "
      + 'and the assessment finding then names it.\n\nPolicy: training policy.',
    );
    expect(ORGANISATION_RECORD_METHOD).toBe('examine');
  });

  test('a record tagged to several controls fills each; a control with no tagged record keeps its gap', () => {
    const ssp = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    const narr = (id: string) => ssp.controlImplementations.find(c => c.control_id === id)!.implementationNarrative;
    for (const id of ['AU.L2-3.3.8', 'AU.L2-3.3.9']) expect(narr(id)).toContain('13 weekly audit log review sign-off records dated 2026-07-06 to 2026-09-28 (audit-log-reviews.json');
    expect(narr('PE.L1-3.10.5')).toContain('6 physical access device (badge and key) register records dated 2026-07-31 to 2026-09-22');
    expect(narr('RA.L2-3.11.1')).toContain(gap('risk assessment'));
    for (const id of ['AT.L2-3.2.2', 'AU.L2-3.3.8', 'AU.L2-3.3.9', 'PE.L1-3.10.5']) expect(narr(id)).not.toContain(NOT_SUPPLIED);
  });

  test('golden: appendix F renders from the screening and lifecycle records (both leavers, the joiner)', () => {
    const ssp = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    const f = ssp.appendices.find(a => a.id === 'F')!;
    expect(f.documentId).toBe('ORGANISATION RECORDS: personnel-lifecycle.json (sha256 46321701746b...); personnel-screening.json (sha256 668c58923a33...)');
    const lines = f.summary.split('\n');
    expect(lines[0]).toBe('| Name | Job Title | Screening | Screened On | Result | Onboarding / Termination Checklist |');
    const S = 'identity verification, employment history, criminal history check, US person status';
    // Rows follow the screening record (roster order); the lifecycle column joins on person_id.
    expect(lines[2]).toBe(`| Alvane Ashenmere | President / Owner | ${S} | 2025-06-21 | cleared | - |`);
    expect(lines).toContain(`| Kestin Marrowmere | CNC Machinist | ${S} | 2026-08-31 | cleared | onboarding 2026-09-10: 5 of 5 checklist steps done |`);
    expect(lines).toContain(`| Dorrel Kettlestead | CNC Machinist | ${S} | 2023-12-26 | cleared | termination 2026-08-22: 5 of 5 checklist steps done |`);
    expect(lines).toContain(`| Merrin Hollinmere | Program Coordinator | ${S} | 2024-11-11 | cleared | termination 2026-09-22: 3 of 5 checklist steps done; open: account disabled (leaver workflow run); removed from CUI-Authorized-Users and S1-CUI-Program-Team |`);
    expect(lines.filter(l => l.startsWith('| ') && !l.startsWith('| Name')).length).toBe(45);
    expect(f.summary).toContain('Organisation-supplied records (examine; not a tested condition): 15 onboarding and termination checklist records dated 2026-08-22 to 2026-09-22');
  });

  test('golden: appendix G renders from the training records', () => {
    const ssp = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    const g = ssp.appendices.find(a => a.id === 'G')!;
    expect(g.documentId).toBe('ORGANISATION RECORDS: training-role-based.json (sha256 b4adb605f302...)');
    expect(g.summary.split('\n').slice(0, 6)).toEqual([
      '| Name | Job Title | S1 Privileged Administrator Security Training (2026) | Required Courses | Completed Courses | Compliance % |',
      '|------|-----------|---|------------------|-------------------|---------------|',
      '| Tamsel Kettlevane | Information Security Manager (ISSM) | completed 2026-08-04 | 1 | 1 | 100% |',
      '| Corvane Marrowholt | Information Systems Security Officer (ISSO) | completed 2026-07-26 | 1 | 1 | 100% |',
      '| Dorrel Nettlecombe | Systems Administrator | completed 2026-07-17 | 1 | 1 | 100% |',
      '| Kestin Oakenwick | Systems Administrator | completed 2026-07-08 | 1 | 1 | 100% |',
    ]);
  });

  test('appendix G across courses: a course a person has no row for is "not required"; an incomplete course is stated', () => {
    const doc = (rows: unknown[]) => Buffer.from(JSON.stringify({ schema: 'ces-org-record/1', record_kind: 'training_completion', rows }));
    const a = doc([{ date: '2026-08-01', person_id: 'p1', name: 'Alvane Ashenmere', job_title: 'Owner', course: 'Awareness', status: 'completed' },
      { date: '2026-08-02', person_id: 'p2', name: 'Halric Brackvane', job_title: 'VP', course: 'Awareness', status: 'assigned' }]);
    const b = doc([{ date: '2026-08-03', person_id: 'p1', name: 'Alvane Ashenmere', job_title: 'Owner', course: 'Insider threat', status: 'completed' }]);
    const recs = [parseOrganisationRecord(ecItem('a.json', a, ['AT.L2-3.2.1']), a)!, parseOrganisationRecord(ecItem('b.json', b, ['AT.L2-3.2.3']), b)!];
    expect(trainingMatrix(recs)!.summary.split('\n').slice(0, 4)).toEqual([
      '| Name | Job Title | Awareness | Insider threat | Required Courses | Completed Courses | Compliance % |',
      '|------|-----------|---|---|------------------|-------------------|---------------|',
      '| Alvane Ashenmere | Owner | completed 2026-08-01 | completed 2026-08-03 | 2 | 2 | 100% |',
      '| Halric Brackvane | VP | assigned | not required | 1 | 0 | 0% |',
    ]);
  });

  test('V27: statuses and every evidence field are unchanged; met and untagged-gap controls keep their narrative', () => {
    const before = fixtureSsp();
    const after = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    after.controlImplementations.forEach((c, i) => {
      const b = before.controlImplementations[i];
      expect(c.status).toBe(b.status);
      expect(c.evidenceReferences).toEqual(b.evidenceReferences);
      expect(c.evidenceDetails).toEqual(b.evidenceDetails);
      expect(c.evidenceArtifactIds).toEqual(b.evidenceArtifactIds);
    });
    // AT.L2-3.2.1 (met) and PS.L2-3.9.2 (tagged by the lifecycle record, no gap sentence) are untouched.
    for (const id of ['AT.L2-3.2.1', 'PS.L2-3.9.2']) {
      expect(after.controlImplementations.find(c => c.control_id === id)!.implementationNarrative)
        .toBe(before.controlImplementations.find(c => c.control_id === id)!.implementationNarrative);
    }
  });

  test('a met control never takes the records sentence, even if it carried the gap sentence', () => {
    const ssp = fixtureSsp();
    const at = ssp.controlImplementations.find(c => c.control_id === 'AT.L2-3.2.2')!;
    at.status = 'met';
    const narrative = at.implementationNarrative;
    applyOrganisationRecords(ssp, fixtureRecords());
    expect(at.implementationNarrative).toBe(narrative);
  });

  test('EO\'s own F / G (AUTO-GENERATED) win; idempotent on a second apply', () => {
    const ssp = fixtureSsp();
    ssp.appendices[1].documentId = 'AUTO-GENERATED';
    const recs = fixtureRecords();
    applyOrganisationRecords(ssp, recs);
    expect(ssp.appendices[1].summary).toBe('Personnel security screening ledger with screening states and evidence artifact counts.');
    const once = JSON.stringify(ssp);
    applyOrganisationRecords(ssp, recs);
    expect(JSON.stringify(ssp)).toBe(once);
  });

  test('provenance: one "organisation records" entry per filled field, full sha256, no gap sentence; existing entries kept', () => {
    const ssp = applyOrganisationRecords(fixtureSsp(), fixtureRecords());
    const prov = ssp.contentProvenance;
    expect(prov[0].field).toBe('cageCode');
    const fields = prov.filter(p => p.provenance === 'organisation records').map(p => p.field);
    expect(fields).toEqual([
      'controlImplementations[AT.L2-3.2.2].implementationNarrative', 'controlImplementations[AU.L2-3.3.8].implementationNarrative',
      'controlImplementations[AU.L2-3.3.9].implementationNarrative', 'controlImplementations[PE.L1-3.10.5].implementationNarrative',
      'appendices[F].documentId', 'appendices[G].documentId',
    ]);
    const at = prov.find(p => p.field === 'controlImplementations[AT.L2-3.2.2].implementationNarrative')!;
    expect(at.source).toContain('sha256 b4adb605f302');
    expect(at.source).toContain('method examine');
    expect(at.source).toMatch(/sha256 [0-9a-f]{64}/);
    for (const p of prov) expect(p.source).not.toContain(NOT_SUPPLIED);
  });

  test('every gap control tagged: no content-gap sentence left anywhere in the SSP', () => {
    const ssp = fixtureSsp();
    const extra = (file: string, controls: string[]) => {
      const c = Buffer.from(JSON.stringify({ schema: 'ces-org-record/1', record_kind: 'risk_assessment', kind_label: 'annual risk assessment register entry', rows: [{ date: '2026-08-15', risk_id: 'R-01' }] }));
      return parseOrganisationRecord(ecItem(file, c, controls), c)!;
    };
    applyOrganisationRecords(ssp, [...fixtureRecords(), extra('risk-assessment.json', ['RA.L2-3.11.1'])]);
    expect(JSON.stringify(ssp)).not.toContain(NOT_SUPPLIED);
    expect(ssp.controlImplementations.find(c => c.control_id === 'RA.L2-3.11.1')!.implementationNarrative)
      .toContain('1 annual risk assessment register entry record dated 2026-08-15 (risk-assessment.json');
  });

  test('parse: a hash mismatch, a non-record JSON, an empty record and an unknown schema are not records', () => {
    const good = fs.readFileSync(path.join(DIR, 'training-role-based.json'));
    expect(parseOrganisationRecord(ecItem('x.json', good, ['AT.L2-3.2.2'], { sha256: 'b'.repeat(64) }), good)).toBeUndefined();
    const other = Buffer.from(JSON.stringify({ policy: 'acp' }));
    expect(parseOrganisationRecord(ecItem('acp.json', other, ['AC.L1-3.1.1']), other)).toBeUndefined();
    const empty = Buffer.from(JSON.stringify({ schema: 'ces-org-record/1', record_kind: 'visitor_log', rows: [] }));
    expect(parseOrganisationRecord(ecItem('e.json', empty, ['PE.L1-3.10.3']), empty)).toBeUndefined();
    const v2 = Buffer.from(JSON.stringify({ schema: 'ces-org-record/2', record_kind: 'visitor_log', rows: [{ date: '2026-09-01' }] }));
    expect(parseOrganisationRecord(ecItem('v.json', v2, ['PE.L1-3.10.3']), v2)).toBeUndefined();
  });

  test('read: only JSON items are fetched, sorted by filename; EC failures give an empty list, never a throw', async () => {
    const recFile = fs.readFileSync(path.join(DIR, 'training-role-based.json'));
    const pdf = Buffer.from('%PDF-1.4\n');
    const items = [
      ecItem('training-role-based.json', recFile, ['AT.L2-3.2.2']),
      { ...ecItem('acp.pdf', pdf, ['AC.L1-3.1.1']), mediaType: 'application/pdf' },
    ];
    const fetched: string[] = [];
    const source = {
      readItems: async () => items,
      readItemContent: async (_t: string, id: string) => { fetched.push(id); return { buffer: id.includes('role') ? recFile : pdf }; },
    };
    const recs = await readOrganisationRecords(source, 's1-mach');
    expect(recs.map(r => r.filename)).toEqual(['training-role-based.json']);
    expect(fetched).toEqual(['eci-fixture-training-role-based']);
    const down = { readItems: async () => { throw new Error('EC down'); }, readItemContent: async () => null };
    await expect(readOrganisationRecords(down, 's1-mach')).resolves.toEqual([]);
  });

  test('no records: the SSP is returned unchanged', () => {
    const ssp = fixtureSsp();
    const before = JSON.stringify(ssp);
    applyOrganisationRecords(ssp, []);
    expect(JSON.stringify(ssp)).toBe(before);
  });

  test('wording: the label and sentence carry no negation-lexicon phrase and no zero count', () => {
    const lexicon = ['has not been created', 'not yet configured', 'has not been configured', 'data not available', 'No artifacts captured',
      '0 authentication methods', '0 managed devices', 'managed by .', 'was not read', 'returned 0 objects', 'not assessed (unread'];
    const s = recordsSentence(fixtureRecords());
    expect(s.startsWith(RECORDS_LABEL)).toBe(true);
    for (const p of lexicon) expect(s).not.toContain(p);
    expect(personnelLedger(fixtureRecords())!.summary).not.toContain(NOT_SUPPLIED);
  });
});
