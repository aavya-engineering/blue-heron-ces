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
 * Create execution context for AO command execution.
 * Returns the execution config and a ces-tenant session factory for the request.
 *
 * The factory carries AO's consumer identity (`{ module: 'ces-ao', ... }`,
 * ratified amendment 2026-07-10) bound at construction, so every
 * ensureConnected/execute request made through it is attributed to ces-ao.
 *
 * @param tenantConfig - TenantConfig resolved through the ces-tenant registry
 * @param dryRun - Defaults to true (no cert validation, no real execution)
 */
export function createExecutionContext(
  tenantConfig: TenantConfig,
  dryRun: boolean = true
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
    if (!tenantConfig.certPath) {
      errors.push('CERT_PATH is required');
    } else if (!fs.existsSync(tenantConfig.certPath)) {
      errors.push(`Certificate file not found at: ${tenantConfig.certPath}`);
    }
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
