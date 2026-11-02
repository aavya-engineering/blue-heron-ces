// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-26 (founder rulings FD-7 and FD-9).
 * - FD-9: AT.L2-3.2.2 is decided by the training store for an operator-defined population only. The population comes
 *   from Muster's question PI.PER.012 (its interview record in eo_interview_records) or an operator-saved list.
 * - FD-7: interview records are cited in the SSP approach block, never scored.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import {
  TrainingStore,
  catalogDecidesControl,
  trainingControlCompliance,
  parseRolePopulationAnswer,
  withRolePopulation,
  INTERVIEW_RECORDS_COLLECTION,
  ROLE_POPULATION_QUESTION_ID,
  type RolePopulation,
} from '../../../src/eo/personnel/TrainingStore';
import { catalogFromOrganisationRecords, type TrainingRecordInput } from '../../../src/eo/personnel/OrganisationTraining';
import { storeControlStatus, applyStoreControlStatus } from '../../../src/eo/server/ledgerAssembly';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';
import type { AssessmentSnapshot, ControlStatus } from 'ces-shared/types/controls';
import { INTERVIEW_RECORD_COLLECTION } from '../../../src/eo/server/routers/interview-router';
import { assessmentApproachFor } from '../../../src/eo/ssp/AssessorApproach';
import type { PersonnelRecord, TrainingCatalog } from '../../../src/shared/types/personnel.types';

const SLUG = 'fin26-tenant';
const AWARENESS = 'S1 Security Awareness: Handling CUI (2026)';
const ROLE_BASED = 'S1 Privileged Administrator Security Training (2026)';
const ISSM = 'Information Security Manager (ISSM)';
const ISSO = 'Information Systems Security Officer (ISSO)';
const SYSADMIN = 'Systems Administrator';
const S1_POPULATION = `${ISSM}; ${ISSO}; ${SYSADMIN}`;

// The S1 shape: four role holders took the role-based course; the rest of the staff did not.
const people = [
  { pid: 'p1', title: 'President / Owner' },
  { pid: 'p8', title: ISSM },
  { pid: 'p9', title: ISSO },
  { pid: 'p10', title: SYSADMIN },
  { pid: 'p11', title: SYSADMIN },
  { pid: 'p20', title: 'CNC Machinist' },
];
const roleHolders = ['p8', 'p9', 'p10', 'p11'];
const trow = (pid: string, title: string, course: string) => ({ date: '2026-08-01', person_id: pid, job_title: title, course, assigned: '2026-07-20', status: 'completed' });
const trec = (file: string, controlIds: string[], rows: Record<string, unknown>[]): TrainingRecordInput =>
  ({ filename: file, sha256: 'b'.repeat(64), recordKind: 'training_completion', controlIds, rows });
const orgRecords = (): TrainingRecordInput[] => [
  trec('training-awareness.json', ['AT.L2-3.2.1'], people.map(p => trow(p.pid, p.title, AWARENESS))),
  trec('training-role-based.json', ['AT.L2-3.2.2'], people.filter(p => roleHolders.includes(p.pid)).map(p => trow(p.pid, p.title, ROLE_BASED))),
];

function interviewRecord(answer: string, interviewedAt: string, recordId: string, questionId = ROLE_POPULATION_QUESTION_ID) {
  return {
    schema: 'ces-shared/interview-record@1',
    recordId,
    tenantSlug: SLUG,
    questionId,
    questionText: 'Which job titles hold information-security duties that need role-based security training (AT.L2-3.2.2)?',
    answer,
    interviewedAt,
    interviewee: { name: null, role: null },
    interviewer: { subjectId: 'harness', role: 'operator' },
    objectives: [],
    provenance: 'operator_interview',
    confidence: 'high',
  };
}

