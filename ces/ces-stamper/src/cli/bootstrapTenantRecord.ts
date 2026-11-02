// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * `stamper bootstrap` support (tenant-init P-5, TENANT-INIT-AUDIT.md section 5 gaps 2, 3 and 9).
 *
 * - The bootstrap script needs PowerShell 7, so the CLI launches `pwsh`, never `powershell.exe` (5.1).
 * - The script writes a result file with no secret material; this module turns it into a
 *   `kind: 'live'` record in the ces-tenant registry (same writer path as `POST /api/tenants`:
 *   `registryRecordPath(getRegistryRoot(), kind, slug)` + `writeJsonArtifact`).
 * - SP-3: the key stays non-exportable in the certificate store, so the record says
 *   `auth.cert_source: 'store'`; `auth.cert_path` points at the public `.cer`.
 */

import * as fs from 'fs';
import { getRegistryRoot, registryRecordPath } from 'ces-tenant';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

/** PowerShell 7 executable the bootstrap command launches. */
export const BOOTSTRAP_PWSH = 'pwsh';

export const PWSH_MISSING_MESSAGE =
  'PowerShell 7 (pwsh) was not found on PATH. New-TenantBootstrap.ps1 requires PowerShell 7+; ' +
  'Windows PowerShell 5.1 (powershell.exe) cannot run it. Install it from https://aka.ms/powershell and retry.';

/** Operator-facing message for a failure to launch the bootstrap script. */
export function describeBootstrapSpawnError(error: NodeJS.ErrnoException): string {
  if (error.code === 'ENOENT') return PWSH_MISSING_MESSAGE;
  return `Failed to execute PowerShell 7 (pwsh): ${error.message}`;
}

/** Shape of the result file New-TenantBootstrap.ps1 writes (schema ces-stamper/bootstrap-result@1). */
export interface BootstrapResult {
  schema?: string;
  tenant_id: string;
  display_name: string;
  environment: 'Commercial' | 'GCCHigh';
  org_name?: string | null;
  domain?: string | null;
  app_id: string;
  cert_thumbprint: string;
  cert_source?: string;
  cert_store_ref?: string;
  cer_path: string;
  cert_expires?: string;
  endpoints: Record<string, string>;
  permissions?: { granted: number; skipped: number; failed: number };
  subscription?: Record<string, unknown>;
  security_defaults?: string;
  break_glass?: { verified: boolean; upns?: string[]; user_ids?: string[]; detail?: string };
  validation_passed?: boolean;
  completed_at?: string;
  /** FIN-21: the licence check and assignment (steps 1 and 18). */
  licenses?: Record<string, unknown>;
  /** FIN-21: true when the script ran with -Simulator; the record is then kind 'sim'. */
  simulator?: boolean;
}

/** Slug from the app display name: lowercase, anything outside [a-z0-9_-] becomes '-'. */
export function deriveTenantSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function readBootstrapResult(resultPath: string): BootstrapResult {
  const text = fs.readFileSync(resultPath, 'utf-8').replace(/^﻿/, '');
  const parsed = JSON.parse(text) as BootstrapResult;
  for (const field of ['tenant_id', 'app_id', 'cert_thumbprint', 'cer_path'] as const) {
    if (!parsed[field]) throw new Error(`Bootstrap result ${resultPath} is missing ${field}`);
  }
  return parsed;
}

/** Build the raw tenant JSON (the persisted registry format), merging over an existing record. */
export function buildBootstrapTenantRecord(
  result: BootstrapResult,
  slug: string,
  existing?: Record<string, any>,
): Record<string, any> {
  const prior = existing ?? {};
  const environment = result.environment === 'GCCHigh' ? 'gcc-high' : 'commercial';
  return {
    ...prior,
    client: {
      ...(prior.client ?? {}),
      slug,
      name: prior.client?.name ?? result.org_name ?? result.display_name,
    },
    tenant: {
      ...(prior.tenant ?? {}),
      tenant_id: result.tenant_id,
      domain: result.domain ?? prior.tenant?.domain ?? '',
      environment: prior.tenant?.environment ?? environment,
    },
    auth: {
      ...(prior.auth ?? {}),
      app_id: result.app_id,
      cert_thumbprint: result.cert_thumbprint,
      cert_path: result.cer_path,
      cert_source: 'store',
      ...(result.cert_store_ref ? { cert_store_ref: result.cert_store_ref } : {}),
    },
    endpoints: { ...(prior.endpoints ?? {}), ...result.endpoints },
    onboarding: {
      ...(prior.onboarding ?? {}),
      tool: 'stamper bootstrap',
      bootstrapped_at: result.completed_at ?? new Date().toISOString(),
      cert_expires: result.cert_expires,
      validation_passed: result.validation_passed === true,
      permissions: result.permissions,
      subscription: result.subscription,
      security_defaults: result.security_defaults,
      break_glass: result.break_glass,
      licenses: result.licenses,
    },
    kind: result.simulator === true ? 'sim' : 'live',
  };
}

/**
 * Write (or update) the live registry record for a bootstrap result. Refuses the `dev` slug and
 * refuses to repoint an existing record at a different tenant id.
 */
export function writeBootstrapTenantRecord(
  result: BootstrapResult,
  slug: string,
  env: NodeJS.ProcessEnv = process.env,
): { path: string; record: Record<string, any>; updated: boolean } {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    throw new Error(`Tenant slug '${slug}' must contain only letters, numbers, hyphens, and underscores`);
  }
  if (slug === 'dev') {
    throw new Error("Refusing to write the 'dev' tenant record from bootstrap");
  }
  const recordPath = registryRecordPath(getRegistryRoot(env), result.simulator === true ? 'sim' : 'live', slug);
  let existing: Record<string, any> | undefined;
  if (fs.existsSync(recordPath)) {
    existing = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
    const priorTenantId = existing?.tenant?.tenant_id;
    if (priorTenantId && priorTenantId !== result.tenant_id) {
      throw new Error(
        `Registry record '${slug}' belongs to tenant ${priorTenantId}, not ${result.tenant_id}; choose another --slug`,
      );
    }
  }
  const record = buildBootstrapTenantRecord(result, slug, existing);
  writeJsonArtifact(recordPath, record);
  return { path: recordPath, record, updated: existing !== undefined };
}
