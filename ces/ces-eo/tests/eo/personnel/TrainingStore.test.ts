// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-12 — training system of record.
 *
 * Logic tests against the real TrainingStore (SQLite-backed via ces-shared's unified
 * CesRepository, same CES_PIPELINE_ROOT=tmpdir pattern as tests/unit/personnel/personnel-store.test.ts).
 * Covers catalog load/save, required-course computation, completion/removal, overdue/expiring
 * status, control satisfaction, and tenant isolation (A cannot see B).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import type { TrainingCatalog, TrainingCompletion } from '../../../src/shared/types/personnel.types';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

describe('TrainingStore', () => {
  let tmpDir: string;
  let store: TrainingStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-training-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    store = new TrainingStore(tmpDir);
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const tenantA = 'training-tenant-a';
  const tenantB = 'training-tenant-b';
  const personA = 'person-a-1';
  const personB = 'person-b-1';

  const customCatalog: TrainingCatalog = {
    courses: [
      {
        id: 'course-all-users',
        title: 'All Users Course',
        provider: 'Test Provider',
        duration: '30min',
        targetRoles: ['*'],
        required_for_roles: ['all_users'],
        satisfies_controls: ['AT.L2-3.2.1'],
        refresh_cycle_days: 365,
      },
      {
        id: 'course-admin',
        title: 'Admin Course',
        provider: 'Test Provider',
        duration: '60min',
        targetRoles: ['system_administrator'],
        required_for_roles: ['system_administrator'],
        satisfies_controls: ['AT.L2-3.2.2'],
        refresh_cycle_days: 365,
      },
      {
        id: 'course-cui',
        title: 'CUI Course',
        provider: 'Test Provider',
        duration: '45min',
        targetRoles: ['cui_access'],
        required_for_roles: ['cui_access'],
        satisfies_controls: ['AT.L2-3.2.1'],
        refresh_cycle_days: 730,
      },
    ],
  };

  describe('catalog load/save', () => {
    it('returns the built-in default catalog when nothing has been saved', () => {
      const catalog = store.loadCatalog(tenantA);
      expect(catalog.courses.length).toBeGreaterThan(0);
      expect(catalog.courses.map(c => c.id)).toContain('dod-cyber-awareness-challenge-2026');
    });

    it('saves and reloads a custom catalog for a tenant', () => {
      store.saveCatalog(tenantA, customCatalog);
      const loaded = store.loadCatalog(tenantA);
      expect(loaded.courses.map(c => c.id)).toEqual(['course-all-users', 'course-admin', 'course-cui']);
    });
  });

  describe('computeRequiredCourses', () => {
    beforeEach(() => {
      store.saveCatalog(tenantA, customCatalog);
    });

    it('assigns the all_users course to every role regardless of screening state', () => {
      const required = store.computeRequiredCourses('Engineer', 'unscreened', customCatalog);
      expect(required).toContain('course-all-users');
      expect(required).not.toContain('course-admin');
      expect(required).not.toContain('course-cui');
    });

    it('assigns the admin course only to Admin/Operator roles', () => {
      expect(store.computeRequiredCourses('Admin', 'unscreened', customCatalog)).toContain('course-admin');
      expect(store.computeRequiredCourses('Operator', 'unscreened', customCatalog)).toContain('course-admin');
      expect(store.computeRequiredCourses('Engineer', 'unscreened', customCatalog)).not.toContain('course-admin');
    });

    it('assigns the CUI course only when screeningState is cleared', () => {
      expect(store.computeRequiredCourses('Engineer', 'cleared', customCatalog)).toContain('course-cui');
      expect(store.computeRequiredCourses('Engineer', 'unscreened', customCatalog)).not.toContain('course-cui');
    });

    // Pin (not a fix): the `targetRoles` wildcard/role check sits INSIDE the loop over
    // `required_for_roles`, so a course with an empty required_for_roles array never
    // matches even if targetRoles says '*'. Every course in both the default and this
    // test's catalog has a non-empty required_for_roles, so this is latent, not exercised
    // in practice today — pinned here and called out in the report rather than "fixed"
    // (unclear which field is supposed to win; a behavior change here is a product call).
    it('a course with empty required_for_roles is never assigned, even with a wildcard targetRoles', () => {
      const catalogWithEdgeCase: TrainingCatalog = {
        courses: [
          {
            id: 'course-orphan-target',
            title: 'Orphan Target Course',
            provider: 'Test Provider',
            duration: '10min',
            targetRoles: ['*'],
            required_for_roles: [],
            satisfies_controls: [],
            refresh_cycle_days: 365,
          },
        ],
      };
      expect(store.computeRequiredCourses('Engineer', 'unscreened', catalogWithEdgeCase)).toEqual([]);
    });
  });

  describe('addCompletion / removeCompletion', () => {
    it('creates training state on first completion and records the completion', () => {
      const completion: TrainingCompletion = { courseId: 'course-all-users', completedDate: '2026-01-01T00:00:00Z' };
      const state = store.addCompletion(tenantA, personA, completion);
      expect(state.personnelId).toBe(personA);
      expect(state.completions).toHaveLength(1);
      expect(state.completions[0].courseId).toBe('course-all-users');
    });

    it('removes a completion by courseId', () => {
      store.addCompletion(tenantA, personA, { courseId: 'course-a', completedDate: '2026-01-01T00:00:00Z' });
      store.addCompletion(tenantA, personA, { courseId: 'course-b', completedDate: '2026-01-01T00:00:00Z' });
      const after = store.removeCompletion(tenantA, personA, 'course-a');
      expect(after?.completions.map(c => c.courseId)).toEqual(['course-b']);
    });

    it('removeCompletion on a person with no state returns null', () => {
      expect(store.removeCompletion(tenantA, 'nobody', 'course-x')).toBeNull();
    });

    // --- DEFECT: re-completing a course (e.g. annual refresher after expiry) left the STALE,
    // expired completion record as the first match, so getTrainingStatus/isControlMet kept
    // reporting the course overdue even though a fresh completion had just been recorded.
    // Fail-first: this assertion fails on unpatched TrainingStore.addCompletion (no de-dup by
    // courseId), which just pushes onto the completions array.
    it('re-completing an expired course clears overdue status (no duplicate stale completion)', () => {
      store.saveCatalog(tenantA, customCatalog);
      // First completion: already expired.
      store.addCompletion(tenantA, personA, {
        courseId: 'course-all-users',
        completedDate: '2020-01-01T00:00:00Z',
        expiryDate: '2020-06-01T00:00:00Z', // long expired
      });
      let status = store.getTrainingStatus(tenantA, personA, 'Engineer', 'unscreened', 30);
      expect(status.overdue).toBe(1);

      // Re-completion: fresh, not expired.
      const farFuture = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
      store.addCompletion(tenantA, personA, {
        courseId: 'course-all-users',
        completedDate: new Date().toISOString(),
        expiryDate: farFuture,
      });

      const state = store.loadTrainingState(tenantA, personA);
      expect(state?.completions.filter(c => c.courseId === 'course-all-users')).toHaveLength(1);

      status = store.getTrainingStatus(tenantA, personA, 'Engineer', 'unscreened', 30);
      expect(status.overdue).toBe(0);
      expect(status.completed).toBe(1);
    });
  });

  describe('getTrainingStatus', () => {
    beforeEach(() => {
      store.saveCatalog(tenantA, customCatalog);
    });

    it('reports total/completed/overdue for a person with no training state at all', () => {
      const status = store.getTrainingStatus(tenantA, 'ghost-person', 'Engineer', 'unscreened', 30);
      expect(status.total).toBe(1); // course-all-users only
      expect(status.completed).toBe(0);
      expect(status.overdue).toBe(0); // no state yet -> not "overdue", just unassigned
    });

    it('reports overdue once required-course state exists but is not completed', () => {
      // Assign (creates state) without completing.
      store.addCompletion(tenantA, personA, { courseId: 'unrelated-course', completedDate: '2026-01-01T00:00:00Z' });
      store.removeCompletion(tenantA, personA, 'unrelated-course'); // leaves state present, completions empty
      const status = store.getTrainingStatus(tenantA, personA, 'Engineer', 'unscreened', 30);
      expect(status.overdue).toBe(1);
    });

    it('reports expiringSoon within the grace period', () => {
      const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days out
      store.addCompletion(tenantA, personA, {
        courseId: 'course-all-users',
        completedDate: new Date().toISOString(),
        expiryDate: soon,
      });
      const status = store.getTrainingStatus(tenantA, personA, 'Engineer', 'unscreened', 30);
      expect(status.expiringSoon).toBe(1);
      expect(status.completed).toBe(1);
    });
  });

  describe('isControlMet', () => {
    beforeEach(() => {
      store.saveCatalog(tenantA, customCatalog);
    });

    it('returns false with no active personnel', () => {
      expect(store.isControlMet(tenantA, 'AT.L2-3.2.1', [])).toBe(false);
    });

    it('returns false when the required course is not yet completed', () => {
      const people = [{ id: personA, role: 'Engineer', screeningState: 'unscreened' }];
      expect(store.isControlMet(tenantA, 'AT.L2-3.2.1', people)).toBe(false);
    });

    it('returns true once every person with the requirement has a current completion', () => {
      store.addCompletion(tenantA, personA, {
        courseId: 'course-all-users',
        completedDate: new Date().toISOString(),
      });
      const people = [{ id: personA, role: 'Engineer', screeningState: 'unscreened' }];
      expect(store.isControlMet(tenantA, 'AT.L2-3.2.1', people)).toBe(true);
    });

    it('an expired completion no longer satisfies the control', () => {
      store.addCompletion(tenantA, personA, {
        courseId: 'course-all-users',
        completedDate: '2020-01-01T00:00:00Z',
        expiryDate: '2020-06-01T00:00:00Z',
      });
      const people = [{ id: personA, role: 'Engineer', screeningState: 'unscreened' }];
      expect(store.isControlMet(tenantA, 'AT.L2-3.2.1', people)).toBe(false);
    });
  });

  describe('tenant isolation (A cannot see B)', () => {
    it('catalogs are isolated per tenant', () => {
      store.saveCatalog(tenantA, customCatalog);
      const bCatalog = store.loadCatalog(tenantB);
      // B never saved a custom catalog -> gets the default, not A's custom one.
      expect(bCatalog.courses.map(c => c.id)).not.toEqual(customCatalog.courses.map(c => c.id));
    });

    it('training state for the same personnelId string is isolated by tenant', () => {
      store.addCompletion(tenantA, personA, { courseId: 'course-x', completedDate: '2026-01-01T00:00:00Z' });
      expect(store.loadTrainingState(tenantB, personA)).toBeNull();
      expect(store.loadTrainingState(tenantA, personA)?.completions).toHaveLength(1);
    });

    it('isControlMet for tenant B is unaffected by tenant A completions', () => {
      store.saveCatalog(tenantA, customCatalog);
      store.saveCatalog(tenantB, customCatalog);
      store.addCompletion(tenantA, personA, { courseId: 'course-all-users', completedDate: new Date().toISOString() });
      const peopleB = [{ id: personB, role: 'Engineer', screeningState: 'unscreened' }];
      expect(store.isControlMet(tenantB, 'AT.L2-3.2.1', peopleB)).toBe(false);
    });
  });

  // Sanity: confirms tests really hit the unified repository, not a leftover in-memory stub.
  it('persists via the unified CES repository collection', () => {
    store.saveCatalog(tenantA, customCatalog);
    const repo = getCesRepository();
    const rec = repo.get('eo_training_catalog', `${tenantA}:_training_catalog`, { tenantSlug: tenantA });
    expect(rec).toBeDefined();
  });
});
