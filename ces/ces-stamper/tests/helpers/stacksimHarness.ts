// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test harness: an in-process tenant-stacksim server (the local simulated Microsoft
// tenant) seeded into a temp tenant root, plus the PowerShell shadow environment
// (PSModulePath -> stacksim fake modules, STACKSIM_SERVER_URL -> this server) so the
// PowerShell that Stamper's adapter spawns directly resolves against the sim.
//
// LIMIT: jest gives each test file a sandboxed copy of process.env. The adapter passes
// that env to its child explicitly; ces-shared's SessionManager (session-host.ps1, the
// LIVE path) does not, so a live-path spawn inside jest would load the REAL Microsoft
// modules. Route tests must therefore never take the live (non-dry-run tenant) path.
//
// Read-only use of the sibling tenant-stacksim build (dist/) — nothing is written into
// that project; the tenant store/ledger live in an os.tmpdir() directory removed on stop().
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const STACKSIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tenant-stacksim');

const dist = (p: string) => pathToFileURL(path.join(STACKSIM_ROOT, 'dist', 'src', p)).href;

export interface SimStore {
  read(collection: string, id: string): Promise<Record<string, any> | undefined>;
}

export interface SimLedgerEntry { type: string; [k: string]: unknown }

export interface StacksimHarness {
  port: number;
  url: string;
  store: SimStore;
  ledgerEntries(type?: string): Promise<SimLedgerEntry[]>;
  /** Arm deterministic faults (POST /_faults); [] clears. */
  setFaults(rules: Array<{ target: string; kind: 'throttle' | 'transient' | 'malformed'; times?: number | 'always' }>): Promise<void>;
  /** Env vars that shadow PowerShell onto this sim. */
  shadowEnv: Record<string, string>;
  stop(): Promise<void>;
}

let psHomeModulesCache: string | undefined;
function psHomeModules(): string {
  if (!psHomeModulesCache) {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSHOME'], { encoding: 'utf-8' });
    psHomeModulesCache = path.join(String(out.stdout).trim(), 'Modules');
  }
  return psHomeModulesCache;
}

export async function startStacksim(slug = 'sim-m365-azure', stance = 'm365_azure'): Promise<StacksimHarness> {
  const { startServe } = await import(dist('cli/commands/serve.js'));
  const { SeedEngine } = await import(dist('seed/SeedEngine.js'));
  const { loadProfile, resolveProfilePath } = await import(dist('profiles/ProfileLoader.js'));

  const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-stacksim-'));
  const profilesDir = path.join(STACKSIM_ROOT, 'profiles');
  const profile = await loadProfile(resolveProfilePath(stance, profilesDir));
  const handle = await startServe({ stance, slug, port: 0, profilesDir, tenantRoot });
  await new SeedEngine(handle.store, handle.ledger).seed(profile);

  const url = `http://127.0.0.1:${handle.port}`;
  return {
    port: handle.port,
    url,
    store: handle.store,
    ledgerEntries: async (type?: string) => handle.ledger.query(type ? { type } : {}),
    setFaults: async (rules) => {
      const res = await fetch(`${url}/_faults`, { method: 'POST', body: JSON.stringify(rules) });
      if (!res.ok) throw new Error(`stacksim /_faults ${res.status}: ${await res.text()}`);
    },
    shadowEnv: {
      PSModulePath: `${path.join(STACKSIM_ROOT, 'psmodules')};${psHomeModules()}`,
      STACKSIM_SERVER_URL: url,
    },
    stop: async () => {
      await handle.stop();
      fs.rmSync(tenantRoot, { recursive: true, force: true });
    },
  };
}

/** Apply env vars to process.env; returns a restore function. */
export function applyEnv(vars: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
