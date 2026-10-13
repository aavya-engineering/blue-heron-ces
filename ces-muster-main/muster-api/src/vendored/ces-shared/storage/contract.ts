// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// VENDORED from ces-shared@storage/contract.ts — adapted: removed DexieContract re-export (not needed by muster-api; avoids circular vendor dependency); added eslint-disable for no-control-regex (verbatim from source)
// FE-safe contract: pure strings and types only. Zero node:* imports.

export type CesModuleName = 'Planner' | 'Stamper' | 'EvidenceOps' | 'AdminOps';
export type PlannerArtifactCategory = 'inputs' | 'outputs';

export interface PlannerArtifactPathOptions {
  customerName: string;
  category?: PlannerArtifactCategory;
  filename?: string;
}

/** Env var that overrides the pipeline storage root on all platforms. */
export const CES_PIPELINE_ROOT_ENV = 'CES_PIPELINE_ROOT';

/** Default pipeline root used when CES_PIPELINE_ROOT is not set (Windows). */
export const DEFAULT_CES_PIPELINE_ROOT_WIN32 = 'C:\\CES_Pipeline';

/** Default pipeline root used when CES_PIPELINE_ROOT is not set (POSIX). */
export const DEFAULT_CES_PIPELINE_ROOT_POSIX = 'ces-pipeline';

/** Reserved-character pattern stripped by sanitizeCustomerName. */
// eslint-disable-next-line no-control-regex
export const CUSTOMER_NAME_RESERVED_RE = /[/\\<>|*?":\x00-\x1f]/g;

/** Fallback customer name when the sanitized result is empty. */
export const CUSTOMER_NAME_FALLBACK = 'unknown';
