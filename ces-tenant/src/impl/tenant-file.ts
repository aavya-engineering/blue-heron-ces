// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Raw tenant-JSON file handling: the on-disk shape is the SAME raw JSON
 * `ces-shared`'s `loadTenantConfig()` reads today
 * (`client.slug` / `tenant.tenant_id` / `auth.*` / `endpoints` / ... --
 * `ces-shared/src/config/TenantConfig.ts:68-136`), plus the new top-level
 * `kind` discriminator (design 2.1). Field mapping, required-field checks,
 * secret-ref resolution, and CES_STRICT_SECRETS behavior are a
 * behavior-preserving port of `loadTenantConfig()`; migrated files keep the
 * raw shape so existing loaders can still read them.
 */

import * as fs from 'node:fs';

import type { AssessmentScope, CuiBoundary, TenantKind, TenantRegistryRecord } from '../registry.js';
import { assertNoInlineSecrets, resolveSecretRef } from './secret-ref.js';

/** Loosely-typed raw tenant JSON (the persisted shape). */
export type RawTenantJson = Record<string, any>;

/**
 * Detect the kind of a raw tenant JSON that predates the `kind` field
 * (design 2.1 point 3: migrated records are `'live'` unless sourced from
 * tenant-stacksim's emitted config). Detection marker: `writeSimTenantConfig()`
 * unconditionally emits `tenant.environment: 'gcc-high-sim'`
 * (`tenant-stacksim/src/config/SimTenantConfig.ts:119-123`), so that value is
 * the grounded sim-provenance signal. An explicit valid `kind` field wins.
 */
export function detectKind(raw: RawTenantJson): TenantKind {
  if (raw.kind === 'live' || raw.kind === 'sim') return raw.kind;
  if (raw.tenant?.environment === 'gcc-high-sim') return 'sim';
  return 'live';
}

