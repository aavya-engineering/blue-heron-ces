// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M3 — author the `kind:'sim'` registry record the GUI legs need.
 *
 * Why a patch on top of the registry's own record, rather than a hand-written
 * file: `ces-tenant`'s `FileTenantRegistry.createEphemeralSimTenant` owns the
 * record shape (deterministic `sim-tenant-<slug>` / `sim-app-<slug>` ids, the
 * sim endpoint block, the live-record collision guard). ces-tester never
 * hand-writes tenant JSON — G-TENANT-ADOPT gate item 5. But the registry's own
 * placeholders cannot pass Stamper's Connect gate:
 *
 *   - `auth.cert_thumbprint` is the literal `SIMTHUMBPRINT000…`, and Connect
 *     runs `Get-ChildItem Cert:\CurrentUser\My\<thumbprint>`
 *     (`PrerequisiteChecker.ts:156-172`), which can never match it;
 *   - `auth.cert_path` is the RELATIVE `sim/<slug>.pfx`, resolved against the
 *     GUI server's own cwd (a sibling repo root — finding #5), where ces-tester
 *     is forbidden to write.
 *
 * So exactly two fields are patched: the real thumbprint of the generated sim
 * cert and an ABSOLUTE `cert_path`. Absolute is the deliberate choice (M0
 * deviation 2): it satisfies `AuthChain`'s exists-check from any cwd, so the
 * same record works for a server spawned from ces-stamper and one spawned from
 * ces-ao. Tenant JSON OVERRIDES env (`StamperConfig.ts:249-252`), so the
 * synthetic-`.env` trick ces-tester uses for the CLI leg does not transfer to
 * the GUI legs — this record is the only channel.
 *
 * The other two of "all four auth fields" (`tenant.tenant_id`, `auth.app_id`)
 * already come from the registry and are asserted, never rewritten.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TenantRegistryLifecycle } from 'ces-tenant';
import { createEphemeralSimTenant } from '../tenant-registry/index.js';

/** `<registryRoot>/sim/<slug>.json` — the registry's own layout. */
export function simRecordPath(registryRoot: string, slug: string): string {
  return path.join(registryRoot, 'sim', `${slug}.json`);
}

export interface SimTenantAuthPatch {
  /** Thumbprint of a cert genuinely present in `Cert:\CurrentUser\My`. */
  readonly certThumbprint: string;
  /** ABSOLUTE path to the `.pfx` — never the registry's relative placeholder. */
  readonly certPath: string;
}

/** The four auth fields `StamperConfig` requires, as read back from the record. */
export interface SimTenantAuthFields {
  readonly tenantId?: string;
  readonly appId?: string;
  readonly certThumbprint?: string;
  readonly certPath?: string;
}

/**
 * Apply the two-field patch to a parsed record object. Pure — returns a new
 * object, never mutates the input. Throws if the patched `cert_path` is not
 * absolute, because a relative one silently resolves against whichever GUI
 * server's cwd happens to read it and then fails closed at execute time.
 */
export function applySimTenantAuthPatch(raw: unknown, patch: SimTenantAuthPatch): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('sim tenant record is not a JSON object');
  }
  if (!path.isAbsolute(patch.certPath)) {
    throw new Error(`sim tenant cert_path must be absolute (got "${patch.certPath}")`);
  }
  const record = raw as Record<string, unknown>;
  const auth = { ...((record.auth as Record<string, unknown> | undefined) ?? {}) };
  auth.cert_thumbprint = patch.certThumbprint;
  auth.cert_path = patch.certPath;
  return { ...record, auth };
}

/** Read back the four auth fields a Connect/execute needs. Pure. */
export function readSimTenantAuthFields(raw: unknown): SimTenantAuthFields {
  const record = (raw ?? {}) as Record<string, unknown>;
  const auth = (record.auth ?? {}) as Record<string, unknown>;
  const tenant = (record.tenant ?? {}) as Record<string, unknown>;
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return {
    tenantId: s(tenant.tenant_id),
    appId: s(auth.app_id),
    certThumbprint: s(auth.cert_thumbprint),
    certPath: s(auth.cert_path),
  };
}

/** Names the auth fields that would fail Stamper's gate. Pure — [] means good. */
export function missingSimTenantAuthFields(fields: SimTenantAuthFields): readonly string[] {
  const missing: string[] = [];
  if (!fields.tenantId) missing.push('tenant.tenant_id');
  if (!fields.appId) missing.push('auth.app_id');
  if (!fields.certThumbprint || fields.certThumbprint.startsWith('SIMTHUMBPRINT')) {
    missing.push('auth.cert_thumbprint (still the registry placeholder)');
  }
  if (!fields.certPath) missing.push('auth.cert_path');
  else if (!path.isAbsolute(fields.certPath)) missing.push(`auth.cert_path (relative: "${fields.certPath}")`);
  return missing;
}

/**
 * Patch an already-authored record in place on disk. Separate from
 * `authorSimTenantRecord` because `createEphemeralSimTenant` OVERWRITES the
 * record file every time it is called — so any later re-registration (e.g. the
 * needle leg registering the same slug mid-run) resets the two auth fields, and
 * the caller must re-patch rather than re-author.
 */
export function patchSimTenantRecord(recordPath: string, patch: SimTenantAuthPatch): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as unknown;
  const patched = applySimTenantAuthPatch(raw, patch);
  fs.writeFileSync(recordPath, JSON.stringify(patched, null, 2) + '\n', 'utf8');
  return patched;
}

export interface AuthorSimTenantRecordOptions {
  readonly registry: TenantRegistryLifecycle;
  /** Registry root the record lands in (run-scoped for the demo). */
  readonly registryRoot: string;
  readonly slug: string;
  readonly auth: SimTenantAuthPatch;
  /** Opaque seed reference persisted as `stacksim_seed` (e.g. `{stance:'m365_azure'}`). */
  readonly seedRef?: unknown;
}

export interface AuthoredSimTenantRecord {
  readonly recordPath: string;
  readonly record: Record<string, unknown>;
  readonly fields: SimTenantAuthFields;
}

/**
 * Create (or overwrite) the sim record through the registry, then patch the two
 * auth fields and verify all four are usable. Idempotent by construction: the
 * registry rewrites the file from its own template every call, so re-running
 * yields the same record rather than accumulating drift.
 */
export async function authorSimTenantRecord(opts: AuthorSimTenantRecordOptions): Promise<AuthoredSimTenantRecord> {
  await createEphemeralSimTenant(opts.registry, opts.slug, opts.seedRef ?? { stance: 'm365_azure' });
  const recordPath = simRecordPath(opts.registryRoot, opts.slug);
  const record = patchSimTenantRecord(recordPath, opts.auth);
  const fields = readSimTenantAuthFields(record);
  const missing = missingSimTenantAuthFields(fields);
  if (missing.length > 0) {
    throw new Error(`sim tenant record ${recordPath} is unusable — missing/invalid: ${missing.join(', ')}`);
  }
  return { recordPath, record, fields };
}
