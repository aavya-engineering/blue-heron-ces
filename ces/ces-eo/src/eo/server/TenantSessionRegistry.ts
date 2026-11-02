// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX2-EO1 (P0, cross-tenant) — tenant-bound Graph sessions.
 *
 * EO used to hold ONE server-global `SessionManager`: whichever tenant `/api/connect` opened
 * last served every live-signal read, so `/api/assess?tenant=B` and
 * `/api/evidence-explorer/capture` for B merged tenant A's live signals into B's results.
 *
 * This registry keys sessions by the tenant slug they were opened for (the same requested,
 * validated slug every tenant-scoped route resolves via `resolveTenantScope`). A read for
 * tenant X gets X's session or `null` — never another tenant's. `get()` additionally checks
 * the session's own bound slug / tenant GUID (recorded on the `SessionManager` at
 * construction), so a mis-registered or stale session is refused rather than borrowed.
 */
import type { SessionManager } from '../core/SessionManager.js';

/** Wire value reported when a tenant has no live session of its own. */
export type LiveSignalsState = 'connected' | 'not_connected';

export class TenantSessionRegistry {
  private readonly sessions = new Map<string, SessionManager>();

  /**
   * Register `sm` as the session for `slug`. Refuses a session bound to a different tenant.
   * Returns the session it replaced (if any) so the caller can disconnect it.
   */
  set(slug: string, sm: SessionManager): SessionManager | null {
    if (sm.boundTenantSlug !== undefined && sm.boundTenantSlug !== slug) {
      throw new Error(`Session is bound to tenant '${sm.boundTenantSlug}', not '${slug}'`);
    }
    const previous = this.sessions.get(slug) ?? null;
    this.sessions.set(slug, sm);
    return previous === sm ? null : previous;
  }

  /**
   * The session opened for `slug`, or `null`. When `expectedTenantId` is given (the tenant GUID
   * the caller resolved from the tenant's config), a session bound to a different GUID is refused.
   */
  get(slug: string | undefined | null, expectedTenantId?: string): SessionManager | null {
    if (!slug) return null;
    const sm = this.sessions.get(slug);
    if (!sm) return null;
    if (sm.boundTenantSlug !== undefined && sm.boundTenantSlug !== slug) return null;
    if (expectedTenantId !== undefined && sm.boundTenantId !== undefined && sm.boundTenantId !== expectedTenantId) {
      return null;
    }
    return sm;
  }

  /** `connected` iff `slug` has its own session. */
  state(slug: string | undefined | null, expectedTenantId?: string): LiveSignalsState {
    return this.get(slug, expectedTenantId) ? 'connected' : 'not_connected';
  }

  slugs(): string[] {
    return [...this.sessions.keys()];
  }

  /** Disconnect and forget every session (shutdown / tests). */
  async disconnectAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(all.map(sm => sm.disconnectAll()));
  }
}