/** Read + parse a raw tenant JSON file. Missing-file message matches `loadTenantConfig()` (`TenantConfig.ts:69-71`) because muster-api's error mapping keys on it. */
export function readRawTenantJson(filePath: string): RawTenantJson {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tenant config not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// --- CMMC scoping field parsers — GP-SHARED-M0-1 ces-tenant half (ratified
// amendment, founder 2026-07-26). Behavior-identical mirror of ces-shared's
// parsers (`ces-shared/src/config/TenantConfig.ts:90-142`), same error
// messages: malformed values throw (config error, fail closed); absent values
// stay undefined so pre-migration tenant files load exactly as before.

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`Tenant config invalid ${field}: expected an array of strings`);
  }
  return value as string[];
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Tenant config invalid ${field}: expected a string`);
  }
  return value;
}

function parseCmmcLevel(value: unknown): 'L1' | 'L2' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'L1' || value === 'L2') return value;
  throw new Error(
    `Tenant config invalid cmmc_level: expected 'L1' or 'L2', got ${JSON.stringify(value)}`,
  );
}

function parseAssessmentScope(value: unknown): AssessmentScope | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tenant config invalid assessment_scope: expected an object');
  }
  const raw = value as Record<string, unknown>;
  return {
    subscriptionIds: parseStringArray(raw.subscription_ids, 'assessment_scope.subscription_ids'),
    resourceGroups: parseStringArray(raw.resource_groups, 'assessment_scope.resource_groups'),
    ous: parseStringArray(raw.ous, 'assessment_scope.ous'),
  };
}

function parseCuiBoundary(value: unknown): CuiBoundary | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tenant config invalid cui_boundary: expected an object');
  }
  const raw = value as Record<string, unknown>;
  return {
    resourceAllowlist: parseStringArray(raw.resource_allowlist, 'cui_boundary.resource_allowlist'),
    tagKey: parseOptionalString(raw.tag_key, 'cui_boundary.tag_key'),
    tagValue: parseOptionalString(raw.tag_value, 'cui_boundary.tag_value'),
  };
}

/**
 * Migration-exemption marker (G-AO-CMMC-BOUND-1 M0 memo addendum). The
 * convention was stated as a literal `cmmcMigrationExempt: true` on the
 * record; the snake_case `cmmc_migration_exempt` spelling matches every
 * other key in the persisted file — both are honored (camelCase wins if
 * both are present, since it is the convention as originally filed).
 */
function parseCmmcMigrationExempt(raw: RawTenantJson): boolean | undefined {
  const value = raw.cmmcMigrationExempt ?? raw.cmmc_migration_exempt;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error('Tenant config invalid cmmc_migration_exempt: expected a boolean');
  }
  return value;
}

/**
 * Map raw tenant JSON to a `TenantRegistryRecord`. Port of
 * `loadTenantConfig()`'s field mapping and validation
 * (`ces-shared/src/config/TenantConfig.ts:68-136`), plus `kind`:
 * - same required-field check (tenant.tenant_id, auth.app_id, auth.cert_path,
 *   auth.cert_thumbprint) with the same error message shape;
 * - same CES_STRICT_SECRETS pre-resolution guard;
 * - same secret-ref resolution of `auth.cert_thumbprint` (fail closed).
 * The RETURNED record carries the resolved thumbprint; the PERSISTED file is
 * never rewritten with resolved secret material (goal must-NOT: credential
 * fields are references only).
 */
export function parseTenantRecord(
  raw: RawTenantJson,
  kind: TenantKind,
  env: NodeJS.ProcessEnv = process.env,
): TenantRegistryRecord {
  const slug = raw.client?.slug;
  const tenantId = raw.tenant?.tenant_id;
  const appId = raw.auth?.app_id;
  const certPath = raw.auth?.cert_path;
  const certThumbprint = raw.auth?.cert_thumbprint;

  const requiredFields: Record<string, unknown> = {
    'tenant.tenant_id': tenantId,
    'auth.app_id': appId,
    'auth.cert_path': certPath,
    'auth.cert_thumbprint': certThumbprint,
  };
  const missing = Object.entries(requiredFields)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Tenant config missing required fields: ${missing.join(', ')}`);
  }

  // Strict-mode guard and per-field resolution both mirror
  // `TenantConfig.ts:100-112`, including evidence_storage.account_key.
  const rawStorage = raw.evidence_storage;
  if (env.CES_STRICT_SECRETS === '1' || env.CES_STRICT_SECRETS === 'true') {
    const secretFields: Record<string, unknown> = { 'auth.cert_thumbprint': certThumbprint };
    if (rawStorage && typeof rawStorage.account_key === 'string') {
      secretFields['evidence_storage.account_key'] = rawStorage.account_key;
    }
    assertNoInlineSecrets(secretFields, Object.keys(secretFields));
  }
  const resolvedThumbprint = resolveSecretRef(certThumbprint, env);
  const resolvedStorage =
    rawStorage && typeof rawStorage.account_key === 'string'
      ? { ...rawStorage, account_key: resolveSecretRef(rawStorage.account_key, env) }
      : rawStorage;

  // CMMC scoping (GP-SHARED-M0-1 ces-tenant half). Load-time partial-config
  // rejection — the Case-B foot-gun (G-AO-CMMC-BOUND-1 M3): a record that
  // opts into `cmmc_level` scoping without a `cui_boundary` is refused here
  // at the registry, not just always-denied downstream by ces-ao's
  // CmmcScopeGate. `assessment_scope` absent is allowed (a tag-based CUI
  // boundary needs no subscription/RG/OU scope), matching the gate's
  // runtime rule which keys the always-deny on `cuiBoundary` alone.
  const cmmcLevel = parseCmmcLevel(raw.cmmc_level);
  const assessmentScope = parseAssessmentScope(raw.assessment_scope);
  const cuiBoundary = parseCuiBoundary(raw.cui_boundary);
  // Migration-exemption default (G-AO-CMMC-BOUND-1 record-migration, founder
  // "complete the spokes" 2026-07-27): `kind:'sim'` records are ephemeral,
  // pane-created simulations — never real assessment targets — so they are
  // migration-exempt BY DEFAULT and drop out of the Phase-2 coverage
  // denominator without each sim file needing a hand-stamped marker (sim count
  // drifts as panes create/tear down ephemeral records). An EXPLICIT value on
  // the record — `true` OR `false` — always wins, so a sim record can still be
  // opted back into the denominator with `cmmc_migration_exempt: false`. Live
  // records keep the prior behavior (undefined unless explicitly marked).
  const explicitExempt = parseCmmcMigrationExempt(raw);
  const cmmcMigrationExempt =
    explicitExempt !== undefined ? explicitExempt : kind === 'sim' ? true : undefined;
  if (cmmcLevel !== undefined && cuiBoundary === undefined) {
    throw new Error(
      'Tenant config invalid: cmmc_level is set but cui_boundary is absent ' +
        '(partial CMMC config foot-gun — G-AO-CMMC-BOUND-1 Case B; add cui_boundary or remove cmmc_level)',
    );
  }

  return {
    tenantSlug: slug ?? 'unknown',
    tenantId,
    appId,
    certPath,
    certThumbprint: resolvedThumbprint,
    domain: raw.tenant?.domain ?? '',
    endpoints: raw.endpoints ?? {},
    subscription: raw.subscription,
    subscriptionId: raw.subscription?.subscription_id,
    resources: raw.resources,
    evidenceStorage: resolvedStorage,
    cmmcLevel,
    assessmentScope,
    cuiBoundary,
    cmmcMigrationExempt,
    clientName: raw.client?.name,
    stack: typeof raw.stack === 'string' ? raw.stack : undefined,
    infrastructure_model: raw.infrastructure_model,
    excluded_entries: Array.isArray(raw.excluded_entries) ? raw.excluded_entries : undefined,
    targetTenantDomain: raw.tenant?.domain,
    kind,
  };
}
