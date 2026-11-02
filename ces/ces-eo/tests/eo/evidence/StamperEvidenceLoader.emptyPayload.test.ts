// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.2a (EO-collection plan; REVIEW P0 #3; critique G1/PE-1): a Stamper SAT counts only when its
 * rawResponse is non-empty — evidence-only records included. An empty one becomes `no_query`.
 * A non-empty evidence-only SAT still counts under B8 (lowest tier, "state not verified").
 * W0.2c: a `stamper/<version>@<ClientId>` executorIdentity is read into the source and on into
 * the determination ledger's provenance (`executorIdentities`).
 * Real StamperEvidenceLoader over files on disk, real ControlAssessor.merge, real ledger builder.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StamperEvidenceLoader, isEmptyPayload, EMPTY_PAYLOAD, executorIdentityOf } from '../../../src/eo/evidence/StamperEvidenceLoader';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const slug = 'w02a-empty-payload';
const TS = '2026-10-27T19:06:20.170Z';
const EXECUTOR = 'stamper/2.2.3@11111111-2222-4333-8444-555555555555';

/** Shape of `au.l2-3.3.5.audit-search.json` (muster-partial, run 19): evidence-only SAT, empty payload. */
function record(o: { entry: string; label: string; controlIds: string[]; verdict: 'SAT' | 'NOT_SAT'; raw: string; evidenceOnly: boolean; executor?: string }) {
  return JSON.stringify({
    rawResponse: o.raw,
    outcome: 'automated_success',
    outcomeRationale: 'Command completed successfully (exit code 0)',
    complianceVerdict: o.verdict,
    registryEntry: { entry_id: o.entry, label: o.label, control_ids: o.controlIds },
    metadata: {
      controlIds: o.controlIds, timestamp: TS, executorIdentity: o.executor ?? 'unknown',
      commandExecuted: o.evidenceOnly ? `[manual/evidence-only] ${o.label}` : 'Set-Something -Enabled $true',
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', moduleVersions: {}, environment: 'GCC-High',
    },
  });
}

