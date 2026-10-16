// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Single source of truth: ces-shared/config
import {
  type TenantConfig,
  loadTenantConfig,
} from 'ces-shared/config';
import { resolveTenantRecordPath } from '../tenant/stamperTenants.js';
export type { EvidenceStorageConfig } from 'ces-shared/config';

// Type alias — existing code continues to reference ClientConfig unchanged
export type ClientConfig = TenantConfig;

// Re-export loader under old name
export const loadClientConfigFromTenantJson = loadTenantConfig;

/**
 * Resolve a tenant slug to its on-disk config path — registry-backed since
 * the G-TENANT-M1 cutover: delegates to the `ces-tenant` registry API
 * (back-compat read order + forward migration included). Async because the
 * registry lifecycle surface is async; call sites `await` it.
 */
export function resolveTenantJsonPath(slug: string): Promise<string> {
  return resolveTenantRecordPath(slug);
}

// Stamper-specific: dotenv-based loader (CLI bootstrap only)
export { loadClientConfig } from './dotenvLoader.js';
