// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router, Request, Response } from 'express';

export function createHealthRouter(
  cachedM365Registry: any,
  cachedInfraRegistry: any,
  cachedMergedRegistry: any,
  // FC-ST-3 step 1 (ST-16): surface the EC auto-start result (already_running|started|
  // autostart_disabled|failed) so the GUI/operator can see it without reading server logs.
  getEcAutostartStatus?: () => string
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
      timestamp: new Date().toISOString(),
    };
    res.json(status);
  });

  return router;
}
