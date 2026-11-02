// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 1: Auth Chain Wiring (G-TENANT-M5 cutover)
// Builds AO's execution context from the ces-tenant package: the session
// surface is ces-tenant's `TenantSessionFactory` (`PersistentSessionFactory`),
// constructed with AO's consumer identity — no deep import of Stamper's
// internal `core/session` or `config/stamper` modules remains.

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { TenantConfig } from 'ces-shared/config';
import { getActiveStackProvider, type StackProvider } from 'ces-shared/stack';
import { PersistentSessionFactory, type TenantSessionFactory } from 'ces-tenant';
import { AO_CONSUMER } from '../tenant/aoTenants.js';

/**
 * Derive the cloud-endpoint DEFAULTS for a tenant from the active stack provider (G4 seam).
 *
 * AO's stack selection routes through `ces-shared/stack`: the active provider is resolved from
 * `tenantConfig.stack` (absent ⇒ DEFAULT_STACK_ID = 'microsoft-gcc-high'), and its declared
 * `cloudEndpoints`/`conventions` supply the defaults. The tenant's own explicit `endpoints` (if any)
 * still win — the provider only fills the gaps. For the Microsoft reference stack the provider's
 * values are byte-identical to the previous hard-coded literals, so behaviour is unchanged.
 *
 * G-TENANT-M5 reconciliation note (design §2.2): this seam is AO's prior art for the sovereign
 * endpoint table ces-tenant will eventually own. ces-tenant's M1 `ConnectionProfile` documents the
 * CURRENT hardcoded GCC High/USGov literals only — the sovereign table is still NEW-SCOPE there
 * (ces-tenant README "Still NOT implemented, by design"), so this seam is CONSUMED here (kept as
 * the source of AO's endpoint defaults) rather than migrated into the package. When ces-tenant
 * ships connection-profile endpoint resolution, this function is the thing it replaces.
 *
 * Returns the active provider plus an `endpoints` object in TenantConfig shape so it can be merged
 * with (and overridden by) the tenant's explicit endpoints before handing off to the adapter.
 */
export function resolveStackEndpoints(tenantConfig: TenantConfig): {
  provider: StackProvider;
  endpoints: NonNullable<TenantConfig['endpoints']>;
} {
  const provider = getActiveStackProvider(tenantConfig);
  const { cloudEndpoints, conventions } = provider.capabilities;
  const endpoints: NonNullable<TenantConfig['endpoints']> = {
    graph: cloudEndpoints.graph,
    login: cloudEndpoints.login,
    // azure_auth is the login authority's /organizations endpoint (derived, not a separate literal).
    azure_auth: `${cloudEndpoints.login}/organizations`,
  };
  if (cloudEndpoints.exchange) endpoints.exchange_env = cloudEndpoints.exchange;
  if (cloudEndpoints.compliance) endpoints.compliance_uri = cloudEndpoints.compliance;
  if (cloudEndpoints.arm) endpoints.arm = cloudEndpoints.arm;
  void conventions; // conventions consulted by the provider; endpoints are the AO-consumed slice
  return { provider, endpoints };
}

/**
 * The execution-config slice AO hands to Stamper's `PowerShellAdapter`
 * (which remains Stamper-owned — logged M5 deviation, see CommandExecutor).
 * Field-compatible with the exact `StamperConfig` getters the adapter reads
 * (`ces-stamper/src/adapters/PowerShellAdapter.ts`: tenantId, appId,
 * certThumbprint, domain, subscriptionId, gccHighEndpoints, dryRun), plus the
 * stack-resolved endpoint table for AO's own use. Built from the tenant
 * config + stack-provider seam — NOT from `ces-stamper/config/stamper`.
 */
export interface AoExecutionConfig {
  tenantId: string;
  appId: string;
  certThumbprint: string;
  certPath: string;
  domain: string;
  subscriptionId?: string;
  /** True when the active stack's cloud environment is GCC High (drives the adapter's connection preamble). */
  gccHighEndpoints: boolean;
  dryRun: boolean;
  /** Stack-provider defaults merged with (and overridden by) the tenant's explicit endpoints. */
  endpoints: NonNullable<TenantConfig['endpoints']>;
}

