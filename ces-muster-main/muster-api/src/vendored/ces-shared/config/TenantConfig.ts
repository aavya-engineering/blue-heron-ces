// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { resolveSecretRef, assertNoInlineSecrets } from './secretRef.js';

export interface EvidenceStorageConfig {
  account_name: string;
  account_key: string;
  container: string;
  base_path: string;
  blob_endpoint: string;
}

export interface TenantConfig {
  tenantSlug: string;
  tenantId: string;
  appId: string;
  certPath: string;
  certThumbprint: string;
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

  // --- Stamper-only optional fields ---
  clientName?: string;
  /**
   * G4: active stack id (multi-stack selector). Reuses this existing config seam — no parallel
   * selector. Absent ⇒ the Microsoft/GCC High reference stack (DEFAULT_STACK_ID).
   */
  stack?: string;
  /** @deprecated Fallback only. Prefer infrastructure_model from Infrastructure Manifest artifact when available. */
  infrastructure_model?: 'm365_only' | 'm365_sentinel' | 'm365_azure';
  excluded_entries?: string[];
  targetTenantDomain?: string;
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

/**
 * Load and parse a tenant JSON file (e.g. ./plan-data/vfsgov/vfsgov.json).
 * Returns a typed TenantConfig with the fields both EC and EO need,
 * plus optional Stamper-specific fields.
 */
export function loadTenantConfig(filePath: string): TenantConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tenant config not found: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

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
    domain: raw.tenant?.domain ?? '',
    endpoints: raw.endpoints ?? {},
    subscription: raw.subscription,
    subscriptionId: raw.subscription?.subscription_id,
    resources: raw.resources,
    evidenceStorage: resolvedStorage,

    // Stamper-only optional fields
    clientName: raw.client?.name,
    stack: typeof raw.stack === 'string' ? raw.stack : undefined,
    infrastructure_model: raw.infrastructure_model,
    excluded_entries: Array.isArray(raw.excluded_entries) ? raw.excluded_entries : undefined,
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
