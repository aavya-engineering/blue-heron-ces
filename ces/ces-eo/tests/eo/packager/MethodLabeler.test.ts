// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W4.1: 800-171A method labels (examine / test / interview) on ledger objectives
 * and on the SSP's evidence details. The ledger replay uses run 25's stored E7 pass 3 snapshot
 * (tests/fixtures/drift/run25-snapshots.json).
 */
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({ uploadEvidenceBlob: jest.fn(), downloadBlob: jest.fn() }), { virtual: true });

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import {
  CONFIGURATION_SOURCES, INTERVIEW_SOURCES, methodForObjective, methodForStoreSource, STAMPER_FILE_METHOD,
} from '../../../src/eo/packager/MethodLabeler.js';
import { buildDeterminationLedger, type DeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger.js';
import { buildEvidenceDetails } from '../../../src/eo/ssp/SspGenerator.js';
import type { StamperEvidence } from '../../../src/eo/evidence/StamperEvidenceLoader.js';

describe('methodForStoreSource', () => {
  it('configuration artefacts and collected records are examined, training records are interviews, other live reads are tests', () => {
    for (const s of ['conditionalAccess', 'authMethods', 'deviceConfigurations', 'crossTenantPolicy', 'agreements']) expect(methodForStoreSource(s)).toBe('examine');
    expect(methodForStoreSource('trainingUserCoverage')).toBe('interview');
    for (const s of ['collect.unifiedAuditLog', 'collect.directoryAudits', 'collect.deviceCompliance', 'collect.securityAlerts']) expect(methodForStoreSource(s)).toBe('examine');
    // Log/alert live reads are records too (examine, 2026-10-28); mechanism reads stay test.
    for (const s of ['directoryAudits', 'securityAlerts', 'signInLogs', 'securityIncidents', 'riskDetections']) expect(methodForStoreSource(s)).toBe('examine');
    for (const s of ['directoryUsers', 'managedDevices', 'roleAssignments', 'secureScores']) {
      expect(methodForStoreSource(s)).toBe('test');
    }
    expect(methodForStoreSource('someNewRead')).toBe('test');
  });

  it('no source is in both sets; a Stamper file is examined', () => {
    for (const s of INTERVIEW_SOURCES) expect(CONFIGURATION_SOURCES.has(s)).toBe(false);
    expect(STAMPER_FILE_METHOD).toBe('examine');
  });
});

describe('methodForObjective', () => {
  it('labels by ledger source', () => {
    expect(methodForObjective({ source: 'personnel' })).toBe('interview');
    expect(methodForObjective({ source: 'training' })).toBe('interview');
    expect(methodForObjective({ source: 'policy' })).toBe('examine');
    expect(methodForObjective({ source: 'disposition' })).toBe('examine');
    expect(methodForObjective({ source: 'tenant-suite' })).toBe('test');
    expect(methodForObjective({ source: 'none' })).toBeUndefined();
  });

  it('digital-signal objectives follow the deciding tier', () => {
    const d = (statusRationale: string) => methodForObjective({ source: 'digital-signal', statusRationale, storeSourceIds: ['collect.signIns'], hasStamperFiles: true });
    expect(d('Tier 2 (live read) decides: discovery/exists: 3 policies')).toBe('test');
    expect(d('Tier 1 (current-run Stamper NOT_SAT) decides: evidence_import/missing: x')).toBe('examine');
    expect(d('Tier 3 (state-verified execution verdict) decides: evidence_import/imported: x')).toBe('examine');
    expect(d('Tier 4 (evidence-only SAT) decides: evidence_import/imported: x')).toBe('examine');
    expect(d('Tier 5 (EO blob) decides: blob_artifact/exists: x')).toBe('examine');
  });

  it('without a deciding tier, the evidence present decides; with none, no label', () => {
    const none = 'No source has an opinion (every source is unread or display-only)';
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none, storeSourceIds: ['conditionalAccess', 'directoryUsers'] })).toBe('test');
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none, storeSourceIds: ['conditionalAccess', 'collect.signIns'] })).toBe('examine');
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none, storeSourceIds: ['conditionalAccess'] })).toBe('examine');
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none, storeSourceIds: ['trainingUserCoverage'] })).toBe('interview');
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none, hasStamperFiles: true })).toBe('examine');
    expect(methodForObjective({ source: 'digital-signal', statusRationale: none })).toBeUndefined();
  });
});

