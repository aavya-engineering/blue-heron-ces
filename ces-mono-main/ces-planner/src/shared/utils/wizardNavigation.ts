// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Shared navigation helper for wizards that auto-skip derived questions.
 *
 * Walks forward or backward from `currentIndex`, skipping any index where
 * `isSkipped(index)` returns true.
 *
 * @returns The next non-skipped index, or `null` if all remaining are skipped.
 */
export function findNextUnskipped(
  currentIndex: number,
  totalCount: number,
  isSkipped: (index: number) => boolean,
  direction: 'forward' | 'backward',
): number | null {
  const step = direction === 'forward' ? 1 : -1;
  let idx = currentIndex + step;

  while (idx >= 0 && idx < totalCount) {
    if (!isSkipped(idx)) return idx;
    idx += step;
  }

  return null;
}
