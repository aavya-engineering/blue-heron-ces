// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W3.1 evidence references, on run 23's inputs (scrubbed copies in tests/fixtures/ssp-uplift):
 *  - `snapshot-run23.json`: the stored run-23 snapshot (80 met / 6 not met / 0 partial / 24 not assessed).
 *  - `ledger-run23.json`: the run-23 determination ledger, trimmed to the fields the generator reads
 *    (objective status, source, rationale and evidence-store `evidenceRefs`).
 *  - `stamper-evidence-run23.json`: the 114 Stamper evidence records (relative names; rawResponse
 *    replaced by a marker), written to a temp tenant evidence folder and read by the real loader.
 * Checks: every control named by a Stamper record gets `evidenceDetails` with hashes; no absolute
 * path anywhere in the SSP JSON; the "No artifacts captured" fallback is gone; status counts and
 * `evidenceArtifactIds` are unchanged; Appendix P carries the Evidence index; the DOCX renders it.
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
import type { DeterminationLedger } from '../../src/eo/assessment/DeterminationLedger.js';
import type { EoSystemSecurityPlan } from '../../src/shared/types/ssp.types.js';
import type { EvidenceIndexedControl, EvidenceDetail } from '../../src/eo/ssp/SspGenerator.js';
import { StamperEvidenceLoader } from '../../src/eo/evidence/StamperEvidenceLoader.js';
import type { StamperEvidence } from '../../src/eo/evidence/StamperEvidenceLoader.js';
import { NO_STAMPER_EVIDENCE } from '../../src/eo/generation/SnippetTemplateEngine.js';
import { SspDocxExporter } from '../../src/eo/ssp/SspDocxExporter.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
const SLUG = 'muster-partial';
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;

/** A Windows drive path or a POSIX root path, not the "s:/" inside "https://". */
const ABSOLUTE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\|\/)(?!\/)|"\/(?:tmp|home|Users|var)\//;

type FixtureRecord = { path: string; record: { metadata: { controlIds: string[] } } & Record<string, unknown> };

