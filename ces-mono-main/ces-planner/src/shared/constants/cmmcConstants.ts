// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export const LEVEL_HIERARCHY: Record<string, string[]> = {
  L1: ['L1'],
  L2: ['L1', 'L2'],
  L3: ['L1', 'L2', 'L3'],
};

export const DOMAIN_NAMES: Record<string, string> = {
  AC: 'Access Control',
  AT: 'Awareness & Training',
  AU: 'Audit & Accountability',
  CA: 'Security Assessment',
  CM: 'Configuration Management',
  IA: 'Identification & Authentication',
  IR: 'Incident Response',
  MA: 'Maintenance',
  MP: 'Media Protection',
  PE: 'Physical Protection',
  PS: 'Personnel Security',
  RA: 'Risk Assessment',
  SC: 'System & Comms Protection',
  SI: 'System & Info Integrity',
  SR: 'Supply Chain Risk Management',
};

/**
 * NIST SP 800-171 Rev 2 base IDs whose canonical CMMC L2-assessment control
 * retains the L1 prefix even though the requirements YAML also contains a
 * duplicate L2 entry.  For these 17 controls the correct requirement_id in
 * all CES artifacts (dispositions, scope exclusions, Stamper export) is the
 * L1 variant — e.g. PE.L1-3.10.1, NOT PE.L2-3.10.1.
 *
 * Source: CMMC L2 Scoping Guide — "FCI Controls" inherited into L2.
 *
 *   AC:  3.1.1, 3.1.2, 3.1.20, 3.1.22
 *   IA:  3.5.1, 3.5.2
 *   MP:  3.8.3
 *   PE:  3.10.1, 3.10.3, 3.10.4, 3.10.5
 *   SC:  3.13.1, 3.13.5
 *   SI:  3.14.1, 3.14.2, 3.14.4, 3.14.5
 */
export const L1_CANONICAL_IN_L2 = new Set([
  '3.1.1', '3.1.2', '3.1.20', '3.1.22',
  '3.5.1', '3.5.2',
  '3.8.3',
  '3.10.1', '3.10.3', '3.10.4', '3.10.5',
  '3.13.1', '3.13.5',
  '3.14.1', '3.14.2', '3.14.4', '3.14.5',
]);

export const GAP_CLASS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  configure: { bg: '#d1fae5', text: '#065f46', label: 'Configure' },
  customize: { bg: '#dbeafe', text: '#1e40af', label: 'Customize' },
  manual: { bg: '#fef3c7', text: '#92400e', label: 'Manual' },
  auto_generate: { bg: '#d1fae5', text: '#065f46', label: 'Auto-Generated' },
  manual_alternative: { bg: '#fef3c7', text: '#92400e', label: 'Manual Alternative' },
  control_not_available: { bg: '#fef2f2', text: '#991b1b', label: 'Not Available' },
  scoped_out: { bg: '#f3f4f6', text: '#6b7280', label: 'Scoped Out (N/A)' },
};
