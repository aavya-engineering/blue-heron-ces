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
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';

/**
 * SIM-BL (2026-10-31): Stamper's SC.L2-3.13.10.key-escrow read, GET
 * /v1.0/informationProtection/bitlocker/recoveryKeys, at the exact absolute
 * URI the registry uses. One escrowed OS-volume key per encrypted Windows
 * device; the customer's unencrypted devices and iOS have none; metadata
 * only, never key material; never empty (verification.evidence.not_empty).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URI = 'https://graph.microsoft.us/v1.0/informationProtection/bitlocker/recoveryKeys';
type Row = Record<string, any>;

async function build(slug: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stacksim-sim-bl-${slug}-`));
  const scenario = await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`));
  await applyScenario(scenario, { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot: path.join(dir, 'tenant') });
  const store = new ObjectStore(path.join(dir, 'tenant', 'store.json'));
  return { dir, store, table: new ResolverTable(store, new StackShapeGate('m365_azure')) };
}

const CASES: Array<{ slug: string; keys: number; unencrypted: string[] }> = [
  { slug: 's1-mach', keys: 50, unencrypted: ['S1-WS-039', 'S1-WS-040'] },
  { slug: 's2-eng', keys: 29, unencrypted: ['S2-CAD-04'] },
  { slug: 's3-def', keys: 31, unencrypted: ['S3-WS-024', 'S3-SF-02', 'S3-SF-04'] },
  { slug: 'muster-partial', keys: 4, unencrypted: [] },
];

for (const c of CASES) {
  describe(`SIM-BL: ${c.slug} BitLocker recovery keys`, () => {
    let b: Awaited<ReturnType<typeof build>>;
    let keys: Row[];
    let managed: Row[];
    let entra: Row[];
    beforeAll(async () => {
      b = await build(c.slug);
      const res = (await b.table.resolveUri('GET', URI)) as Row;
      keys = res.value as Row[];
      managed = (await b.store.list('managedDevices')) as Row[];
      entra = (await b.store.list('devices')) as Row[];
    }, 60_000);
    afterAll(async () => {
      await fs.rm(b.dir, { recursive: true, force: true });
    });

    it('answers in a value envelope, never empty', () => {
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('one key per encrypted Windows managed device, none for the unencrypted ones', () => {
      const encryptedWin = managed.filter((d) => (d.operatingSystem ?? 'Windows') === 'Windows' && d.isEncrypted !== false);
      expect(keys).toHaveLength(encryptedWin.length);
      if (c.keys >= 0) expect(keys).toHaveLength(c.keys);
      const keyed = new Set(keys.map((k) => k.deviceId));
      for (const name of c.unencrypted) {
        const md = managed.find((d) => d.deviceName === name);
        expect(md, name).toBeDefined();
        expect(md!.isEncrypted).toBe(false);
        if (md!.azureADDeviceId) expect(keyed.has(md!.azureADDeviceId), name).toBe(false);
      }
      expect(managed.filter((d) => d.isEncrypted === false)).toHaveLength(c.unencrypted.length);
    });

    it('metadata only: id, createdDateTime, deviceId, volumeType; no key material', () => {
      for (const k of keys) {
        expect(Object.keys(k).sort()).toEqual(['createdDateTime', 'deviceId', 'id', 'volumeType']);
        expect(k).not.toHaveProperty('key');
        expect(k.volumeType).toBe('operatingSystemVolume');
        expect(Number.isNaN(Date.parse(k.createdDateTime))).toBe(false);
        expect(Date.parse(k.createdDateTime)).toBeLessThan(Date.now());
      }
      expect(new Set(keys.map((k) => k.id)).size).toBe(keys.length);
    });

    it('every deviceId is a seeded Entra device', () => {
      const ids = new Set(entra.map((d) => d.id));
      for (const k of keys) expect(ids.has(k.deviceId), k.deviceId).toBe(true);
    });

    it('honours $filter on deviceId', async () => {
      const one = keys[0];
      const res = (await b.table.resolveUri('GET', `${URI}?$filter=deviceId eq '${one.deviceId}'`)) as Row;
      expect(res.value).toEqual([one]);
    });
  });
}
