/**
 * W7-EO2 (orchestrator build-level ruling 2026-10-29, reversible): a Tier 1 Stamper NOT_SAT for a
 * control is superseded when, later in the same run (by timestamps), an AdminOps evidence row that
 * names the control records a confirmed write, and the live read (Tier 2) then passes. The control is
 * met at Tier 2 and its finding keeps the three events. A failing live read, a dry run, an apply
 * without a confirming read, or an AdminOps row older than the Stamper record leaves Tier 1 standing.
 * The AdminOps rows go through the production AdminOpsEvidenceReader (AO golden shape, temp ces.db);
 * the Stamper sources through StamperEvidenceLoader / executionResultsToSources, as /api/assess does.
 * All names are fictional.
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({ uploadEvidenceBlob: jest.fn(), downloadBlob: jest.fn() }), { virtual: true });
jest.mock('ces-shared/storage', () => ({ getStamperPlanDataRoot: jest.fn(() => '/tmp/w7-eo2-plan-data') }), { virtual: true });

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { AssessmentSource, AssessmentSnapshot, ControlAssessment } from 'ces-shared/types/controls';
import type { ExecutionResultsManifest } from 'ces-shared/types/execution-results';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor.js';
import { StamperEvidenceLoader, type StamperEvidence } from '../../../src/eo/evidence/StamperEvidenceLoader.js';
import { executionResultsToSources } from '../../../src/eo/evidence/StamperExecutionResultsLoader.js';
import { AdminOpsEvidenceReader, ADMINOPS_SINCE_ENV } from '../../../src/eo/adminops/AdminOpsEvidenceReader.js';
import { SprsCalculator } from '../../../src/eo/sprs/SprsCalculator.js';
import { makeRealShapeRow } from '../adminops/helpers/makeRealShapeRow.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const TENANT_ID = 'w7eo2-tenant';
const PS = 'PS.L2-3.9.2';
const OTHER = 'AC.L2-3.1.6';
const PLAIN = 'AC.L2-3.1.10';
const ENTRY = 'PS.L2-3.9.2.leaver-workflow';
const RUN = 'translated-mplan_w7eo2';
const T_EARLY = '2026-10-29T09:40:00.000Z';
const T_STAMPER = '2026-10-29T10:00:00.000Z';
const T_LIVE = '2026-10-29T10:45:00.000Z';
const T_AO = '2026-10-29T10:30:00.000Z';
const LIVE_SENTENCE = "Lifecycle workflows: leaver 'Fictional Leaver - disable account' scheduled with a disable task; mover 'Fictional Mover' scheduled";
const LIVE_FAIL_SENTENCE = "Lifecycle workflows: leaver 'Fictional Leaver - disable account' is on demand (isSchedulingEnabled false)";

const live = (controlId: string, nist: string, result: 'exists' | 'missing', detail: string): ControlAssessment => ({
  control_id: controlId, nist_ref: nist, status: result === 'exists' ? 'met' : 'not_met',
  classification: 'automated', sources: [{ type: 'discovery', timestamp: T_LIVE, detail, result }], last_assessed: T_LIVE,
  signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: T_LIVE, implementation_narrative: detail,
});

const notSat = (controlId: string, entryId: string): StamperEvidence => ({
  complianceVerdict: 'NOT_SAT', sha256Hash: 'x', timestamp: T_STAMPER, controlIds: [controlId],
  entryId, label: 'Fictional verify-only read', commandExecuted: '[verify-only: SET not sent]', mode: 'state-verified',
  outcomeRationale: 'SET/verification failed: verification failed on existing resource',
  executorIdentity: 'stamper/0.0.0@fictional',
});

const manifest = (controlIds: string[]): ExecutionResultsManifest => ({
  contractVersion: '1.1.0', runId: RUN, planId: 'mplan_w7eo2', executablePlanId: RUN, cesId: 'ces-fictional-0001',
  tenantSlug: 'w7eo2', completedAt: T_STAMPER, totalControls: 110,
  results: controlIds.map(controlId => ({ controlId, directive: 'automated', verdict: 'not_sat', outcome: 'failed', timestampUtc: T_STAMPER })),
} as unknown as ExecutionResultsManifest);

type AoRow = 'confirmed' | 'confirmed-early' | 'dry-run' | 'unconfirmed' | 'none';

describe('W7-EO2: a later confirmed AdminOps write plus a passing live read supersedes a Tier 1 Stamper NOT_SAT', () => {
  let tmpDir: string;
  let dbPath: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  const prevSince = process.env[ADMINOPS_SINCE_ENV];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-eo2-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    delete process.env[ADMINOPS_SINCE_ENV];
    dbPath = path.join(tmpDir, 'ces.db');
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevRoot;
    if (prevSince === undefined) delete process.env[ADMINOPS_SINCE_ENV]; else process.env[ADMINOPS_SINCE_ENV] = prevSince;
  });

  function seedAo(kind: AoRow): void {
    if (kind === 'none') return;
    const base = { tenantId: TENANT_ID, commandId: 'A-21', controlIds: [PS], correlationId: 'corr-fictional-a21' };
    const row = kind === 'dry-run'
      ? makeRealShapeRow({ ...base, timestamp: T_AO, mode: 'dry_run', dryRun: true })
      : makeRealShapeRow({
        ...base,
        timestamp: kind === 'confirmed-early' ? T_EARLY : T_AO,
        preStateOutput: '{"isSchedulingEnabled":false}',
        postStateOutput: kind === 'unconfirmed' ? '  ' : '{"isSchedulingEnabled":true}',
      });
    getCesRepository(dbPath).put('adminops_evidence', row);
  }

  /** The /api/assess merge: Stamper records, then AdminOps rows, then the execution-results manifest. */
  function assess(ao: AoRow, psLive: 'exists' | 'missing'): AssessmentSnapshot {
    seedAo(ao);
    const sources = new StamperEvidenceLoader('w7eo2').toAssessmentSources([notSat(PS, ENTRY), notSat(OTHER, 'AC.L2-3.1.6.admin-account')]);
    const add = (m: Map<string, AssessmentSource[]>) => {
      for (const [id, list] of m) sources.set(id, [...(sources.get(id) ?? []), ...list]);
    };
    add(new AdminOpsEvidenceReader(TENANT_ID, dbPath).read().sources);
    add(executionResultsToSources(manifest([PS])));
    const signals = new Map<string, ControlAssessment>([
      [PS, live(PS, '3.9.2', psLive, psLive === 'exists' ? LIVE_SENTENCE : LIVE_FAIL_SENTENCE)],
      [OTHER, live(OTHER, '3.1.6', 'exists', 'Fictional dedicated admin account present')],
      [PLAIN, live(PLAIN, '3.1.10', 'exists', 'Fictional session lock 10 min')],
    ]);
    return new ControlAssessor(controlsRefPath, []).merge(TENANT_ID, [], [], [], [], sources, signals, undefined, []);
  }

  const ctl = (snap: AssessmentSnapshot, id: string) => snap.controls.find(c => c.control_id === id) as EoControlAssessment;
  const STAMPER_TASK = `Stamper task failed (directive automated, outcome failed, run ${RUN})`;
  const HISTORY = `Stamper ${ENTRY} NOT_SAT at ${T_STAMPER}; ${STAMPER_TASK} NOT_SAT at ${T_STAMPER}; AdminOps A-21 (corr-fictional-a21) ${T_AO} confirmed; live read now satisfies`;

  function expectTier1Stands(c: EoControlAssessment): void {
    expect(c.status).toBe('not_met');
    expect(c.statusRationale.startsWith('Tier 1 (current-run Stamper NOT_SAT) decides:')).toBe(true);
    expect(c.assessmentFinding).toContain(`Stamper entry ${ENTRY} (`);
    expect(c.assessmentFinding).toContain('NOT_SAT: SET/verification failed');
    expect(c.assessmentFinding).toContain(STAMPER_TASK);
    expect(c.stamperNotSatSuperseded).toBeUndefined();
  }

  test('(1) Stamper NOT_SAT, then a confirmed A-21 write, then a passing live read: met at Tier 2, the finding carries the three events', async () => {
    const snap = assess('confirmed', 'exists');
    const c = ctl(snap, PS);
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 2 \(live read\) decides: discovery\/exists: /);
    expect(c.statusRationale).toContain('; supersedes Tier 1 (current-run Stamper NOT_SAT): ');
    expect(c.assessmentFinding).toBe(`${HISTORY}: ${LIVE_SENTENCE}`);
    expect(c.stamperNotSatSuperseded).toBe(HISTORY);
    expect(c.findingStamperEntries).toBeUndefined();

    // SSP: met, not downgraded by the FX-12 block; the history is stated in the entry.
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    const ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, variables: {} });
    const ci = ssp.controlImplementations.find(x => x.control_id === PS)!;
    expect(ci.status).toBe('met');
    expect(ci.implementationNarrative).toContain(`Stamper execution: ${STAMPER_TASK}. Superseded later in the run: ${HISTORY}.`);
    expect(ci.implementationNarrative).not.toContain('Reported as not met and carried to the POA&M');

    // SPRS: PS.L2-3.9.2 weighs 5; the superseded run scores 5 above the same run with a failing live read.
    closeAllCesRepositories();
    fs.rmSync(dbPath, { force: true });
    const failing = assess('confirmed', 'missing');
    const sprs = new SprsCalculator();
    expect(sprs.calculate(snap.controls).score - sprs.calculate(failing.controls).score).toBe(5);
  });

  test('(2) same, but the live read still fails: not_met, the Stamper finding stands', () => {
    expectTier1Stands(ctl(assess('confirmed', 'missing'), PS));
  });

  test('(3) AdminOps dry run only (or an apply without a confirming read): unchanged', () => {
    const baseline = ctl(assess('none', 'exists'), PS);
    expectTier1Stands(baseline);
    for (const kind of ['dry-run', 'unconfirmed'] as const) {
      closeAllCesRepositories();
      fs.rmSync(dbPath, { force: true });
      const c = ctl(assess(kind, 'exists'), PS);
      expectTier1Stands(c);
      expect(c.assessmentFinding).toBe(baseline.assessmentFinding);
      if (kind === 'dry-run') expect(c.statusRationale).toBe(baseline.statusRationale);
    }
  });

  test('(4) the AdminOps write is older than the Stamper record: the Stamper NOT_SAT stands', () => {
    const c = ctl(assess('confirmed-early', 'exists'), PS);
    expectTier1Stands(c);
    expect(c.sources.some(s => s.type === 'adminops_execution' && s.timestamp === T_EARLY && s.result === 'imported')).toBe(true);
  });

  test('(5) an unrelated control is untouched', () => {
    const baseline = assess('none', 'exists');
    closeAllCesRepositories();
    fs.rmSync(dbPath, { force: true });
    const snap = assess('confirmed', 'exists');
    // AC.L2-3.1.6 has its own Stamper NOT_SAT and a passing live read, but no AdminOps row names it.
    const other = ctl(snap, OTHER);
    expect(other.status).toBe('not_met');
    expect(other.statusRationale.startsWith('Tier 1')).toBe(true);
    expect(other.stamperNotSatSuperseded).toBeUndefined();
    for (const c of snap.controls as EoControlAssessment[]) {
      if (c.control_id === PS) continue;
      const b = ctl(baseline, c.control_id);
      expect([c.control_id, c.status, c.statusRationale, c.assessmentFinding]).toEqual([b.control_id, b.status, b.statusRationale, b.assessmentFinding]);
    }
    expect(ctl(snap, PLAIN).status).toBe('met');
  });
});