describe('FIN-26 pure rules', () => {
  it('parses a PI.PER.012 answer: ";" or line breaks, trimmed, de-duplicated ignoring case; none / n/a = no population', () => {
    expect(parseRolePopulationAnswer(` ${ISSM} ;${ISSO}\n${SYSADMIN}; systems administrator ;`)).toEqual([ISSM, ISSO, SYSADMIN]);
    expect(parseRolePopulationAnswer('none')).toEqual([]);
    expect(parseRolePopulationAnswer('N/A')).toEqual([]);
    expect(parseRolePopulationAnswer('  ')).toEqual([]);
  });

  it('the collection name equals the interview router one', () => {
    expect(INTERVIEW_RECORDS_COLLECTION).toBe(INTERVIEW_RECORD_COLLECTION);
  });

  const catalog = catalogFromOrganisationRecords(orgRecords())!;
  const pop = (roles: string[]): RolePopulation => ({ controlId: 'AT.L2-3.2.2', roles, source: 'interview' });
  const active = people.map((p, i) => ({ id: `id-${i}`, role: p.title, screeningState: 'cleared' }));
  const done = new Set(people.map((p, i) => (roleHolders.includes(p.pid) ? `id-${i}` : '')).filter(Boolean));
  const stateOf = (id: string) => ({
    personnelId: id,
    requiredCourses: [],
    completions: [{ courseId: AWARENESS, completedDate: '2026-08-01' }, ...(done.has(id) ? [{ courseId: ROLE_BASED, completedDate: '2026-08-01' }] : [])],
  });

  it('without a population AT.L2-3.2.2 stays undecided (NS-3b unchanged)', () => {
    expect(catalogDecidesControl(catalog, 'AT.L2-3.2.2')).toBe(false);
    expect(catalogDecidesControl(withRolePopulation(catalog, undefined), 'AT.L2-3.2.2')).toBe(false);
  });

  it('with a population the role-scoped course decides it, over the population only', () => {
    const c = withRolePopulation(catalog, pop([ISSM, ISSO, SYSADMIN]));
    expect(catalogDecidesControl(c, 'AT.L2-3.2.2')).toBe(true);
    expect(trainingControlCompliance(c, 'AT.L2-3.2.2', active, stateOf)).toEqual({
      total: 4, compliant: 4, exempt: 0, met: true, population: { roles: [ISSM, ISSO, SYSADMIN], source: 'interview' },
    });
    // Case-insensitive title match.
    expect(trainingControlCompliance(withRolePopulation(catalog, pop(['systems administrator'])), 'AT.L2-3.2.2', active, stateOf))
      .toMatchObject({ total: 2, compliant: 2, met: true });
    // A population member without a completion: not met.
    expect(trainingControlCompliance(withRolePopulation(catalog, pop([SYSADMIN, 'CNC Machinist'])), 'AT.L2-3.2.2', active, stateOf))
      .toMatchObject({ total: 3, compliant: 2, met: false });
    // No active person holds a population title: decided, never vacuously met.
    expect(trainingControlCompliance(withRolePopulation(catalog, pop(['Chief Pilot'])), 'AT.L2-3.2.2', active, stateOf))
      .toMatchObject({ total: 0, compliant: 0, met: false });
    // An expired completion does not count.
    const expired = (id: string) => ({ ...stateOf(id), completions: stateOf(id).completions.map(x => (x.courseId === ROLE_BASED ? { ...x, expiryDate: '2026-01-01' } : x)) });
    expect(trainingControlCompliance(c, 'AT.L2-3.2.2', active, expired, new Date('2026-10-31'))).toMatchObject({ compliant: 0, met: false });
  });

  it('the population changes no other control', () => {
    const c = withRolePopulation(catalog, pop([SYSADMIN]));
    for (const id of ['AT.L2-3.2.1', 'AT.L2-3.2.3', 'PS.L2-3.9.1']) {
      expect(catalogDecidesControl(c, id)).toBe(catalogDecidesControl(catalog, id));
      expect(trainingControlCompliance(c, id, active, stateOf)).toEqual(trainingControlCompliance(catalog, id, active, stateOf));
    }
  });

  it('a population with no role-scoped course leaves the rule as it was (an all-personnel course still decides)', () => {
    const allOnly: TrainingCatalog = { courses: catalog.courses.filter(x => x.id === AWARENESS).map(x => ({ ...x, satisfies_controls: ['AT.L2-3.2.1', 'AT.L2-3.2.2'] })) };
    const c = withRolePopulation(allOnly, pop([SYSADMIN]));
    expect(catalogDecidesControl(c, 'AT.L2-3.2.2')).toBe(true);
    expect(trainingControlCompliance(c, 'AT.L2-3.2.2', active, stateOf)).toEqual(trainingControlCompliance(allOnly, 'AT.L2-3.2.2', active, stateOf));
  });
});

