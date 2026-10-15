// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Node-only storage resolver. Imports node:path — do NOT import from FE/browser code.
import * as path from 'node:path';

import {
  CesModuleName,
  PlannerArtifactPathOptions,
  CES_PIPELINE_ROOT_ENV,
  DEFAULT_CES_PIPELINE_ROOT_WIN32,
  DEFAULT_CES_PIPELINE_ROOT_POSIX,
  CUSTOMER_NAME_RESERVED_RE,
  CUSTOMER_NAME_FALLBACK,
} from './contract.js';

export const DEFAULT_CES_PIPELINE_ROOT =
  process.platform === 'win32'
    ? DEFAULT_CES_PIPELINE_ROOT_WIN32
    : path.join(process.cwd(), DEFAULT_CES_PIPELINE_ROOT_POSIX);

export function getCesPipelineRoot(): string {
  return path.resolve(process.env[CES_PIPELINE_ROOT_ENV] || DEFAULT_CES_PIPELINE_ROOT);
}

export function getCesModuleRoot(moduleName: CesModuleName): string {
  return path.join(getCesPipelineRoot(), moduleName);
}

export function getModuleStorageRoot(moduleName: Exclude<CesModuleName, 'Planner'>): string {
  return path.join(getCesModuleRoot(moduleName), 'storage');
}

export function getPlannerCustomersRoot(): string {
  return path.join(getCesModuleRoot('Planner'), 'customers');
}

export function sanitizeCustomerName(name: string): string {
  return name.replace(CUSTOMER_NAME_RESERVED_RE, '_').trim() || CUSTOMER_NAME_FALLBACK;
}

export function getPlannerCustomerRoot(customerName: string): string {
  return path.join(getPlannerCustomersRoot(), sanitizeCustomerName(customerName));
}

export function getPlannerArtifactDirectory(options: PlannerArtifactPathOptions): string {
  const customerRoot = getPlannerCustomerRoot(options.customerName);
  return options.category ? path.join(customerRoot, options.category) : customerRoot;
}

export function getPlannerArtifactPath(options: PlannerArtifactPathOptions): string {
  const directory = getPlannerArtifactDirectory(options);
  return options.filename ? path.join(directory, options.filename) : directory;
}

export function getStamperPlanDataRoot(): string {
  return path.join(getCesModuleRoot('Stamper'), 'plan-data');
}

/**
 * Canonical root for a tenant's Stamper data. This is the SINGLE read path
 * for any module that needs Stamper output (plans, evidence, logs, state).
 * EvidenceOps and any future consumer must resolve through this helper,
 * never via repo-relative paths or hard-coded locations.
 */
export function getStamperTenantRoot(tenantSlug: string): string {
  return path.join(getStamperPlanDataRoot(), tenantSlug);
}

/**
 * Subdirectory under a tenant's Stamper root. Use 'evidence' for Stamper-written
 * evidence files, 'state' for execution-results manifests, 'plans' for executable
 * plans, 'logs' for run logs. Consumers resolve through getStamperTenantRoot.
 */
export function getStamperTenantSubdir(
  tenantSlug: string,
  subdir: 'plans' | 'evidence' | 'logs' | 'state',
): string {
  return path.join(getStamperTenantRoot(tenantSlug), subdir);
}

/**
 * Canonical root for EC's own module storage (its item store + ledger). EC never
 * writes into another tool's tree; this is its own root, distinct from
 * getStamperTenantRoot (which EC reads from, read-only, during an index pass).
 */
export function getEcModuleRoot(): string {
  return getModuleStorageRoot('EvidenceCollector');
}

/**
 * Per-tenant root under EC's module storage, keyed by tenant slug. Guards against
 * path traversal: a slug containing separators or a `..` segment (or one that
 * otherwise resolves outside the EC module root) is rejected rather than silently
 * escaping the module root.
 */
export function getEcTenantRoot(tenantSlug: string): string {
  if (typeof tenantSlug !== 'string' || tenantSlug.trim().length === 0) {
    throw new Error('EC tenant slug must be a non-empty string');
  }
  if (tenantSlug !== tenantSlug.trim()) {
    throw new Error(`EC tenant slug must not have leading/trailing whitespace: '${tenantSlug}'`);
  }
  // CUSTOMER_NAME_RESERVED_RE carries the 'g' flag (used elsewhere for .replace());
  // reset lastIndex before .test() so repeated calls don't skip ahead statefully.
  CUSTOMER_NAME_RESERVED_RE.lastIndex = 0;
  if (CUSTOMER_NAME_RESERVED_RE.test(tenantSlug) || tenantSlug.includes('..')) {
    throw new Error(`EC tenant slug contains disallowed characters (path traversal rejected): '${tenantSlug}'`);
  }

  const root = getEcModuleRoot();
  const resolved = path.resolve(root, tenantSlug);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`EC tenant slug '${tenantSlug}' resolves outside the EC storage root (path traversal rejected)`);
  }

  return resolved;
}

export function getTimestampedJsonFilename(type: string, artifactId?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${type}_${artifactId || timestamp}.json`;
}
