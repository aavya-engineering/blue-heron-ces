// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Reach/tier probe signature — NEW-SCOPE, design §2.5.
 *
 * Grounded finding: no existing "is this tenant reachable / what tier" probe
 * was found in any of the four researched repos (Stamper, ces-eo, muster-api,
 * tenant-stacksim) under that name or an equivalent (design §2.5). "Do not
 * invent a reach/tier probe capability that isn't grounded" — this interface
 * is declared as NEW-SCOPE, not extracted from existing behavior, per the
 * design doc's explicit instruction to call this out to the founder rather
 * than present it as extraction.
 *
 * The two closest adjacent (but materially different) behaviors, for
 * reference only — neither is what this interface models:
 * - `StacksimMode.warnIfSimUnreachable()`
 *   (`ces-stamper/src/core/StacksimMode.ts:74-95`) — a best-effort
 *   sim-server-only health check (POST `${serverUrl}/ledger`), warns but does
 *   not fail. Sim-only, not a live-tenant probe.
 * - muster-api's harvest `PROBES` table
 *   (`ces-muster/muster-api/src/services/harvestService.ts:69-132`) — checks
 *   specific Graph capabilities on an ALREADY-authenticated tenant. Evidence
 *   collection, not a pre-connection reach/tier check.
 *
 * `probeSimReady` below adds a THIRD grounding, added 2026-07-10 per founder
 * direction naming ces-tester as a named M0 consumer: `ces-tester/PLAN.md`
 * M1 task 3 documents a real, currently-hand-rolled sim-tenant ready-check
 * (poll `/resolve` for a known-seeded object after a `scenario` CLI write,
 * before any HTTP read). That is closer to grounded-but-not-yet-extracted
 * than the fully-speculative live-tenant probe above — it is still marked
 * NEW-SCOPE for TenantManager because no TenantManager code implements it;
 * only ces-tester's own orchestrator code does today.
 */

import type { TenantKind } from './registry.js';

/**
 * NEW-SCOPE. Outcome of a pre-connection reachability/tier probe. No source
 * grounding — shape is a design placeholder only, to be refined when this
 * capability is actually built (design §2.5: "a natural home would be a thin
 * wrapper combining warnIfSimUnreachable's pattern for sim with a
 * lightweight Graph /organization call for live").
 */
export interface TenantReachResult {
  reachable: boolean;
  /** Which kind of check ran — mirrors the registry's `kind` discriminator (`registry.ts`). */
  kind: TenantKind;
  /** Round-trip latency of the probe call, if measured. */
  latencyMs?: number;
  /** Present when `reachable` is false. */
  error?: string;
}

/**
 * NEW-SCOPE. Reach/tier probe contract. Not extracted from any existing
 * function — see file header. Declared here only so the M0 interface
 * inventory names the capability design §2.5 asks the founder to scope
 * explicitly as new work, not a copy-and-wrap of existing logic (design §7).
 */
export interface TenantReachProbe {
  /**
   * NEW-SCOPE. Check whether a tenant is reachable before attempting a full
   * connect. No current equivalent exists for live tenants; the closest sim
   * analog is `warnIfSimUnreachable()` (see file header), which this
   * interface does not simply wrap — it is a placeholder signature only.
   */
  probeReach(tenantSlug: string): Promise<TenantReachResult>;

  /**
   * NEW-SCOPE. Sim-tenant ready-check — covers ces-tester as a NAMED
   * consumer (founder direction, 2026-07-10). Source: `ces-tester/PLAN.md`
   * M1 task 3, "Readiness/sequencing": after stacksim's `scenario` CLI call
   * returns (a direct-write path, "distinct from the server's HTTP handlers,
   * and pre-S1 bypasses the single-writer server entirely") and before any
   * `/resolve`/`/ledger` HTTP read against that same tenant, ces-tester
   * "performs an explicit ready-check: poll a cheap `/resolve` query for a
   * known-seeded object... until it returns non-empty or a bounded retry
   * budget (e.g. 10 attempts / 5s) is exhausted, treating exhaustion as a
   * hard failure, not a silent pass-through to the assertion step." This
   * exists, per that plan, "because the CLI write and the HTTP read are
   * different code paths that are not guaranteed synchronized today; it
   * simplifies (may become a no-op or collapse to a single health check)
   * once stacksim's S1 lands." `probeSimReady` is that behavior expressed as
   * a TenantManager-owned contract, so ces-tester's orchestrator consumes
   * the probe instead of hand-rolling its own polling loop, rather than
   * duplicating a fourth independent implementation of the pattern design
   * §1 already documents happening three times. Still NEW-SCOPE — no
   * TenantManager code implements this at M0; the polling logic itself
   * remains ces-tester's own hand-rolled loop until this is built.
   */
  probeSimReady(tenantSlug: string, options?: { maxAttempts?: number; timeoutMs?: number }): Promise<TenantReachResult>;
}
