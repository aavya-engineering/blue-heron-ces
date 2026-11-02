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
 * PH-6 R-SIM (2026-10-31): the S1/S2 objects the AO sweep binds (LOG-PH5-AO.md
 * "Red 3"): a public IP for the firewall (F-12 publicIpName, discovered by
 * Get-AzPublicIpAddress) and CES's own app registration (C-02 appId,
 * discovered by GET /v1.0/applications; C-02 then reads it with
 * Get-MgApplication -Filter "appId eq '...'"). S3 has no Azure, so no public IP.
 * In-process ResolverTable only: no simulator port.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
type Row = Record<string, any>;
const asList = (v: unknown): Row[] => {
  if (Array.isArray(v)) return v as Row[];
  if (v && typeof v === 'object' && Array.isArray((v as Row).value)) return (v as Row).value as Row[];
  return v === undefined || v === null ? [] : [v as Row];
};

describe('PH-6 R-SIM: AO sweep seed objects (public IP, app registration)', () => {
  let dir: string;
  const tables: Record<string, ResolverTable> = {};

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph6-'));
    const prev = process.env.STACKSIM_FIXED_NOW;
    process.env.STACKSIM_FIXED_NOW = '2026-10-01T00:00:00.000Z';
    try {
      for (const slug of ['s1-mach', 's2-eng', 's3-def']) {
        const root = path.join(dir, slug);
        await applyScenario(await loadScenario(path.join(SIM_ROOT, 'scenarios', `${slug}.json`)), { profilesDir: PROFILES_DIR, tenantRoot: root });
        tables[slug] = new ResolverTable(new ObjectStore(path.join(root, 'store.json')), new StackShapeGate('m365_azure'));
      }
    } finally {
      if (prev === undefined) delete process.env.STACKSIM_FIXED_NOW;
      else process.env.STACKSIM_FIXED_NOW = prev;
    }
  }, 120_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  for (const [slug, rg] of [['s1-mach', 'rg-s1-mach-prod'], ['s2-eng', 'rg-s2-eng-prod']] as const) {
    it(`${slug}: Get-AzPublicIpAddress lists the firewall's public IP, and a by-name read finds it`, async () => {
      const t = tables[slug];
      const all = asList(await t.resolveCmdlet('Get-AzPublicIpAddress', []));
      expect(all.map((p) => p.Name)).toEqual([`pip-${slug}-fw`]);
      expect(all[0].Id).toContain(`/resourceGroups/${rg}/providers/Microsoft.Network/publicIPAddresses/pip-${slug}-fw`);
      expect(all[0].IpAddress).toMatch(/^203\.0\.113\./);
      const one = asList(await t.resolveCmdlet('Get-AzPublicIpAddress', ['-ResourceGroupName', rg, '-Name', `pip-${slug}-fw`]));
      expect(one).toHaveLength(1);
      expect(asList(await t.resolveCmdlet('Get-AzFirewall', []))).toHaveLength(1);
    });

    it(`${slug}: Stamper's named public IP reads (pip-fw-cmmc, pip-bastion-cmmc) still find nothing (score-neutral)`, async () => {
      for (const name of ['pip-fw-cmmc', 'pip-bastion-cmmc']) {
        const got = await tables[slug].resolveCmdlet('Get-AzPublicIpAddress', ['-ResourceGroupName', rg, '-Name', name]).then(asList, () => [] as Row[]);
        expect(got, name).toEqual([]);
      }
    });
  }

  for (const slug of ['s1-mach', 's2-eng', 's3-def']) {
    it(`${slug}: GET /v1.0/applications returns CES's app registration, and C-02's -Filter read finds it`, async () => {
      const t = tables[slug];
      const apps = asList(await t.resolveUri('GET', '/v1.0/applications', undefined));
      expect(apps).toHaveLength(1);
      expect(apps[0].appId).toBe(`sim-app-${slug}`);
      expect(apps[0].passwordCredentials).toEqual([]);
      expect(apps[0].keyCredentials).toHaveLength(1);
      const byFilter = asList(await t.resolveCmdlet('Get-MgApplication', ['-Filter', `appId eq '${apps[0].appId}'`]));
      expect(byFilter.map((a) => a.id)).toEqual([apps[0].id]);
    });
  }

  it('s3-def: no public IP (S3 has no Azure resource and no firewall)', async () => {
    expect(asList(await tables['s3-def'].resolveCmdlet('Get-AzPublicIpAddress', []))).toEqual([]);
  });
});
