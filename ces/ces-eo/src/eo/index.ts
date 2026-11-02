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
import { initModuleSecrets, moduleSecretsPostureLine } from 'ces-shared/secrets';

async function main() {
  console.log('Evidence Ops v0.1.0 — Starting...');
  // FIN-42 (SP-4): load the DPAPI module-secret store before any secret read; fail closed on a
  // present-but-unreadable store. It never writes process.env (read sites use secretEnv()).
  initModuleSecrets();
  console.log(`  ${moduleSecretsPostureLine()}`);

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
  // SEC-4 (revised 10-30, founder: no loopback-only default): every interface, as before, unless
  // CES_EO_BIND names one address. Network callers are gated by the bearer token.
  const host = process.env.CES_EO_BIND;
  const onListen = () => {
    console.log(`  EO server listening on http://localhost:${config.port} (bind ${host ?? 'all'})`);
    console.log('  Ready.');

    // Start scheduled signal capture if configured
    const scheduledHandler = getScheduledCaptureHandler();
    if (scheduledHandler) {
      scheduledHandler.start();
    }
  };
  if (host) app.listen(config.port, host, onListen);
  else app.listen(config.port, onListen);
}

main().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
