// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31: the EO kit UI (ces-eo/ui, built into public/app) is served at /app/, as Stamper's SPA is
// (ces-stamper health.routes.ts createStamperUiRouter). The legacy console stays at /.
//
//   GET /app/<route>   (no file extension) -> public/app/index.html (history fallback); assets fall
//                      through to the existing express.static(publicDir)
//   GET /api/ui/info   read-only: the SPA build state, whether EO runs against the simulator, and
//                      whether two-person approval is on (FINISH-PLAN ruling: off unless
//                      CES_TWO_PERSON_APPROVAL=1; the UI hides two-person controls while off)

import * as fs from 'node:fs';
import * as path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { secretEnv } from 'ces-shared/secrets';
import { uploaderIssuerConfigured } from '../../uploader-tokens/UploaderTokenIssuer.js';

export const EO_SPA_BASE_PATH = '/app/';

export interface EoUiInfo {
  spaPath: string;
  spaBuilt: boolean;
  simulator: { active: boolean };
  twoPersonApproval: boolean;
  uploaderTokenIssuer: boolean;
}

export function describeEoUi(publicDir: string, env: Record<string, string | undefined> = secretEnv()): EoUiInfo {
  return {
    spaPath: EO_SPA_BASE_PATH,
    spaBuilt: fs.existsSync(path.join(publicDir, 'app', 'index.html')),
    simulator: { active: Boolean(env.STACKSIM_SERVER_URL) },
    twoPersonApproval: env.CES_TWO_PERSON_APPROVAL === '1',
    uploaderTokenIssuer: uploaderIssuerConfigured(env),
  };
}

/** Mount BEFORE express.static(publicDir). */
export function createEoUiRouter(publicDir: string, env?: Record<string, string | undefined>): express.Router {
  const router = express.Router();
  const spaIndex = path.join(publicDir, 'app', 'index.html');

  router.get(/^\/app(?:\/(?:.*\/)?[^./]*)?$/,(_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(spaIndex, (err) => {
      if (err) next();
    });
  });

  router.get('/api/ui/info', (_req: Request, res: Response) => {
    res.json(describeEoUi(publicDir, env ?? secretEnv()));
  });

  return router;
}
