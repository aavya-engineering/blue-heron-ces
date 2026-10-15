// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC sim rail (plan M2 "Sim rail"): with CES_EC_SIM_ONLY on (the default), EC refuses
// every tenant that is not a registered `kind: 'sim'` tenant whose http(s) endpoints are
// all loopback. Every refusal is logged (stderr + an append-only refusals.jsonl under
// EC's own module root). Tenant identity comes from the ces-tenant registry API only.
//
// Decision order (first match wins; mirrors ces-ao's SimOnlyRail):
//  1. slug not registered / registry lookup throws        -> refused (always, fail closed)
//  2. kind 'sim'  -> admitted only if every http(s) endpoint is loopback
//  3. sim rail on (CES_EC_SIM_ONLY != '0')                -> any non-sim tenant refused
//  4. sim rail off + kind 'live'                          -> admitted (mode 'live')

import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileTenantRegistry, type FileTenantRegistryOptions, type TenantKind } from 'ces-tenant';
import { getEcModuleRoot } from 'ces-shared/storage/node';

import { isSimOnly } from './config.js';

const LOOPBACK_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

export interface TenantIdentity {
  kind: TenantKind;
  endpoints?: Record<string, string | undefined>;
}

/** Resolves a slug to its registry kind/endpoints; `undefined` = not registered. */
export type TenantResolver = (slug: string) => Promise<TenantIdentity | undefined>;

export function registryTenantResolver(options: FileTenantRegistryOptions = {}): TenantResolver {
  return async (slug: string) => {
    // A fresh registry per lookup so env overrides (CES_TENANT_ROOT etc.) apply at call time.
    const registry = new FileTenantRegistry(options);
    const record = await registry.get(slug);
    if (!record) return undefined;
    return { kind: record.kind, endpoints: { ...record.endpoints } };
  };
}

export type RailDecision =
  | { allowed: true; mode: 'sim' | 'live' }
  | { allowed: false; reason: string };

export async function checkTenant(
  slug: string,
  resolve: TenantResolver,
  env: Record<string, string | undefined> = process.env,
): Promise<RailDecision> {
  let identity: TenantIdentity | undefined;
  try {
    identity = await resolve(slug);
  } catch (err) {
    return { allowed: false, reason: `tenant registry lookup failed for '${slug}': ${(err as Error).message}` };
  }
  if (!identity) {
    return { allowed: false, reason: `tenant '${slug}' is not registered in the ces-tenant registry` };
  }
  if (identity.kind === 'sim') {
    for (const [key, url] of Object.entries(identity.endpoints ?? {})) {
      if (!url || typeof url !== 'string') continue;
      if (!/^https?:\/\//i.test(url)) continue;
      if (!LOOPBACK_PATTERN.test(url)) {
        return { allowed: false, reason: `sim tenant '${slug}' has non-loopback endpoint ${key}=${url}` };
      }
    }
    return { allowed: true, mode: 'sim' };
  }
  if (isSimOnly(env)) {
    return {
      allowed: false,
      reason: `CES_EC_SIM_ONLY is on (default): refusing non-sim tenant '${slug}' (kind: '${identity.kind}')`,
    };
  }
  if (identity.kind === 'live') return { allowed: true, mode: 'live' };
  return { allowed: false, reason: `tenant '${slug}' has unknown kind '${String(identity.kind)}'` };
}

export function refusalsLogPath(): string {
  return path.join(getEcModuleRoot(), 'refusals.jsonl');
}

export interface RefusalRecord {
  at: string;
  tenantSlug: string;
  operation: string;
  reason: string;
}

/** Log a refusal to stderr and append it to EC's refusals.jsonl. Never throws. */
export function logRefusal(rec: RefusalRecord): void {
  console.warn(`[ces-ec] REFUSED ${rec.operation} tenant='${rec.tenantSlug}': ${rec.reason}`);
  try {
    const file = refusalsLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[ces-ec] could not persist refusal record: ${(err as Error).message}`);
  }
}

export function readRefusals(): RefusalRecord[] {
  const file = refusalsLogPath();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RefusalRecord);
}