describe('W3.1 evidence references on run 23', () => {
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  let tmp: string;
  let records: FixtureRecord[];
  let snapshot: AssessmentSnapshot;
  let stamperEvidence: StamperEvidence[];
  let ssp: EoSystemSecurityPlan;
  let controls: EvidenceIndexedControl[];
  let json: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w31-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const evidenceDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence');
    records = readJson<FixtureRecord[]>('stamper-evidence-run23.json');
    for (const r of records) {
      const file = path.join(evidenceDir, ...r.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(r.record));
    }
    stamperEvidence = new StamperEvidenceLoader(SLUG).loadEvidenceForTenant();
    snapshot = readJson<AssessmentSnapshot>('snapshot-run23.json');
    const ledger = readJson<DeterminationLedger>('ledger-run23.json');
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot,
      ledger,
      variables: {},
      tenantSlug: SLUG,
      stamperEvidence,
    });
    controls = ssp.controlImplementations as EvidenceIndexedControl[];
    json = JSON.stringify(ssp);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  test('the loader reads all 114 run-23 records (the /api/assess filesFound count)', () => {
    expect(records).toHaveLength(114);
    expect(stamperEvidence).toHaveLength(114);
  });

  test('every control named by a Stamper record has evidenceDetails with a 64-hex sha256', () => {
    const named = new Set(records.flatMap(r => r.record.metadata.controlIds));
    expect(named.size).toBe(80);
    for (const id of named) {
      const c = controls.find(x => x.control_id === id)!;
      const stamper = (c.evidenceDetails ?? []).filter(d => d.kind === 'stamper');
      const expected = records.filter(r => r.record.metadata.controlIds.includes(id)).length;
      expect({ id, n: stamper.length }).toEqual({ id, n: expected });
      for (const d of stamper) {
        expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(Number.isFinite(Date.parse(d.timestamp))).toBe(true);
      }
    }
    // Every record lands on every control it names: 114 files, one detail per (file, control).
    const totalStamper = controls.reduce((s, c) => s + (c.evidenceDetails ?? []).filter(d => d.kind === 'stamper').length, 0);
    expect(totalStamper).toBe(records.reduce((s, r) => s + new Set(r.record.metadata.controlIds).size, 0));
  });

  test('a Stamper detail carries relative path, entry id, verdict and B8 mode label', () => {
    const c = controls.find(x => x.control_id === 'AC.L1-3.1.1')!;
    const d = c.evidenceDetails!.find(x => x.kind === 'stamper' && x.entryId === 'AC.L1-3.1.1.ca-policy-evidence') as Extract<EvidenceDetail, { kind: 'stamper' }>;
    expect(d.path).toBe('access_control/ac.l1-3.1.1.ca-policy-evidence.json');
    expect(d.verdict).toBe('SAT');
    expect(d.mode).toBe('evidence-only');
    expect(d.modeLabel).toBe('state not verified');
    const verified = controls.flatMap(x => x.evidenceDetails ?? []).find(x => x.kind === 'stamper' && x.mode === 'state-verified') as Extract<EvidenceDetail, { kind: 'stamper' }>;
    expect(verified.modeLabel).toBe('state verified');
  });

  test('ledger evidence-store refs are carried per control, one per record', () => {
    const ledger = readJson<DeterminationLedger>('ledger-run23.json');
    const withRefs = new Set(ledger.objectives.filter(o => o.evidenceRefs?.length).map(o => o.controlId));
    expect(withRefs.size).toBeGreaterThan(0);
    for (const id of withRefs) {
      const store = (controls.find(x => x.control_id === id)!.evidenceDetails ?? []).filter(d => d.kind === 'evidence-store');
      const recordIds = new Set(ledger.objectives.filter(o => o.controlId === id).flatMap(o => (o.evidenceRefs ?? []).map(r => r.recordId)));
      expect(store.map(d => (d as Extract<EvidenceDetail, { kind: 'evidence-store' }>).recordId).sort()).toEqual([...recordIds].sort());
    }
  });

  test('no absolute path anywhere in the SSP JSON; every detail path is relative', () => {
    expect(json).not.toMatch(ABSOLUTE_PATH);
    expect(json).not.toContain(tmp);
    for (const d of controls.flatMap(c => c.evidenceDetails ?? [])) {
      if (d.kind === 'stamper') {
        expect(path.isAbsolute(d.path)).toBe(false);
        expect(d.path).not.toMatch(/^[A-Za-z]:|^[\\/]|\.\./);
      }
    }
  });

  test('the "No artifacts captured" fallback is gone; evidenced narratives state the records', () => {
    expect(json).not.toContain('No artifacts captured');
    for (const c of controls) {
      expect((c.consistencyFlags ?? []).map(f => f.phrase)).not.toContain('No artifacts captured');
    }
    const ac = controls.find(x => x.control_id === 'AC.L1-3.1.1')!;
    expect(ac.implementationNarrative).toContain('access_control/ac.l1-3.1.1.ca-policy-evidence.json');
    expect(ac.implementationNarrative).toContain('state not verified');
    expect(ac.implementationNarrative).toContain('Appendix P');
  });

  test('a control without evidence states that no Stamper record exists (no claim of evidence)', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const bare = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: JSON.parse(JSON.stringify(snapshot)) as AssessmentSnapshot,
      variables: {},
      tenantSlug: SLUG,
    });
    const withSignals = bare.controlImplementations.filter(c => c.status === 'met'
      && snapshot.controls.find(s => s.control_id === c.control_id)?.signals?.length);
    expect(withSignals.length).toBeGreaterThan(0);
    expect(withSignals.some(c => c.implementationNarrative.includes(NO_STAMPER_EVIDENCE))).toBe(true);
    expect(JSON.stringify(bare)).not.toContain('No artifacts captured');
    expect(bare.controlImplementations.every(c => (c as EvidenceIndexedControl).evidenceDetails === undefined)).toBe(true);
  });

  test('status counts and evidenceArtifactIds are unchanged (80 / 6 / 0 / 24)', () => {
    const count = (s: string) => controls.filter(c => c.status === s).length;
    expect([count('met'), count('not_met'), count('partial'), count('not_assessed')]).toEqual([80, 6, 0, 24]);
    for (const c of controls) {
      expect(c.status).toBe(snapshot.controls.find(s => s.control_id === c.control_id)?.status ?? 'not_assessed');
    }
    // evidenceReferences is still built from evidenceArtifactIds only (empty on run 23).
    expect(controls.every(c => c.evidenceReferences.length === 0)).toBe(true);
    expect(snapshot.controls.every(c => c.evidenceArtifactIds.length === 0)).toBe(true);
  });

  test('EC items stay out of evidenceDetails (V27)', () => {
    for (const d of controls.flatMap(c => c.evidenceDetails ?? [])) expect(['stamper', 'evidence-store']).toContain(d.kind);
    expect(JSON.stringify(controls.map(c => c.evidenceDetails ?? []))).not.toContain('acp.pdf');
  });

  test('Appendix P carries the Evidence index with full hashes', () => {
    const p = ssp.appendices!.find(a => a.id === 'P')!;
    expect(p.summary).toContain('**Evidence index**');
    const sample = controls.find(c => c.evidenceDetails?.length)!.evidenceDetails![0];
    expect(p.summary).toContain(sample.sha256);
    const rows = p.summary.split('**Evidence index**')[1].split('\n').filter(l => /^\| [A-Z]{2}\.L/.test(l));
    expect(rows).toHaveLength(controls.reduce((s, c) => s + (c.evidenceDetails?.length ?? 0), 0));
  });

  test('the DOCX renders a per-control evidence line and the Appendix P Evidence index table', async () => {
    const buf = await new SspDocxExporter().export(ssp);
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect(xml).toContain('Evidence records: ');
    expect(xml).toContain('Evidence index');
    expect(xml).toContain('access_control/ac.l1-3.1.1.ca-policy-evidence.json');
    expect(xml).toContain(NO_STAMPER_EVIDENCE);
    expect(xml).not.toContain('**Evidence index**');
  });
});
