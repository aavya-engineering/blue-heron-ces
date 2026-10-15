// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import { getCesRepository } from 'ces-shared/persistence/node';

// G2: AssessmentSnapshots persist in the unified SQLite repository, tenant-isolated by the
// snapshot's tenantId, replacing eo-storage/assessments/*.json (+ latest.json). See ADR-002.
// "latest" is no longer a duplicate record — it's a query over the collection ordered by
// generatedAt. The store is single-tenant per storageRoot, so the tenant scope for the
// read APIs (which carry no tenantId) is resolved from a small per-storageRoot pointer record.
const ASSESSMENTS_COLLECTION = 'eo_assessments';

interface ScopePointer {
  tenantId: string;
}

/**
 * Persists AssessmentSnapshots to the unified repository, tenant-scoped by snapshot.tenantId.
 */
export class AssessmentStore {
  private readonly storageRoot: string;
  /** Cached tenantId for this storageRoot's reads; learned on save or from the pointer record. */
  private tenantId: string | undefined;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
  }

  private get repo() {
    return getCesRepository();
  }

  /** Stable, unguessable-not-required pointer id binding this storageRoot to its tenantId. */
  private scopePointerId(): string {
    return `${ASSESSMENTS_COLLECTION}:scope:${this.storageRoot}`;
  }

  /** Resolve this store's tenant scope, or undefined if nothing has been saved yet. */
  private resolveTenantId(): string | undefined {
    if (this.tenantId !== undefined) return this.tenantId;
    const ptr = this.repo.findById<ScopePointer>(ASSESSMENTS_COLLECTION, this.scopePointerId());
    if (ptr) this.tenantId = ptr.data.tenantId;
    return this.tenantId;
  }

  save(snapshot: AssessmentSnapshot): string {
    this.repo.put(ASSESSMENTS_COLLECTION, {
      id: snapshot.snapshotId,
      ces: { tenantId: snapshot.tenantId },
      data: snapshot,
    });
    // Remember (and persist) the tenant for this storageRoot so later reads can scope.
    this.tenantId = snapshot.tenantId;
    this.repo.put(ASSESSMENTS_COLLECTION, {
      id: this.scopePointerId(),
      ces: { tenantId: snapshot.tenantId },
      data: { tenantId: snapshot.tenantId } satisfies ScopePointer,
    });
    // Return a stable locator (was the on-disk path) for parity with callers that log it.
    return `${ASSESSMENTS_COLLECTION}/${snapshot.snapshotId}`;
  }

  loadLatest(): AssessmentSnapshot | null {
    const tenantId = this.resolveTenantId();
    if (tenantId === undefined) return null;
    const records = this.repo
      .list<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, { tenantId })
      .filter((r) => r.id !== this.scopePointerId());
    if (records.length === 0) return null;
    return records
      .map((r) => r.data)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }

  /**
   * FX-EO1: latest snapshot for an EXPLICIT tenant (the request's resolved GUID), independent
   * of this storageRoot's scope pointer — so a request for tenant B never gets tenant A's
   * assessment just because A was the last tenant saved here.
   */
  loadLatestForTenant(tenantId: string): AssessmentSnapshot | null {
    const records = this.repo
      .list<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, { tenantId })
      .filter((r) => !r.id.startsWith(`${ASSESSMENTS_COLLECTION}:scope:`))
      .map((r) => r.data)
      .filter((d) => d && typeof d.generatedAt === 'string' && Array.isArray(d.controls));
    if (records.length === 0) return null;
    return records.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }

  /**
   * FX-EO8: SPRS history for an EXPLICIT tenant (the request's resolved GUID), independent of
   * this storageRoot's scope pointer (which only remembers the last tenant saved here).
   */
  listSnapshotsForTenant(tenantId: string): { snapshotId: string; generatedAt: string; sprs_score: number }[] {
    return this.repo
      .list<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, { tenantId })
      .filter((r) => !r.id.startsWith(`${ASSESSMENTS_COLLECTION}:scope:`))
      .map((r) => r.data)
      .filter((d) => d && typeof d.generatedAt === 'string' && Array.isArray(d.controls))
      .map((d) => ({ snapshotId: d.snapshotId, generatedAt: d.generatedAt, sprs_score: d.sprs_score }))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  /** FX-EO6: a snapshot by id, only if it belongs to the given tenant (request-scoped). */
  loadForTenant(tenantId: string, snapshotId: string): AssessmentSnapshot | null {
    const rec = this.repo.get<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, snapshotId, { tenantId });
    return rec && rec.data?.tenantId === tenantId ? rec.data : null;
  }

  load(snapshotId: string): AssessmentSnapshot | null {
    const tenantId = this.resolveTenantId();
    if (tenantId === undefined) return null;
    const rec = this.repo.get<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, snapshotId, { tenantId });
    return rec ? rec.data : null;
  }

  listSnapshots(): { snapshotId: string; generatedAt: string; sprs_score: number }[] {
    const tenantId = this.resolveTenantId();
    if (tenantId === undefined) return [];
    return this.repo
      .list<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, { tenantId })
      .filter((r) => r.id !== this.scopePointerId())
      .map((r) => ({
        snapshotId: r.data.snapshotId,
        generatedAt: r.data.generatedAt,
        sprs_score: r.data.sprs_score,
      }))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }
}
