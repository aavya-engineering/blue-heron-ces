// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { defineConfig, devices } from '@playwright/test';

// FIN-31: the watched EO UI run (V124). It does NOT start EO: the run harness (FIN-35, agent H3)
// starts EO, EC and the simulator on run-scoped roots and passes EO_URL plus the run secrets. Never
// point it at a server on the founder's real roots.
//
// Watched by default (founder ruling: UI runs are headed, paced and captioned, with video and
// trace); CES_UI_HEADLESS=1 runs headless on request; CES_UI_SLOWMO sets the pacing (default 400 ms).
const headless = process.env.CES_UI_HEADLESS === '1';
const slowMoRaw = Number(process.env.CES_UI_SLOWMO);
const slowMo = Number.isFinite(slowMoRaw) ? slowMoRaw : headless ? 0 : 400;
const EO_URL = (process.env.EO_URL ?? 'http://127.0.0.1:5004').replace(/\/$/, '');
const OUTPUT_DIR = process.env.CES_UI_OUTPUT_DIR ?? 'C:/ces-nb/out/ui/eo/playwright';

export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  outputDir: OUTPUT_DIR,
  reporter: [['list']],
  use: {
    baseURL: `${EO_URL}/app/`,
    headless,
    launchOptions: { slowMo },
    video: 'on',
    trace: 'on',
    acceptDownloads: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'eo-watched', use: { ...devices['Desktop Chrome'] } }],
});
