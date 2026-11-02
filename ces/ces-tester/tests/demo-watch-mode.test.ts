// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M1 — argv -> browser visibility. The acceptance line the demo
// depends on is "headless stays the default": every unattended path (run-all,
// CI, the unwatched demo) must never pop a window, and only an explicit
// `--watch` flips it headed with a human-followable slowMo.
import { describe, it, expect } from 'vitest';
import {
  resolveWatchMode,
  HEADLESS_MODE,
  WATCHED_MODE,
  WATCH_SLOW_MO_MS,
  type WatchMode,
} from '../src/demo/watch-mode.js';

describe('resolveWatchMode', () => {
  it('defaults to headless with no slow-motion when argv is empty', () => {
    expect(resolveWatchMode([])).toEqual({ headless: true, slowMo: 0 });
  });

  it('stays headless for unrelated flags (only --watch opts in)', () => {
    expect(resolveWatchMode(['--config', 'demo-dib-small', '--force'])).toEqual({
      headless: true,
      slowMo: 0,
    });
  });

  it('--watch turns the browser visible with a 250ms slowMo', () => {
    expect(resolveWatchMode(['--watch'])).toEqual({ headless: false, slowMo: WATCH_SLOW_MO_MS });
    expect(WATCH_SLOW_MO_MS).toBe(250);
  });

  it('detects --watch anywhere in argv, not just first', () => {
    expect(resolveWatchMode(['demo:e2e', '--config', 'demo-dib-small', '--watch'])).toEqual(
      WATCHED_MODE,
    );
  });

  it('does not match near-miss flags (--watchdog, --no-watch)', () => {
    expect(resolveWatchMode(['--watchdog'])).toEqual(HEADLESS_MODE);
    expect(resolveWatchMode(['--no-watch'])).toEqual(HEADLESS_MODE);
  });

  it('is shaped as a Playwright launch-options subset (spreadable into chromium.launch)', () => {
    const watch: WatchMode = resolveWatchMode(['--watch']);
    const launchOptions = { ...watch };
    expect(launchOptions).toEqual({ headless: false, slowMo: 250 });
  });
});
