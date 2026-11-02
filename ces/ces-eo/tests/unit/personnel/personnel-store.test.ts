// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import {
  PersonnelConfigSchema,
  PersonnelCreateRequestSchema,
  PersonnelUpdateRequestSchema,
  LifecycleEventCreateSchema,
  ScreeningStateSchema,
} from '../../../src/shared/types/personnel.types';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

// ---------- PersonnelStore ----------
// G2: PersonnelStore now persists to the unified SQLite repository ({CES_PIPELINE_ROOT}/ces.db),
// tenant-isolated by tenantSlug. Tests point CES_PIPELINE_ROOT at a temp dir per test and release
// the SQLite handle (Windows file lock) before deleting it. Behavioral assertions are unchanged;
// the former on-disk-file assertions are converted to repository-content assertions.

describe('PersonnelStore', () => {
  let tmpDir: string;
  let store: PersonnelStore;
  const prevRoot = process.env.CES_PIPELINE_ROOT;
  const PERSONNEL_COLLECTION = 'eo_personnel';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-personnel-test-'));
    process.env.CES_PIPELINE_ROOT = tmpDir; // unified DB lands at {tmpDir}/ces.db
    store = new PersonnelStore(tmpDir);
  });

  afterEach(() => {
    closeAllCesRepositories(); // release SQLite handle before deleting the temp DB (Windows lock)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  const tenant = 'test-tenant';

  describe('create', () => {
    it('creates a record with auto-generated ID', () => {
      const record = store.create(tenant, {
        displayName: 'Alice Smith',
        email: 'alice@example.com',
        role: 'Engineer',
      });

      expect(record.id).toBeDefined();
      expect(record.id.length).toBeGreaterThan(0);
      expect(record.displayName).toBe('Alice Smith');
      expect(record.email).toBe('alice@example.com');
      expect(record.role).toBe('Engineer');
      expect(record.screeningState).toBe('unscreened');
      expect(record.evidenceArtifacts).toEqual([]);
      expect(record.lifecycleEvents).toHaveLength(1);
      expect(record.lifecycleEvents[0].event).toBe('created');
    });

    it('persists record to the repository', () => {
      const record = store.create(tenant, {
        displayName: 'Bob Jones',
        email: 'bob@example.com',
        role: 'Admin',
      });

      // G2: assert repository contents (tenant-scoped) rather than an on-disk JSON file.
      const rec = getCesRepository().get<{ displayName: string }>(
        PERSONNEL_COLLECTION,
        `${tenant}:${record.id}`,
        { tenantSlug: tenant },
      );
      expect(rec).toBeDefined();
      expect(rec!.data.displayName).toBe('Bob Jones');
    });

    it('accepts optional entraObjectId', () => {
      const record = store.create(tenant, {
        displayName: 'Carol Lee',
        email: 'carol@example.com',
        role: 'Manager',
        entraObjectId: 'aad-123-456',
      });

      expect(record.entraObjectId).toBe('aad-123-456');
    });
  });

  describe('load', () => {
    it('returns empty array when no records exist', () => {
      const records = store.load(tenant);
      expect(records).toEqual([]);
    });

    it('loads all records for a tenant', () => {
      store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      store.create(tenant, { displayName: 'B', email: 'b@e.com', role: 'R' });
      store.create(tenant, { displayName: 'C', email: 'c@e.com', role: 'R' });

      // Create fresh store to clear cache
      const store2 = new PersonnelStore(tmpDir);
      const records = store2.load(tenant);
      expect(records).toHaveLength(3);
    });

    it('uses cache on second call', () => {
      store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });

      const first = store.load(tenant);
      const second = store.load(tenant);
      // Same array reference when cached
      expect(first).toBe(second);
    });

    it('skips _config.json', () => {
      store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      store.saveConfig(tenant, PersonnelConfigSchema.parse({}));

      const store2 = new PersonnelStore(tmpDir);
      const records = store2.load(tenant);
      expect(records).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('returns record by ID', () => {
      const created = store.create(tenant, {
        displayName: 'Alice',
        email: 'alice@e.com',
        role: 'Eng',
      });

      const found = store.get(tenant, created.id);
      expect(found).not.toBeNull();
      expect(found!.displayName).toBe('Alice');
    });

    it('returns null for unknown ID', () => {
      const found = store.get(tenant, 'nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('save', () => {
    it('updates an existing record', () => {
      const record = store.create(tenant, {
        displayName: 'Alice',
        email: 'alice@e.com',
        role: 'Eng',
      });

      record.screeningState = 'cleared';
      record.lastScreenedDate = '2026-04-20';
      store.save(tenant, record);

      const store2 = new PersonnelStore(tmpDir);
      const loaded = store2.get(tenant, record.id);
      expect(loaded!.screeningState).toBe('cleared');
      expect(loaded!.lastScreenedDate).toBe('2026-04-20');
    });

    it('invalidates cache', () => {
      const record = store.create(tenant, {
        displayName: 'Alice',
        email: 'alice@e.com',
        role: 'Eng',
      });

      // Load to populate cache
      store.load(tenant);

      record.role = 'Lead';
      store.save(tenant, record);

      // Should not use stale cache
      const loaded = store.get(tenant, record.id);
      expect(loaded!.role).toBe('Lead');
    });
  });

  describe('delete', () => {
    it('removes record file', () => {
      const record = store.create(tenant, {
        displayName: 'Alice',
        email: 'alice@e.com',
        role: 'Eng',
      });

      const deleted = store.delete(tenant, record.id);
      expect(deleted).toBe(true);

      const found = store.get(tenant, record.id);
      expect(found).toBeNull();
    });

    it('returns false for nonexistent record', () => {
      const deleted = store.delete(tenant, 'nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('addEvent', () => {
    it('appends lifecycle event to record', () => {
      const record = store.create(tenant, {
        displayName: 'Alice',
        email: 'alice@e.com',
        role: 'Eng',
      });

      const updated = store.addEvent(tenant, record.id, {
        event: 'screening_started',
        actor: 'admin@e.com',
        details: 'Background check initiated',
      });

      expect(updated).not.toBeNull();
      expect(updated!.lifecycleEvents).toHaveLength(2); // created + screening_started
      expect(updated!.lifecycleEvents[1].event).toBe('screening_started');
      expect(updated!.lifecycleEvents[1].actor).toBe('admin@e.com');
      expect(updated!.lifecycleEvents[1].timestamp).toBeDefined();
    });

    it('returns null for nonexistent record', () => {
      const updated = store.addEvent(tenant, 'fake-id', {
        event: 'test',
        actor: 'admin',
      });
      expect(updated).toBeNull();
    });

    it('persists event to disk', () => {
      const record = store.create(tenant, {
        displayName: 'Bob',
        email: 'bob@e.com',
        role: 'Eng',
      });

      store.addEvent(tenant, record.id, {
        event: 'cleared',
        actor: 'admin',
      });

      const store2 = new PersonnelStore(tmpDir);
      const loaded = store2.get(tenant, record.id);
      expect(loaded!.lifecycleEvents).toHaveLength(2);
    });
  });

  describe('config', () => {
    it('returns default config when none saved', () => {
      const config = store.loadConfig(tenant);
      expect(config.reviewCycleYears).toBe(5);
      expect(config.docRetentionYears).toBe(6);
      expect(config.defaultScreeningVendor).toBe('checkr');
      expect(config.vendors).toHaveLength(3);
    });

    it('saves and loads custom config', () => {
      const config = PersonnelConfigSchema.parse({
        reviewCycleYears: 3,
        docRetentionYears: 10,
      });

      store.saveConfig(tenant, config);

      const store2 = new PersonnelStore(tmpDir);
      const loaded = store2.loadConfig(tenant);
      expect(loaded.reviewCycleYears).toBe(3);
      expect(loaded.docRetentionYears).toBe(10);
    });
  });

  describe('getReadiness', () => {
    it('returns not_met for both controls when no records', () => {
      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_1).toBe('not_met');
      expect(readiness.ps_3_9_2).toBe('not_met');
      expect(readiness.total).toBe(0);
      expect(readiness.cleared).toBe(0);
    });

    it('returns met for PS.L2-3.9.1 when all active are cleared', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'cleared';
      store.save(tenant, r1);

      const r2 = store.create(tenant, { displayName: 'B', email: 'b@e.com', role: 'R' });
      r2.screeningState = 'cleared';
      store.save(tenant, r2);

      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_1).toBe('met');
      expect(readiness.cleared).toBe(2);
      expect(readiness.total).toBe(2);
    });

    it('returns not_met for PS.L2-3.9.1 when any active is not cleared', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'cleared';
      store.save(tenant, r1);

      // Second record is still unscreened
      store.create(tenant, { displayName: 'B', email: 'b@e.com', role: 'R' });

      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_1).toBe('not_met');
    });

    it('excludes offboarded from active count', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'cleared';
      store.save(tenant, r1);

      const r2 = store.create(tenant, { displayName: 'B', email: 'b@e.com', role: 'R' });
      r2.screeningState = 'offboarded';
      store.save(tenant, r2);

      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_1).toBe('met'); // Only r1 is active, and it's cleared
      expect(readiness.total).toBe(1); // Only active
      expect(readiness.offboarded).toBe(1);
    });

    it('returns met for PS.L2-3.9.2 when offboarded record has lifecycle event', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'offboarded';
      r1.lifecycleEvents.push({
        timestamp: new Date().toISOString(),
        event: 'offboarded',
        actor: 'admin',
        details: 'Account deprovisioned',
      });
      store.save(tenant, r1);

      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_2).toBe('met');
    });

    it('returns not_met for PS.L2-3.9.2 when offboarded has no offboarded event', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'offboarded';
      // Only has the 'created' event, not 'offboarded'
      store.save(tenant, r1);

      const readiness = store.getReadiness(tenant);
      expect(readiness.ps_3_9_2).toBe('not_met');
    });

    it('counts expiring-soon in metrics', () => {
      const r1 = store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });
      r1.screeningState = 'expiring-soon';
      store.save(tenant, r1);

      const readiness = store.getReadiness(tenant);
      expect(readiness.expiringSoon).toBe(1);
    });

    it('counts unscreened and expired as unscreened', () => {
      store.create(tenant, { displayName: 'A', email: 'a@e.com', role: 'R' });

      const r2 = store.create(tenant, { displayName: 'B', email: 'b@e.com', role: 'R' });
      r2.screeningState = 'expired';
      store.save(tenant, r2);

      const readiness = store.getReadiness(tenant);
      expect(readiness.unscreened).toBe(2);
    });
  });
});

