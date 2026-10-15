// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ControlStatus } from 'ces-shared/types/controls';

export interface PartialCreditRule {
  nist_ref: string;
  threshold: number;
  metric: string;
}

/**
 * Maps Graph API compliance states to CMMC ControlStatus values.
 */
export function translateGraphStatus(
  graphState: string,
  partialRules?: PartialCreditRule
): ControlStatus {
  switch (graphState.toLowerCase()) {
    case 'compliant':
      return 'met';
    case 'notcompliant':
    case 'not_compliant':
      return 'not_met';
    case 'conflict':
      return 'partial';
    case 'notapplicable':
    case 'not_applicable':
      return 'not_assessed';
    case 'unknown':
    default:
      return 'not_assessed';
  }
}

/**
 * Applies partial credit rules for controls that require coverage thresholds.
 * For example, SC.L2-3.13.11 requires 100% device coverage for full credit.
 */
export function applyPartialCredit(
  baseStatus: ControlStatus,
  coveragePercent: number,
  rule: PartialCreditRule
): ControlStatus {
  if (baseStatus === 'not_met') return 'not_met';

  if (coveragePercent >= rule.threshold) {
    return 'met';
  } else if (coveragePercent > 0) {
    return 'partial';
  }
  return 'not_met';
}