/**
 * SP-3 (R3, SECRETS-PLAN.md): the tenant-key fields AO reads. Declared locally (structurally) so this
 * file type-checks whether 'ces-shared/config' resolves to a TenantConfig that already carries
 * them (ces-shared/src/config/TenantConfig.ts, FIN-20) or to an older build that does not.
 */
type CertSourceFields = { certSource?: 'file' | 'store'; certStoreRef?: string };

/** SP-3: what a certificate-store probe reports. Never carries key material. */
export interface CertStoreProbeResult {
  /** A certificate with this thumbprint is in the searched store(s). */
  found: boolean;
  /** That certificate has an associated private key (it can sign the app-only token request). */
  hasPrivateKey: boolean;
  /** The store path where it was found, e.g. Cert:\CurrentUser\My. */
  location?: string;
  /** A probe failure (PowerShell missing, timeout): the reason only. */
  error?: string;
}

/** SP-3: probe the Windows certificate store for a thumbprint. Injectable for tests. */
export type CertStoreProbe = (thumbprint: string, storeRef: string | undefined) => CertStoreProbeResult;

const THUMBPRINT_RE = /^[0-9A-Fa-f]{40}$/;
/** Same shape ces-shared's loader enforces (TenantConfig.ts CERT_STORE_REF_RE). */
const STORE_REF_RE = /^Cert:\\(CurrentUser|LocalMachine)\\[A-Za-z]+(\\[0-9A-Fa-f]{40})?$/;

/** The fixed probe script. Inputs arrive only as environment variables. */
const CERT_STORE_PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$t = $env:CES_AO_PROBE_THUMB',
  "$stores = if ($env:CES_AO_PROBE_STORE) { @($env:CES_AO_PROBE_STORE) } else { @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My') }",
  '$hit = $null; $loc = $null',
  'foreach ($s in $stores) { $c = Get-ChildItem -Path $s -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $t } | Select-Object -First 1; if ($c) { $hit = $c; $loc = $s; break } }',
  'if ($hit) { [pscustomobject]@{ found = $true; hasPrivateKey = [bool]$hit.HasPrivateKey; location = $loc } | ConvertTo-Json -Compress }',
  "else { '{\"found\":false,\"hasPrivateKey\":false}' }",
].join('\n');

/**
 * Default probe: one short Windows PowerShell child. The thumbprint and store path go through the
 * child's ENVIRONMENT (never argv); the script is fixed and passed with -EncodedCommand; the child
 * prints one JSON line of booleans. It searches the record's store when the record names one, else
 * Cert:\CurrentUser\My then Cert:\LocalMachine\My.
 */
export const defaultCertStoreProbe: CertStoreProbe = (thumbprint, storeRef) => {
  const encoded = Buffer.from(CERT_STORE_PROBE_SCRIPT, 'utf16le').toString('base64');
  // A ref with a thumbprint segment is a certificate path: search its parent store.
  const store = storeRef ? storeRef.replace(/\\[0-9A-Fa-f]{40}$/, '') : '';
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, CES_AO_PROBE_THUMB: thumbprint, CES_AO_PROBE_STORE: store },
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) {
    return { found: false, hasPrivateKey: false, error: r.error ? r.error.message : `powershell exited ${r.status}` };
  }
  try {
    const line = String(r.stdout).trim().split(/\r?\n/).pop() ?? '';
    const j = JSON.parse(line);
    return {
      found: j.found === true,
      hasPrivateKey: j.hasPrivateKey === true,
      location: typeof j.location === 'string' ? j.location : undefined,
    };
  } catch {
    return { found: false, hasPrivateKey: false, error: 'unreadable probe output' };
  }
};

/**
 * SP-3: the live-run key check, by key location. Returns error lines (empty = pass).
 * - `file` (the default when the record is silent): the original rule, unchanged. The PFX at
 *   certPath must exist.
 * - `store`: the thumbprint must be in the certificate store WITH a private key. certPath (the public
 *   .cer that bootstrap writes) need not exist, and no PFX is ever required.
 */
