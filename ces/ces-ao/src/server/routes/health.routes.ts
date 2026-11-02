// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router } from 'express';

/** SEC-4: auth posture on /api/health — "ENFORCED" when a bearer token is configured, else "LOOPBACK_TRUSTED". */
export type AoAuthPosture = 'ENFORCED' | 'LOOPBACK_TRUSTED';

export interface AoHealthPosture {
  auth: AoAuthPosture;
  bind: string;
}

// SEC-4: /api/health stays open (launchers poll it) and carries no tenant data — only these five keys.
export function createHealthRouter(registryLoaded: boolean, posture: AoHealthPosture) {
  const router = Router();

  router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '0.2.0', registryLoaded, auth: posture.auth, bind: posture.bind });
  });

  return router;
}
