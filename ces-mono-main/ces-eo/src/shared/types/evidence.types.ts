// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extended evidence types for directive-aware evidence files.
 * The base DirectiveMetadata lives in ces-shared/types/evidence.
 * This file defines DirectiveEvidence which wraps evidence with optional directive metadata.
 */

import type { ExtendedDirectiveMetadata } from './directive.types.js';

export interface DirectiveEvidence {
  control_id: string;
  captured_at: string;
  source: 'ec_capture' | 'discovery' | 'manual';
  directive_metadata?: ExtendedDirectiveMetadata;
}

export interface MechanismStatus {
  ca_app_control_active: boolean;
  ca_non_browser_block_active: boolean;
  dlp_active: boolean;
  sensitivity_labels_active: boolean;
}

export interface ArchitectureMetadata {
  architecture_declared: 'session_controlled_byod' | 'allowed_vdi_only' | 'no_mobile_devices';
  directive: 'validate' | 'document-prohibition' | 'implement' | 'skip';
  enforcement_verified: boolean;
  verification_date: string;
  mechanism_status: MechanismStatus;
  tenant_variant: 'GCC High' | 'Commercial';
  azure_resources_present: boolean;
  ca_app_control_policies_summary?: string;
  non_browser_block_policy_summary?: string;
  dlp_policies_summary?: string;
  sensitivity_labels_summary?: string;
  gap_description_dlp?: string;
  poam_id?: string;
}
