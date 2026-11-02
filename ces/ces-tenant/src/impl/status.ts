// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * `TenantStatusSurface` + `TenantActivityRecorder` library-mode
 * implementation — RATIFIED AMENDMENT (founder, 2026-07-10), G-TENANT-1
 * addendum item 2.
 *
 * Own-process view ONLY, per the amendment's delivery-mode contract: this
 * in-process ledger sees exactly what the surfaces constructed in THIS
 * process record into it (`PersistentSessionFactory`,
 * `PlanDataTenantHttpKeyProvider`, `StacksimEnvironment` all accept an
 * `activity` option). M6's stateful service replaces it with the full
 * cross-process picture behind the SAME `TenantStatusSurface` interface —
 * consumers wire it once.
 *
 * Append-only: `recordActivity()` is the only mutation; there is no
 * update/delete/clear surface, and reads return snapshot copies.
 */

import type {
  TenantActivityEntry,
  TenantActivityFilter,
  TenantActivityInput,
  TenantActivityRecorder,
  TenantConnectionStatusEntry,
  TenantStatusSurface,
} from '../status-surface.js';
import type { SessionState } from '../session-surface.js';
import type { TenantKind } from '../registry.js';

/**
 * A per-engine-service session-state source for the status view — the
 * shape `PersistentSessionFactory.getAllSessionStates()` already satisfies.
 */
export interface SessionStateSource {
  getAllSessionStates(): SessionState[];
}

interface RegisteredSessionSource {
  tenantSlug?: string;
  kind?: TenantKind;
  source: SessionStateSource;
}

export class InProcessTenantStatus implements TenantStatusSurface, TenantActivityRecorder {
  private readonly entries: TenantActivityEntry[] = [];
  private readonly sessionSources: RegisteredSessionSource[] = [];

  /**
   * Append one activity entry, stamped with the current time. Append-only:
   * once recorded an entry is never modified or removed by this class.
   */
  recordActivity(entry: TenantActivityInput): void {
    this.entries.push({
      at: new Date(),
      consumer: entry.consumer === null ? null : { ...entry.consumer },
      operation: entry.operation,
      ...(entry.tenantSlug !== undefined ? { tenantSlug: entry.tenantSlug } : {}),
      ...(entry.sessionType !== undefined ? { sessionType: entry.sessionType } : {}),
      outcome: entry.outcome,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    });
  }

  /**
   * Register a session-state source (typically a `PersistentSessionFactory`,
   * which is constructed per tenant) so `getConnectionStatus()` can report
   * its per-engine-service states under the given tenant identity.
   */
  attachSessionSource(source: SessionStateSource, identity: { tenantSlug?: string; kind?: TenantKind } = {}): void {
    this.sessionSources.push({ tenantSlug: identity.tenantSlug, kind: identity.kind, source });
  }

  /** Own-process view: one row per attached session source (tenant), plus a slug-only row for activity against tenants with no attached source. */
  async getConnectionStatus(): Promise<TenantConnectionStatusEntry[]> {
    const rows: TenantConnectionStatusEntry[] = this.sessionSources.map((s) => ({
      ...(s.tenantSlug !== undefined ? { tenantSlug: s.tenantSlug } : {}),
      ...(s.kind !== undefined ? { kind: s.kind } : {}),
      sessions: s.source.getAllSessionStates().map((state) => ({ ...state })),
      lastActivityAt: this.lastActivityAt(s.tenantSlug),
    }));

    const coveredSlugs = new Set(this.sessionSources.map((s) => s.tenantSlug).filter((s) => s !== undefined));
    const activityOnlySlugs = new Set<string>();
    for (const e of this.entries) {
      if (e.tenantSlug !== undefined && !coveredSlugs.has(e.tenantSlug)) {
        activityOnlySlugs.add(e.tenantSlug);
      }
    }
    for (const slug of activityOnlySlugs) {
      rows.push({ tenantSlug: slug, sessions: [], lastActivityAt: this.lastActivityAt(slug) });
    }
    return rows;
  }

  /** Ledger read: oldest first, snapshot copies, optional exact-match filter. */
  async getActivity(filter?: TenantActivityFilter): Promise<TenantActivityEntry[]> {
    return this.entries
      .filter((e) => {
        if (filter?.module !== undefined && e.consumer?.module !== filter.module) return false;
        if (filter?.sessionType !== undefined && e.sessionType !== filter.sessionType) return false;
        if (filter?.tenantSlug !== undefined && e.tenantSlug !== filter.tenantSlug) return false;
        return true;
      })
      .map((e) => ({ ...e, consumer: e.consumer === null ? null : { ...e.consumer } }));
  }

  private lastActivityAt(tenantSlug: string | undefined): Date | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (tenantSlug === undefined || e.tenantSlug === tenantSlug) return e.at;
    }
    return null;
  }
}
