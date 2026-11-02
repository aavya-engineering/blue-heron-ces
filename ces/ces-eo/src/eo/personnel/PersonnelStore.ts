// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import type {
  PersonnelRecord,
  PersonnelConfig,
  PersonnelReadiness,
  PersonnelEvidenceArtifact,
  LifecycleEvent,
} from '../../shared/types/personnel.types.js';
import { PersonnelConfigSchema } from '../../shared/types/personnel.types.js';
import type { ScreeningElementStore } from './ScreeningElementStore.js';
import { getCesRepository } from 'ces-shared/persistence/node';
import {
  personnelFromRecords,
  readinessFromOrganisationRecords,
  type PersonnelRecordInput,
  type StoredOrganisationPersonnel,
} from './OrganisationPersonnel.js';

// G2: PersonnelRecords persist in the unified SQLite repository, tenant-isolated by tenantSlug,
// replacing {storageRoot}/personnel/{tenantSlug}/{id}.json (+ _config.json). See ADR-002.
const PERSONNEL_COLLECTION = 'eo_personnel';

/**
 * Stores and retrieves PersonnelRecords per tenant (unified repository, tenant-scoped).
 *
 * In-memory cache: Map<tenantSlug, PersonnelRecord[]>
 *   - Populated on first load() per tenant
 *   - Invalidated on save/delete
 */
export class PersonnelStore {
  private readonly storageRoot: string;
  private readonly cache: Map<string, PersonnelRecord[]> = new Map();

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Per-tenant record key for a personnel record id (collection PK is global). */
  private recordKey(tenantSlug: string, id: string): string {
    return `${tenantSlug}:${id}`;
  }

  /** Per-tenant key for the personnel config singleton. */
  private configKey(tenantSlug: string): string {
    return `${tenantSlug}:_config`;
  }

  /** W5 cycle 7: per-tenant key for the organisation's uploaded personnel records (screening, lifecycle). */
  private orgRecordsKey(tenantSlug: string): string {
    return `${tenantSlug}:_orgRecords`;
  }

  /**
   * Create a new personnel record with auto-generated ID and timestamps.
   */
  create(
    tenantSlug: string,
    data: { displayName: string; email: string; role: string; entraObjectId?: string },
  ): PersonnelRecord {
    const now = new Date().toISOString();
    const record: PersonnelRecord = {
      id: randomUUID(),
      displayName: data.displayName,
      email: data.email,
      entraObjectId: data.entraObjectId,
      role: data.role,
      screeningState: 'unscreened',
      createdDate: now,
      evidenceArtifacts: [],
      lifecycleEvents: [
        {
          timestamp: now,
          event: 'created',
          actor: 'system',
          details: `Record created for ${data.displayName}`,
        },
      ],
    };

    this.repo.put(PERSONNEL_COLLECTION, {
      id: this.recordKey(tenantSlug, record.id),
      ces: { tenantSlug },
      data: record,
    });
    this.cache.delete(tenantSlug);
    return record;
  }

  /**
   * Persist an updated personnel record.
   */
  save(tenantSlug: string, record: PersonnelRecord): void {
    this.repo.put(PERSONNEL_COLLECTION, {
      id: this.recordKey(tenantSlug, record.id),
      ces: { tenantSlug },
      data: record,
    });
    this.cache.delete(tenantSlug);
  }

  /**
   * Load all personnel records for a tenant.
   */
  load(tenantSlug: string): PersonnelRecord[] {
    const cached = this.cache.get(tenantSlug);
    if (cached) return cached;

    const configKey = this.configKey(tenantSlug);
    const orgKey = this.orgRecordsKey(tenantSlug);
    const records = this.repo
      .list<PersonnelRecord>(PERSONNEL_COLLECTION, { tenantSlug })
      .filter((r) => r.id !== configKey && r.id !== orgKey)
      .map((r) => r.data);

    this.cache.set(tenantSlug, records);
    return records;
  }

  /**
   * Get a single personnel record by ID.
   */
  get(tenantSlug: string, id: string): PersonnelRecord | null {
    const records = this.load(tenantSlug);
    return records.find(r => r.id === id) ?? null;
  }

  /**
   * Delete a personnel record (hard delete).
   */
  delete(tenantSlug: string, id: string): boolean {
    const removed = this.repo.delete(PERSONNEL_COLLECTION, this.recordKey(tenantSlug, id), { tenantSlug });
    if (!removed) return false;
    this.cache.delete(tenantSlug);
    return true;
  }

  /**
   * Add a lifecycle event to a personnel record.
   */
  addEvent(tenantSlug: string, id: string, event: Omit<LifecycleEvent, 'timestamp'>): PersonnelRecord | null {
    const record = this.get(tenantSlug, id);
    if (!record) return null;

    const lifecycleEvent: LifecycleEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    record.lifecycleEvents.push(lifecycleEvent);
    this.save(tenantSlug, record);
    return record;
  }

  /**
   * Load personnel config for a tenant.
   * Returns default config if none saved.
   */
  loadConfig(tenantSlug: string): PersonnelConfig {
    const rec = this.repo.get<unknown>(PERSONNEL_COLLECTION, this.configKey(tenantSlug), { tenantSlug });
    if (rec) {
      try {
        return PersonnelConfigSchema.parse(rec.data);
      } catch {
        // Fall through to defaults
      }
    }
    return PersonnelConfigSchema.parse({});
  }

  /**
   * Save personnel config for a tenant.
   */
  saveConfig(tenantSlug: string, config: PersonnelConfig): void {
    this.repo.put(PERSONNEL_COLLECTION, {
      id: this.configKey(tenantSlug),
      ces: { tenantSlug },
      data: config,
    });
  }

