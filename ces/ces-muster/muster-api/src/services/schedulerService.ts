// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// schedulerService.ts — G-MUSTER-PL-1 H3, widened by FIN-25. A real wall-clock
// scheduler that fires nudge + reassessment ticks on an interval through the
// existing withTenant pipeline, so the annuity engine is self-driving instead
// of only firing when a POST route (or `mu ... --now`) is invoked.
//
// FIN-25: the scheduler serves EVERY tenant. The old boundary (X11: one
// configured operator tenant, because a cross-tenant tick needed a
// service-account design) is closed by the ces.db store: the tenant list is a
// global control collection (lib/musterStore.ts `tenantIds()`), and each
// tenant is then ticked inside ITS OWN required tenant scope — one tenant's
// rows are never read under another's. A failing tenant is reported through
// onError and does not stop the others. Passing `tenantId` still pins the
// scheduler to that single tenant. Cadence values remain [validate with BHD].
//
// The simulated-clock path is unchanged: the POST /api/nudges/tick and
// /api/reassessment/tick routes still accept an explicit `now`, and this
// scheduler reuses the SAME service factories (createNudgeService /
// createReassessmentService) through the SAME withTenant wrapper the routes use
// — no engine is reimplemented here. Nudges and reminders land in the
// simulated mail outbox (FD-6); nothing is sent.

import { db as sharedDb, withTenant } from '../lib/db.js';
import { createNudgeService } from './nudgeService.js';
import { createReassessmentService } from './reassessmentService.js';

export interface SchedulerOptions {
  /** Pin to one tenant. Omitted: every tenant on record (FIN-25). */
  tenantId?: string;
  /** Wall-clock interval between ticks, in milliseconds. */
  intervalMs: number;
  /** Store passed to withTenant; defaults to the shared ces.db store. */
  db?: unknown;
  /** Tenant list when tenantId is omitted. Default: the store's tenants. */
  listTenants?: () => Promise<string[]>;
  /** Clock — defaults to the real wall clock. Injected in tests. */
  nowFn?: () => Date;
  /** Invoked if a tick throws; a scheduled tick must never crash the process. */
  onError?: (err: unknown) => void;
}

/** Every tenant id the store knows (the root tenant collection). */
async function storeTenantIds(client: unknown): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  if (c && typeof c.tenantIds === 'function') return c.tenantIds();
  if (c?.tenant?.findMany) {
    const rows: Array<{ id: string }> = await c.tenant.findMany();
    return rows.map((r) => r.id);
  }
  return [];
}

export interface Scheduler {
  /** Run exactly one tick now: nudges then reassessment, per tenant, tenant-scoped. */
  runOnce(): Promise<void>;
  /** Begin firing ticks every intervalMs (idempotent). */
  start(): void;
  /** Stop firing ticks (idempotent). */
  stop(): void;
  /** True while the interval is armed. */
  readonly running: boolean;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const nowFn = opts.nowFn ?? (() => new Date());
  const onError =
    opts.onError ?? ((err: unknown) => console.error('[scheduler] tick failed:', err));
  let timer: ReturnType<typeof setInterval> | undefined;

  const client = opts.db ?? sharedDb;

  async function tickTenant(tenantId: string, now: Date): Promise<void> {
    // Exactly the call shape the POST routes use — tenant-scoped via withTenant,
    // engagementId null (whole tenant), explicit wall-clock `now`.
    await withTenant(tenantId, (tx) => createNudgeService(tx).evaluate(null, now), client);
    await withTenant(tenantId, (tx) => createReassessmentService(tx).tick(null, now), client);
  }

  async function runOnce(): Promise<void> {
    const now = nowFn();
    if (opts.tenantId) {
      await tickTenant(opts.tenantId, now);
      return;
    }
    const tenants = opts.listTenants ? await opts.listTenants() : await storeTenantIds(client);
    for (const tenantId of tenants) {
      try {
        await tickTenant(tenantId, now);
      } catch (err) {
        onError(err);
      }
    }
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void runOnce().catch(onError);
      }, opts.intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    get running() {
      return timer !== undefined;
    },
  };
}