describe('FIN-26 TrainingStore population source and the ledger', () => {
  let tmpDir: string;
  let personnel: PersonnelStore;
  let training: TrainingStore;
  let screening: ScreeningElementStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fin26-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    personnel = new PersonnelStore(tmpDir);
    training = new TrainingStore(tmpDir);
    screening = new ScreeningElementStore(tmpDir);
  });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const seed = () => {
    people.forEach((p, i) => {
      const id = `00000000-0000-4000-8000-0000000000${String(i + 10)}`;
      personnel.save(SLUG, { id, displayName: p.pid, email: `${p.pid}@example.invalid`, role: p.title, screeningState: 'cleared', createdDate: '2026-01-01', evidenceArtifacts: [], lifecycleEvents: [] } as PersonnelRecord);
      training.addCompletion(SLUG, id, { courseId: AWARENESS, completedDate: '2026-08-01' });
      if (roleHolders.includes(p.pid)) training.addCompletion(SLUG, id, { courseId: ROLE_BASED, completedDate: '2026-08-01' });
    });
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(orgRecords()));
  };
  const putRecord = (rec: ReturnType<typeof interviewRecord>, slug = SLUG) =>
    getCesRepository().put(INTERVIEW_RECORDS_COLLECTION, { id: rec.recordId, ces: { tenantSlug: slug, tenantId: 't-1' }, data: { ...rec, tenantSlug: slug } });
  const deps = () => ({ personnelStore: personnel, screeningElementStore: screening, trainingStore: training });

  it('no population: the ledger store status does not decide AT.L2-3.2.2 (today S1/S2)', () => {
    seed();
    expect(training.loadRolePopulation(SLUG)).toBeUndefined();
    const s = storeControlStatus(deps(), SLUG);
    expect(s.decided).not.toContain('AT.L2-3.2.2');
    expect(s.decided).toContain('AT.L2-3.2.1');
  });

  it('the PI.PER.012 interview record defines the population; the ledger then decides AT.L2-3.2.2 met over those people', () => {
    seed();
    putRecord(interviewRecord(S1_POPULATION, '2026-10-31T10:00:00.000Z', 'a'.repeat(64)));
    // A record of another question and another tenant's record are ignored.
    putRecord(interviewRecord('CNC Machinist', '2026-10-31T11:00:00.000Z', 'b'.repeat(64), 'PI.PER.011'));
    putRecord(interviewRecord('CNC Machinist', '2026-10-31T12:00:00.000Z', 'c'.repeat(64)), 'other-tenant');
    expect(training.loadRolePopulation(SLUG)).toEqual({
      controlId: 'AT.L2-3.2.2', roles: [ISSM, ISSO, SYSADMIN], source: 'interview',
      questionId: ROLE_POPULATION_QUESTION_ID, recordId: 'a'.repeat(64), capturedAt: '2026-10-31T10:00:00.000Z',
    });
    const s = storeControlStatus(deps(), SLUG);
    expect(s.decided).toContain('AT.L2-3.2.2');
    expect(s.status['AT.L2-3.2.2']).toMatchObject({ status: 'met', source: 'training' });
    expect(s.status['AT.L2-3.2.2'].rationale).toContain('(4/4 compliant)');
    // FIN-26b: the population-scoped count names the population; AT.L2-3.2.1 keeps its wording.
    expect(s.status['AT.L2-3.2.2'].rationale).toBe(
      `role-based training completion across the defined population (${ISSM}; ${ISSO}; ${SYSADMIN}) (4/4 compliant)`,
    );
    expect(s.status['AT.L2-3.2.1'].rationale).toBe('awareness-training completion across active personnel (6/6 compliant)');
    const active = personnel.load(SLUG).map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));
    expect(training.isControlMet(SLUG, 'AT.L2-3.2.2', active)).toBe(true);
    // The personnel card: the role course is required of exactly the population.
    const cat = training.loadCatalog(SLUG);
    expect(training.computeRequiredCourses(SYSADMIN, 'cleared', cat)).toContain(ROLE_BASED);
    expect(training.computeRequiredCourses('CNC Machinist', 'cleared', cat)).not.toContain(ROLE_BASED);
  });

  it('the newest record wins; a population member who has not trained makes it not met', () => {
    seed();
    putRecord(interviewRecord(S1_POPULATION, '2026-10-31T10:00:00.000Z', 'a'.repeat(64)));
    putRecord(interviewRecord(`${SYSADMIN}; CNC Machinist`, '2026-10-31T12:00:00.000Z', 'd'.repeat(64)));
    expect(training.loadRolePopulation(SLUG)?.roles).toEqual([SYSADMIN, 'CNC Machinist']);
    expect(storeControlStatus(deps(), SLUG).status['AT.L2-3.2.2']).toMatchObject({ status: 'not_met' });
  });

  it('an operator-saved population outranks the record; removing it falls back to the record; saveCatalog never stores it', () => {
    seed();
    putRecord(interviewRecord(S1_POPULATION, '2026-10-31T10:00:00.000Z', 'a'.repeat(64)));
    training.saveRolePopulation(SLUG, [SYSADMIN]);
    expect(training.loadRolePopulation(SLUG)).toEqual({ controlId: 'AT.L2-3.2.2', roles: [SYSADMIN], source: 'operator' });
    training.saveRolePopulation(SLUG, undefined);
    expect(training.loadRolePopulation(SLUG)?.source).toBe('interview');
    const loaded = training.loadCatalog(SLUG);
    expect((loaded as { role_population?: unknown }).role_population).toBeDefined();
    training.saveCatalog(SLUG, loaded);
    const raw = getCesRepository().get<Record<string, unknown>>('eo_training_catalog', `${SLUG}:_training_catalog`, { tenantSlug: SLUG });
    expect(raw?.data).not.toHaveProperty('role_population');
  });

  it('AR5 end to end: the ledger and applyStoreControlStatus move AT.L2-3.2.2 not_assessed -> met (S1 shape), and nothing else', () => {
    seed();
    const snapshotWith = (statuses: Record<string, ControlStatus>): AssessmentSnapshot => ({
      snapshotId: 'snap-fin26', tenantId: 'tenant-fin26', generatedAt: '2026-10-31T00:00:00Z', sources_merged: [], sprs_score: 0,
      controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0,
      controls: Object.entries(statuses).map(([control_id, status]) => ({
        control_id, nist_ref: control_id.replace(/^[A-Z]+\.L[12]-/, ''), status, classification: 'nonstack', sources: [], last_assessed: '2026-10-31T00:00:00Z',
        signals: [], evidenceArtifactIds: [], automationSource: 'manual', lastFetchedAt: '2026-10-31T00:00:00Z', statusRationale: status === 'met' ? 'Tier 2 (live read): met' : 'No source',
      }) as AssessmentSnapshot['controls'][number]),
    });
    const baseline = { 'AT.L2-3.2.1': 'met', 'AT.L2-3.2.2': 'not_assessed', 'AT.L2-3.2.3': 'met' } as Record<string, ControlStatus>;
    const run = () => {
      const snap = snapshotWith(baseline);
      const store = storeControlStatus(deps(), SLUG);
      const ledger = buildDeterminationLedger({ tenantId: snap.tenantId, generatedAt: snap.generatedAt, snapshot: snap, manualControlStatus: store.status });
      return { snap, moved: applyStoreControlStatus(snap, ledger, store) };
    };
    // Without the record: AT.L2-3.2.2 stays not_assessed.
    const before = run();
    expect(before.moved.find(m => m.controlId === 'AT.L2-3.2.2')).toBeUndefined();
    expect(before.snap.controls.find(c => c.control_id === 'AT.L2-3.2.2')!.status).toBe('not_assessed');
    // With the PI.PER.012 record: exactly AT.L2-3.2.2 moves.
    putRecord(interviewRecord(S1_POPULATION, '2026-10-31T10:00:00.000Z', 'a'.repeat(64)));
    const after = run();
    expect(after.moved).toEqual([{ controlId: 'AT.L2-3.2.2', from: 'not_assessed', to: 'met' }]);
  });

  it('a "none" answer defines no population', () => {
    seed();
    putRecord(interviewRecord('none', '2026-10-31T10:00:00.000Z', 'a'.repeat(64)));
    expect(training.loadRolePopulation(SLUG)).toBeUndefined();
    expect(storeControlStatus(deps(), SLUG).decided).not.toContain('AT.L2-3.2.2');
  });
});

describe('FIN-26 FD-7: interview rows are cited, not scored', () => {
  it('a held interview row says "cited, not scored"; other states and sources keep their labels', () => {
    const base = assessmentApproachFor('AT.L2-3.2.2', {})!;
    const objective = base.objectives.find(o => o.evidence.some(e => e.cesSource === 'interview'));
    expect(objective).toBeDefined();
    const held = assessmentApproachFor('AT.L2-3.2.2', { interviewObjectiveIds: [objective!.objectiveId] })!;
    const heldText = held.objectives.find(o => o.objectiveId === objective!.objectiveId)!.text;
    expect(heldText).toContain('(interview: record present this run; cited, not scored)');
    const notHeld = assessmentApproachFor('AT.L2-3.2.2', { interviewObjectiveIds: [] })!;
    expect(notHeld.objectives.find(o => o.objectiveId === objective!.objectiveId)!.text).toContain('(interview: no record this run)');
    expect(base.objectives.find(o => o.objectiveId === objective!.objectiveId)!.text).toContain('(interview: not checked)');
    expect(held.objectives.find(o => o.objectiveId === objective!.objectiveId)!.evidence.find(e => e.cesSource === 'interview')!.held).toBe('held');
  });
});
