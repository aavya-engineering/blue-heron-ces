// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30 test helper (tests only), as Stamper's ui/src/screens/console/axe-helper.ts: axe ids of
// serious or critical findings. color-contrast is off because jsdom computes no colours.

import axe from 'axe-core';

export async function seriousAxe(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}
