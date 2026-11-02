// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { runInventoryExtraction } from '../../coverage/InventoryExtractor.js';

/** `stacksim inventory` - G-STACKSIM-2 iteration 1: extract every distinct
 *  call from Stamper/EO/AO's real source and write coverage/inventory.json. */
export async function runInventory(): Promise<void> {
  const { report, outPath } = await runInventoryExtraction();
  console.log(`stacksim inventory: wrote ${outPath}`);
  console.log(`  stamper: ${report.counts.stamper}`);
  console.log(`  eo:      ${report.counts.eo}`);
  console.log(`  ao:      ${report.counts.ao}`);
  console.log(`  total:   ${report.items.length}`);
}
