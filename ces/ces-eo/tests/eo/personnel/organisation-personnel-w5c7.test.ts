/**
 * Synthetic-customer W5 cycle 7 (personnel store): the organisation's uploaded personnel records decide
 * PS.L2-3.9.1 / PS.L2-3.9.2 readiness when present. Row shapes follow the S1 and S2 records
 * (`customers/<slug>/records/personnel-screening.json` / `personnel-lifecycle.json`, `ces-org-record/1`):
 * S1 45 screening rows (all cleared), 15 lifecycle rows (1 joiner, leaver s1p-040 complete, leaver s1p-007 with
 * the account-disable and group-removal steps open); S2 29 screening rows (26 staff + 3 contractors, all cleared),
 * 9 lifecycle rows (1 joiner, contractor leaver s2c-028 with the account-disable step open). Names are omitted.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import {
  personnelFromRecords, readinessFromOrganisationRecords, type PersonnelRecordInput,
} from '../../../src/eo/personnel/OrganisationPersonnel';

const screeningRow = (id: string, result = 'cleared', extra: Record<string, unknown> = {}) => ({
  date: '2025-06-21', person_id: id, job_title: 'Engineer',
  screening: 'identity verification, employment history, criminal history check, US person status', result, reviewed_by: 'FSO', ...extra,
});
const step = (id: string, event: 'onboarding' | 'termination', s: string, status: 'done' | 'open', title = 'Engineer') =>
  ({ date: '2026-09-22', person_id: id, job_title: title, event, step: s, status, performed_by: 'FSO' });
const pad = (prefix: string, n: number) => String(n).padStart(3, '0').replace(/^/, `${prefix}-`);

const s1Screening = () => Array.from({ length: 45 }, (_, i) => screeningRow(pad('s1p', i + 1)));
const s1Lifecycle = (disable007: 'done' | 'open' = 'open') => [
  ...['screening record confirmed before account creation', 'account created; added to S1-Training-Not-Complete until training is complete',
    'security awareness and insider threat training assigned', 'facility badge issued', 'rules of behaviour signed'].map(s => step('s1p-041', 'onboarding', s, 'done', 'CNC Machinist')),
  ...['exit interview; CUI handling obligations restated', 'account disabled (leaver workflow run)', 'removed from all groups and licences',
    'facility badge collected and revoked', 'company equipment returned (shop-floor tablet)'].map(s => step('s1p-040', 'termination', s, 'done', 'CNC Machinist')),
  step('s1p-007', 'termination', 'exit interview; CUI handling obligations restated', 'done', 'Program Coordinator'),
  step('s1p-007', 'termination', 'facility badge collected and revoked', 'done', 'Program Coordinator'),
  step('s1p-007', 'termination', 'company equipment returned (laptop)', 'done', 'Program Coordinator'),
  step('s1p-007', 'termination', 'account disabled (leaver workflow run)', disable007, 'Program Coordinator'),
  step('s1p-007', 'termination', 'removed from CUI-Authorized-Users and S1-CUI-Program-Team', disable007, 'Program Coordinator'),
];
const s2Screening = () => [
  ...Array.from({ length: 26 }, (_, i) => screeningRow(pad('s2p', i + 1))),
  ...[26, 27, 28].map(n => screeningRow(pad('s2c', n), 'cleared', { screening: 'contractor: employer attestation of identity, background and US person status' })),
];
const s2Lifecycle = () => [
  ...['screening record confirmed before account creation', 'account created in on-premises AD and synchronised',
    'security awareness and insider threat training assigned', 'facility badge issued', 'rules of behaviour signed'].map(s => step('s2p-021', 'onboarding', s, 'done', 'Test Engineer')),
  step('s2c-028', 'termination', 'engagement end confirmed with the provider; CUI handling obligations restated', 'done', 'MSP Support Technician'),
  step('s2c-028', 'termination', 'remote support tool access for the technician withdrawn by the provider', 'done', 'MSP Support Technician'),
  step('s2c-028', 'termination', 'cloud-only contractor account disabled (leaver workflow run)', 'open', 'MSP Support Technician'),
  step('s2c-028', 'termination', 'removed from S2-Contractors and licences reclaimed', 'open', 'MSP Support Technician'),
];
const record = (kind: string, rows: Record<string, unknown>[], n = 1): PersonnelRecordInput =>
  ({ itemId: `ec-item-${kind}-${n}`, filename: `${kind.replace('_', '-')}.json`, sha256: 'a'.repeat(64), recordKind: kind, rows });
const stored = (screening: Record<string, unknown>[], lifecycle: Record<string, unknown>[]) =>
  personnelFromRecords([record('personnel_screening', screening), record('personnel_lifecycle', lifecycle), record('training_completion', [{ date: '2026-01-01' }])], '2026-10-28T00:00:00Z')!;

describe('W5c7 readiness from the organisation personnel records', () => {
  it('S1 shape: PS.L2-3.9.1 met (44 active cleared, the complete leaver excluded); PS.L2-3.9.2 not met naming s1p-007', () => {
    const { readiness, rationale391, rationale392 } = readinessFromOrganisationRecords(stored(s1Screening(), s1Lifecycle()));
    expect(readiness.ps_3_9_1).toBe('met');
    expect([readiness.total, readiness.cleared, readiness.offboarded]).toEqual([44, 44, 1]);
    expect(rationale391).toContain('45 person(s) in the uploaded screening records (personnel-screening.json), 1 offboarded excluded; all 44 active person(s) cleared');
    expect(readiness.ps_3_9_2).toBe('not_met');
    expect(rationale392).toContain('2 leaver(s)');
    expect(rationale392).toContain('account not disabled: s1p-007 (Program Coordinator) (account-disable step not done; open: account disabled (leaver workflow run); removed from CUI-Authorized-Users and S1-CUI-Program-Team)');
    expect(rationale392).not.toContain('s1p-040');
  });

  it('S1 shape with the leaver completed: PS.L2-3.9.2 met, 43 active', () => {
    const { readiness, rationale392 } = readinessFromOrganisationRecords(stored(s1Screening(), s1Lifecycle('done')));
    expect(readiness.ps_3_9_2).toBe('met');
    expect(readiness.total).toBe(43);
    expect(rationale392).toContain("every leaver's account-disable step is done");
  });

  it('S2 shape: PS.L2-3.9.1 met (29 cleared, contractors included); PS.L2-3.9.2 not met naming s2c-028', () => {
    const { readiness, rationale392 } = readinessFromOrganisationRecords(stored(s2Screening(), s2Lifecycle()));
    expect(readiness.ps_3_9_1).toBe('met');
    expect([readiness.total, readiness.cleared, readiness.offboarded]).toEqual([29, 29, 0]);
    expect(readiness.ps_3_9_2).toBe('not_met');
    expect(rationale392).toContain('s2c-028 (MSP Support Technician) (account-disable step not done');
  });

  it('a person not cleared: PS.L2-3.9.1 not met, the person and result printed', () => {
    const rows = s2Screening();
    rows[4] = screeningRow('s2p-005', 'pending');
    const { readiness, rationale391 } = readinessFromOrganisationRecords(stored(rows, s2Lifecycle()));
    expect(readiness.ps_3_9_1).toBe('not_met');
    expect(rationale391).toContain("not cleared: s2p-005 (Engineer) result 'pending'");
  });

  it('an admin-account row counts as its owner (owner_person_id): no double count; the latest row wins', () => {
    const rows = [screeningRow('s1p-008', 'cleared'), screeningRow('s1a-046', 'cleared', { owner_person_id: 's1p-008', date: '2025-07-01' })];
    const { readiness } = readinessFromOrganisationRecords(stored(rows, []));
    expect(readiness.total).toBe(1);
    const expired = [screeningRow('s1p-008', 'cleared'), screeningRow('s1a-046', 'expired', { owner_person_id: 's1p-008', date: '2026-07-01' })];
    expect(readinessFromOrganisationRecords(stored(expired, [])).readiness.ps_3_9_1).toBe('not_met');
  });

  it('a leaver with no account-disable step recorded: not met, said so', () => {
    const { readiness, rationale392 } = readinessFromOrganisationRecords(stored(s2Screening(), [step('s2p-003', 'termination', 'exit interview', 'done')]));
    expect(readiness.ps_3_9_2).toBe('not_met');
    expect(rationale392).toContain('no account-disable step recorded');
  });

  it('no personnel-kind record: nothing to store', () => {
    expect(personnelFromRecords([record('training_completion', [{ date: '2026-01-01' }])], 'x')).toBeUndefined();
  });
});

describe('W5c7 PersonnelStore with the organisation records', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  const SLUG = 's2-eng';
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5c7-personnel-'));
    process.env.CES_PIPELINE_ROOT = tmp;
  });
  afterEach(() => {
    closeAllCesRepositories();
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('no uploaded records: today\'s behaviour (an empty store is not met, no basis)', () => {
    const store = new PersonnelStore(tmp);
    const r = store.getReadiness(SLUG);
    expect([r.ps_3_9_1, r.ps_3_9_2, r.ps_3_9_1_basis, r.ps_3_9_2_basis]).toEqual(['not_met', 'not_met', undefined, undefined]);
  });

  it('uploaded S2 records become the source; load() still lists only personnel records; removed again when none is uploaded', () => {
    const store = new PersonnelStore(tmp);
    store.saveOrganisationRecords(SLUG, [record('personnel_screening', s2Screening()), record('personnel_lifecycle', s2Lifecycle())]);
    const r = store.getReadiness(SLUG);
    expect(r.ps_3_9_1).toBe('met');
    expect(r.ps_3_9_1_basis).toContain('29 person(s)');
    expect(r.ps_3_9_2).toBe('not_met');
    expect(r.ps_3_9_2_basis).toContain('s2c-028');
    expect(store.load(SLUG)).toEqual([]);
    store.saveOrganisationRecords(SLUG, []);
    expect(store.getReadiness(SLUG).ps_3_9_1_basis).toBeUndefined();
  });

  it('screening uploaded without lifecycle: PS.L2-3.9.2 keeps the personnel-record rule', () => {
    const store = new PersonnelStore(tmp);
    store.save(SLUG, {
      id: 'p-1', displayName: 'Leaver', email: 'leaver@example.invalid', role: 'engineer', screeningState: 'offboarded',
      createdDate: '2026-01-01T00:00:00Z', evidenceArtifacts: [], lifecycleEvents: [{ timestamp: '2026-02-01T00:00:00Z', event: 'offboarded', actor: 'system', details: 'x' }],
    } as any);
    store.saveOrganisationRecords(SLUG, [record('personnel_screening', s2Screening())]);
    const r = store.getReadiness(SLUG);
    expect(r.ps_3_9_1).toBe('met');
    expect(r.ps_3_9_2).toBe('met');
    expect(r.ps_3_9_2_basis).toBeUndefined();
  });
});
