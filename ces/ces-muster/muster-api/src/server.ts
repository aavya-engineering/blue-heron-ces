// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import 'dotenv/config';
import { app } from './app.js';
import { createScheduler } from './services/schedulerService.js';
import { assertJwtSecretConfigured } from './lib/jwt.js';
import { initModuleSecrets, moduleSecretsPostureLine } from 'ces-shared/secrets';

// FIN-42 (SP-4): load the DPAPI module-secret store before any secret read (fail closed when present
// but unreadable); it never writes process.env. Then refuse to start without JWT_SECRET, as before.
initModuleSecrets();
console.log(moduleSecretsPostureLine());
assertJwtSecretConfigured();

const PORT = parseInt(process.env.PORT ?? '4000', 10);

app.listen(PORT, () => {
  console.log(`muster-api listening on port ${PORT}`);

  // G-MUSTER-PL-1 H3 + FIN-25: the self-driving annuity scheduler. It serves
  // EVERY tenant in ces.db (each ticked inside its own tenant scope); set
  // SCHEDULER_TENANT_ID to pin it to one tenant, or MUSTER_SCHEDULER=off to
  // disable it. Cadence via SCHEDULER_INTERVAL_MS (default 1h; the first tick
  // fires one interval after start). Nudges and reminders go to the simulated
  // mail outbox only (FD-6). The POST /tick routes remain available regardless.
  if ((process.env.MUSTER_SCHEDULER ?? 'on').toLowerCase() !== 'off') {
    const intervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '3600000', 10);
    const tenantId = process.env.SCHEDULER_TENANT_ID || undefined;
    createScheduler({ tenantId, intervalMs }).start();
    console.log(
      `[scheduler] started for ${tenantId ? `tenant ${tenantId}` : 'every tenant'}, every ${intervalMs}ms`
    );
  }
});