describe('the ledger carries the label (run 25, E7 pass 3)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/drift/run25-snapshots.json'), 'utf-8'));
  const snap = fx.snapshots['r25-p3'] as AssessmentSnapshot;
  const ledger = buildDeterminationLedger({ tenantId: snap.tenantId, generatedAt: snap.generatedAt, snapshot: snap });
  const tierOf = new Map(snap.controls.map(c => [c.control_id, /^Tier (\d)/.exec((c as { statusRationale?: string }).statusRationale ?? '')?.[1] ?? null]));

  it('every objective whose control has a deciding tier has a method, and it matches the tier', () => {
    const decided = ledger.objectives.filter(o => o.source === 'digital-signal' && tierOf.get(o.controlId));
    expect(decided.length).toBeGreaterThan(200);
    for (const o of decided) expect({ id: o.objectiveId, m: o.method }).toEqual({ id: o.objectiveId, m: tierOf.get(o.controlId) === '2' ? 'test' : 'examine' });
  });

  it('objectives with no tier and no evidence carry no label; the methods field (all three) is unchanged', () => {
    const undecided = ledger.objectives.filter(o => o.source === 'digital-signal' && !tierOf.get(o.controlId));
    expect(undecided.length).toBeGreaterThan(0);
    for (const o of undecided) {
      const hasStamper = (snap.controls.find(c => c.control_id === o.controlId)?.sources ?? [])
        .some(s => s.type === 'evidence_import' && (s.result === 'imported' || s.result === 'missing'));
      if (hasStamper) expect(o.method).toBe('examine'); else expect(o.method).toBeUndefined();
    }
    for (const o of ledger.objectives) expect(o.methods).toEqual(['examine', 'interview', 'test']);
  });

  it('a store ref without a deciding tier labels the objective from the ref (a collected record: examine)', () => {
    const notAssessed = snap.controls.find(c => !/^Tier/.test((c as { statusRationale?: string }).statusRationale ?? ''))!;
    const l = buildDeterminationLedger({
      tenantId: snap.tenantId, generatedAt: snap.generatedAt, snapshot: snap,
      evidenceRefsLookup: (id) => id.startsWith(`${notAssessed.control_id}[`)
        ? [{ recordId: 'r1', tenantId: snap.tenantId, sourceId: 'collect.signIns', sha256: 'a'.repeat(64), collectedAt: snap.generatedAt, status: 'success' }]
        : [],
    });
    const objs = l.objectives.filter(o => o.controlId === notAssessed.control_id);
    expect(objs.length).toBeGreaterThan(0);
    for (const o of objs) expect(o.method).toBe('examine');
  });

  it('personnel objectives are interviews', () => {
    const l = buildDeterminationLedger({
      tenantId: snap.tenantId, generatedAt: snap.generatedAt, snapshot: snap,
      manualControlStatus: { 'PS.L2-3.9.1': { status: 'met', source: 'personnel', rationale: 'screening ledger' } },
    });
    const ps = l.objectives.filter(o => o.controlId === 'PS.L2-3.9.1');
    expect(ps.length).toBeGreaterThan(0);
    for (const o of ps) expect(o.method).toBe('interview');
  });
});

describe('the SSP evidence details carry the label (SspGenerator.buildEvidenceDetails)', () => {
  it('a Stamper file is examine; a store record follows its source', () => {
    const stamper: StamperEvidence[] = [{
      complianceVerdict: 'SAT', sha256Hash: 'b'.repeat(64), timestamp: '2026-10-28T02:43:00.000Z', controlIds: ['AC.L1-3.1.1'],
      entryId: 'AC.L1-3.1.1.ca-policy-evidence', label: 'Verify CA', evidenceFilePath: 'access_control/ac.l1-3.1.1.ca.json', mode: 'evidence-only',
    } as StamperEvidence];
    const ref = (sourceId: string, recordId: string) => ({ recordId, tenantId: 't', sourceId, sha256: 'c'.repeat(64), collectedAt: '2026-10-28T02:44:00.000Z' });
    const ledger = { objectives: [
      { objectiveId: 'AC.L1-3.1.1[a]', controlId: 'AC.L1-3.1.1', evidenceRefs: [ref('conditionalAccess', 'r1'), ref('collect.signIns', 'r2'), ref('trainingUserCoverage', 'r3'), ref('directoryUsers', 'r4')] },
    ] } as unknown as DeterminationLedger;
    const details = buildEvidenceDetails(stamper, ledger, undefined).get('AC.L1-3.1.1')!;
    const byKey = Object.fromEntries(details.map(d => [d.kind === 'stamper' ? 'stamper' : d.sourceId, d.method]));
    expect(byKey).toEqual({ stamper: 'examine', conditionalAccess: 'examine', 'collect.signIns': 'examine', trainingUserCoverage: 'interview', directoryUsers: 'test' });
  });
});
