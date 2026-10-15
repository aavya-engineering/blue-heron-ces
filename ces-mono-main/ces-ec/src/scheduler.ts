// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// M3 trigger: one pass at startup, then every EC_INDEX_INTERVAL_MIN (default 15), plus on
// demand (POST /api/index). Every tenant goes through the sim rail first; refusals are
// logged. A per-tenant in-flight guard prevents overlapping passes.

import * as fs from 'node:fs';

import { getStamperPlanDataRoot } from 'ces-shared/storage/node';

import { getIndexIntervalMin } from './config.js';
import { runIndexPass, type IndexPassOptions, type IndexPassResult } from './indexPass.js';
import { checkTenant, logRefusal, type TenantResolver } from './simRail.js';
import { listStoredTenants, tenantRoot } from './store.js';

export class IndexInFlightError extends Error {}

export type IndexOutcome =
  | { tenantSlug: string; outcome: 'indexed'; result: IndexPassResult }
  | { tenantSlug: string; outcome: 'refused'; reason: string }
  | { tenantSlug: string; outcome: 'busy' };

/** Candidate tenants for a scheduled pass: Stamper plan-data tenant dirs ∪ EC's own tenant dirs. */
export function discoverTenants(): string[] {
  const slugs = new Set<string>(listStoredTenants());
  const stamperRoot = getStamperPlanDataRoot();
  if (fs.existsSync(stamperRoot)) {
    for (const e of fs.readdirSync(stamperRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      try {
        tenantRoot(e.name);
        slugs.add(e.name);
      } catch {
        /* not a valid slug — skip */
      }
    }
  }
  return [...slugs].sort();
}

export class IndexService {
  private readonly inFlight = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly resolveTenant: TenantResolver,
    private readonly passOptions: IndexPassOptions = {},
  ) {}

  /** Rail-check then index one tenant. Throws BadTenantSlugError / IndexInFlightError. */
  async indexTenant(slug: string, operation = 'index'): Promise<IndexOutcome> {
    tenantRoot(slug);
    const decision = await checkTenant(slug, this.resolveTenant);
    if (!decision.allowed) {
      logRefusal({ at: new Date().toISOString(), tenantSlug: slug, operation, reason: decision.reason });
      return { tenantSlug: slug, outcome: 'refused', reason: decision.reason };
    }
    if (this.inFlight.has(slug)) throw new IndexInFlightError(`index pass already running for '${slug}'`);
    this.inFlight.add(slug);
    try {
      return { tenantSlug: slug, outcome: 'indexed', result: runIndexPass(slug, this.passOptions) };
    } finally {
      this.inFlight.delete(slug);
    }
  }

  /** Index every discovered tenant (scheduled path). Busy tenants are skipped, not failed. */
  async indexAll(operation = 'scheduled-index'): Promise<IndexOutcome[]> {
    const out: IndexOutcome[] = [];
    for (const slug of discoverTenants()) {
      try {
        out.push(await this.indexTenant(slug, operation));
      } catch (err) {
        if (err instanceof IndexInFlightError) out.push({ tenantSlug: slug, outcome: 'busy' });
        else console.error(`[ces-ec] scheduled index failed for '${slug}': ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** Startup pass now, then every `intervalMin` minutes. Timer is unref'd. */
  async start(intervalMin: number = getIndexIntervalMin()): Promise<IndexOutcome[]> {
    this.stop();
    const first = await this.indexAll('startup-index');
    this.timer = setInterval(() => {
      void this.indexAll('scheduled-index');
    }, intervalMin * 60 * 1000);
    this.timer.unref();
    return first;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isScheduled(): boolean {
    return this.timer !== undefined;
  }
}
