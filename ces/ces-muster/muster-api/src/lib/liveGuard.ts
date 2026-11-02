// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveGuard.ts — FC-MU-2 test-safety guard for the live (non-sim) path.
// Under vitest (process.env.VITEST is set by the runner) any live side effect
// whose target is not localhost throws. The sim (127.0.0.1) stays reachable;
// a real Microsoft endpoint never is. Tests must inject fakes for live reads.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Under vitest, refuse any live side effect that is not localhost. */
export function assertNotLiveUnderTest(what: string, url?: string): void {
  if (!process.env.VITEST) return;
  if (url) {
    try {
      if (LOCAL_HOSTS.has(new URL(url).hostname)) return;
    } catch {
      // unparseable → refuse below
    }
  }
  throw new Error(`live path refused under test: ${what}${url ? ` (${url})` : ''} — inject a fake`);
}
