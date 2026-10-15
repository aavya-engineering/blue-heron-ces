// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC entrypoint. Start (cwd = the ces-ec module root):  npx tsx src/index.ts
// Listens on EC_HOST:EC_PORT (default 127.0.0.1:4001), runs one index pass at startup,
// then every EC_INDEX_INTERVAL_MIN minutes (default 15).

import type { Server } from 'node:http';

import { createApp } from './app.js';
import { getHost, getIndexIntervalMin, getPort, isSimOnly } from './config.js';
import { IndexService } from './scheduler.js';
import { registryTenantResolver } from './simRail.js';

export interface RunningEc {
  server: Server;
  indexService: IndexService;
  close(): Promise<void>;
}

export async function startEc(opts: { port?: number; host?: string; intervalMin?: number } = {}): Promise<RunningEc> {
  const resolveTenant = registryTenantResolver();
  const indexService = new IndexService(resolveTenant);
  const app = createApp({ resolveTenant, indexService });
  const port = opts.port ?? getPort();
  const host = opts.host ?? getHost();

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.once('error', reject);
  });
  const addr = server.address();
  const shown = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : `${host}:${port}`;
  console.log(`[ces-ec] Evidence Collector listening on http://${shown} (mode: ${isSimOnly() ? 'sim-only' : 'live allowed'})`);

  // Startup pass runs after listen so /api/health answers immediately.
  void indexService
    .start(opts.intervalMin ?? getIndexIntervalMin())
    .then((outcomes) => {
      const summary = outcomes.map((o) => `${o.tenantSlug}=${o.outcome === 'indexed' ? o.result.run.status : o.outcome}`);
      console.log(`[ces-ec] startup index pass: ${summary.length ? summary.join(', ') : 'no tenants discovered'}`);
    })
    .catch((err) => console.error(`[ces-ec] startup index pass failed: ${(err as Error).message}`));

  return {
    server,
    indexService,
    close: () =>
      new Promise<void>((resolve) => {
        indexService.stop();
        server.close(() => resolve());
      }),
  };
}

const invokedDirectly = (() => {
  const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
  return /\/src\/index\.ts$|\/dist\/index\.js$/.test(entry);
})();

if (invokedDirectly) {
  startEc().catch((err) => {
    console.error(`[ces-ec] failed to start: ${(err as Error).message}`);
    process.exit(1);
  });
}
