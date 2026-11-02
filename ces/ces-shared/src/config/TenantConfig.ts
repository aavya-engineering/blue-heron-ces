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
import * as os from 'node:os';

import { resolveSecretRef, assertNoInlineSecrets, isSecretRef, SecretRefError } from './secretRef.js';

export interface EvidenceStorageConfig {
  account_name: string;
  account_key: string;
  container: string;
  base_path: string;
  blob_endpoint: string;
}

/** In-scope boundary for a CMMC assessment (GP-SHARED-M0-1, filed by ces-ao G-AO-CMMC-BOUND-1 M0). */
export interface AssessmentScope {
  subscriptionIds?: string[];
  resourceGroups?: string[];
  ous?: string[];
}

/** CUI boundary: resource allowlist or tag-based match, consumed by ces-ao ParameterMapper. */
export interface CuiBoundary {
  resourceAllowlist?: string[];
  tagKey?: string;
  tagValue?: string;
}

export interface TenantConfig {
  tenantSlug: string;
  tenantId: string;
  appId: string;
  certPath: string;
  certThumbprint: string;
  /**
   * SP-3 (R3, SECRETS-PLAN.md): where the tenant key lives. `file` (the default when the record is
   * silent) = a PFX at `certPath`; `store` = a non-exportable key in the Windows certificate store, found
   * by thumbprint (`certPath` then names the public `.cer` only). Present only when the record declares
   * `auth.cert_source`, so older records load with an unchanged shape; read it with `certSourceOf()`.
   */
  certSource?: CertSource;
  /** SP-3: optional `auth.cert_store_ref`, e.g. `Cert:\CurrentUser\My\<thumbprint>` (written by bootstrap). */
  certStoreRef?: string;
  domain: string;
  endpoints: {
    graph: string;
    login: string;
    compliance_uri?: string;
    exchange_env?: string;
    azure_auth?: string;
    arm?: string;
  };
  subscription?: {
    subscription_id: string;
    resource_group: string;
    location: string;
  };
  subscriptionId?: string;
  resources?: Record<string, string>;
  evidenceStorage?: EvidenceStorageConfig;

  // --- CMMC scoping fields (GP-SHARED-M0-1) ---
  /**
   * Optional for backward compatibility: absent ⇒ pre-migration tenant. Consumers (ces-ao
   * CmmcScopeGate) fail open with a warning during Phase 1 and fail closed in Phase 2.
   */
  cmmcLevel?: 'L1' | 'L2';
  assessmentScope?: AssessmentScope;
  cuiBoundary?: CuiBoundary;

  // --- Stamper-only optional fields ---
  clientName?: string;
  /**
   * G4: active stack id (multi-stack selector). Reuses this existing config seam — no parallel
   * selector. Absent ⇒ the Microsoft/GCC High reference stack (DEFAULT_STACK_ID).
   */
  stack?: string;
  /**
   * @deprecated Fallback only. Prefer infrastructure_model from Infrastructure Manifest artifact when available.
   * For CMMC scoping, superseded by assessmentScope/cuiBoundary (G-AO-CMMC-BOUND-1 G6).
   */
  infrastructure_model?: 'm365_only' | 'm365_sentinel' | 'm365_azure';
  /** For CMMC scoping, superseded by assessmentScope/cuiBoundary (G-AO-CMMC-BOUND-1 G6). */
  excluded_entries?: string[];
  /** PH-13 P13-LV (DD-h): licences the customer bought beyond the target (e.g. "entra_id_governance"); opts licence-gated registry entries in. */
  licence_opt_ins?: string[];
  targetTenantDomain?: string;
}

/** SP-3: the two places a tenant key may live. */
export type CertSource = 'file' | 'store';

/** SP-3: a config's key location; `file` when the record did not declare one. */
export function certSourceOf(config: Pick<TenantConfig, 'certSource'>): CertSource {
  return config.certSource ?? 'file';
}

function parseCertSource(value: unknown): CertSource | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'file' || value === 'store') return value;
  throw new Error(
    `Tenant config invalid auth.cert_source: expected 'file' or 'store', got ${JSON.stringify(value)}`
  );
}

/** SP-3: `Cert:\<CurrentUser|LocalMachine>\<store>[\<40-hex thumbprint>]`. Anything else is refused. */
export const CERT_STORE_REF_RE = /^Cert:\\(CurrentUser|LocalMachine)\\[A-Za-z]+(\\[0-9A-Fa-f]{40})?$/;

function parseCertStoreRef(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !CERT_STORE_REF_RE.test(value)) {
    throw new Error(
      'Tenant config invalid auth.cert_store_ref: expected Cert:\\<CurrentUser|LocalMachine>\\<store>[\\<thumbprint>]'
    );
  }
  return value;
}

/**
 * Sim provenance, same marker as ces-tenant's `detectKind` (`ces-tenant/src/impl/tenant-file.ts`): an
 * explicit `kind`, else `tenant.environment: 'gcc-high-sim'`, which tenant-stacksim always writes.
 */
function isSimRecord(raw: Record<string, any>): boolean {
  if (raw.kind === 'live' || raw.kind === 'sim') return raw.kind === 'sim';
  return raw.tenant?.environment === 'gcc-high-sim';
}

/**
 * SP-1 (R1, SECRETS-PLAN.md): the customer's initial password never sits in a tenant record as a
 * literal. Always on (no switch):
 * - a live record carrying a non-empty `resources.initial_password` is refused;
 * - `resources.initial_password_ref`, on any record, must be a reference (`env:NAME` / `${NAME}`).
 * Errors name the field, never the value. Sim records keep their labelled fake `initial_password`
 * (tenant-stacksim writes it); no code maps it into a variable any more, so it is dead data there.
 */
