// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.3 (B12): six-year retention metadata, and StorageCleanupService never touches
 * `<storageRoot>/evidence-store`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { retainUntil, isUnderEvidenceStore, RETENTION_YEARS } from '../../../../src/eo/evidence/store/RetentionPolicy';
import { StorageCleanupService } from '../../../../src/eo/server/StorageCleanupService';
import { evidenceStoreRoot } from '../../../../src/eo/config/EoConfig';

describe('RetentionPolicy (W1.3)', () => {
  it('retainUntil = collectedAt + 6 years', () => {
    expect(RETENTION_YEARS).toBe(6);
    expect(retainUntil('2026-10-27T00:00:00.000Z')).toBe('2032-10-27T00:00:00.000Z');
    expect(retainUntil('2028-02-29T12:00:00Z')).toBe('2034-03-01T12:00:00.000Z'); // no Feb 29 in 2034
    expect(() => retainUntil('nope')).toThrow(/unparseable/);
  });

  it('isUnderEvidenceStore matches the store and anything inside it, nothing else', () => {
    const root = path.join(os.tmpdir(), 'eo-root');
    expect(isUnderEvidenceStore(root, path.join(root, 'evidence-store'))).toBe(true);
    expect(isUnderEvidenceStore(root, path.join(root, 'evidence-store', 't', 'records.jsonl'))).toBe(true);
    expect(isUnderEvidenceStore(root, path.join(root, 'assessments', '..', 'evidence-store', 'x'))).toBe(true);
    expect(isUnderEvidenceStore(root, path.join(root, 'evidence-store-old'))).toBe(false);
    expect(isUnderEvidenceStore(root, path.join(root, 'assessments', 'x'))).toBe(false);
  });

  it('EoConfig places the store at <storageRoot>/evidence-store', () => {
    expect(evidenceStoreRoot({ storageRoot: path.join('r', 'eo') })).toBe(path.join('r', 'eo', 'evidence-store'));
  });

  describe('StorageCleanupService never touches the store', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ret-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('refuses a snapshot id that resolves into the store', async () => {
      const store = path.join(tmp, 'evidence-store', 'tenant-x');
      fs.mkdirSync(store, { recursive: true });
      fs.writeFileSync(path.join(store, 'records.jsonl'), '{}\n');
      const svc = new StorageCleanupService(tmp);
      await expect(svc.deleteSnapshot('../evidence-store/tenant-x')).rejects.toThrow(/refusing to delete under evidence-store/);
      await expect(svc.deleteSnapshot('../evidence-store')).rejects.toThrow(/refusing/);
      expect(fs.existsSync(path.join(store, 'records.jsonl'))).toBe(true);
    });

    it('old snapshots and temp files are pruned; old store files are left alone', async () => {
      const old = new Date(Date.now() - 400 * 24 * 3600 * 1000);
      const snap = path.join(tmp, 'assessments', 's1');
      fs.mkdirSync(snap, { recursive: true });
      fs.writeFileSync(path.join(snap, 'snapshot.json'), '{}');
      fs.utimesSync(path.join(snap, 'snapshot.json'), old, old);
      fs.mkdirSync(path.join(tmp, 'temp'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'temp', 't.tmp'), 'x');
      fs.utimesSync(path.join(tmp, 'temp', 't.tmp'), old, old);
      const rec = path.join(tmp, 'evidence-store', 'tenant-x', 'records.jsonl');
      fs.mkdirSync(path.dirname(rec), { recursive: true });
      fs.writeFileSync(rec, '{}\n');
      fs.utimesSync(rec, old, old);
      const svc = new StorageCleanupService(tmp);
      expect(await svc.cleanAssessmentSnapshots(30)).toBe(1);
      expect(await svc.cleanTempFiles(7)).toBe(1);
      expect(fs.existsSync(rec)).toBe(true);
    });
  });
});
