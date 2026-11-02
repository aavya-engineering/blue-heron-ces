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

// FIN-30: the AO kit console's own Playwright specs (written, not run by the slice; FIN-35's harness
// runs the watched AO step). Specs are named *.e2e.ts so no Vitest run collects them.
//  - Watchable by default (founder 10-29): headed, paced, video and trace on. CES_UI_HEADLESS=1 for headless.
//  - The server is never reused (it could be on real roots) and needs run-scoped roots: the config
//    refuses to start unless CES_PIPELINE_ROOT and CES_TENANT_ROOT are set by the caller.
//  - CES_AO_E2E_PORT picks the port (default 5103, not the simulator's 4390).
const PORT = Number(process.env.CES_AO_E2E_PORT || 5103);
const ORIGIN = `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.CES_AO_E2E_OUT || 'C:/ces-nb/out/ui/ao/playwright';
const headless = process.env.CES_UI_HEADLESS === '1';

for (const key of ['CES_PIPELINE_ROOT', 'CES_TENANT_ROOT']) {
  if (!process.env[key]) throw new Error(`ces-ao/ui Playwright: set ${key} to a run-scoped folder first (test isolation).`);
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  outputDir: OUTPUT_DIR,
  reporter: [['list'], ['json', { outputFile: path.join(OUTPUT_DIR, 'results.json') }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `${ORIGIN}/app/`,
    headless,
    launchOptions: { slowMo: headless ? 0 : 400 },
    video: headless ? 'retain-on-failure' : 'on',
    trace: headless ? 'retain-on-failure' : 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // AO serves the built SPA (ces-ao/ui/dist) at /app/; build it first (`npm run build` here).
    command: `npm run gui -- --port ${PORT}`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${ORIGIN}/api/health`,
    env: { ...(process.env as Record<string, string>), CES_NO_OPEN: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
