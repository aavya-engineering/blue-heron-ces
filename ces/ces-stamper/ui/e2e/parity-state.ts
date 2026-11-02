// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Run-scoped on-disk state for the parity GUI server (W8-PIS). The server reads and writes
// CES_PIPELINE_ROOT (default %LOCALAPPDATA%\CES\pipeline: Stamper plan-data, evidence, logs,
// state, variables.json, ces.db) and CES_TENANT_ROOT (default ~/.ces/tenants: the tenant
// registry). Both point under PARITY_STATE_ROOT, which is wiped and seeded before the server
// starts. Playwright starts webServer before globalSetup, so the wipe runs as the first half of
// the webServer command (`npx tsx ui/e2e/parity-state.ts && npm run gui ...`), never while the
// server holds ces.db open. Run with --wipe, this file wipes and seeds; imported, it only exports.

import * as fs from 'node:fs';
import * as path from 'node:path';

export const PARITY_STATE_ROOT = 'C:/ces-nb/out/ui/parity-state';
export const PARITY_PIPELINE_ROOT = `${PARITY_STATE_ROOT}/pipeline`;
export const PARITY_TENANT_ROOT = `${PARITY_STATE_ROOT}/tenants`;

/** The one non-dev tenant record the parity server lists (fictional; FG-4 selects it). */
export const SEED_TENANT_SLUG = 'parity-larkspur';

export const SEED_TENANT_RECORD = {
  kind: 'live',
  client: { slug: SEED_TENANT_SLUG, name: 'Larkspur Avionics (fictional)' },
  tenant: { tenant_id: '00000000-0000-4000-8000-0000000000a1', domain: 'larkspur.example', environment: 'gcchigh' },
  auth: { app_id: '00000000-0000-4000-8000-0000000000a2', cert_path: 'C:\\fixture\\certs\\larkspur.pfx', cert_thumbprint: 'FIXTURE0000000000000000000000000000000000' },
};

/** Environment for the GUI server: run-scoped roots, and no browser tab on start (GuiServer.ts:438). */
export function parityServerEnv(): Record<string, string> {
  return {
    CES_PIPELINE_ROOT: PARITY_PIPELINE_ROOT,
    CES_TENANT_ROOT: PARITY_TENANT_ROOT,
    STORAGE_ROOT: `${PARITY_PIPELINE_ROOT}/Stamper/storage`,
    CES_STAMPER_PLAN_DATA_ROOT: `${PARITY_STATE_ROOT}/repo-plan-data`,
    CES_NO_OPEN: '1',
  };
}

/** Refuses any root outside C:/ces-nb/out/ui/ (fail closed: never wipe a real location). */
function assertScoped(root: string): void {
  const resolved = path.resolve(root).toLowerCase();
  const allowed = path.resolve('C:/ces-nb/out/ui').toLowerCase() + path.sep;
  if (!resolved.startsWith(allowed)) throw new Error(`parity state root ${root} is outside C:/ces-nb/out/ui/`);
}

/** Wipes PARITY_STATE_ROOT and seeds the tenant registry and an empty dev evidence store. */
export function wipeAndSeed(root: string = PARITY_STATE_ROOT): void {
  assertScoped(root);
  fs.rmSync(root, { recursive: true, force: true });
  const tenantRoot = path.join(root, 'tenants');
  fs.mkdirSync(path.join(tenantRoot, 'sim'), { recursive: true });
  fs.mkdirSync(path.join(tenantRoot, 'live'), { recursive: true });
  fs.writeFileSync(path.join(tenantRoot, 'live', `${SEED_TENANT_SLUG}.json`), `${JSON.stringify(SEED_TENANT_RECORD, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'pipeline', 'Stamper', 'plan-data', 'dev', 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pipeline', 'Stamper', 'storage'), { recursive: true });
}

/** The `--output` / `-o` directory from a Playwright command line, if one was given. */
export function outputDirFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--output' || arg === '-o') return argv[i + 1];
    if (arg.startsWith('--output=')) return arg.slice('--output='.length);
  }
  return undefined;
}

if (process.argv.includes('--wipe')) {
  wipeAndSeed();
  console.log(`[parity-state] wiped and seeded ${PARITY_STATE_ROOT}`);
}
