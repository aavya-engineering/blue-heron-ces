// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure NS-3b (founder D-2): the customer's course names reach EO's training catalog as a
 * customer-scoped catalog (their own products, not mapped onto the DoD / CDSE defaults), and the personnel
 * and training stores set the PS / AT control status in the snapshot under the ledger's precedence.
 * The SSP never prints a complete store count beside a status other than met, or an incomplete one beside met.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { AssessmentSnapshot, ControlStatus } from 'ces-shared/types/controls';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { TrainingStore, catalogDecidesControl, trainingControlCompliance } from '../../../src/eo/personnel/TrainingStore';
import { catalogFromOrganisationRecords, RECORD_ROLES, type TrainingRecordInput } from '../../../src/eo/personnel/OrganisationTraining';
import { buildDeterminationLedger } from '../../../src/eo/assessment/DeterminationLedger';
import { storeControlStatus, applyStoreControlStatus, STORE_RATIONALE_PREFIX } from '../../../src/eo/server/ledgerAssembly';
import { SspGenerator } from '../../../src/eo/ssp/SspGenerator';
import type { PersonnelRecord, PersonnelTrainingState, TrainingCatalog, PersonnelReadiness } from '../../../src/shared/types/personnel.types';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const SLUG = 'ns3b-tenant';
const AWARENESS = 'S1 Security Awareness: Handling CUI (2026)';
const INSIDER = 'S1 Insider Threat Awareness (2026)';
const ROLE_BASED = 'S1 Privileged Administrator Security Training (2026)';
const IR_COURSE = 'S1 Incident Response Team Training (2026)';

const people = [
  { pid: 'p1', title: 'President / Owner' },
  { pid: 'p2', title: 'Systems Administrator' },
  { pid: 'p3', title: 'CNC Machinist' },
  { pid: 'p4', title: 'CNC Machinist' },
];
const trow = (pid: string, title: string, course: string) => ({ date: '2026-08-01', person_id: pid, job_title: title, course, assigned: '2026-07-20', status: 'completed' });
const trec = (file: string, controlIds: string[], rows: Record<string, unknown>[]): TrainingRecordInput =>
  ({ filename: file, sha256: 'b'.repeat(64), recordKind: 'training_completion', controlIds, rows });
const s1Records = (): TrainingRecordInput[] => [
  trec('training-awareness.json', ['AT.L2-3.2.1'], people.map(p => trow(p.pid, p.title, AWARENESS))),
  trec('training-insider-threat.json', ['AT.L2-3.2.3'], people.map(p => trow(p.pid, p.title, INSIDER))),
  trec('training-role-based.json', ['AT.L2-3.2.2'], [trow('p2', 'Systems Administrator', ROLE_BASED)]),
  trec('training-incident-response.json', ['IR.L2-3.6.1'], [trow('p2', 'Systems Administrator', IR_COURSE)]),
  { filename: 'visitor-log.json', sha256: 'c'.repeat(64), recordKind: 'visitor_log', controlIds: ['PE.L1-3.10.3'], rows: [{ date: '2026-08-01', course: 'not a course' }] },
];

describe('NS-3b customer-scoped training catalog from the organisation records', () => {
  it('each AT-tagged course becomes its own course (id = the name verbatim); awareness and insider threat are required of everyone; role-based of the record titles', () => {
    const cat = catalogFromOrganisationRecords(s1Records())!;
    expect(cat.courses.map(c => c.id)).toEqual([INSIDER, ROLE_BASED, AWARENESS].sort());
    const by = new Map(cat.courses.map(c => [c.id, c]));
    expect(by.get(AWARENESS)).toMatchObject({ satisfies_controls: ['AT.L2-3.2.1'], required_for_roles: ['all_users'], targetRoles: ['*'] });
    expect(by.get(INSIDER)).toMatchObject({ satisfies_controls: ['AT.L2-3.2.3'], required_for_roles: ['all_users'] });
    expect(by.get(ROLE_BASED)).toMatchObject({ satisfies_controls: ['AT.L2-3.2.2'], required_for_roles: [RECORD_ROLES], targetRoles: ['Systems Administrator'] });
    // IR training (no AT tag) and non-training records add nothing.
    expect(by.has(IR_COURSE)).toBe(false);
    expect(catalogDecidesControl(cat, 'AT.L2-3.2.1')).toBe(true);
    expect(catalogDecidesControl(cat, 'AT.L2-3.2.3')).toBe(true);
    expect(catalogDecidesControl(cat, 'AT.L2-3.2.2')).toBe(false);
  });

  it('no AT training record -> no catalog', () => {
    expect(catalogFromOrganisationRecords([])).toBeUndefined();
    expect(catalogFromOrganisationRecords([trec('training-incident-response.json', ['IR.L2-3.6.1'], [trow('p2', 'x', IR_COURSE)])])).toBeUndefined();
  });
});