export function validateTenantKey(
  tenantConfig: TenantConfig & CertSourceFields,
  probe: CertStoreProbe = defaultCertStoreProbe,
): string[] {
  const errors: string[] = [];
  if ((tenantConfig.certSource ?? 'file') === 'store') {
    const thumb = tenantConfig.certThumbprint;
    if (!thumb) return errors; // the caller reports "CERT_THUMBPRINT is required"
    if (!THUMBPRINT_RE.test(thumb)) {
      errors.push('CERT_THUMBPRINT must be 40 hex characters for cert_source "store"');
      return errors;
    }
    const ref = tenantConfig.certStoreRef;
    if (ref !== undefined && !STORE_REF_RE.test(ref)) {
      errors.push('cert_store_ref is not a Cert:\\<CurrentUser|LocalMachine>\\<store> path');
      return errors;
    }
    const res = probe(thumb, ref);
    if (res.error) errors.push(`Certificate store probe failed: ${res.error}`);
    else if (!res.found) errors.push(`Certificate ${thumb} not found in the certificate store (cert_source "store")`);
    else if (!res.hasPrivateKey) errors.push(`Certificate ${thumb} is in the store without a private key (cert_source "store")`);
    return errors;
  }
  if (!tenantConfig.certPath) {
    errors.push('CERT_PATH is required');
  } else if (!fs.existsSync(tenantConfig.certPath)) {
    errors.push(`Certificate file not found at: ${tenantConfig.certPath}`);
  }
  return errors;
}

/**
 * Create execution context for AO command execution.
 * Returns the execution config and a ces-tenant session factory for the request.
 *
 * The factory carries AO's consumer identity (`{ module: 'ces-ao', ... }`,
 * ratified amendment 2026-07-10) bound at construction, so every
 * ensureConnected/execute request made through it is attributed to ces-ao.
 *
 * @param tenantConfig - TenantConfig resolved through the ces-tenant registry
 * @param dryRun - Defaults to true (no cert validation, no real execution)
 * @param certStoreProbe - SP-3 seam: the store probe for `cert_source: 'store'` records (tests inject)
 */
export function createExecutionContext(
  tenantConfig: TenantConfig,
  dryRun: boolean = true,
  certStoreProbe: CertStoreProbe = defaultCertStoreProbe
): { executionConfig: AoExecutionConfig; sessionFactory: TenantSessionFactory } {
  // Resolve cloud-endpoint defaults through the stack-provider seam, then let any explicit
  // tenant endpoints override them. Microsoft (default stack) ⇒ identical endpoint values.
  const { provider, endpoints: stackEndpoints } = resolveStackEndpoints(tenantConfig);
  const endpoints = { ...stackEndpoints, ...(tenantConfig.endpoints ?? {}) };

  // Live-run validation parity with the retired StamperConfig.fromTenantConfig path
  // (fail closed BEFORE any session spawn; dry-run skips it, same as before).
  if (!dryRun) {
    const errors: string[] = [];
    if (!tenantConfig.tenantId) errors.push('TENANT_ID is required');
    if (!tenantConfig.appId) errors.push('APP_ID is required');
    if (!tenantConfig.certThumbprint) errors.push('CERT_THUMBPRINT is required');
    // SP-3: file mode is the original check, unchanged; store mode probes the certificate store.
    errors.push(...validateTenantKey(tenantConfig, certStoreProbe));
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  const executionConfig: AoExecutionConfig = {
    tenantId: tenantConfig.tenantId,
    appId: tenantConfig.appId,
    certThumbprint: tenantConfig.certThumbprint,
    certPath: tenantConfig.certPath,
    domain: tenantConfig.domain || '',
    subscriptionId: tenantConfig.subscriptionId || tenantConfig.subscription?.subscription_id,
    gccHighEndpoints: provider.capabilities.conventions.cloudEnvironment === 'gcc_high',
    dryRun,
    endpoints,
  };

  // ces-tenant session factory for this request (the TenantSessionFactory
  // surface — Stamper's SessionManager orchestration, now package-owned).
  const sessionFactory: TenantSessionFactory = new PersistentSessionFactory(
    {
      tenantId: tenantConfig.tenantId,
      appId: tenantConfig.appId,
      certThumbprint: tenantConfig.certThumbprint,
      targetTenantDomain: tenantConfig.targetTenantDomain || tenantConfig.domain || undefined,
      subscriptionId: executionConfig.subscriptionId,
    },
    {
      dryRun,
      consumer: AO_CONSUMER,
      tenantSlug: tenantConfig.tenantSlug,
    }
  );

  return { executionConfig, sessionFactory };
}
