// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
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

export function getStamperTenantRoot(tenantSlug: string): string {
  return path.join(getStamperPlanDataRoot(), tenantSlug);
}

export function getStamperTenantSubdir(
  tenantSlug: string,
  subdir: 'plans' | 'evidence' | 'logs' | 'state',
): string {
  return path.join(getStamperTenantRoot(tenantSlug), subdir);
}

export function getTimestampedJsonFilename(type: string, artifactId?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${type}_${artifactId || timestamp}.json`;
}
