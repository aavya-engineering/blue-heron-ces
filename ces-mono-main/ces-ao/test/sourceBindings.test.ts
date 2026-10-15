// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO2 (2026-09-27) — every tenant-sourced parameter binds, or fails with a
// named reason that a filed REQ covers.
//
// The tenant record is the REAL stacksim tenant object: tenant-stacksim's own
// `buildSimTenantConfig` (pure function, read from the sibling source), written
// to a temp ces-tenant registry root as `kind:'sim'` and parsed back through
// AO's production registry path (`loadTenantConfigBySlug`). Binding runs through
// the production `mapAoParametersToVariables`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSimTenantConfig } from '../../tenant-stacksim/src/config/SimTenantConfig.js';
import { mapAoParametersToVariables, UnboundSourceError } from '../src/execution/ParameterMapper.js';
import { SOURCE_BINDINGS, resolveSource, BUILTIN_ROLE_TEMPLATE_IDS } from '../src/execution/SourceBindings.js';
import { loadTenantConfigBySlug, resetTenantRegistryForTests } from '../src/tenant/aoTenants.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
import type { AoCommand } from '../src/types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = registry as unknown as AoCommand[];
const SOURCED = COMMANDS.filter((c) => c.parameters.some((p) => p.source));
const REQ_PATH = path.resolve(__dirname, '..', 'docs', 'requirements', 'REQ-tenant-stacksim-ao-source-keys.md');

function userInputsFor(cmd: AoCommand): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const p of cmd.parameters) if (!p.source) inputs[p.name] = `input-${p.name}`;
  return inputs;
}

let root: string;
const env0 = { ...process.env };
let simTenant: any;

function deleteDottedPath(obj: any, dotted: string): void {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null) return;
    cur = cur[parts[i]];
  }
  if (cur != null) delete cur[parts[parts.length - 1]];
}

/**
 * A tenant clone with the given registry `source` names guaranteed unbound: the
 * literal source path AND every SOURCE_BINDINGS key for it are deleted. Used so
 * "this source is unbound" tests stay true regardless of what tenant-stacksim's
 * SimTenantConfig happens to emit today (it is under active, separate development —
 * see REQ-tenant-stacksim-ao-source-keys.md) — the test asserts AO's own unbound-value
 * error path, not the sim's current data completeness.
 */
function tenantMissingSources(tenant: any, sourceNames: string[]): any {
  const clone = JSON.parse(JSON.stringify(tenant));
  for (const name of sourceNames) {
    deleteDottedPath(clone, name);
    for (const key of SOURCE_BINDINGS[name]?.keys ?? []) deleteDottedPath(clone, key);
  }
  return clone;
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-w4-bind-'));
  const registryRoot = path.join(root, 'registry');
  const raw = { ...buildSimTenantConfig({ slug: 'ao-bind', tenantStance: 'm365_azure' }), kind: 'sim' };
  fs.mkdirSync(path.join(registryRoot, 'sim'), { recursive: true });
  fs.writeFileSync(path.join(registryRoot, 'sim', 'ao-bind.json'), JSON.stringify(raw, null, 2));
  process.env.CES_TENANT_ROOT = registryRoot;
  resetTenantRegistryForTests();
  simTenant = await loadTenantConfigBySlug('ao-bind');
});

