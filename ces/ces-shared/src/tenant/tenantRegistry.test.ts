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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SIM_TENANT_SLUG,
  createModuleTenantRegistry,
  detectLegacyKind,
  type LegacyTenantKind,
} from './tenantRegistry.js';

const recordPath = (root: string, kind: LegacyTenantKind, slug: string) =>
  path.join(root, kind, `${slug}.json`);

function writeLegacy(planRoot: string, slug: string, body: Record<string, unknown>) {
  fs.mkdirSync(path.join(planRoot, slug), { recursive: true });
  fs.writeFileSync(path.join(planRoot, slug, `${slug}.json`), JSON.stringify(body), 'utf-8');
}

describe('tenantRegistry (DUP-2)', () => {
  let tmp: string;
  let planRoot: string;
  let regRoot: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-shared-tenreg-'));
    planRoot = path.join(tmp, 'plan-data');
    regRoot = path.join(tmp, 'registry');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function make(skipDirNames?: string[], createRegistry = () => ({ id: Symbol('reg') })) {
    return createModuleTenantRegistry({
      moduleName: 'testTenants',
      defaultPlanDataRoot: () => planRoot,
      skipDirNames,
      createRegistry,
      getRegistryRoot: () => regRoot,
      registryRecordPath: recordPath,
    });
  }

  it('keeps the historical default sim slug', () => {
    expect(DEFAULT_SIM_TENANT_SLUG).toBe('sim-m365-azure');
  });

  it('detects kind: explicit wins, gcc-high-sim marker -> sim, else live', () => {
    expect(detectLegacyKind({ kind: 'sim' })).toBe('sim');
    expect(detectLegacyKind({ kind: 'live', tenant: { environment: 'gcc-high-sim' } })).toBe('live');
    expect(detectLegacyKind({ tenant: { environment: 'gcc-high-sim' } })).toBe('sim');
    expect(detectLegacyKind({ kind: 'bogus' })).toBe('live');
    expect(detectLegacyKind({})).toBe('live');
  });

  it('is a no-op when the plan-data root is missing', () => {
    make().seedRegistryFromRepoPlanData();
    expect(fs.existsSync(regRoot)).toBe(false);
  });

  it('migrates legacy records with kind stamped, trailing newline, source left in place', () => {
    writeLegacy(planRoot, 'acme', { tenant: { id: 't1' }, secret: { ref: 'x' } });
    writeLegacy(planRoot, 'simco', { tenant: { environment: 'gcc-high-sim' } });
    make().seedRegistryFromRepoPlanData();

    const acme = fs.readFileSync(recordPath(regRoot, 'live', 'acme'), 'utf-8');
    expect(acme.endsWith('}\n')).toBe(true);
    expect(JSON.parse(acme)).toEqual({ tenant: { id: 't1' }, secret: { ref: 'x' }, kind: 'live' });
    expect(JSON.parse(fs.readFileSync(recordPath(regRoot, 'sim', 'simco'), 'utf-8')).kind).toBe('sim');
    expect(fs.existsSync(path.join(planRoot, 'acme', 'acme.json'))).toBe(true);
  });

  it('skips files, dirs without <slug>.json, skipDirNames, and slugs already in either namespace', () => {
    fs.mkdirSync(planRoot, { recursive: true });
    fs.writeFileSync(path.join(planRoot, 'loose.json'), '{}');
    fs.mkdirSync(path.join(planRoot, 'empty'));
    writeLegacy(planRoot, 'dev', {});
    writeLegacy(planRoot, 'known', { tenant: { environment: 'gcc-high-sim' } });
    fs.mkdirSync(path.join(regRoot, 'live'), { recursive: true });
    fs.writeFileSync(recordPath(regRoot, 'live', 'known'), '{"kind":"live"}');

    make(['dev']).seedRegistryFromRepoPlanData();

    expect(fs.existsSync(recordPath(regRoot, 'live', 'dev'))).toBe(false);
    expect(fs.existsSync(recordPath(regRoot, 'live', 'empty'))).toBe(false);
    expect(fs.existsSync(recordPath(regRoot, 'sim', 'known'))).toBe(false);
    expect(fs.readFileSync(recordPath(regRoot, 'live', 'known'), 'utf-8')).toBe('{"kind":"live"}');
  });

  it('migrates a dev dir when skipDirNames is not given (AO behaviour)', () => {
    writeLegacy(planRoot, 'dev', {});
    make().seedRegistryFromRepoPlanData();
    expect(fs.existsSync(recordPath(regRoot, 'live', 'dev'))).toBe(true);
  });

  it('warns and continues on an unparseable legacy record', () => {
    fs.mkdirSync(path.join(planRoot, 'bad'), { recursive: true });
    fs.writeFileSync(path.join(planRoot, 'bad', 'bad.json'), '{nope');
    writeLegacy(planRoot, 'good', {});
    make().seedRegistryFromRepoPlanData();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[testTenants] failed to migrate legacy tenant "bad"'));
    expect(fs.existsSync(recordPath(regRoot, 'live', 'good'))).toBe(true);
  });

  it('honours explicit planDataRoot / registryRoot arguments', () => {
    const otherPlan = path.join(tmp, 'other-plan');
    const otherReg = path.join(tmp, 'other-reg');
    writeLegacy(otherPlan, 'x', {});
    make().seedRegistryFromRepoPlanData(otherPlan, otherReg);
    expect(fs.existsSync(recordPath(otherReg, 'live', 'x'))).toBe(true);
    expect(fs.existsSync(regRoot)).toBe(false);
  });

  it('getTenantRegistry constructs once and seeds once; reset clears both', () => {
    const create = vi.fn(() => ({ id: Symbol('reg') }));
    const reg = make(undefined, create);
    writeLegacy(planRoot, 'first', {});

    const a = reg.getTenantRegistry();
    expect(fs.existsSync(recordPath(regRoot, 'live', 'first'))).toBe(true);
    writeLegacy(planRoot, 'second', {});
    const b = reg.getTenantRegistry();
    expect(b).toBe(a);
    expect(create).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(recordPath(regRoot, 'live', 'second'))).toBe(false);

    reg.resetTenantRegistryForTests();
    const c = reg.getTenantRegistry();
    expect(c).not.toBe(a);
    expect(create).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(recordPath(regRoot, 'live', 'second'))).toBe(true);
  });
});
