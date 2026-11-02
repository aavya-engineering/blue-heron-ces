// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../../src/cli/commands/seed.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { TenantLockedError, TENANT_LOCK_FILENAME } from '../../src/store/TenantLock.js';

/**
 * backlog-S1 regression test (BACKLOG.md § S1, acceptance criterion 3):
 * a concurrent `serve` + `seed`/`scenario` invocation against the same
 * tenant cannot interleave writes — the serve process holds the exclusive
 * tenant lock for its lifetime and every other writer fails loudly.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SCENARIOS_DIR = path.join(SIM_ROOT, 'scenarios');

describe('backlog-S1: single-writer guarantee for store.json/ledger.jsonl', () => {
  let dir: string;
  let tenantRoot: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s1-'));
    tenantRoot = path.join(dir, 'tenant');
  });

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('seed against a live-served tenant fails loudly; succeeds after stop', async () => {
    handle = await startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot });

    await expect(
      seedTenant({ stance: 'm365_azure', slug: 's1', profilesDir: PROFILES_DIR, tenantRoot }),
    ).rejects.toThrow(TenantLockedError);

    await handle.stop();
    handle = undefined;

    const result = await seedTenant({ stance: 'm365_azure', slug: 's1', profilesDir: PROFILES_DIR, tenantRoot });
    expect(result.counts.users).toBeGreaterThan(0);
  });

  it('scenario rebuild against a live-served tenant fails loudly and does NOT wipe the tenant', async () => {
    handle = await startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    // Server-owned write so store.json exists on disk before the attack.
    await handle.store.create('users', { id: 'canary-user', displayName: 'Canary' });

    const scenario = await loadScenario(path.join(SCENARIOS_DIR, 'muster-partial.json'));
    await expect(applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot })).rejects.toThrow(
      TenantLockedError,
    );

    // The failed scenario must not have deleted the served tenant's files.
    const storeRaw = await fs.readFile(path.join(tenantRoot, 'store.json'), 'utf8');
    expect(storeRaw).toContain('canary-user');
  });

  it('a second serve on the same tenant fails loudly', async () => {
    handle = await startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    await expect(
      startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot }),
    ).rejects.toThrow(TenantLockedError);
  });

  it('a stale lock from a dead process is stolen, not fatal', async () => {
    // A real pid that is guaranteed dead: spawn a child that exits immediately.
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = child.pid ?? 0;
    expect(deadPid).toBeGreaterThan(0);

    await fs.mkdir(tenantRoot, { recursive: true });
    await fs.writeFile(
      path.join(tenantRoot, TENANT_LOCK_FILENAME),
      JSON.stringify({ pid: deadPid, owner: 'serve', acquiredAt: new Date().toISOString() }),
      'utf8',
    );

    const result = await seedTenant({ stance: 'm365_azure', slug: 's1', profilesDir: PROFILES_DIR, tenantRoot });
    expect(result.counts.users).toBeGreaterThan(0);
    // Lock released after the successful seed — a serve can start now.
    handle = await startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
  });

  it('normal sequential flow (seed -> serve -> stop -> scenario) is unaffected', async () => {
    await seedTenant({ stance: 'm365_azure', slug: 's1', profilesDir: PROFILES_DIR, tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 's1', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    await handle.stop();
    handle = undefined;

    const scenario = await loadScenario(path.join(SCENARIOS_DIR, 'muster-partial.json'));
    const applied = await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot });
    expect(applied.seedCounts.users).toBeGreaterThan(0);
  });
});
