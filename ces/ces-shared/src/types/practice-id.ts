// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Practice-id normaliser (EVC.6, R-4). The ces-shared controls reference spells
// the 17 Level 1 practices `AC.L1-3.1.1`; the CMMC Level 2 Assessment Guide
// v2.13 labels every practice `L2` (`AC.L2-3.1.1`). Code keys by NIST number,
// so both spellings resolve to the same entry. See README "Practice-id
// convention". Zero imports.

/**
 * `AC.L1-3.1.1`, `AC.L2-3.1.1`, `AC.L2-3.1.1#E01` and `3.1.1` all -> `3.1.1`:
 * the part after the first dash, with any `#E<nn>` definition suffix or
 * `[x]` objective suffix removed.
 */
export function normalizePracticeId(id: string): string {
  const dash = id.indexOf('-');
  const tail = dash === -1 ? id : id.slice(dash + 1);
  return tail.replace(/[#[].*$/, '');
}
