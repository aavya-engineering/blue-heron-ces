// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

// W8-SPA0 (AD-3): CES_STAMPER_UI=legacy|react. Legacy console at / (default); SPA at /app/.
export type StamperUiMode = 'legacy' | 'react';

export const SPA_BASE_PATH = '/app/';

export interface HealthUiInfo {
  mode: StamperUiMode;
  spaPath: string;
  /** True when the SPA build (public/app/index.html) is present. */
  spaBuilt: boolean;
}

export interface HealthSimulatorInfo {
  /** True when the GUI was launched with the stack-simulator environment (STACKSIM_SERVER_URL set). */
  active: boolean;
  serverUrl: string | null;
}

export function resolveStamperUiMode(env: NodeJS.ProcessEnv = process.env): StamperUiMode {
  return env['CES_STAMPER_UI'] === 'react' ? 'react' : 'legacy';
}

export function describeUi(publicDir: string, mode: StamperUiMode): HealthUiInfo {
  return {
    mode,
    spaPath: SPA_BASE_PATH,
    spaBuilt: fs.existsSync(path.join(publicDir, 'app', 'index.html')),
  };
}

// Launch environment as ces-tester's stamper-launcher (src/stamper-launcher/env.ts) and
// `gui --stacksim` set it: STACKSIM_SERVER_URL names the simulator server.
export function describeSimulator(env: NodeJS.ProcessEnv = process.env): HealthSimulatorInfo {
  const url = env['STACKSIM_SERVER_URL'];
  return { active: Boolean(url), serverUrl: url ? url : null };
}

/**
 * Mounted before the static middleware. `react` redirects / to /app/; /app/<route> (no file
 * extension) serves the SPA's index.html (history fallback). Assets fall through to static.
 */
export function createStamperUiRouter(publicDir: string, mode: StamperUiMode): Router {
  const router = Router();
  const spaIndex = path.join(publicDir, 'app', 'index.html');

  if (mode === 'react') {
    router.get('/', (_req: Request, res: Response) => {
      res.redirect(302, SPA_BASE_PATH);
    });
  }

  router.get(/^\/app\/(?:.*\/)?[^./]*$/, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(spaIndex, (err) => {
      if (err) next();
    });
  });

  return router;
}

export function createHealthRouter(
  cachedM365Registry: any,
  cachedInfraRegistry: any,
  cachedMergedRegistry: any,
  // FC-ST-3 step 1 (ST-16): surface the EC auto-start result (already_running|started|
  // autostart_disabled|failed) so the GUI/operator can see it without reading server logs.
  getEcAutostartStatus?: () => string,
  // W8-SPA0: read-only `ui` and `simulator` fields.
  getUiInfo?: () => HealthUiInfo,
  env: NodeJS.ProcessEnv = process.env
): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    const status = {
      status: 'ok',
      registries: {
        m365: cachedM365Registry !== null,
        infra: cachedInfraRegistry !== null,
        merged: cachedMergedRegistry !== null,
      },
      evidenceCollector: {
        autostart: getEcAutostartStatus ? getEcAutostartStatus() : 'not_checked',
      },
      ui: getUiInfo
        ? getUiInfo()
        : { mode: resolveStamperUiMode(env), spaPath: SPA_BASE_PATH, spaBuilt: false },
      simulator: describeSimulator(env),
      timestamp: new Date().toISOString(),
    };
    res.json(status);
  });

  return router;
}
