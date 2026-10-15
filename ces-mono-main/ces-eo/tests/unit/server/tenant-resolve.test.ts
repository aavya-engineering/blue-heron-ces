// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registryRecordPath } from 'ces-tenant';
import { resolveTenantJsonPath } from '../../../src/eo/server/tenant-resolve';

/**
 * G-EO-STAB-1 M3: registry-first tenant resolution. The resolver must find
 * ephemeral sim tenants the ces-tenant registry creates (previously invisible
 * to /api/assess), fall back to Stamper plan-data, and NEVER read the retired
 * ~/.stamper/tenants path.
 */
describe('resolveTenantJsonPath — registry-first (EO-STAB M3)', () => {
  let tmp: string;
  let registryRoot: string;
  let stamperRoot: string;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-m3-'));
    registryRoot = path.join(tmp, 'registry');
    stamperRoot = path.join(tmp, 'stamper');
    // ces-tester sets this override for ephemeral sim tenants; EO must honor it.
    process.env.CES_TENANT_ROOT = registryRoot;
  });

  afterEach(() => {
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT;
    else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function seedRegistry(kind: 'sim' | 'live', slug: string): string {
    const p = registryRecordPath(registryRoot, kind, slug);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ slug, kind }), 'utf-8');
    return p;
  }

  function seedPlanData(slug: string): string {
    const p = path.join(stamperRoot, 'plan-data', slug, `${slug}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ slug }), 'utf-8');
    return p;
  }

  it('resolves a ces-tenant registry SIM record (the ephemeral-sim-tenant fix)', () => {
    const expected = seedRegistry('sim', 'ephemeral-1');
    expect(resolveTenantJsonPath('ephemeral-1', stamperRoot, os.homedir())).toBe(expected);
  });

  it('resolves a registry LIVE record', () => {
    const expected = seedRegistry('live', 'vfsgov');
    expect(resolveTenantJsonPath('vfsgov', stamperRoot, os.homedir())).toBe(expected);
  });

  it('registry takes precedence over plan-data for the same slug', () => {
    const reg = seedRegistry('sim', 'dup');
    seedPlanData('dup');
    expect(resolveTenantJsonPath('dup', stamperRoot, os.homedir())).toBe(reg);
  });

  it('falls back to Stamper plan-data when no registry record exists', () => {
    const expected = seedPlanData('planonly');
    expect(resolveTenantJsonPath('planonly', stamperRoot, os.homedir())).toBe(expected);
  });

  it('returns null when neither registry nor plan-data has the tenant', () => {
    expect(resolveTenantJsonPath('missing', stamperRoot, os.homedir())).toBeNull();
  });

  it('NEVER reads the retired ~/.stamper/tenants path', () => {
    // Even if a legacy file exists under the passed homeDir, it is not resolved.
    const legacyHome = path.join(tmp, 'home');
    const legacy = path.join(legacyHome, '.stamper', 'tenants', 'legacy', 'legacy.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{}', 'utf-8');
    expect(resolveTenantJsonPath('legacy', stamperRoot, legacyHome)).toBeNull();
  });
});
