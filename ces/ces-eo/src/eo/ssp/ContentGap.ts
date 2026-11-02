// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 (SC-5, SC-2 row 12): the one sentence EO writes where the organisation has supplied no content.
 * It replaces the "[MANUAL INPUT REQUIRED]" / "REQUIRES MANUAL INPUT" tokens. The scorecard counts
 * each occurrence of NOT_SUPPLIED as a content gap (it is not a placeholder).
 */
export const NOT_SUPPLIED = 'Not supplied by the organisation (content gap)';

/** "Not supplied by the organisation (content gap): <what>." */
export function notSupplied(what: string): string {
  return `${NOT_SUPPLIED}: ${what.replace(/[.\s]+$/, '')}.`;
}
