#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
/**
 * index.ts — entry point for the `eo` CLI (package.json bin). All logic lives in eo.ts.
 */

import { initModuleSecrets } from 'ces-shared/secrets';
import { runEo } from './eo.js';

// process.exitCode, not process.exit(): Node 24 on Windows aborts (libuv UV_HANDLE_CLOSING) when exit runs
// while fetch's keep-alive sockets are closing; letting the loop drain avoids it (R-F1 V87).
// FIN-42 (SP-4): load the DPAPI module-secret store first, so runEo's default env (secretEnv()) sees
// CES_EO_AUTH_TOKEN from it. No store: the environment is used, as before. An unreadable store fails closed.
Promise.resolve().then(() => {
  initModuleSecrets();
  return runEo(process.argv.slice(2));
}).then((code) => {
  process.exitCode = code;
}).catch((err: unknown) => {
  process.stderr.write(JSON.stringify({ error: String(err) }) + '\n');
  process.exitCode = 1;
});
