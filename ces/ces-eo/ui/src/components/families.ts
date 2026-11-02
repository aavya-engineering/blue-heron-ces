// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the 14 CMMC L2 families in legacy order with legacy display names (public/index.html FAMILIES).

export const FAMILIES: ReadonlyArray<{ abbr: string; name: string }> = [
  { abbr: 'AC', name: 'Access Control' },
  { abbr: 'AT', name: 'Awareness & Training' },
  { abbr: 'AU', name: 'Audit & Accountability' },
  { abbr: 'CM', name: 'Config Management' },
  { abbr: 'IA', name: 'Identification & Auth' },
  { abbr: 'IR', name: 'Incident Response' },
  { abbr: 'MA', name: 'Maintenance' },
  { abbr: 'MP', name: 'Media Protection' },
  { abbr: 'PE', name: 'Physical Protection' },
  { abbr: 'PS', name: 'Personnel Security' },
  { abbr: 'RA', name: 'Risk Assessment' },
  { abbr: 'CA', name: 'Security Assessment' },
  { abbr: 'SC', name: 'Systems & Comms' },
  { abbr: 'SI', name: 'System & Info Integrity' },
];

export const familyName = (abbr: string): string => FAMILIES.find((f) => f.abbr === abbr)?.name ?? abbr;

/** Legacy approach label from the control's classification. */
export function approachLabel(classification: string | undefined): string {
  return classification === 'automated' ? 'AUTOMATED' : classification === 'nonstack' ? 'NON-STACK' : 'EXCLUDED';
}
