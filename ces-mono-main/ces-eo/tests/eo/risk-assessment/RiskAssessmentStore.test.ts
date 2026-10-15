// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-15 (area 1: register CRUD) — RiskAssessmentStore logic tests against the
 * real unified CES repository (same CES_PIPELINE_ROOT=tmpdir pattern as the other FC-EO-B
 * store tests). Also covers config load defaults, annual-review state, and snapshot
 * immutability (areas 4's data layer; the step-machine/document-generation logic itself
 * lives in the router/renderer and is covered separately).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';
import type { RiskEntry } from '../../../src/shared/types/risk-assessment.types';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';

describe('RiskAssessmentStore', () => {
  let tmpDir: string;
  let store: RiskAssessmentStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-risk-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    store = new RiskAssessmentStore(tmpDir);
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const tenantA = 'risk-tenant-a';
  const tenantB = 'risk-tenant-b';

  const manualEntry: Omit<RiskEntry, 'id' | 'firstIdentified'> = {
    threatSource: 'non_adversarial',
    threatEvent: 'Test threat event',
    vulnerability: { type: 'organizational', description: 'Test vulnerability' },
    affectedAssets: [],
    affectedOperations: [],
    treatmentRecommendation: 'mitigate',
    treatmentStatus: 'recommended',
    lastReviewed: '2026-01-01T00:00:00Z',
    nextReviewDue: '2027-01-01T00:00:00Z',
    source: { type: 'manual', description: 'manually entered' },
  };

  describe('config', () => {
    it('returns a default config with the NIST scoring scale pre-populated', () => {
      const cfg = store.loadConfig(tenantA);
      expect(cfg.methodology).toBe('nist_sp_800_30_rev1');
      expect(cfg.scoringScale?.likelihoodScale).toEqual(['very_low', 'low', 'moderate', 'high', 'very_high']);
    });

    it('saves and reloads a custom config', () => {
      const cfg = store.loadConfig(tenantA);
      cfg.scopeStatement = 'Custom scope statement';
      cfg.frequencyMonths = 6;
      store.saveConfig(tenantA, cfg);
      const reloaded = store.loadConfig(tenantA);
      expect(reloaded.scopeStatement).toBe('Custom scope statement');
      expect(reloaded.frequencyMonths).toBe(6);
    });
  });

  describe('register CRUD', () => {
    it('starts with an empty register', () => {
      const register = store.loadRegister(tenantA);
      expect(register.entries).toEqual([]);
    });

    it('addEntry assigns an id and firstIdentified, and persists it', () => {
      const entry = store.addEntry(tenantA, manualEntry);
      expect(entry.id).toBeTruthy();
      expect(entry.firstIdentified).toBeTruthy();
      const register = store.loadRegister(tenantA);
      expect(register.entries.map(e => e.id)).toEqual([entry.id]);
    });

    it('getEntry finds an entry by id, or returns null', () => {
      const entry = store.addEntry(tenantA, manualEntry);
      expect(store.getEntry(tenantA, entry.id)?.threatEvent).toBe('Test threat event');
      expect(store.getEntry(tenantA, 'no-such-id')).toBeNull();
    });

    it('updateEntry merges fields and returns the updated entry', () => {
      const entry = store.addEntry(tenantA, manualEntry);
      const updated = store.updateEntry(tenantA, entry.id, { treatmentStatus: 'mitigated', notes: 'fixed it' });
      expect(updated?.treatmentStatus).toBe('mitigated');
      expect(updated?.notes).toBe('fixed it');
      expect(updated?.threatEvent).toBe('Test threat event'); // untouched fields preserved
    });

    it('updateEntry on an unknown id returns null and does not create an entry', () => {
      expect(store.updateEntry(tenantA, 'no-such-id', { notes: 'x' })).toBeNull();
      expect(store.loadRegister(tenantA).entries).toEqual([]);
    });

    it('deleteEntry removes the entry and returns true; a second delete returns false', () => {
      const entry = store.addEntry(tenantA, manualEntry);
      expect(store.deleteEntry(tenantA, entry.id)).toBe(true);
      expect(store.loadRegister(tenantA).entries).toEqual([]);
      expect(store.deleteEntry(tenantA, entry.id)).toBe(false);
    });
  });

  describe('annual review state', () => {
    it('has no in-progress review by default', () => {
      expect(store.loadAnnualReviewState(tenantA)).toBeNull();
    });

    it('saves, reloads, and deletes review state', () => {
      store.saveAnnualReviewState(tenantA, { currentStep: 1, startedAt: '2026-01-01T00:00:00Z', startedBy: 'reviewer', stepData: {} });
      expect(store.loadAnnualReviewState(tenantA)?.currentStep).toBe(1);
      store.deleteAnnualReviewState(tenantA);
      expect(store.loadAnnualReviewState(tenantA)).toBeNull();
    });
  });

  describe('annual snapshots (immutability)', () => {
    it('creates a snapshot and lists it', () => {
      const register = store.loadRegister(tenantA);
      const snapshot = store.createSnapshot(tenantA, {
        assessmentYear: 2026, reviewedDate: '2026-01-01T00:00:00Z', reviewedBy: 'reviewer',
        signedOffBy: 'ao', signedOffDate: '2026-01-01T00:00:00Z', registerSnapshot: register,
        reportArtifactPath: 'snapshots/2026.json',
      });
      expect(snapshot.snapshotId).toBeTruthy();
      expect(store.listSnapshots(tenantA)).toEqual([{ year: 2026, snapshotId: snapshot.snapshotId, signedOffDate: '2026-01-01T00:00:00Z' }]);
    });

    it('refuses to overwrite an existing year (snapshots are immutable)', () => {
      const register = store.loadRegister(tenantA);
      store.createSnapshot(tenantA, {
        assessmentYear: 2026, reviewedDate: '2026-01-01T00:00:00Z', reviewedBy: 'reviewer',
        signedOffBy: 'ao', signedOffDate: '2026-01-01T00:00:00Z', registerSnapshot: register,
        reportArtifactPath: 'snapshots/2026.json',
      });
      expect(() => store.createSnapshot(tenantA, {
        assessmentYear: 2026, reviewedDate: '2026-06-01T00:00:00Z', reviewedBy: 'reviewer-2',
        signedOffBy: 'ao', signedOffDate: '2026-06-01T00:00:00Z', registerSnapshot: register,
        reportArtifactPath: 'snapshots/2026.json',
      })).toThrow(/already exists/);
    });
  });

  describe('ingestion run log', () => {
    it('saves and lists ingestion runs, most recent first', () => {
      store.saveIngestionRun(tenantA, { timestamp: '2026-01-01T00:00:00Z', results: [], totalNew: 1, totalUpdated: 0, totalErrors: 0 });
      store.saveIngestionRun(tenantA, { timestamp: '2026-02-01T00:00:00Z', results: [], totalNew: 2, totalUpdated: 0, totalErrors: 0 });
      const runs = store.listIngestionRuns(tenantA);
      expect(runs.map(r => r.timestamp)).toEqual(['2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z']);
    });
  });

  describe('tenant isolation (A cannot see B)', () => {
    it('registers are isolated per tenant', () => {
      const entryA = store.addEntry(tenantA, manualEntry);
      expect(store.getEntry(tenantB, entryA.id)).toBeNull();
      expect(store.loadRegister(tenantB).entries).toEqual([]);
    });

    it('config, annual-review state, and snapshots are isolated per tenant', () => {
      const cfgA = store.loadConfig(tenantA);
      cfgA.scopeStatement = 'A only';
      store.saveConfig(tenantA, cfgA);
      expect(store.loadConfig(tenantB).scopeStatement).toBe('');

      store.saveAnnualReviewState(tenantA, { currentStep: 3, startedAt: '2026-01-01T00:00:00Z', startedBy: 'x', stepData: {} });
      expect(store.loadAnnualReviewState(tenantB)).toBeNull();

      const registerA = store.loadRegister(tenantA);
      store.createSnapshot(tenantA, {
        assessmentYear: 2026, reviewedDate: '2026-01-01T00:00:00Z', reviewedBy: 'r',
        signedOffBy: 'ao', signedOffDate: '2026-01-01T00:00:00Z', registerSnapshot: registerA,
        reportArtifactPath: 'snapshots/2026.json',
      });
      expect(store.listSnapshots(tenantB)).toEqual([]);
    });
  });
});