afterAll(() => {
  process.env = { ...env0 };
  resetTenantRegistryForTests();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('W4-AO2 source binding table', () => {
  it('has a binding for every distinct registry source (no source is left to chance)', () => {
    const sources = new Set(COMMANDS.flatMap((c) => c.parameters.filter((p) => p.source).map((p) => p.source!)));
    const missing = [...sources].filter((s) => !(s in SOURCE_BINDINGS));
    expect(missing).toEqual([]);
    expect(SOURCED.length).toBeGreaterThanOrEqual(31);
  });

  it('a COMPLETE tenant object binds every sourced parameter of every command', () => {
    const resources: Record<string, string> = {};
    for (const b of Object.values(SOURCE_BINDINGS)) {
      for (const k of b.keys) if (k.startsWith('resources.')) resources[k.slice('resources.'.length)] = `v-${k}`;
    }
    const complete = { ...simTenant, cmmcMigrationExempt: true, resources };
    for (const cmd of SOURCED) {
      const vars = mapAoParametersToVariables(cmd, complete, userInputsFor(cmd));
      for (const p of cmd.parameters.filter((x) => x.source)) {
        expect(vars[p.name], `${cmd.id}.${p.name}`).toBeTruthy();
      }
    }
  });

  it('built-in role definition ids fall back to the platform constants only when the tenant has no key', () => {
    expect(resolveSource({}, 'globalAdminRoleDefId')).toMatchObject({
      value: BUILTIN_ROLE_TEMPLATE_IDS.globalAdministrator,
      origin: 'platform-constant',
    });
    expect(resolveSource({ resources: { global_admin_role_def_id: 'tenant-ga' } }, 'globalAdminRoleDefId')).toMatchObject({
      value: 'tenant-ga',
      origin: 'tenant-key',
    });
  });

  it('a request value never overrides a tenant-bound value (FX-AO1 invariant kept)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'C-03')!;
    const vars = mapAoParametersToVariables(cmd, { ...simTenant, cmmcMigrationExempt: true }, {
      ...userInputsFor(cmd),
      keyVaultName: 'attacker-kv',
    });
    expect(vars.keyVaultName).toBe('sim-kv-1');
  });

  it('an unknown required value fails with a named reason (source, tenant, every key tried)', () => {
    const cmd = COMMANDS.find((c) => c.id === 'A-01')!;
    // FC-AO 2026-09-27: force m365LicenseSkuId/baseGroupId unbound on the clone
    // regardless of whether the concurrently-developed sim now emits them — this
    // test pins AO's error path, not the sim's current data completeness.
    const tenantMissingKey = tenantMissingSources(simTenant, ['m365LicenseSkuId', 'baseGroupId']);
    let err: unknown;
    try {
      mapAoParametersToVariables(cmd, tenantMissingKey, userInputsFor(cmd));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnboundSourceError);
    const msg = (err as Error).message;
    expect(msg).toContain('"m365LicenseSkuId"');
    expect(msg).toContain('resources.m365_license_sku_id');
    expect(msg).toContain('"ao-bind"');
  });
});

describe('W4-AO2 fail-closed: empty request values do not bind', () => {
  it.each(['', '   '])('an empty request value (%j) for an unbound required source still fails', (empty) => {
    const cmd = COMMANDS.find((c) => c.id === 'A-01')!;
    // FC-AO 2026-09-27: same isolation as above — force these two sources unbound
    // on the clone so the test doesn't depend on the sim's current data completeness.
    const tenantMissingKeys = tenantMissingSources(simTenant, ['m365LicenseSkuId', 'baseGroupId']);
    expect(() =>
      mapAoParametersToVariables(cmd, tenantMissingKeys, { ...userInputsFor(cmd), m365LicenseSkuId: empty, baseGroupId: empty }),
    ).toThrow(UnboundSourceError);
  });
});

describe('W4-AO2 enumeration against the stacksim tenant object (m365_azure)', () => {
  const reqText = fs.readFileSync(REQ_PATH, 'utf-8');
  const bound: string[] = [];
  const open: Record<string, string[]> = {};

  for (const cmd of SOURCED) {
    it(`${cmd.id}: binds against stacksim, or its missing keys are named in REQ-tenant-stacksim-ao-source-keys`, () => {
      try {
        const vars = mapAoParametersToVariables(cmd, simTenant, userInputsFor(cmd));
        for (const p of cmd.parameters.filter((x) => x.source && x.required)) {
          expect(vars[p.name], `${cmd.id}.${p.name}`).toBeTruthy();
          expect(vars[p.name]).not.toMatch(/[{}]/);
        }
        bound.push(cmd.id);
      } catch (e) {
        expect(e).toBeInstanceOf(UnboundSourceError);
        const missingKeys = (e as UnboundSourceError).unbound.map((u) => u.tried[u.tried.length - 1]);
        open[cmd.id] = missingKeys;
        for (const key of missingKeys) {
          const short = key.replace(/^resources\./, '');
          expect(reqText, `${cmd.id}: key ${short} must be requested in the REQ`).toContain(`\`${short}\``);
          // ...and the REQ names this op as blocked by it.
          const row = reqText.split('\n').find((l) => l.startsWith(`| \`${short}\``)) ?? '';
          expect(row, `${cmd.id} listed on the ${short} row`).toContain(cmd.id);
        }
      }
    });
  }

  it('records the split (bound vs HONEST-OPEN) — at least the stacksim-emitted keys bind', () => {
    // Operator/break-glass/KV/LAW/VNet/storage/RG are emitted by stacksim today.
    for (const id of ['A-11', 'A-15', 'A-19', 'A-09', 'C-03', 'C-05', 'F-13', 'F-14', 'H-01', 'H-02', 'H-03', 'F-08']) {
      expect(bound, id).toContain(id);
    }
    // eslint-disable-next-line no-console
    console.log(`[W4-AO2] bound ${bound.length}/${SOURCED.length}: ${bound.sort().join(' ')}`);
    // eslint-disable-next-line no-console
    console.log(`[W4-AO2] HONEST-OPEN ${Object.keys(open).length}: ${JSON.stringify(open)}`);
  });
});
