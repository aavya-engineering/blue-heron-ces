// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import 'dotenv/config';
import { loadEoConfig } from './config/EoConfig.js';
import { createEoServer, getScheduledCaptureHandler } from './server/EoServer.js';

async function main() {
  console.log('Evidence Ops v0.1.0 — Starting...');

  const config = await loadEoConfig();
  console.log(`  Port: ${config.port}`);
  console.log(`  Registry: ${config.registryPath}`);
  console.log(`  Storage: ${config.storageRoot}`);

  if (config.tenantConfigPath) {
    console.log(`  Tenant config: ${config.tenantConfigPath}`);
  }
  if (config.tenantSlug) {
    console.log(`  Default tenant: ${config.tenantSlug}`);
  }
  const app = createEoServer(config);
  app.listen(config.port, () => {
    console.log(`  EO server listening on http://localhost:${config.port}`);
    console.log('  Ready.');

    // Start scheduled signal capture if configured
    const scheduledHandler = getScheduledCaptureHandler();
    if (scheduledHandler) {
      scheduledHandler.start();
    }
  });
}

main().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
