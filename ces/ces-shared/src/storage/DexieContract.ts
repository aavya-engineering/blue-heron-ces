// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe Dexie contract. Zero node:* imports.
// Pinned to the exact current value in ces-planner/src/shared/db/schema.ts.

import type { PlannerArtifactPathOptions } from './contract.js';

/** Dexie database name — must match the literal in AppDatabase constructor exactly. */
export const PLANNER_DEXIE_DB_NAME = 'CMMCComplianceTool';

/** Current schema version — matches the highest .version() call in AppDatabase. */
export const PLANNER_DEXIE_DB_VERSION = 6;

/**
 * Maps each Dexie store name to a deterministic FS sub-path under
 * getPlannerCustomerRoot(customerName). The actual absolute path is resolved
 * at runtime by Node-side helpers (see node.ts) and must not be computed here.
 */
export const PLANNER_DEXIE_STORE_TO_FS_PATH: Record<string, string> = {
  si_baselines: 'inputs/si-baselines',
  cui_boundaries: 'outputs/cui-boundaries',
  btc_confirmations: 'outputs/btc-confirmations',
  tenant_config_profiles: 'outputs/tenant-config-profiles',
  policy_inputs: 'inputs/policy-inputs',
  readiness_postures: 'outputs/readiness-postures',
};

// Re-export PlannerArtifactPathOptions so consumers can import from a single FE-safe path.
export type { PlannerArtifactPathOptions };
