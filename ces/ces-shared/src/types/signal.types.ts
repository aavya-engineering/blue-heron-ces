// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface SignalResult {
  signalId: string;
  source: 'graph' | 'powershell' | 'manual';
  endpoint: string;
  timestamp: string;
  rawData: unknown;
  status: 'success' | 'error' | 'not_assessed';
  error?: string;
  parsed?: Record<string, unknown>;
  complianceState?: 'compliant' | 'non_compliant' | 'unknown';
  findings?: string[];
  metadata?: {
    threshold?: number;
    compliantCount?: number;
    totalCount?: number;
    [key: string]: unknown;
  };
}
