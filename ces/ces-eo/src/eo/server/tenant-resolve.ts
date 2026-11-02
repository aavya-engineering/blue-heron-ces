// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRegistryRoot, registryRecordPath } from 'ces-tenant';

/**
 * Resolve a tenant's config JSON, registry-first (G-EO-STAB-1 M3).
 *
 * Extracted from eo-router-utils into its own light module (imports only
 * fs/path/ces-tenant) so it is unit-testable without dragging the util barrel's
 * heavy SspGenerator/evidence-blob chain.
 *
 * Resolution order:
 *   1. The ces-tenant REGISTRY (sim then live), `<registryRoot>/<kind>/<slug>.json`
 *      via ces-tenant's own `getRegistryRoot()`/`registryRecordPath()` — so EO and
 *      the registry can never drift, and `CES_TENANT_ROOT` (the override ces-tester
 *      sets for ephemeral sim tenants) is honored. This is the fix for "ephemeral
 *      sim tenants created via the ces-tenant registry are INVISIBLE to /api/assess."
 *   2. Stamper `plan-data/<slug>/<slug>.json` (the current human-authored convention).
 *
 * The deprecated `~/.stamper/tenants/` reader is REMOVED (last deprecated-path reader).
 * `_homeDir` is retained in the signature for its six callers but no longer used for a
 * legacy path; the registry root derives from getRegistryRoot() exactly as ces-tenant
 * defines it (env `CES_TENANT_ROOT` or `~/.ces/tenants`).
 */
export function resolveTenantJsonPath(slug: string, stamperPath: string, _homeDir: string): string | null {
  const registryRoot = getRegistryRoot();
  for (const kind of ['sim', 'live'] as const) {
    const registryPath = registryRecordPath(registryRoot, kind, slug);
    if (fs.existsSync(registryPath)) return registryPath;
  }

  const planDataPath = path.join(stamperPath, 'plan-data', slug, `${slug}.json`);
  if (fs.existsSync(planDataPath)) return planDataPath;

  return null;
}

/** Result of resolving a request's `?tenant=` slug to its tenant GUID (FX-EO1). */
export type TenantScope =
  | { ok: true; slug: string; tenantId: string; tenantJsonPath: string }
  | { ok: false; status: 400 | 404; message: string };

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * FX-EO1: resolve the REQUESTED tenant — never the server's default — to its tenant GUID,
 * the same way `/api/assess` does (resolveTenantJsonPath → `tenant.tenant_id`).
 *
 * Every tenant-scoped read (Explorer index/item, AdminOps executions, evidence package,
 * SSP/POA&M) must call this with the request's own slug. There is deliberately NO fallback
 * to `config.tenantSlug`: a missing tenant is a 400 and an unknown tenant a 404, so a read
 * can never silently widen to another tenant's (or "all") rows.
 */
export function resolveTenantScope(rawSlug: unknown, stamperPath: string): TenantScope {
  if (typeof rawSlug !== 'string' || rawSlug.trim() === '') {
    return { ok: false, status: 400, message: 'tenant required' };
  }
  const slug = rawSlug.trim();
  if (!SLUG_RE.test(slug)) {
    return { ok: false, status: 400, message: 'invalid tenant slug' };
  }
  const tenantJsonPath = resolveTenantJsonPath(slug, stamperPath, '');
  if (!tenantJsonPath) {
    return { ok: false, status: 404, message: `Tenant config not found: ${slug}` };
  }
  let raw: { tenant?: { tenant_id?: unknown } };
  try {
    raw = JSON.parse(fs.readFileSync(tenantJsonPath, 'utf-8'));
  } catch {
    return { ok: false, status: 400, message: 'Invalid tenant config format' };
  }
  const tenantId = raw?.tenant?.tenant_id;
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { ok: false, status: 400, message: `Tenant config has no tenant.tenant_id: ${slug}` };
  }
  return { ok: true, slug, tenantId, tenantJsonPath };
}
