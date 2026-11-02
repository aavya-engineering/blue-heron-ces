// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Auth-state store -- the v1 heart of the M6 daemon (founder resolution
 * 2026-07-11: auth-state-only). Holds what modules register (strategy kind,
 * expiry, optional bearer material) per tenant x engine service, and hands
 * it back to claiming modules so the sign-in ceremony happens once per
 * engagement (goal: "one sign-in ... shared by Muster, Stamper, EO, AO, and
 * ces-tester").
 *
 * Redaction contract: `list()` returns summaries with `holdsToken: boolean`
 * only. Raw material leaves this store solely through `claim()`, which the
 * server exposes as `POST /api/auth/claim` (localhost, per-OS-user).
 */

import type { ConsumerIdentity } from '../consumer.js';
import type { SessionType } from '../connection.js';
import type { AuthStateClaim, AuthStateRegistration, AuthStateSummary } from './protocol.js';

interface StoredAuthState {
  registration: AuthStateRegistration;
  registeredBy: ConsumerIdentity;
  registeredAt: Date;
  claimCount: number;
}

export class AuthStateStore {
  private readonly states: StoredAuthState[] = [];

  /**
   * Register auth state for a tenant (optionally scoped to one engine
   * service). A newer registration for the same (tenantSlug, sessionType)
   * scope replaces the older one -- state is current-by-definition, not a
   * ledger (the append-only ledger is the ACTIVITY surface, not this store).
   */
  register(registration: AuthStateRegistration, registeredBy: ConsumerIdentity): AuthStateSummary {
    const idx = this.states.findIndex(
      (s) =>
        s.registration.tenantSlug === registration.tenantSlug &&
        s.registration.sessionType === registration.sessionType,
    );
    const stored: StoredAuthState = {
      registration: { ...registration },
      registeredBy: { ...registeredBy },
      registeredAt: new Date(),
      claimCount: 0,
    };
    if (idx >= 0) this.states.splice(idx, 1);
    this.states.push(stored);
    return this.summarize(stored);
  }

  /**
   * Claim auth state for a tenant. Matching (auto-connect semantics, goal
   * requirement 2): an exact sessionType-scoped entry wins; otherwise a
   * tenant-wide entry (no sessionType) matches any requested service.
   * Expired entries never match. Returns undefined when the daemon has
   * nothing -- the caller then establishes its own connection (degrade,
   * never block).
   */
  claim(tenantSlug: string, sessionType: SessionType | undefined, claimedBy: ConsumerIdentity): AuthStateClaim | undefined {
    const now = Date.now();
    const live = this.states.filter((s) => {
      if (s.registration.tenantSlug !== tenantSlug) return false;
      if (s.registration.expiresAt && Date.parse(s.registration.expiresAt) <= now) return false;
      if (sessionType === undefined) return true;
      return s.registration.sessionType === undefined || s.registration.sessionType === sessionType;
    });
    if (live.length === 0) return undefined;

    // Prefer the exact service scope over tenant-wide; newest within a scope.
    const exact = live.filter((s) => s.registration.sessionType === sessionType);
    const pick = (exact.length > 0 ? exact : live)[exact.length > 0 ? exact.length - 1 : live.length - 1];
    pick.claimCount++;
    void claimedBy; // attribution is recorded in the activity ledger by the server, not here

    const r = pick.registration;
    return {
      tenantSlug: r.tenantSlug,
      strategyKind: r.strategyKind,
      ...(r.sessionType !== undefined ? { sessionType: r.sessionType } : {}),
      ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt } : {}),
      ...(r.bearerToken !== undefined ? { bearerToken: r.bearerToken } : {}),
      registeredBy: { ...pick.registeredBy },
      registeredAt: pick.registeredAt.toISOString(),
    };
  }

  /** Redacted summaries (status surface) -- never includes token material. */
  list(tenantSlug?: string): AuthStateSummary[] {
    return this.states
      .filter((s) => tenantSlug === undefined || s.registration.tenantSlug === tenantSlug)
      .map((s) => this.summarize(s));
  }

  /** Slugs that currently hold any auth state (for the status matrix). */
  tenantSlugs(): string[] {
    return [...new Set(this.states.map((s) => s.registration.tenantSlug))];
  }

  private summarize(s: StoredAuthState): AuthStateSummary {
    const r = s.registration;
    return {
      tenantSlug: r.tenantSlug,
      strategyKind: r.strategyKind,
      ...(r.sessionType !== undefined ? { sessionType: r.sessionType } : {}),
      ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt } : {}),
      registeredBy: { ...s.registeredBy },
      registeredAt: s.registeredAt.toISOString(),
      claimCount: s.claimCount,
      holdsToken: r.bearerToken !== undefined,
    };
  }
}
