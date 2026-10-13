// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M1 — the `--watch` visibility toggle.
 *
 * Headless is the default for every Playwright leg: CI, run-all and the
 * unattended demo path must never pop a browser window. `--watch` is the
 * operator-facing opt-in that makes each leg visible on stage (headed, with a
 * slow-motion delay between actions so a human can follow the drive).
 *
 * `WatchMode` is deliberately shaped as a Playwright launch-options subset, so
 * every driver can spread it straight into `chromium.launch({ ...watch })`.
 */

/** Slow-motion delay (ms) applied between Playwright actions under `--watch`. */
export const WATCH_SLOW_MO_MS = 250;

export interface WatchMode {
  /** Headless is the default; `--watch` flips it to a visible browser. */
  readonly headless: boolean;
  /** Playwright `slowMo` (ms) — 0 unless watching. */
  readonly slowMo: number;
}

/** Headless default, shared by every leg that is not explicitly watching. */
export const HEADLESS_MODE: WatchMode = { headless: true, slowMo: 0 };

/** Visible, human-followable drive — `--watch`. */
export const WATCHED_MODE: WatchMode = { headless: false, slowMo: WATCH_SLOW_MO_MS };

/** argv -> browser visibility. Headless unless `--watch` is present. */
export function resolveWatchMode(argv: readonly string[]): WatchMode {
  return argv.includes('--watch') ? WATCHED_MODE : HEADLESS_MODE;
}
