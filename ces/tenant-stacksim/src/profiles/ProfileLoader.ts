// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { KNOWN_OBJECT_TYPES } from '../store/schemas.js';
import { SEED_SET_NAMES } from '../seed/sets/gccHighG5.js';
import { AZURE_TIER_BY_OBJECT_TYPE, STANCE_TO_TIER, type TenantStance } from '../gating/StackShapeGate.js';

export interface Profile {
  tenantStance: TenantStance;
  slug: string;
  counts: Record<string, number>;
  /** SIMFIX FIX-S2: named seed sets applied after the counts (src/seed/sets/). */
  seedSets?: string[];
}

const VALID_STANCES: readonly TenantStance[] = ['m365_only', 'm365_sentinel', 'm365_azure'];

const TIER_RANK: Record<'none' | 'sentinel' | 'full', number> = { none: 0, sentinel: 1, full: 2 };

const PROFILE_FILENAMES: Record<TenantStance, string> = {
  m365_only: 'm365-only.json',
  m365_sentinel: 'm365-sentinel.json',
  m365_azure: 'm365-azure.json',
};

/** Resolves a profile manifest's path within a given profiles directory. */
export function resolveProfilePath(stance: TenantStance, profilesDir: string): string {
  return path.join(profilesDir, PROFILE_FILENAMES[stance]);
}

/**
 * Validates a parsed profile manifest against TenantStance and, per Core
 * Design (e) layer 1 (seed-data absence), rejects any declared object-type
 * count whose azureTier exceeds the manifest's own tenantStance tier.
 */
export function validateProfile(parsed: Partial<Profile>): Profile {
  if (!parsed.tenantStance || !VALID_STANCES.includes(parsed.tenantStance)) {
    throw new Error(`ProfileLoader: invalid or missing tenantStance "${String(parsed.tenantStance)}"`);
  }
  if (!parsed.slug || typeof parsed.slug !== 'string') {
    throw new Error('ProfileLoader: missing or invalid slug');
  }
  if (!parsed.counts || typeof parsed.counts !== 'object') {
    throw new Error('ProfileLoader: missing or invalid counts');
  }

  const profileTier = STANCE_TO_TIER[parsed.tenantStance];

  for (const [objectType, count] of Object.entries(parsed.counts)) {
    if (!KNOWN_OBJECT_TYPES.includes(objectType)) {
      throw new Error(`ProfileLoader: unknown object type "${objectType}" in manifest`);
    }
    if (typeof count !== 'number' || count < 0) {
      throw new Error(`ProfileLoader: invalid count for "${objectType}" (must be a non-negative number)`);
    }
    const requiredTier = AZURE_TIER_BY_OBJECT_TYPE[objectType] ?? 'none';
    if (count > 0 && TIER_RANK[profileTier] < TIER_RANK[requiredTier]) {
      throw new Error(
        `ProfileLoader: manifest for "${parsed.tenantStance}" declares "${objectType}" (azureTier "${requiredTier}") which exceeds the profile's tier "${profileTier}"`,
      );
    }
  }

  if (parsed.seedSets !== undefined) {
    if (!Array.isArray(parsed.seedSets)) throw new Error('ProfileLoader: seedSets must be an array');
    for (const n of parsed.seedSets) {
      if (!(SEED_SET_NAMES as readonly string[]).includes(n)) throw new Error(`ProfileLoader: unknown seed set "${n}"`);
    }
    if (parsed.seedSets.length > 0 && parsed.tenantStance !== 'm365_azure') {
      throw new Error(`ProfileLoader: seed set(s) ${parsed.seedSets.join(', ')} carry Azure objects and need tenantStance m365_azure`);
    }
  }

  return {
    tenantStance: parsed.tenantStance,
    slug: parsed.slug,
    counts: parsed.counts as Record<string, number>,
    ...(parsed.seedSets && parsed.seedSets.length ? { seedSets: [...parsed.seedSets] } : {}),
  };
}

export async function loadProfile(filePath: string): Promise<Profile> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Profile>;
  return validateProfile(parsed);
}
