// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-13 — screening system of record (store-level logic, real CesRepository).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import type { ScreeningElementState } from '../../../src/eo/personnel/screening.types';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';

describe('ScreeningElementStore', () => {
  let tmpDir: string;
  let store: ScreeningElementStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-screening-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    store = new ScreeningElementStore(tmpDir);
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const tenantA = 'screening-tenant-a';
  const tenantB = 'screening-tenant-b';
  const personA = 'person-a';
  const personB = 'person-b';

  const identityState: ScreeningElementState = {
    elementNumber: 1,
    status: 'completed',
    data: {
      _elementType: 'identity_verification',
      documentType: 'drivers_license',
      documentNumber: 'D1234567',
      issuingAuthority: 'DMV',
      expirationDate: '2030-01-01',
      verifiedBy: 'hr-admin',
      verificationDate: '2026-01-01',
    },
    completedDate: '2026-01-01T00:00:00Z',
  };

  describe('load/save', () => {
    it('returns null for an element never saved', () => {
      expect(store.load(tenantA, personA, 1)).toBeNull();
    });

    it('saves and reloads a valid element state', () => {
      store.save(tenantA, personA, 1, identityState);
      const loaded = store.load(tenantA, personA, 1);
      expect(loaded?.status).toBe('completed');
      expect(loaded?.data && '_elementType' in loaded.data ? loaded.data._elementType : null).toBe('identity_verification');
    });
  });

  describe('loadAll', () => {
    it('returns 7 elements, defaulting missing ones to not_started/null', () => {
      store.save(tenantA, personA, 1, identityState);
      const all = store.loadAll(tenantA, personA);
      expect(all).toHaveLength(7);
      expect(all[0].status).toBe('completed');
      expect(all[1].status).toBe('not_started');
      expect(all[1].data).toBeNull();
      expect(all.map(e => e.elementNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
  });

  describe('areElementsOneToSixComplete', () => {
    it('is false when any of 1-6 is missing or incomplete', () => {
      expect(store.areElementsOneToSixComplete(tenantA, personA)).toBe(false);
      store.save(tenantA, personA, 1, identityState);
      expect(store.areElementsOneToSixComplete(tenantA, personA)).toBe(false); // 2-6 still missing
    });

    it('is true once elements 1-6 are all completed (element 7 not required)', () => {
      for (let i = 1; i <= 6; i++) {
        store.save(tenantA, personA, i, { ...identityState, elementNumber: i as any, data: null });
      }
      expect(store.areElementsOneToSixComplete(tenantA, personA)).toBe(true);
    });
  });

  describe('getReadiness', () => {
    it('reports incomplete with no AO determination when nothing is done', () => {
      const readiness = store.getReadiness(tenantA, personA);
      expect(readiness.elementsComplete).toEqual([]);
      expect(readiness.elementsIncomplete).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(readiness.aoDetermination).toBeNull();
      expect(readiness.packageComplete).toBe(false);
    });

    it('packageComplete is true only when all 7 are complete AND element 7 determination is approve', () => {
      for (let i = 1; i <= 6; i++) {
        store.save(tenantA, personA, i, { elementNumber: i as any, status: 'completed', data: null });
      }
      store.save(tenantA, personA, 7, {
        elementNumber: 7, status: 'completed',
        data: { _elementType: 'ao_sign_off', ao_name: 'Officer', ao_email: 'ao@example.test', ao_role: 'AO', determination: 'deny', signOffDate: '2026-01-01', signedText: 'x' },
      });
      let readiness = store.getReadiness(tenantA, personA);
      expect(readiness.element7Status).toBe('completed');
      expect(readiness.aoDetermination).toBe('deny');
      expect(readiness.packageComplete).toBe(false); // denied, not approved

      store.save(tenantA, personA, 7, {
        elementNumber: 7, status: 'completed',
        data: { _elementType: 'ao_sign_off', ao_name: 'Officer', ao_email: 'ao@example.test', ao_role: 'AO', determination: 'approve', signOffDate: '2026-01-01', signedText: 'x' },
      });
      readiness = store.getReadiness(tenantA, personA);
      expect(readiness.aoDetermination).toBe('approve');
      expect(readiness.packageComplete).toBe(true);
    });
  });

  describe('tenant isolation (A cannot see B)', () => {
    it('an element saved for A is invisible to B for the same personnelId string', () => {
      store.save(tenantA, personA, 1, identityState);
      expect(store.load(tenantB, personA, 1)).toBeNull();
      expect(store.load(tenantA, personA, 1)).not.toBeNull();
    });

    it('readiness for B is unaffected by a fully-approved package in A', () => {
      for (let i = 1; i <= 6; i++) {
        store.save(tenantA, personA, i, { elementNumber: i as any, status: 'completed', data: null });
      }
      store.save(tenantA, personA, 7, {
        elementNumber: 7, status: 'completed',
        data: { _elementType: 'ao_sign_off', ao_name: 'Officer', ao_email: 'ao@example.test', ao_role: 'AO', determination: 'approve', signOffDate: '2026-01-01', signedText: 'x' },
      });
      const readinessB = store.getReadiness(tenantB, personB);
      expect(readinessB.packageComplete).toBe(false);
      expect(readinessB.elementsComplete).toEqual([]);
    });
  });
});
