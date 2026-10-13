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
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
// @ts-expect-error plain-JS generator script (no type declarations)
import { buildDemoScenario, loadDemoConfig } from '../../scripts/build-demo-scenario.mjs';

/**
 * GP-STACKSIM-1 M4: demo profile "demo-dib-small" — a seeded, resettable
 * fictional small-DIB-contractor tenant for live sales demos. Three
 * guarantees under test: (1) the realistic staff/devices and every deliberate
 * gap are served through the REAL Graph facade exactly as scenario-built,
 * (2) the headline gaps sit where Muster/EO actually look (CA policy state,
 * managed-device compliance), and (3) re-running the scenario IS the reset —
 * two builds yield byte-identical store state.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const SCENARIO_PATH = path.join(SIM_ROOT, 'scenarios', 'demo-dib-small.json');

describe('demo-dib-small profile', () => {
  let dir: string;
  let tenantRoot: string;
  let handle: ServeHandle;
  let base: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-demo-'));
    tenantRoot = path.join(dir, 'tenant');
    const scenario = await loadScenario(SCENARIO_PATH);
    await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 'demo-dib-small', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
    base = `http://127.0.0.1:${handle.port}`;
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('serves the realistic 13-person staff through the real Graph facade', async () => {
    const res = await fetch(`${base}/v1.0/users`);
    expect(res.status).toBe(200);
    const users = ((await res.json()) as { value: Array<Record<string, unknown>> }).value;
    expect(users.length).toBe(13);
    const owner = users.find((u) => u.id === 'user-1');
    expect(owner?.displayName).toBe('Dana Okafor');
    expect(owner?.userPrincipalName).toBe('dana.okafor@ridgelinefab.onmicrosoft.us');
    // No generic seed names survive the rename pass.
    expect(users.some((u) => String(u.displayName).startsWith('Sim User'))).toBe(false);
  });

  it('exposes the deliberate gaps where discovery/assessment actually read', async () => {
    // Headline gap: MFA policy present but report-only -> iam-001/iam-004 "no".
    const ca = await fetch(`${base}/v1.0/identity/conditionalAccess/policies/caPolicy-1`);
    const policy = (await ca.json()) as Record<string, unknown>;
    expect(policy.state).toBe('enabledForReportingButNotEnforced');
    expect((policy.grantControls as { builtInControls: string[] }).builtInControls).toContain('mfa');

    // Endpoint gap: the shared shop-floor kiosk is enrolled but red.
    const md = await fetch(`${base}/v1.0/deviceManagement/managedDevices`);
    const devices = ((await md.json()) as { value: Array<Record<string, unknown>> }).value;
    const kiosk = devices.find((d) => d.deviceName === 'RIDGE-SHOP-KIOSK');
    expect(kiosk?.complianceState).toBe('noncompliant');
    expect(kiosk?.isEncrypted).toBe(false);

    // Identity-hygiene gap: the shared login account is visible in the listing.
    const users = ((await (await fetch(`${base}/v1.0/users`)).json()) as { value: Array<Record<string, unknown>> }).value;
    expect(users.find((u) => u.userPrincipalName === 'shop@ridgelinefab.onmicrosoft.us')?.displayName).toBe('Shop Floor (shared)');
  });

  it('declares the state-detection ground truth Muster scenarios use', async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    expect(scenario.expectedFacts).toEqual({
      'iam-001': 'no',
      'iam-004': 'no',
      'ep-001': 'yes',
      'ep-002': 'yes',
    });
    // The demo must run smooth: no fault injection in the demo profile.
    expect(scenario.faultInjection).toBeUndefined();
  });

  it('drift guard: the committed scenario matches its editable config (npm run demo:build)', async () => {
    // The config (scenarios/demo-dib-small.config.json) is the single
    // editable source of truth — founder sign-off 2026-07-25 came with a
    // "build it for easy change" rider. If this fails, someone edited the
    // generated scenario by hand or changed the config without regenerating:
    // run `npm run demo:build` and commit both files together.
    const generated = buildDemoScenario(loadDemoConfig()) as unknown;
    const committed = JSON.parse(await fs.readFile(SCENARIO_PATH, 'utf8')) as unknown;
    expect(generated).toEqual(committed);
  });

  it('reset = re-run: two builds of the scenario produce identical store state', async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const rootA = path.join(dir, 'reset-a');
    const rootB = path.join(dir, 'reset-b');
    await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot: rootA });
    await applyScenario(scenario, { profilesDir: PROFILES_DIR, tenantRoot: rootB });
    type Store = { collections: Record<string, Record<string, unknown>> };
    const a = JSON.parse(await fs.readFile(path.join(rootA, 'store.json'), 'utf8')) as Store;
    const b = JSON.parse(await fs.readFile(path.join(rootB, 'store.json'), 'utf8')) as Store;
    // Two classes of run-relative data are expected to differ: the
    // directoryAudits trail (per-run ids/timestamps by design) and seeded
    // *DateTime/timestamp fields (sign-in logs etc. are generated relative to
    // "now" for realism). Everything a demo audience and the tools reason
    // about — ids, names, states, gap flags — must be identical.
    const TIME_FIELD = /(dateTime|timestamp)$/i;
    const maskTimes = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(maskTimes);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, val]) => [
            k,
            TIME_FIELD.test(k) ? '<time>' : maskTimes(val),
          ]),
        );
      }
      return v;
    };
    const { directoryAudits: auditsA, ...restA } = a.collections;
    const { directoryAudits: auditsB, ...restB } = b.collections;
    expect(maskTimes(restA)).toEqual(maskTimes(restB));
    expect(Object.keys(auditsA ?? {}).length).toBe(Object.keys(auditsB ?? {}).length);
  });
});
