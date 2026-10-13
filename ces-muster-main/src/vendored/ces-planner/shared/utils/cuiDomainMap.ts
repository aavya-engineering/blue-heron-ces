// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/** CUI answer prefix → primary and adjacent CMMC domains */
export const CUI_DOMAIN_MAP: Record<string, { primary: string[]; adjacent: string[] }> = {
  'CUI.ID': {
    primary: ['AC', 'IA'],
    adjacent: ['AU'],
  },
  'CUI.DEV': {
    primary: ['AC', 'PE'],
    adjacent: ['CM', 'MA'],
  },
  'CUI.DEVOPS': {
    primary: ['CM', 'SA'],
    adjacent: ['AC', 'SI'],
  },
  'CUI.LC.EGR': {
    primary: ['AU', 'MP'],
    adjacent: ['SC'],
  },
  'CUI.LC.RET': {
    primary: ['AU', 'MP'],
    adjacent: ['SC'],
  },
  'CUI.GEN': {
    primary: ['SC'],
    adjacent: ['AC', 'SI'],
  },
  'CUI.USR': {
    primary: ['AT', 'PS'],
    adjacent: ['AC'],
  },
};
