// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { loadProfile, resolveProfilePath } from '../../profiles/ProfileLoader.js';
import { SeedEngine, type SeedResult } from '../../seed/SeedEngine.js';
import { ObjectStore } from '../../store/ObjectStore.js';
import { Ledger } from '../../ledger/Ledger.js';
import { acquireTenantLock } from '../../store/TenantLock.js';
import type { TenantStance } from '../../gating/StackShapeGate.js';
import { parseFlags } from '../index.js';

export interface SeedArgs {
  stance: TenantStance;
  slug?: string;
  profilesDir?: string;
  tenantRoot?: string;
}

/** `stacksim seed <m365_only|m365_sentinel|m365_azure> [--slug s]` */
export async function runSeed(argv: string[]): Promise<SeedResult> {
  const [stance, ...rest] = argv;
  if (!stance) {
    throw new Error('stacksim seed: missing <profile> argument (m365_only|m365_sentinel|m365_azure)');
  }
  const flags = parseFlags(rest);
  return seedTenant({
    stance: stance as TenantStance,
    slug: typeof flags.slug === 'string' ? flags.slug : undefined,
  });
}

/**
 * backlog-S1 (closes the M1 deviation this comment used to record): Core
 * Design (f) requires an exclusive writer for store.json/ledger.jsonl.
 * `seed` still writes via ObjectStore/Ledger in-process, but only while
 * holding the tenant lock (TenantLock.ts) — the same lock `stacksim serve`
 * holds for its whole lifetime — so seeding a tenant that a live serve
 * process owns fails loudly (TenantLockedError) instead of interleaving
 * writes.
 */
export async function seedTenant(args: SeedArgs): Promise<SeedResult> {
  const profilesDir = args.profilesDir ?? path.join(process.cwd(), 'profiles');
  const profilePath = resolveProfilePath(args.stance, profilesDir);
  const profile = await loadProfile(profilePath);
  const slug = args.slug ?? profile.slug;

  const tenantRoot = args.tenantRoot ?? path.join(process.cwd(), '.stacksim', 'tenants', slug);
  const lock = await acquireTenantLock(tenantRoot, 'seed');
  try {
    const store = new ObjectStore(path.join(tenantRoot, 'store.json'));
    const ledger = new Ledger(path.join(tenantRoot, 'ledger.jsonl'));

    const engine = new SeedEngine(store, ledger);
    return await engine.seed(profile);
  } finally {
    await lock.release();
  }
}
