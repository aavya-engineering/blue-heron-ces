// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { AutomationType } from '../core/CmmcComplianceAnalyzer.js';

/**
 * Priority ranking for gap remediation
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Represents a single gap entry (registry entry that is not satisfied).
 * Enriches ControlEntryDetail with additional fields needed for remediation planning.
 */
export interface GapEntry {
  entry_id: string;
  label: string;
  engine: string;
  status: 'missing' | 'error' | 'no_query' | 'not_checked' | 'exists_not_sat';
  verdict?: 'SAT' | 'NOT_SAT';
  reason: string;
  manual_only: boolean;
  layer_hint: number;
  variables_required: string[];
  captures: string[];
  control_ids: string[];
}

/**
 * Represents a CMMC control with associated gap entries.
 */
export interface GapControl {
  control_id: string;
  family: string;
  cmmc_level: number;
  nist_ref: string;
  practice: string;
  priority: Priority;
  automation_type: AutomationType;
  gap_entries: GapEntry[];
}

/**
 * Impact matrix: maps each entry_id to the controls it would satisfy.
 */
export interface ImpactMatrix {
  [entry_id: string]: string[];
}

/**
 * Summary statistics for the gap remediation plan.
 */
export interface GapSummary {
  total_controls_with_gaps: number;
  total_gap_entries: number;
  by_priority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  by_status: {
    missing: number;
    error: number;
    no_query: number;
    not_checked: number;
    exists_not_sat: number;
  };
  manual_only_count: number;
  automated_count: number;
}

/**
 * Complete gap remediation plan with all metadata.
 */
export interface GapRemediationPlan {
  timestamp: string;
  tenant_slug: string;
  infrastructure_model: string;
  summary: GapSummary;
  gap_controls: GapControl[];
  execution_order: string[];
  impact_matrix: ImpactMatrix;
}