// ---------- Zod Schemas ----------

describe('Personnel Zod Schemas', () => {
  describe('ScreeningStateSchema', () => {
    it('accepts valid states', () => {
      const states = ['unscreened', 'in-progress', 'cleared', 'expiring-soon', 'expired', 'offboarded'];
      for (const s of states) {
        expect(ScreeningStateSchema.safeParse(s).success).toBe(true);
      }
    });

    it('rejects invalid state', () => {
      expect(ScreeningStateSchema.safeParse('active').success).toBe(false);
    });
  });

  describe('PersonnelCreateRequestSchema', () => {
    it('validates a valid create request', () => {
      const result = PersonnelCreateRequestSchema.safeParse({
        displayName: 'Alice Smith',
        email: 'alice@example.com',
        role: 'Engineer',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty displayName', () => {
      const result = PersonnelCreateRequestSchema.safeParse({
        displayName: '',
        email: 'alice@example.com',
        role: 'Engineer',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing email', () => {
      const result = PersonnelCreateRequestSchema.safeParse({
        displayName: 'Alice',
        role: 'Engineer',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional entraObjectId', () => {
      const result = PersonnelCreateRequestSchema.safeParse({
        displayName: 'Alice',
        email: 'alice@example.com',
        role: 'Engineer',
        entraObjectId: 'aad-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entraObjectId).toBe('aad-123');
      }
    });
  });

  describe('PersonnelUpdateRequestSchema', () => {
    it('validates partial update', () => {
      const result = PersonnelUpdateRequestSchema.safeParse({
        screeningState: 'cleared',
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty object (no updates)', () => {
      const result = PersonnelUpdateRequestSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects invalid screening state', () => {
      const result = PersonnelUpdateRequestSchema.safeParse({
        screeningState: 'invalid-state',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('LifecycleEventCreateSchema', () => {
    it('validates a valid event', () => {
      const result = LifecycleEventCreateSchema.safeParse({
        event: 'screening_started',
        actor: 'admin@example.com',
        details: 'Background check initiated',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty event', () => {
      const result = LifecycleEventCreateSchema.safeParse({
        event: '',
        actor: 'admin',
      });
      expect(result.success).toBe(false);
    });

    it('accepts without optional details', () => {
      const result = LifecycleEventCreateSchema.safeParse({
        event: 'cleared',
        actor: 'admin',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('PersonnelConfigSchema', () => {
    it('applies defaults for empty object', () => {
      const config = PersonnelConfigSchema.parse({});
      expect(config.reviewCycleYears).toBe(5);
      expect(config.docRetentionYears).toBe(6);
      expect(config.defaultScreeningVendor).toBe('checkr');
      expect(config.vendors).toHaveLength(3);
    });

    it('accepts custom values', () => {
      const config = PersonnelConfigSchema.parse({
        reviewCycleYears: 3,
        docRetentionYears: 10,
      });
      expect(config.reviewCycleYears).toBe(3);
      expect(config.docRetentionYears).toBe(10);
    });
  });
});