export function assertNoLiteralInitialPassword(raw: Record<string, any>): void {
  const r = raw.resources;
  if (!r || typeof r !== 'object') return;
  const literal = r.initial_password;
  if (literal !== undefined && literal !== null && literal !== '' && !isSimRecord(raw)) {
    throw new SecretRefError(
      'literal resources.initial_password is not permitted in a tenant record; remove it and supply the ' +
        'initial password by reference (resources.initial_password_ref = env:NAME, a Tenant Manifest ' +
        'secret reference, or the operator overlay)'
    );
  }
  const ref = r.initial_password_ref;
  if (ref !== undefined && ref !== null && ref !== '' && !isSecretRef(ref)) {
    throw new SecretRefError('resources.initial_password_ref must be a reference (env:NAME or ${NAME}), not a literal');
  }
}

/**
 * Replaces {placeholder} tokens in an endpoint string with values from
 * TenantConfig.resources. Unresolved placeholders are left as-is.
 */
export function resolveEndpointVariables(
  endpoint: string,
  resources: Record<string, string>
): string {
  return endpoint.replace(/\{(\w+)\}/g, (_, key) => resources[key] ?? `{${key}}`);
}

// --- CMMC scoping field parsers (GP-SHARED-M0-1) ---
// Malformed values throw (config error, fail closed); absent values stay undefined so
// pre-migration tenant files load exactly as before.

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
    `Tenant config invalid cmmc_level: expected 'L1' or 'L2', got ${JSON.stringify(value)}`
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
 * Load and parse a tenant JSON file (e.g. ./plan-data/edcgov/edcgov.json).
 * Returns a typed TenantConfig with the fields both EC and EO need,
 * plus optional Stamper-specific fields.
 */
export function loadTenantConfig(filePath: string): TenantConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tenant config not found: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // SP-1 (R1): refuse a literal initial password before anything else reads the record.
  assertNoLiteralInitialPassword(raw);

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
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Tenant config missing required fields: ${missing.join(', ')}`);
  }

  // G1/T6: secret-bearing fields may be externalized as references (env:NAME / ${NAME});
  // literals pass through unchanged. A declared reference that can't resolve throws (fail closed).
  // G8: hardened deployments can forbid inline secrets entirely via CES_STRICT_SECRETS=1 — the
  // check runs BEFORE resolution (after resolution the value is a literal). Default off ⇒ no change.
  const rawStorage = raw.evidence_storage;
  if (process.env.CES_STRICT_SECRETS === '1' || process.env.CES_STRICT_SECRETS === 'true') {
    const secretFields: Record<string, unknown> = { 'auth.cert_thumbprint': certThumbprint };
    if (rawStorage && typeof rawStorage.account_key === 'string') {
      secretFields['evidence_storage.account_key'] = rawStorage.account_key;
    }
    assertNoInlineSecrets(secretFields, Object.keys(secretFields));
  }
  const resolvedThumbprint = resolveSecretRef(certThumbprint).value;
  const certSource = parseCertSource(raw.auth?.cert_source);
  const certStoreRef = parseCertStoreRef(raw.auth?.cert_store_ref);
  const resolvedStorage =
    rawStorage && typeof rawStorage.account_key === 'string'
      ? { ...rawStorage, account_key: resolveSecretRef(rawStorage.account_key).value }
      : rawStorage;

  const config: TenantConfig = {
    tenantSlug: slug ?? 'unknown',
    tenantId,
    appId,
    certPath,
    certThumbprint: resolvedThumbprint,
    ...(certSource ? { certSource } : {}),
    ...(certStoreRef ? { certStoreRef } : {}),
    domain: raw.tenant?.domain ?? '',
    endpoints: raw.endpoints ?? {},
    subscription: raw.subscription,
    subscriptionId: raw.subscription?.subscription_id,
    resources: raw.resources,
    evidenceStorage: resolvedStorage,

    // CMMC scoping fields (GP-SHARED-M0-1)
    cmmcLevel: parseCmmcLevel(raw.cmmc_level),
    assessmentScope: parseAssessmentScope(raw.assessment_scope),
    cuiBoundary: parseCuiBoundary(raw.cui_boundary),

    // Stamper-only optional fields
    clientName: raw.client?.name,
    stack: typeof raw.stack === 'string' ? raw.stack : undefined,
    infrastructure_model: raw.infrastructure_model,
    excluded_entries: Array.isArray(raw.excluded_entries) ? raw.excluded_entries : undefined,
    licence_opt_ins: Array.isArray(raw.licence_opt_ins) ? raw.licence_opt_ins.filter((x: unknown): x is string => typeof x === 'string') : undefined,
    targetTenantDomain: raw.tenant?.domain,
  };

  return config;
}

/**
 * Resolve the path to a tenant JSON file by slug.
 * Convention: ./plan-data/<slug>/<slug>.json relative to projectRoot.
 * Falls back to legacy ~/.stamper/tenants/<slug>/<slug>.json (read-only) with warning.
 */
export function resolveTenantJsonPath(slug: string, projectRoot: string): string {
  const newPath = path.resolve(projectRoot, 'plan-data', slug, `${slug}.json`);
  if (fs.existsSync(newPath)) return newPath;

  // Legacy fallback: check old ~/.stamper/tenants/ location
  const legacyPath = path.join(os.homedir(), '.stamper', 'tenants', slug, `${slug}.json`);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  // Neither exists — return the new path (caller will handle 404)
  return newPath;
}
