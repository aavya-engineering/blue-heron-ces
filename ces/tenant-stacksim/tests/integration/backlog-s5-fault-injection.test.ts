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
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { applyScenario } from '../../src/scenarios/ScenarioEngine.js';

/**
 * backlog-S5 acceptance test (BACKLOG.md § S5): a scenario/config knob makes
 * a named command return 429 / transient failure / malformed payload
 * DETERMINISTICALLY — covered across both transports (POST /resolve, the
 * fake-module protocol; and the /v1.0 Graph REST facade) and both knobs
 * (a scenario's faultInjection block persisted to faults.json, and the
 * runtime POST /_faults route).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

describe('backlog-S5: deterministic fault injection', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;

  async function setFaults(rules: unknown): Promise<Response> {
    return fetch(`${base}/_faults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    });
  }

  async function resolveCmdlet(cmdlet: string): Promise<Response> {
    return fetch(`${base}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'cmdlet', cmdlet }),
    });
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s5-'));
    const tenantRoot = path.join(dir, 'tenant');
    // Build via a scenario WITH a faultInjection block — proves the
    // scenario knob end-to-end (persisted faults.json -> serve startup).
    await applyScenario(
      {
        name: 's5-faults',
        description: 'fault-injection acceptance scenario',
        stance: 'm365_azure',
        faultInjection: [{ target: 'Get-MgIdentityConditionalAccessPolicy', kind: 'throttle', times: 1 }],
      },
      { profilesDir: PROFILES_DIR, tenantRoot },
    );
    handle = await startServe({ stance: 'm365_azure', slug: 's5', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    base = `http://127.0.0.1:${handle.port}`;
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('scenario knob: faults.json written by the scenario is live at serve startup, deterministically once', async () => {
    const first = await resolveCmdlet('Get-MgIdentityConditionalAccessPolicy');
    expect(first.status).toBe(429);
    const err = (await first.json()) as { error: { code: string } };
    expect(err.error.code).toBe('TooManyRequests');
    expect(first.headers.get('retry-after')).toBe('1');

    // times: 1 — the second call passes through to real seeded data.
    const second = await resolveCmdlet('Get-MgIdentityConditionalAccessPolicy');
    expect(second.status).toBe(200);
    const data = (await second.json()) as { data: unknown[] };
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
  });

  it('runtime knob: POST /_faults replaces rules; throttle fires exactly N times on the cmdlet path', async () => {
    const set = await setFaults([{ target: 'Get-MgUser', kind: 'throttle', times: 2 }]);
    expect(set.status).toBe(200);

    expect((await resolveCmdlet('Get-MgUser')).status).toBe(429);
    expect((await resolveCmdlet('Get-MgUser')).status).toBe(429);
    const third = await resolveCmdlet('Get-MgUser');
    expect(third.status).toBe(200);
    expect(((await third.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
    // Unrelated cmdlets are never faulted.
    expect((await resolveCmdlet('Get-MgGroup')).status).toBe(200);
  });

  it('transient failure on the Graph REST facade by URI prefix, then recovery', async () => {
    await setFaults([{ target: '/v1.0/deviceManagement/managedDevices', kind: 'transient', times: 1 }]);

    const first = await fetch(`${base}/v1.0/deviceManagement/managedDevices`);
    expect(first.status).toBe(503);
    expect(((await first.json()) as { error: { code: string } }).error.code).toBe('ServiceUnavailable');

    const second = await fetch(`${base}/v1.0/deviceManagement/managedDevices`);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { value: unknown[] }).value.length).toBeGreaterThan(0);
  });

  it("malformed payload: HTTP 200 whose body does not parse; 'always' never recovers until rules cleared", async () => {
    await setFaults([{ target: 'Get-MgUser', kind: 'malformed', times: 'always' }]);

    for (let i = 0; i < 3; i++) {
      const res = await resolveCmdlet('Get-MgUser');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(() => JSON.parse(text)).toThrow();
    }

    // Clearing the table restores normal behavior.
    await setFaults([]);
    const clean = await resolveCmdlet('Get-MgUser');
    expect(clean.status).toBe(200);
    expect(((await clean.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  it('rejects invalid rules loudly', async () => {
    expect((await setFaults([{ target: 'Get-MgUser', kind: 'explode' }])).status).toBe(400);
    expect((await setFaults([{ kind: 'throttle' }])).status).toBe(400);
    expect((await setFaults({ not: 'an array' })).status).toBe(400);
  });
});