  /**
   * W5 cycle 7: keep the organisation's uploaded personnel records (the `personnel_screening` and
   * `personnel_lifecycle` kinds among `records`) as the readiness source for this tenant. With none of those
   * kinds the stored set is removed, so readiness falls back to the personnel records.
   */
  saveOrganisationRecords(tenantSlug: string, records: PersonnelRecordInput[]): StoredOrganisationPersonnel | undefined {
    const stored = personnelFromRecords(records, new Date().toISOString());
    if (stored) {
      this.repo.put(PERSONNEL_COLLECTION, { id: this.orgRecordsKey(tenantSlug), ces: { tenantSlug }, data: stored });
    } else {
      this.repo.delete(PERSONNEL_COLLECTION, this.orgRecordsKey(tenantSlug), { tenantSlug });
    }
    return stored;
  }

  /** The stored organisation personnel records, if any. */
  loadOrganisationRecords(tenantSlug: string): StoredOrganisationPersonnel | undefined {
    const rec = this.repo.get<StoredOrganisationPersonnel>(PERSONNEL_COLLECTION, this.orgRecordsKey(tenantSlug), { tenantSlug });
    return rec?.data ?? undefined;
  }

  /**
   * Calculate PS control readiness from personnel records.
   * W5 cycle 7: when the organisation's uploaded records are stored (saveOrganisationRecords), the screening
   * records decide PS.L2-3.9.1 and the lifecycle records decide PS.L2-3.9.2 (OrganisationPersonnel.ts); a kind
   * that was not uploaded keeps the rule below.
   *
   * PS.L2-3.9.1 (Screening): MET when all non-offboarded records are 'cleared'
   * PS.L2-3.9.2 (Termination): MET when at least one 'offboarded' record exists
   *   with documented lifecycle events
   */
  getReadiness(tenantSlug: string, screeningStore?: ScreeningElementStore): PersonnelReadiness {
    const records = this.load(tenantSlug);
    const active = records.filter(r => r.screeningState !== 'offboarded');
    const offboarded = records.filter(r => r.screeningState === 'offboarded');
    const cleared = active.filter(r => r.screeningState === 'cleared');
    const expiringSoon = active.filter(r => r.screeningState === 'expiring-soon');
    const unscreened = active.filter(r =>
      r.screeningState === 'unscreened' || r.screeningState === 'expired',
    );

    // PS.L2-3.9.1: All active personnel must be cleared
    const ps391Met = active.length > 0 && active.every(r => r.screeningState === 'cleared');

    // PS.L2-3.9.2: At least one offboarded record with procedural overlay artifact
    // or legacy lifecycle event (backward-compat for records offboarded before wizard)
    const ps392Met = offboarded.some(r =>
      r.evidenceArtifacts.some(a => a.type === 'offboarding-procedural-overlay') ||
      r.lifecycleEvents.some(e => e.event === 'offboarded'),
    );

    // Check screening evidence completion for all cleared personnel
    let screeningEvidenceComplete = false;
    if (screeningStore && cleared.length > 0) {
      screeningEvidenceComplete = cleared.every(r => {
        const readiness = screeningStore.getReadiness(tenantSlug, r.id);
        return readiness.packageComplete;
      });
    }

    const fromStore: PersonnelReadiness = {
      cleared: cleared.length,
      total: active.length,
      expiringSoon: expiringSoon.length,
      unscreened: unscreened.length,
      offboarded: offboarded.length,
      ps_3_9_1: ps391Met ? 'met' : 'not_met',
      ps_3_9_2: ps392Met ? 'met' : 'not_met',
      screening_evidence_complete: screeningEvidenceComplete,
    };

    const org = this.loadOrganisationRecords(tenantSlug);
    if (!org) return fromStore;
    const { readiness, rationale391, rationale392 } = readinessFromOrganisationRecords(org);
    return {
      ...fromStore,
      ...(rationale391 !== undefined ? {
        cleared: readiness.cleared, total: readiness.total, expiringSoon: 0, unscreened: readiness.unscreened,
        ps_3_9_1: readiness.ps_3_9_1, ps_3_9_1_basis: rationale391,
      } : {}),
      ...(rationale392 !== undefined ? { offboarded: readiness.offboarded, ps_3_9_2: readiness.ps_3_9_2, ps_3_9_2_basis: rationale392 } : {}),
    };
  }

  /**
   * Add an evidence artifact to a personnel record.
   */
  addArtifact(tenantSlug: string, personnelId: string, artifact: PersonnelEvidenceArtifact): PersonnelRecord | null {
    const record = this.get(tenantSlug, personnelId);
    if (!record) return null;
    record.evidenceArtifacts.push(artifact);
    this.save(tenantSlug, record);
    return record;
  }

  /**
   * Remove an evidence artifact from a personnel record.
   */
  removeArtifact(tenantSlug: string, personnelId: string, artifactId: string): PersonnelRecord | null {
    const record = this.get(tenantSlug, personnelId);
    if (!record) return null;
    record.evidenceArtifacts = record.evidenceArtifacts.filter(a => a.id !== artifactId);
    this.save(tenantSlug, record);
    return record;
  }

  /**
   * Get all evidence artifacts for a personnel record.
   */
  getArtifacts(tenantSlug: string, personnelId: string): PersonnelEvidenceArtifact[] {
    const record = this.get(tenantSlug, personnelId);
    if (!record) return [];
    return record.evidenceArtifacts;
  }
}
