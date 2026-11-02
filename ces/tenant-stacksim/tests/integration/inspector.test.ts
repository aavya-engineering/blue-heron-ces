// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../../src/cli/commands/seed.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';

/** Inspector (2026-07-11): read-only visual surface at GET / + JSON at /_inspector/data. */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

describe('inspector', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-inspector-'));
    const tenantRoot = path.join(dir, 'tenant');
    await seedTenant({ stance: 'm365_azure', slug: 'inspect', profilesDir: PROFILES_DIR, tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 'inspect', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    base = `http://127.0.0.1:${handle.port}`;
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('GET / serves the self-contained page', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('stacksim inspector');
    expect(html).toContain('simulated tenant');
    // Self-contained: no external fetches beyond the data route.
    expect(html).not.toMatch(/src="http|href="http/);
  });

  it('GET /_inspector/data reflects seeded state, ledger activity, and fault rules', async () => {
    // Generate a read-serve and a fault rule so all sections have content.
    await fetch(`${base}/v1.0/identity/conditionalAccess/policies`);
    await fetch(`${base}/_faults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ target: 'Get-MgUser', kind: 'throttle', times: 1 }]),
    });

    const res = await fetch(`${base}/_inspector/data`);
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      tenant: { slug: string; stance: string };
      totalObjects: number;
      collections: Array<{ name: string; count: number }>;
      ledger: { total: number; tail: Array<{ type: string }> };
      faults: Array<{ target: string }>;
    };
    expect(d.tenant.slug).toBe('inspect');
    expect(d.tenant.stance).toBe('m365_azure');
    expect(d.totalObjects).toBeGreaterThan(50);
    // SIMFIX FIX-S2: m365_azure = 5 generator users + 6 from the gcc-high-g5 seed set.
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-users): +1 disabled leaver (user-12) so
    // EO's personnel-action evaluator has a real disabled account to check residual access against.
    expect(d.collections.find((c) => c.name === 'users')?.count).toBe(12);
    expect(d.ledger.total).toBeGreaterThan(0);
    expect(d.faults[0]?.target).toBe('Get-MgUser');
  });

  it('inspector routes never shadow the Graph facade or resolve protocol', async () => {
    const graph = await fetch(`${base}/v1.0/deviceManagement/managedDevices`);
    expect(graph.status).toBe(200);
    expect(((await graph.json()) as { value: unknown[] }).value.length).toBeGreaterThan(0);
  });
});
