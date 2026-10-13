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

const PORT = parseInt(process.env.PORT ?? '4000', 10);

app.listen(PORT, () => {
  console.log(`muster-api listening on port ${PORT}`);

  // G-MUSTER-PL-1 H3: optional self-driving annuity scheduler for ONE configured
  // operator tenant. Off unless SCHEDULER_TENANT_ID is set (the cross-tenant
  // GLOBAL tick stays excluded — X11). Cadence via SCHEDULER_INTERVAL_MS
  // (default 1h). The POST /tick routes remain available regardless.
  const schedulerTenantId = process.env.SCHEDULER_TENANT_ID;
  if (schedulerTenantId) {
    const intervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '3600000', 10);
    createScheduler({ tenantId: schedulerTenantId, intervalMs }).start();
    console.log(
      `[scheduler] started for tenant ${schedulerTenantId}, every ${intervalMs}ms`
    );
  }
});
