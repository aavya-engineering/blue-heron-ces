// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-KB-2 (gap closure, knowledge-base consumers): every SSP control carries an "Assessment approach" block per
 * 800-171A objective from the KB-1 assessor KBs (methods + evidence-matrix sources, naming which CES holds this run
 * where known). Text only: no status, SPRS or narrative change (AR5, V30). objectiveEvidenceSources is PKG-3's helper.
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
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import { StamperEvidenceLoader } from '../../src/eo/evidence/StamperEvidenceLoader.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';
import { objectiveEvidenceSources, assessmentApproachFor } from '../../src/eo/ssp/AssessorApproach.js';
import type { ApproachedControl, EvidenceIndexedControl } from '../../src/eo/ssp/SspGenerator.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const objectivesRef = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/assessment-objectives'), 'utf-8')) as { objectives: Array<{ objectiveId: string; controlId: string }> };

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const SLUG = 'muster-partial';
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;

describe('GC-KB-2 AssessorApproach helpers', () => {
  test('objectiveEvidenceSources returns the matrix rows for every 800-171A objective', () => {
    expect(objectivesRef.objectives).toHaveLength(320);
    for (const o of objectivesRef.objectives) {
      const rows = objectiveEvidenceSources(o.objectiveId);
      expect({ id: o.objectiveId, n: rows.length > 0 }).toEqual({ id: o.objectiveId, n: true });
      for (const r of rows) expect(['stack_signal', 'ao_row', 'stamper_evidence', 'ec_upload', 'eo_store', 'interview']).toContain(r.ces_source);
    }
    expect(objectiveEvidenceSources('XX.L9-0.0.0[a]')).toEqual([]);
  });

  test('objectiveEvidenceSources returns copies (the KB cache is not mutable through it)', () => {
    const a = objectiveEvidenceSources('AC.L1-3.1.1[a]');
    a[0].notes = 'changed';
    expect(objectiveEvidenceSources('AC.L1-3.1.1[a]')[0].notes).not.toBe('changed');
  });

  test('held: a named Stamper entry, an EO collector covering the objective, EC uploads; unknown when not known', () => {
    const none = assessmentApproachFor('AU.L2-3.3.7')!;
    expect(none.objectives.map(o => o.objectiveId)).toEqual(['AU.L2-3.3.7[a]', 'AU.L2-3.3.7[b]', 'AU.L2-3.3.7[c]']);
    expect(none.objectives.flatMap(o => o.evidence.map(e => e.held)).every(h => h === 'unknown')).toBe(true);
    const some = assessmentApproachFor('AU.L2-3.3.7', {
      stamperEntryIds: ['AU.L2-3.3.7.time-sync'],
      storeRecords: [{ sourceId: 'collect.unifiedAuditLog', objectiveIds: ['AU.L2-3.3.7[a]'] }],
      ecUploads: 0,
    })!;
    const held = (oid: string, src: string) => some.objectives.find(o => o.objectiveId === oid)!.evidence.filter(e => e.cesSource === src).map(e => e.held);
    expect(held('AU.L2-3.3.7[c]', 'stamper_evidence')).toEqual(['held']);
    // FIN-11: the row names an entry the control does not hold this run, so it is not held (it was unknown).
    expect(held('AU.L2-3.3.7[a]', 'stamper_evidence')).toEqual(['not_held']);
    expect(held('AU.L2-3.3.7[a]', 'eo_store')).toEqual(['held']);
    expect(held('AU.L2-3.3.7[a]', 'interview')).toEqual(['unknown']);
    const empty = assessmentApproachFor('AU.L2-3.3.7', { stamperEntryIds: [], storeRecords: [] })!;
    expect(empty.objectives.find(o => o.objectiveId === 'AU.L2-3.3.7[c]')!.evidence.find(e => e.cesSource === 'stamper_evidence')!.held).toBe('not_held');
    expect(some.objectives[2].text).toMatch(/^AU\.L2-3\.3\.7\[c\] .+\. Methods: examine, interview, test\. Evidence sources: .*Intune time sync policy \(Stamper evidence: record present this run\)/);
    expect(assessmentApproachFor('XX.L9-0.0.0')).toBeUndefined();
  });
});

describe('GC-KB-2 SSP on run 23: an approach for every control, text only', () => {
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  let tmp: string;
  let snapshot: AssessmentSnapshot;
  let controls: Array<ApproachedControl & EvidenceIndexedControl>;
  let ssp: any;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb2-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const evidenceDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
    for (const r of readJson<Array<{ path: string; record: unknown }>>('stamper-evidence-run23.json')) {
      const file = path.join(evidenceDir, ...r.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(r.record));
    }
    const stamperEvidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    snapshot = readJson<AssessmentSnapshot>('snapshot-run23.json');
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot,
      ledger: readJson<DeterminationLedger>('ledger-run23.json'),
      variables: {},
      tenantSlug: SLUG,
      stamperEvidence,
    });
    controls = ssp.controlImplementations;
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  test('all 110 controls carry an approach whose objectives match the 800-171A reference', () => {
    expect(controls).toHaveLength(110);
    for (const c of controls) {
      const want = objectivesRef.objectives.filter(o => o.controlId === c.control_id).map(o => o.objectiveId).sort();
      const got = (c.assessmentApproach?.objectives ?? []).map(o => o.objectiveId).sort();
      expect({ id: c.control_id, got }).toEqual({ id: c.control_id, got: want });
      expect(c.assessmentApproach!.summary.length).toBeGreaterThan(0);
      for (const o of c.assessmentApproach!.objectives) {
        expect(o.methods.length).toBeGreaterThan(0);
        expect(o.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  test('statuses are unchanged and the approach never enters the narrative', () => {
    const byId = new Map(snapshot.controls.map(c => [c.control_id, c.status]));
    for (const c of controls) {
      if (byId.has(c.control_id) && byId.get(c.control_id) !== 'partial') expect({ id: c.control_id, s: c.status }).toEqual({ id: c.control_id, s: byId.get(c.control_id) });
      expect(c.implementationNarrative).not.toContain('Evidence sources:');
      expect(c.implementationNarrative).not.toContain(c.assessmentApproach!.summary);
    }
  });

  test('held is derived from this run: Stamper records and evidence-store records show as present', () => {
    const states = controls.flatMap(c => c.assessmentApproach!.objectives.flatMap(o => o.evidence.map(e => `${e.cesSource}:${e.held}`)));
    expect(states).toContain('stamper_evidence:held');
    expect(states.some(s => s === 'eo_store:held' || s === 'eo_store:not_held')).toBe(true);
    expect(states.filter(s => s.startsWith('interview:')).every(s => s === 'interview:unknown')).toBe(true);
    // A control with no Stamper record at all: its Stamper rows are "not held", never "held".
    const bare = controls.find(c => !(c.evidenceDetails ?? []).some(d => d.kind === 'stamper'));
    if (bare) {
      const rows = bare.assessmentApproach!.objectives.flatMap(o => o.evidence.filter(e => e.cesSource === 'stamper_evidence'));
      expect(rows.every(e => e.held === 'not_held')).toBe(true);
    }
  });

  test('the DOCX export still builds with the new field', async () => {
    const exporter = new SspDocxExporter();
    const buf = await exporter.export(ssp);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
