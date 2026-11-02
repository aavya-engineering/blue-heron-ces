// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-12: EO reads Stamper's execution-results manifest (consumer side of the ces-shared
 * contract, fed the producer golden `ces-shared/src/types/__fixtures__/stamper-execution-results.json`).
 * A control whose Stamper task failed or was blocked is not_met in the snapshot, says so in its
 * SSP entry and lands in the POA&M, even when a seeded-state source is positive.
 */
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/stub-plan-data'),
}), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { AssessmentSource, AssessmentSnapshot } from 'ces-shared/types/controls';
import type { ExecutionResultsManifest } from 'ces-shared/types/execution-results';
import {
  loadLatestExecutionResults,
  executionResultsToSources,
  isStamperExecutionFailure,
} from '../../src/eo/evidence/StamperExecutionResultsLoader';
import { ControlAssessor } from '../../src/eo/assessment/ControlAssessor';
import { PoamGenerator } from '../../src/eo/poam/PoamGenerator';
import {
  buildGoldenTenantManifest,
  buildGoldenInfraManifest,
  buildGoldenMissionPlan,
  buildGoldenManifests,
} from '../ssp/golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');
const GOLDEN = path.resolve(__dirname, '../../../ces-shared/src/types/__fixtures__/stamper-execution-results.json');
const loadGolden = (): ExecutionResultsManifest => JSON.parse(fs.readFileSync(GOLDEN, 'utf-8'));

