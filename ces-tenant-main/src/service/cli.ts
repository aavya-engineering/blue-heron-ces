#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * `ces-tenant serve` -- M6 open decision 2, resolved at planning (see
 * docs/M6-RECORD.md): the daemon is started by an EXPLICIT user-run command
 * only, mirroring tenant-stacksim's `serve` (the goal's named precedent).
 * No module auto-spawns it; when it is not running, every module degrades to
 * the library transport (gate 3).
 *
 * Usage:
 *   npm run serve            # default port 4690
 *   npm run serve -- --port 5000
 *   node dist/service/cli.js serve [--port N]
 */

import { TenantServiceDaemon } from './server.js';
import { DEFAULT_TENANT_SERVICE_PORT } from './protocol.js';

function parsePort(argv: string[]): number {
  const idx = argv.findIndex((a) => a === '--port' || a === '-p');
  if (idx === -1) return DEFAULT_TENANT_SERVICE_PORT;
  const value = Number(argv[idx + 1]);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    console.error(`[ces-tenant] invalid --port value: ${argv[idx + 1]}`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Tolerate both `cli.js serve --port N` and `cli.js --port N`.
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';
  if (command !== 'serve') {
    console.error(`[ces-tenant] unknown command "${command}" -- only "serve" exists (M6 v1)`);
    process.exit(2);
  }

  const daemon = new TenantServiceDaemon({ port: parsePort(argv) });
  const port = await daemon.start();
  console.log(`[ces-tenant] status page: http://127.0.0.1:${port}/status`);

  const shutdown = async (): Promise<void> => {
    console.log('[ces-tenant] shutting down...');
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(`[ces-tenant] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