describe('W0.2a: an empty-payload SAT never counts as a positive source', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w02a-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const dir = path.join(tmp, 'Stamper', 'plan-data', slug, 'evidence', 'audit_accountability');
    fs.mkdirSync(dir, { recursive: true });
    const put = (file: string, body: string) => fs.writeFileSync(path.join(dir, file), body);
    // AU.L2-3.3.5: its only SAT is evidence-only and empty (the run-19 file).
    put('au.l2-3.3.5.audit-search.json', record({ entry: 'AU.L2-3.3.5.audit-search', label: 'Audit Log Search Evidence (Reduce/Review Capability)', controlIds: ['AU.L2-3.3.5'], verdict: 'SAT', raw: '', evidenceOnly: true }));
    // AU.L2-3.3.6: a non-empty evidence-only SAT still counts, labelled (B8).
    put('au.l2-3.3.6.audit-report-evidence.json', record({ entry: 'AU.L2-3.3.6.audit-report', label: 'Audit Report Evidence', controlIds: ['AU.L2-3.3.6'], verdict: 'SAT', raw: '{"value":[{"Operations":"Set-Mailbox"}]}', evidenceOnly: true, executor: EXECUTOR }));
    // AU.L2-3.3.1: an empty command-backed SAT does not count either.
    put('au.l2-3.3.1.audit-enable.json', record({ entry: 'AU.L2-3.3.1.audit-enable', label: 'Enable Unified Audit Log Ingestion', controlIds: ['AU.L2-3.3.1'], verdict: 'SAT', raw: '   ', evidenceOnly: false }));
    // AU.L2-3.3.2: one empty and one non-empty SAT: the non-empty one carries the control.
    put('au.l2-3.3.2.a.json', record({ entry: 'AU.L2-3.3.2.a', label: 'Empty signin read', controlIds: ['AU.L2-3.3.2'], verdict: 'SAT', raw: '[]', evidenceOnly: true }));
    put('au.l2-3.3.2.b.json', record({ entry: 'AU.L2-3.3.2.b', label: 'Signin logs', controlIds: ['AU.L2-3.3.2'], verdict: 'SAT', raw: '{"value":[{"id":"s1"}]}', evidenceOnly: false, executor: EXECUTOR }));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  function sources() {
    const loader = new StamperEvidenceLoader(slug);
    return loader.toAssessmentSources(loader.loadEvidenceForTenant());
  }

  function snapshot() {
    return new ControlAssessor(controlsRefPath, []).merge('w02a', [], [], [], [], sources());
  }
  const control = (snap: ReturnType<typeof snapshot>, id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;

  it('empty evidence-only SAT (au.l2-3.3.5.audit-search.json shape) -> no_query, "empty payload"', () => {
    const s = sources().get('AU.L2-3.3.5')!;
    expect(s.map(x => x.result)).toEqual(['no_query']);
    expect(s[0].detail).toContain(EMPTY_PAYLOAD);
    const c = control(snapshot(), 'AU.L2-3.3.5');
    expect(c.status).toBe('not_assessed');
  });

  it('non-empty evidence-only SAT still counts, at the lowest tier, labelled "state not verified" (B8)', () => {
    const s = sources().get('AU.L2-3.3.6')!;
    expect(s.map(x => x.result)).toEqual(['imported']);
    expect(s[0].detail.endsWith('(state not verified)')).toBe(true);
    const c = control(snapshot(), 'AU.L2-3.3.6');
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 4 \(evidence-only Stamper SAT\) decides; state not verified/);
  });

  it('empty command-backed (state-verified) SAT -> no_query as well', () => {
    expect(sources().get('AU.L2-3.3.1')!.map(x => x.result)).toEqual(['no_query']);
    expect(control(snapshot(), 'AU.L2-3.3.1').status).toBe('not_assessed');
  });

  it('a control keeps its status from the non-empty SAT when another of its SATs is empty', () => {
    expect(sources().get('AU.L2-3.3.2')!.map(x => x.result).sort()).toEqual(['imported', 'no_query']);
    const c = control(snapshot(), 'AU.L2-3.3.2');
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 3/);
  });

  it('isEmptyPayload: blank, null and empty JSON containers are empty; real payloads are not', () => {
    for (const e of [undefined, null, '', '  ', 'null', '[]', '{}', '""', [], {}]) expect(isEmptyPayload(e)).toBe(true);
    for (const n of ['x', '{"value":[]}', '[{"id":1}]', [{ id: 1 }], { a: 1 }, 0]) expect(isEmptyPayload(n)).toBe(false);
  });

  it('W0.2c: the executor identity is carried on the source and into the ledger provenance', () => {
    const s = sources();
    expect(s.get('AU.L2-3.3.6')![0].detail).toContain(`[executor ${EXECUTOR}]`);
    expect(executorIdentityOf(s.get('AU.L2-3.3.6')![0])).toBe(EXECUTOR);
    // legacy values ('unknown', a tenant slug, bare 'stamper') are not identities and are not carried
    expect(s.get('AU.L2-3.3.5')![0].detail).not.toContain('[executor');

    const snap = snapshot();
    const ledger = buildDeterminationLedger({
      tenantId: 'w02a', generatedAt: TS, snapshot: snap,
      objectivesCatalog: [
        { objectiveId: 'AU.L2-3.3.6[a]', controlId: 'AU.L2-3.3.6', description: 'd', methods: ['examine'] },
        { objectiveId: 'AU.L2-3.3.5[a]', controlId: 'AU.L2-3.3.5', description: 'd', methods: ['examine'] },
      ],
      sprsWeights: {},
    });
    const o6 = ledger.objectives.find(o => o.objectiveId === 'AU.L2-3.3.6[a]')!;
    expect(o6.source).toBe('digital-signal');
    expect(o6.executorIdentities).toEqual([EXECUTOR]);
    expect(ledger.objectives.find(o => o.objectiveId === 'AU.L2-3.3.5[a]')!.executorIdentities).toBeUndefined();
  });
});