const SLUG = 'muster-partial';
const FAILED = 'AC.L1-3.1.1';   // failed in the golden run
const PASSED = 'AC.L1-3.1.20';  // completed in the golden run

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fx12-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function stateDir(name: string): string {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Seeded-state positive source (what made a failed task look "met"). */
function seeded(): Map<string, AssessmentSource[]> {
  const src: AssessmentSource = { type: 'blob_artifact', timestamp: 't', detail: 'seeded', result: 'exists' };
  return new Map([FAILED, PASSED].map(id => [id, [{ ...src }]]));
}

function assess(manifest: ExecutionResultsManifest | null): AssessmentSnapshot {
  const sources = seeded();
  if (manifest) {
    for (const [id, list] of executionResultsToSources(manifest)) sources.set(id, [...(sources.get(id) ?? []), ...list]);
  }
  return new ControlAssessor(controlsRefPath, []).merge('tenant-fx12', [], [], [], [], sources);
}

const statusOf = (snap: AssessmentSnapshot, id: string) => snap.controls.find(c => c.control_id === id)!.status;

function withResult(m: ExecutionResultsManifest, id: string, verdict: 'sat' | 'not_sat', outcome: string): ExecutionResultsManifest {
  return { ...m, results: m.results.map(r => (r.controlId === id ? { ...r, verdict, outcome } : r)) };
}

describe('loadLatestExecutionResults', () => {
  it('reads the producer golden and ignores the .delivery.json sidecar', () => {
    const dir = stateDir('golden');
    const g = loadGolden();
    fs.writeFileSync(path.join(dir, `execution-results-${g.executablePlanId}.json`), JSON.stringify(g));
    fs.writeFileSync(path.join(dir, `execution-results-${g.executablePlanId}.delivery.json`),
      JSON.stringify({ tenantSlug: SLUG, status: 'skipped', reason: 'no endpoint' }));
    const r = loadLatestExecutionResults(SLUG, dir)!;
    expect(r).not.toBeNull();
    expect(r.manifest.runId).toBe(g.runId);
    expect(r.invalidFiles).toEqual([]);
  });

  it('picks the latest run by completedAt, skips other tenants and invalid files', () => {
    const dir = stateDir('latest');
    const g = loadGolden();
    fs.writeFileSync(path.join(dir, 'execution-results-a.json'), JSON.stringify({ ...g, runId: 'old', completedAt: '2026-01-01T00:00:00.000Z' }));
    fs.writeFileSync(path.join(dir, 'execution-results-b.json'), JSON.stringify({ ...g, runId: 'new', completedAt: '2026-12-01T00:00:00.000Z' }));
    fs.writeFileSync(path.join(dir, 'execution-results-c.json'), JSON.stringify({ ...g, runId: 'other', tenantSlug: 'another-tenant', completedAt: '2027-01-01T00:00:00.000Z' }));
    fs.writeFileSync(path.join(dir, 'execution-results-d.json'), JSON.stringify({ contractVersion: '9.9.9' }));
    const r = loadLatestExecutionResults(SLUG, dir)!;
    expect(r.manifest.runId).toBe('new');
    expect(r.invalidFiles).toEqual(['execution-results-d.json']);
  });

  it('returns null when the state folder is missing', () => {
    expect(loadLatestExecutionResults(SLUG, path.join(tmp, 'absent'))).toBeNull();
  });
});

describe('FX-12: a failed or blocked Stamper task is never a seeded-state "met"', () => {
  it('failed task -> not_met despite a positive seeded source; completed task stays met', () => {
    const snap = assess(loadGolden());
    expect(statusOf(snap, FAILED)).toBe('not_met');
    expect(statusOf(snap, PASSED)).toBe('met');
    const src = snap.controls.find(c => c.control_id === FAILED)!.sources.find(isStamperExecutionFailure)!;
    expect(src.detail).toMatch(/Stamper task failed/);
  });

  it('blocked task -> not_met', () => {
    const snap = assess(withResult(loadGolden(), PASSED, 'not_sat', 'blocked'));
    expect(statusOf(snap, PASSED)).toBe('not_met');
    expect(snap.controls.find(c => c.control_id === PASSED)!.sources.find(isStamperExecutionFailure)!.detail).toMatch(/blocked/);
  });

  it('without a manifest the seeded source still decides (no regression)', () => {
    expect(statusOf(assess(null), FAILED)).toBe('met');
  });

  it('a completed Stamper task never upgrades a control on its own', () => {
    const snap = new ControlAssessor(controlsRefPath, []).merge('tenant-fx12', [], [], [], [], executionResultsToSources(loadGolden()));
    expect(statusOf(snap, PASSED)).toBe('not_assessed');
  });

  it('the failed control status differs from a run where its task passed, and it feeds the POA&M', () => {
    const snapFail = assess(loadGolden());
    const snapPass = assess(withResult(loadGolden(), FAILED, 'sat', 'completed'));
    expect(statusOf(snapPass, FAILED)).toBe('met');
    expect(statusOf(snapFail, FAILED)).toBe('not_met');

    const poamFail = new PoamGenerator(controlsRefPath, sprsWeightsPath, []).generate({ assessment: snapFail });
    const poamPass = new PoamGenerator(controlsRefPath, sprsWeightsPath, []).generate({ assessment: snapPass });
    // AC.L1-3.1.1 is a 5-point control: not POA&M-eligible, so it appears as an eligibility blocker.
    const blockerIds = (p: typeof poamFail) => p.eligibility.blockers.map(b => b.control_id);
    expect(blockerIds(poamFail)).toContain(FAILED);
    expect(blockerIds(poamPass)).not.toContain(FAILED);
    // R-POAM: it is still tracked in items[], flagged not POA&M-eligible (32 CFR 170.21).
    expect(poamFail.items.find(i => i.control_id === FAILED)?.poamEligible).toBe(false);
  });

  it('a failed 1-point control becomes a POA&M item', () => {
    const ONE_POINT = 'AC.L2-3.1.10'; // failed in the golden run, weight 1
    const sources = new Map<string, AssessmentSource[]>([[ONE_POINT, [{ type: 'blob_artifact', timestamp: 't', detail: 'seeded', result: 'exists' }]]]);
    for (const [id, list] of executionResultsToSources(loadGolden())) sources.set(id, [...(sources.get(id) ?? []), ...list]);
    const snap = new ControlAssessor(controlsRefPath, []).merge('tenant-fx12', [], [], [], [], sources);
    expect(statusOf(snap, ONE_POINT)).toBe('not_met');
    const poam = new PoamGenerator(controlsRefPath, sprsWeightsPath, []).generate({ assessment: snap });
    expect(poam.items.map(i => i.control_id)).toContain(ONE_POINT);
  });

  it('the SSP entry for the failed control states the Stamper result', async () => {
    const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
    const gen = new SspGenerator(controlsRefPath, sprsWeightsPath);
    const common = {
      tenantManifest: buildGoldenTenantManifest(),
      infraManifest: buildGoldenInfraManifest(),
      missionPlan: buildGoldenMissionPlan(),
      manifests: buildGoldenManifests(),
      variables: { organizationName: 'FX-12 Test Co.' },
    };
    const sspFail = gen.generate({ assessment: assess(loadGolden()), ...common });
    const sspPass = gen.generate({ assessment: assess(withResult(loadGolden(), FAILED, 'sat', 'completed')), ...common });
    const entry = (ssp: typeof sspFail) => ssp.controlImplementations.find(c => c.control_id === FAILED)!;
    expect(entry(sspFail).status).toBe('not_met');
    expect(entry(sspPass).status).toBe('met');
    expect(entry(sspFail).implementationNarrative).toMatch(/Stamper execution: Stamper task failed/);
    expect(entry(sspPass).implementationNarrative).not.toMatch(/Stamper execution:/);
  });
});