describe('NS-3b stores', () => {
  let tmpDir: string;
  let personnel: PersonnelStore;
  let training: TrainingStore;
  let screening: ScreeningElementStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ns3b-'));
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

  const ids = new Map<string, string>();
  const seed = (opts: { awareness?: string[]; offboardP4?: boolean } = {}) => {
    people.forEach((p, i) => {
      const id = `00000000-0000-4000-8000-00000000000${i + 1}`;
      ids.set(p.pid, id);
      const offboarded = opts.offboardP4 && p.pid === 'p4';
      personnel.save(SLUG, { id, displayName: p.pid, email: `${p.pid}@example.invalid`, role: p.title, screeningState: offboarded ? 'offboarded' : 'cleared', createdDate: '2026-01-01', evidenceArtifacts: [], lifecycleEvents: [] } as PersonnelRecord);
      if ((opts.awareness ?? people.map(x => x.pid)).includes(p.pid)) training.addCompletion(SLUG, id, { courseId: AWARENESS, completedDate: '2026-08-01' });
      training.addCompletion(SLUG, id, { courseId: INSIDER, completedDate: '2026-08-01' });
      if (p.pid === 'p2') training.addCompletion(SLUG, id, { courseId: ROLE_BASED, completedDate: '2026-08-01' });
    });
  };

  it('catalog precedence: operator-saved, then customer-scoped, then default; undefined removes the customer-scoped one', () => {
    expect(training.loadCatalog(SLUG).courses.some(c => c.id === 'dod-cyber-awareness-challenge-2026')).toBe(true);
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(s1Records()));
    expect(training.loadCatalog(SLUG).courses.map(c => c.id)).toContain(AWARENESS);
    const operator: TrainingCatalog = { courses: [{ id: 'op-course', title: 'Operator', provider: 'x', duration: '1h', targetRoles: ['*'], required_for_roles: ['all_users'], satisfies_controls: ['AT.L2-3.2.1'], refresh_cycle_days: 365 }] };
    training.saveCatalog(SLUG, operator);
    expect(training.loadCatalog(SLUG).courses.map(c => c.id)).toEqual(['op-course']);
    expect(training.loadCatalog('other-tenant').courses.some(c => c.id === AWARENESS)).toBe(false);
    training.saveOrganisationCatalog(SLUG, undefined);
    expect(training.loadOrganisationCatalog(SLUG)).toBeUndefined();
  });

  it('completions recorded under the customer course names match the customer-scoped catalog exactly (no loosened match)', () => {
    seed();
    const active = personnel.load(SLUG).map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));
    // Default catalog: the customer's own courses are not DoD / CDSE products -> not met.
    expect(training.isControlMet(SLUG, 'AT.L2-3.2.1', active)).toBe(false);
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(s1Records()));
    expect(training.controlCompliance(SLUG, 'AT.L2-3.2.1', active)).toEqual({ total: 4, compliant: 4, exempt: 0, met: true });
    expect(training.isControlMet(SLUG, 'AT.L2-3.2.3', active)).toBe(true);
    // AT.L2-3.2.2: only the role-scoped course covers it. The one admin is compliant and everyone else is exempt,
    // but that population comes from the record itself, so the store never calls it met (personnel card included).
    expect(training.controlCompliance(SLUG, 'AT.L2-3.2.2', active)).toEqual({ total: 4, compliant: 1, exempt: 3, met: true });
    expect(training.isControlMet(SLUG, 'AT.L2-3.2.2', active)).toBe(false);
    // A completion under a near-miss name does not count.
    training.removeCompletion(SLUG, ids.get('p3')!, AWARENESS);
    training.addCompletion(SLUG, ids.get('p3')!, { courseId: 'S1 Security Awareness (2026)', completedDate: '2026-08-01' });
    expect(training.controlCompliance(SLUG, 'AT.L2-3.2.1', active)).toEqual({ total: 4, compliant: 3, exempt: 0, met: false });
  });

  it('isControlMet and trainingControlCompliance agree on the default catalog (behaviour preserved)', () => {
    seed();
    const active = personnel.load(SLUG).map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));
    training.addCompletion(SLUG, ids.get('p1')!, { courseId: 'dod-cyber-awareness-challenge-2026', completedDate: '2026-08-01' });
    for (const at of ['AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3']) {
      const c = trainingControlCompliance(training.loadCatalog(SLUG), at, active, id => training.loadTrainingState(SLUG, id));
      expect(training.isControlMet(SLUG, at, active)).toBe(c.met);
      expect(c.met).toBe(false);
    }
  });

  const snapshotWith = (statuses: Record<string, ControlStatus>): AssessmentSnapshot => ({
    snapshotId: 'snap-ns3b', tenantId: 'tenant-ns3b', generatedAt: '2026-10-31T00:00:00Z', sources_merged: [], sprs_score: 0,
    controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: 0,
    controls: Object.entries(statuses).map(([control_id, status]) => ({
      control_id, nist_ref: control_id.replace(/^[A-Z]+\.L[12]-/, ''), status, classification: 'nonstack', sources: [], last_assessed: '2026-10-31T00:00:00Z',
      signals: [], evidenceArtifactIds: [], automationSource: 'manual', lastFetchedAt: '2026-10-31T00:00:00Z', statusRationale: status === 'met' ? 'Tier 2 (live read): met' : 'No source',
    }) as AssessmentSnapshot['controls'][number]),
  });
  const baseline = (): Record<string, ControlStatus> => ({ 'AT.L2-3.2.1': 'met', 'AT.L2-3.2.2': 'not_assessed', 'AT.L2-3.2.3': 'met', 'PS.L2-3.9.1': 'not_assessed', 'PS.L2-3.9.2': 'met' });
  const orgPersonnel = (disable: 'done' | 'open') => personnel.saveOrganisationRecords(SLUG, [
    { itemId: 'i1', filename: 'personnel-screening.json', sha256: 'd'.repeat(64), recordKind: 'personnel_screening', rows: people.map(p => ({ date: '2025-06-21', person_id: p.pid, job_title: p.title, result: 'cleared' })) },
    { itemId: 'i2', filename: 'personnel-lifecycle.json', sha256: 'e'.repeat(64), recordKind: 'personnel_lifecycle', rows: [
      { date: '2026-09-01', person_id: 'p4', job_title: 'CNC Machinist', event: 'termination', step: 'exit interview', status: 'done' },
      { date: '2026-09-01', person_id: 'p4', job_title: 'CNC Machinist', event: 'termination', step: 'account disabled (leaver workflow run)', status: disable },
    ] },
  ]);
  const apply = (snap: AssessmentSnapshot, dispositions?: Record<string, 'NA'>, objectiveEvidence?: Record<string, 'satisfied' | 'other_than_satisfied'>) => {
    const store = storeControlStatus({ personnelStore: personnel, screeningElementStore: screening, trainingStore: training }, SLUG);
    const ledger = buildDeterminationLedger({ tenantId: snap.tenantId, generatedAt: snap.generatedAt, snapshot: snap, manualControlStatus: store.status, dispositions, objectiveEvidence });
    return { store, moved: applyStoreControlStatus(snap, ledger, store), ledger };
  };
  const statusOf = (snap: AssessmentSnapshot, id: string) => snap.controls.find(c => c.control_id === id)!.status;

  it('S1 shape: PS.L2-3.9.1 not_assessed -> met (records all cleared), PS.L2-3.9.2 met -> not_met (open account-disable step); AT.L2-3.2.2 left alone', () => {
    seed({ offboardP4: false });
    orgPersonnel('open');
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(s1Records()));
    const snap = snapshotWith(baseline());
    const { store, moved } = apply(snap);
    expect(store.decided.sort()).toEqual(['AT.L2-3.2.1', 'AT.L2-3.2.3', 'PS.L2-3.9.1', 'PS.L2-3.9.2']);
    expect(moved).toEqual([
      { controlId: 'PS.L2-3.9.1', from: 'not_assessed', to: 'met' },
      { controlId: 'PS.L2-3.9.2', from: 'met', to: 'not_met' },
    ]);
    expect(statusOf(snap, 'AT.L2-3.2.2')).toBe('not_assessed');
    expect(store.status['AT.L2-3.2.2']).toBeUndefined();
    const ps1 = snap.controls.find(c => c.control_id === 'PS.L2-3.9.1') as unknown as { statusRationale: string; assessmentFinding: string };
    expect(ps1.statusRationale.startsWith(`${STORE_RATIONALE_PREFIX} (personnel store, ledger precedence): personnel screening from the organisation's records`)).toBe(true);
    expect(ps1.assessmentFinding).toMatch(/all 4 active person\(s\) cleared/);
    // AT agrees with the deciding tier: the tier stays first.
    const at1 = snap.controls.find(c => c.control_id === 'AT.L2-3.2.1') as unknown as { statusRationale: string };
    expect(at1.statusRationale).toMatch(/^Tier 2 \(live read\): met; store precedence \(training store\) agrees: /);
    expect([snap.controls_met, snap.controls_not_met, snap.controls_not_assessed]).toEqual([3, 1, 1]);
  });

  it('precedence: a mission-plan disposition and a tenant-suite probe still outrank the store', () => {
    seed();
    orgPersonnel('open');
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(s1Records()));
    const snap = snapshotWith(baseline());
    const objectiveEvidence = { 'AT.L2-3.2.1[a]': 'other_than_satisfied' as const };
    apply(snap, { '3.9.2': 'NA' }, objectiveEvidence);
    expect(statusOf(snap, 'PS.L2-3.9.2')).toBe('met');      // disposition NA wins every objective -> store not deciding, left as is
    expect(statusOf(snap, 'AT.L2-3.2.1')).toBe('not_met');  // one objective outranked by a failing probe -> ledger rollup not_met
  });

  it('empty stores decide nothing (S3 / muster-partial shape): the snapshot is unchanged', () => {
    const snap = snapshotWith({ ...baseline(), 'PS.L2-3.9.2': 'not_met' });
    const before = JSON.stringify(snap);
    const { store, moved } = apply(snap);
    expect(store.decided).toEqual([]);
    expect(moved).toEqual([]);
    expect(JSON.stringify(snap)).toBe(before);
    // The ledger keeps its existing store opinion (unchanged behaviour).
    expect(store.status['PS.L2-3.9.1'].status).toBe('not_met');
  });

  it('SSP consistency: no "N/N compliant" or "N/N cleared" beside a status that disagrees, on every AT / PS row', () => {
    seed({ awareness: ['p1', 'p2', 'p3'] });
    orgPersonnel('open');
    training.saveOrganisationCatalog(SLUG, catalogFromOrganisationRecords(s1Records()));
    const records = personnel.load(SLUG);
    const states = new Map<string, PersonnelTrainingState>();
    for (const r of records) { const st = training.loadTrainingState(SLUG, r.id); if (st) states.set(r.id, st); }
    const trainingData = { catalog: training.loadCatalog(SLUG), states };
    const readiness: PersonnelReadiness = personnel.getReadiness(SLUG, screening);

    const generate = (statuses: Record<string, ControlStatus>) => new SspGenerator(controlsRefPath, sprsWeightsPath).generate({
      assessment: snapshotWith(statuses), personnelRecords: records, personnelReadiness: readiness, trainingData, tenantSlug: SLUG,
    } as Parameters<SspGenerator['generate']>[0]);
    const rows = (ssp: ReturnType<typeof generate>) => (ssp.controlImplementations as Array<{ control_id: string; status: string; implementationNarrative: string }>)
      .filter(c => /^(AT|PS)\./.test(c.control_id));
    const violations = (ssp: ReturnType<typeof generate>): string[] => {
      const out: string[] = [];
      for (const c of rows(ssp)) {
        const at = /Current status: (\d+)\/(\d+) personnel compliant/.exec(c.implementationNarrative);
        const ps = c.control_id === 'PS.L2-3.9.1' ? /Personnel Screening Status: (\d+)\/(\d+) cleared/.exec(c.implementationNarrative) : null;
        for (const m of [at, ps]) {
          if (!m) continue;
          const complete = Number(m[1]) === Number(m[2]) && Number(m[2]) > 0;
          if (!['met', 'not_met'].includes(c.status) || complete !== (c.status === 'met')) out.push(`${c.control_id} ${c.status}: ${m[0]}`);
        }
      }
      return out;
    };

    // Statuses as the store decides them (AT.L2-3.2.1 3/4 -> not_met; AT.L2-3.2.3 4/4 met; PS.L2-3.9.1 4/4 met).
    const agreeing = generate({ 'AT.L2-3.2.1': 'not_met', 'AT.L2-3.2.2': 'not_assessed', 'AT.L2-3.2.3': 'met', 'PS.L2-3.9.1': 'met', 'PS.L2-3.9.2': 'not_met' });
    expect(violations(agreeing)).toEqual([]);
    const narr = (ssp: ReturnType<typeof generate>, id: string) => rows(ssp).find(c => c.control_id === id)!.implementationNarrative;
    expect(narr(agreeing, 'AT.L2-3.2.1')).toMatch(/Current status: 3\/4 personnel compliant/);
    expect(narr(agreeing, 'AT.L2-3.2.3')).toMatch(/Current status: 4\/4 personnel compliant/);
    expect(narr(agreeing, 'AT.L2-3.2.2')).toMatch(/the training store does not decide this control/);
    expect(narr(agreeing, 'AT.L2-3.2.2')).not.toMatch(/Current status:/);
    expect(narr(agreeing, 'PS.L2-3.9.1')).toMatch(/Personnel Screening Status: 4\/4 cleared, 0 unscreened \(from the organisation's screening records\)/);
    expect(narr(agreeing, 'PS.L2-3.9.2')).toMatch(/Termination: termination from the organisation's records: .*account not disabled: p4/);

    // The reverse: a higher-precedence source decided the other way. No count is printed beside it.
    const reversed = generate({ 'AT.L2-3.2.1': 'met', 'AT.L2-3.2.2': 'met', 'AT.L2-3.2.3': 'not_met', 'PS.L2-3.9.1': 'not_met', 'PS.L2-3.9.2': 'met' });
    expect(violations(reversed)).toEqual([]);
    expect(narr(reversed, 'AT.L2-3.2.1')).toMatch(/The training store does not decide the status shown for AT.L2-3.2.1/);
    expect(narr(reversed, 'AT.L2-3.2.3')).toMatch(/The training store does not decide the status shown for AT.L2-3.2.3/);
    expect(narr(reversed, 'PS.L2-3.9.1')).toMatch(/the personnel store does not decide the status shown for PS.L2-3.9.1/);
    // not_assessed rows carry no count either.
    expect(violations(generate({ 'AT.L2-3.2.1': 'not_assessed', 'AT.L2-3.2.3': 'not_assessed', 'PS.L2-3.9.1': 'not_assessed' }))).toEqual([]);
  });
});
