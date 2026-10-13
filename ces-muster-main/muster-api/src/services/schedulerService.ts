// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// schedulerService.ts — G-MUSTER-PL-1 H3. A real wall-clock scheduler that fires
// nudge + reassessment ticks on an interval for ONE configured operator tenant,
// through the existing withTenant pipeline. This makes the annuity engine
// self-driving instead of only firing when a POST route (or `mu ... --now`) is
// invoked.
//
// BOUNDARY (X11 / BHD checklist row 21 — deliberately held): this is
// operator-tenant-scoped. It ticks exactly the single tenant it is configured
// with; it does NOT iterate all tenants. A cross-tenant GLOBAL tick needs a
// service-account design and stays out of scope. Cadence values remain
// [validate with BHD].
//
// The simulated-clock path is unchanged: the POST /api/nudges/tick and
// /api/reassessment/tick routes still accept an explicit `now`, and this
// scheduler reuses the SAME service factories (createNudgeService /
// createReassessmentService) through the SAME withTenant wrapper the routes use
// — no engine is reimplemented here.

import { withTenant } from '../lib/prisma.js';
import { createNudgeService } from './nudgeService.js';
import { createReassessmentService } from './reassessmentService.js';

export interface SchedulerOptions {
  /** The single operator tenant this scheduler ticks (NOT all tenants). */
  tenantId: string;
  /** Wall-clock interval between ticks, in milliseconds. */
  intervalMs: number;
  /** Prisma client passed to withTenant; defaults to the global db. */
  db?: unknown;
  /** Clock — defaults to the real wall clock. Injected in tests. */
  nowFn?: () => Date;
  /** Invoked if a tick throws; a scheduled tick must never crash the process. */
  onError?: (err: unknown) => void;
}

export interface Scheduler {
  /** Run exactly one tick now: nudges then reassessment, tenant-scoped. */
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

  async function runOnce(): Promise<void> {
    const now = nowFn();
    // Exactly the call shape the POST routes use — tenant-scoped via withTenant,
    // engagementId null (whole tenant), explicit wall-clock `now`.
    await withTenant(
      opts.tenantId,
      (tx) => createNudgeService(tx).evaluate(null, now),
      opts.db
    );
    await withTenant(
      opts.tenantId,
      (tx) => createReassessmentService(tx).tick(null, now),
      opts.db
    );
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
