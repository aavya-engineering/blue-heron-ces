// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parityWatchOptions } from './e2e/parity/harness';
import { outputDirFromArgv, parityServerEnv } from './e2e/parity-state';

const PORT = 5102;
const ORIGIN = `http://localhost:${PORT}`;

// Outputs (traces, videos, .last-run.json) and the JSON report of per-test durations go to the
// same directory: `--output <dir>` when given, else the default below (W8-PIS).
const OUTPUT_DIR = outputDirFromArgv(process.argv) ?? 'C:/ces-nb/out/ui/parity/playwright';

// Headless, no slow-mo, video and trace on failure, unless CES_UI_WATCH=1 (harness.ts).
const watch = parityWatchOptions();

// One Stamper GUI server serves both consoles (AD-3): legacy at /, SPA at /app/.
// The parity harness runs each spec under both projects and compares (AD-4).
// The server runs on run-scoped roots under C:/ces-nb/out/ui/parity-state/, wiped and seeded by
// the first half of its command (Playwright starts webServer before globalSetup); globalSetup
// then checks the server on the port is that one. Never reuse a running server: it could be on
// the founder's real roots.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  globalTimeout: 7_200_000,
  fullyParallel: false,
  workers: 1,
  outputDir: OUTPUT_DIR,
  reporter: [['list'], ['json', { outputFile: path.join(OUTPUT_DIR, 'results.json') }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    headless: watch.headless,
    launchOptions: { slowMo: watch.slowMo },
    video: watch.video,
    trace: watch.trace,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `npx tsx ui/e2e/parity-state.ts --wipe && npm run gui -- --port ${PORT}`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${ORIGIN}/health`,
    env: parityServerEnv(),
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'legacy',
      use: { ...devices['Desktop Chrome'], baseURL: `${ORIGIN}/` },
    },
    {
      name: 'react',
      use: { ...devices['Desktop Chrome'], baseURL: `${ORIGIN}/app/` },
    },
  ],
});
