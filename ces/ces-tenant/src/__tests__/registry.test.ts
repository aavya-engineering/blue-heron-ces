// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * FileTenantRegistry -- acceptance gate 2: back-compat read order, one-time
 * forward migration, kind stamping, A9 structural namespace separation, and
 * the ces-tester lifecycle (create/teardown/listByKind invariants).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FileTenantRegistry } from '../impl/registry.js';
import { SecretRefError } from '../impl/secret-ref.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

interface Roots {
  registryRoot: string;
  cesPipelineRoot: string;
  homeDir: string;
}

function makeRoots(): Roots {
  return {
    registryRoot: tempDir('ces-tenant-reg-'),
    cesPipelineRoot: tempDir('ces-tenant-pipe-'),
    homeDir: tempDir('ces-tenant-home-'),
  };
}

function makeRegistry(roots: Roots, env: NodeJS.ProcessEnv = {}): FileTenantRegistry {
  return new FileTenantRegistry({ ...roots, env });
}

/** Raw tenant JSON in the exact shape loadTenantConfig() reads. */
function rawTenant(slug: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    client: { slug, name: `Client ${slug}` },
    tenant: { tenant_id: `tid-${slug}`, domain: `${slug}.onmicrosoft.us` },
    auth: { app_id: `app-${slug}`, cert_path: `certs/${slug}.pfx`, cert_thumbprint: `THUMB-${slug}` },
    endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
    ...overrides,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function planDataPath(roots: Roots, slug: string): string {
  return path.join(roots.cesPipelineRoot, 'Stamper', 'plan-data', slug, `${slug}.json`);
}

function legacyFlatPath(roots: Roots, slug: string): string {
  return path.join(roots.homeDir, '.stamper', 'tenants', `${slug}.json`);
}

function legacyNestedPath(roots: Roots, slug: string): string {
  return path.join(roots.homeDir, '.stamper', 'tenants', slug, `${slug}.json`);
}

function newRootPath(roots: Roots, kind: 'live' | 'sim', slug: string): string {
  return path.join(roots.registryRoot, kind, `${slug}.json`);
}

describe('FileTenantRegistry.get -- back-compat read order (gate 2)', () => {
  it('returns undefined when the slug exists nowhere', async () => {
    const roots = makeRoots();
    expect(await makeRegistry(roots).get('ghost')).toBeUndefined();
  });

  it('reads the new root first and wins over plan-data and legacy', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), { ...rawTenant('acme', { tenant: { tenant_id: 'tid-new', domain: 'acme.onmicrosoft.us' } }), kind: 'live' });
    writeJson(planDataPath(roots, 'acme'), rawTenant('acme', { tenant: { tenant_id: 'tid-plandata', domain: 'acme.onmicrosoft.us' } }));
    writeJson(legacyFlatPath(roots, 'acme'), rawTenant('acme', { tenant: { tenant_id: 'tid-legacy', domain: 'acme.onmicrosoft.us' } }));

    const record = await makeRegistry(roots).get('acme');
    expect(record?.tenantId).toBe('tid-new');
    expect(record?.kind).toBe('live');
  });

  it('reads plan-data before legacy when the new root has no record', async () => {
    const roots = makeRoots();
    writeJson(planDataPath(roots, 'acme'), rawTenant('acme', { tenant: { tenant_id: 'tid-plandata', domain: 'acme.onmicrosoft.us' } }));
    writeJson(legacyFlatPath(roots, 'acme'), rawTenant('acme', { tenant: { tenant_id: 'tid-legacy', domain: 'acme.onmicrosoft.us' } }));

    const record = await makeRegistry(roots).get('acme');
    expect(record?.tenantId).toBe('tid-plandata');
  });

  it('falls through to the legacy flat path, then the legacy nested variant', async () => {
    const roots = makeRoots();
    writeJson(legacyNestedPath(roots, 'nested-only'), rawTenant('nested-only'));
    expect((await makeRegistry(roots).get('nested-only'))?.tenantId).toBe('tid-nested-only');

    writeJson(legacyFlatPath(roots, 'both'), rawTenant('both', { tenant: { tenant_id: 'tid-flat', domain: 'x' } }));
    writeJson(legacyNestedPath(roots, 'both'), rawTenant('both', { tenant: { tenant_id: 'tid-nested', domain: 'x' } }));
    expect((await makeRegistry(roots).get('both'))?.tenantId).toBe('tid-flat');
  });
});

describe('FileTenantRegistry -- one-time forward migration + kind stamping (gate 2)', () => {
  it('migrates a plan-data hit forward, stamped kind: live, leaving the source in place', async () => {
    const roots = makeRoots();
    writeJson(planDataPath(roots, 'acme'), rawTenant('acme'));

    const record = await makeRegistry(roots).get('acme');
    expect(record?.kind).toBe('live');

    const migrated = JSON.parse(fs.readFileSync(newRootPath(roots, 'live', 'acme'), 'utf-8'));
    expect(migrated.kind).toBe('live');
    expect(migrated.tenant.tenant_id).toBe('tid-acme');
    // Back-compat READS, not writes: the source file stays.
    expect(fs.existsSync(planDataPath(roots, 'acme'))).toBe(true);

    // Second read now hits the new root directly (still the same record).
    expect((await makeRegistry(roots).get('acme'))?.kind).toBe('live');
  });

  it('detects tenant-stacksim provenance (tenant.environment gcc-high-sim) and stamps kind: sim into the sim namespace', async () => {
    const roots = makeRoots();
    writeJson(
      legacyFlatPath(roots, 'simten'),
      rawTenant('simten', { tenant: { tenant_id: 'sim-tenant-simten', domain: 'simten.simtenant.onmicrosoft.us', environment: 'gcc-high-sim' } }),
    );

    const record = await makeRegistry(roots).get('simten');
    expect(record?.kind).toBe('sim');
    expect(fs.existsSync(newRootPath(roots, 'sim', 'simten'))).toBe(true);
    expect(fs.existsSync(newRootPath(roots, 'live', 'simten'))).toBe(false);
  });

  it('never persists resolved secret material: migrated file keeps the env: reference, returned record resolves it', async () => {
    const roots = makeRoots();
    writeJson(
      planDataPath(roots, 'reftenant'),
      rawTenant('reftenant', { auth: { app_id: 'app-x', cert_path: 'x.pfx', cert_thumbprint: 'env:REF_THUMB' } }),
    );

    const record = await makeRegistry(roots, { REF_THUMB: 'RESOLVED123' }).get('reftenant');
    expect(record?.certThumbprint).toBe('RESOLVED123');

    const migrated = JSON.parse(fs.readFileSync(newRootPath(roots, 'live', 'reftenant'), 'utf-8'));
    expect(migrated.auth.cert_thumbprint).toBe('env:REF_THUMB');
  });

  it('fails closed on an unresolvable secret reference', async () => {
    const roots = makeRoots();
    writeJson(
      planDataPath(roots, 'badref'),
      rawTenant('badref', { auth: { app_id: 'a', cert_path: 'p', cert_thumbprint: 'env:UNSET_VAR' } }),
    );
    await expect(makeRegistry(roots, {}).get('badref')).rejects.toThrow(SecretRefError);
  });
});

describe('FileTenantRegistry -- A9 structural separation', () => {
  it('throws loudly when a slug exists in BOTH live and sim namespaces', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'dup'), { ...rawTenant('dup'), kind: 'live' });
    writeJson(newRootPath(roots, 'sim', 'dup'), { ...rawTenant('dup'), kind: 'sim' });
    await expect(makeRegistry(roots).get('dup')).rejects.toThrow(/BOTH live and sim/);
  });

  it('refuses to serve a record whose stamped kind contradicts its namespace', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'sim', 'liar'), { ...rawTenant('liar'), kind: 'live' });
    await expect(makeRegistry(roots).get('liar')).rejects.toThrow(/stamping bug/);
  });

  it('treats a new-root record with NO kind field as a stamping bug (design 2.1 point 3)', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'nokind'), rawTenant('nokind'));
    await expect(makeRegistry(roots).get('nokind')).rejects.toThrow(/stamping bug/);
  });
});

describe('FileTenantRegistry -- ces-tester lifecycle', () => {
  it('createEphemeralSimTenant writes a kind: sim record carrying the opaque seedRef', async () => {
    const roots = makeRoots();
    const registry = makeRegistry(roots);
    const seedRef = { scenario: 'baseline-cui', file: 'scenarios/baseline.json' };

    const record = await registry.createEphemeralSimTenant('eph1', seedRef);
    expect(record.kind).toBe('sim');
    expect(record.tenantId).toBe('sim-tenant-eph1');
    expect(record.domain).toBe('eph1.simtenant.onmicrosoft.us');

    const persisted = JSON.parse(fs.readFileSync(newRootPath(roots, 'sim', 'eph1'), 'utf-8'));
    expect(persisted.kind).toBe('sim');
    expect(persisted.tenant.environment).toBe('gcc-high-sim');
    expect(persisted.stacksim_seed).toEqual(seedRef);
  });

  it('refuses to create an ephemeral sim tenant shadowing a live slug', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'prod'), { ...rawTenant('prod'), kind: 'live' });
    await expect(makeRegistry(roots).createEphemeralSimTenant('prod', {})).rejects.toThrow(/live record/);
  });

  it('teardown leaves no residue: torn-down slug is not returned by listByKind(sim)', async () => {
    const roots = makeRoots();
    const registry = makeRegistry(roots);
    await registry.createEphemeralSimTenant('eph2', null);
    expect((await registry.listByKind('sim')).map((r) => r.tenantSlug)).toContain('eph2');

    await registry.teardownEphemeralSimTenant('eph2');
    expect((await registry.listByKind('sim')).map((r) => r.tenantSlug)).not.toContain('eph2');
    expect(await registry.get('eph2')).toBeUndefined();

    // Idempotent second teardown.
    await expect(registry.teardownEphemeralSimTenant('eph2')).resolves.toBeUndefined();
  });

  it('teardown refuses a slug that is a live tenant', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'prod2'), { ...rawTenant('prod2'), kind: 'live' });
    await expect(makeRegistry(roots).teardownEphemeralSimTenant('prod2')).rejects.toThrow(/live tenant/);
  });

  it('listByKind filters strictly on the stamped kind field, never on location alone', async () => {
    const roots = makeRoots();
    const registry = makeRegistry(roots);
    writeJson(newRootPath(roots, 'live', 'alive'), { ...rawTenant('alive'), kind: 'live' });
    writeJson(newRootPath(roots, 'sim', 'asim'), { ...rawTenant('asim'), kind: 'sim' });
    // Mis-filed: sits in sim/ but stamped live -- must appear in NEITHER list.
    writeJson(newRootPath(roots, 'sim', 'misfiled'), { ...rawTenant('misfiled'), kind: 'live' });

    expect((await registry.listByKind('sim')).map((r) => r.tenantSlug)).toEqual(['asim']);
    expect((await registry.listByKind('live')).map((r) => r.tenantSlug)).toEqual(['alive']);
  });
});

// ---------------------------------------------------------------------------
// CMMC scoping fields -- GP-SHARED-M0-1 ces-tenant half (ratified amendment,
// founder 2026-07-26). Mirrors ces-shared's TenantConfig parse semantics.
// ---------------------------------------------------------------------------

describe('CMMC scoping fields (GP-SHARED-M0-1 amendment)', () => {
  it('pre-migration records load unchanged: all four fields undefined', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), { ...rawTenant('acme'), kind: 'live' });
    const record = await makeRegistry(roots).get('acme');
    expect(record?.cmmcLevel).toBeUndefined();
    expect(record?.assessmentScope).toBeUndefined();
    expect(record?.cuiBoundary).toBeUndefined();
    expect(record?.cmmcMigrationExempt).toBeUndefined();
  });

  it('parses snake_case cmmc_level / assessment_scope / cui_boundary to typed camelCase fields', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), {
      ...rawTenant('acme', {
        cmmc_level: 'L2',
        assessment_scope: { subscription_ids: ['sub-1'], resource_groups: ['rg-1'], ous: ['OU=CUI'] },
        cui_boundary: { resource_allowlist: ['vm-1'], tag_key: 'cui', tag_value: 'true' },
      }),
      kind: 'live',
    });
    const record = await makeRegistry(roots).get('acme');
    expect(record?.cmmcLevel).toBe('L2');
    expect(record?.assessmentScope).toEqual({ subscriptionIds: ['sub-1'], resourceGroups: ['rg-1'], ous: ['OU=CUI'] });
    expect(record?.cuiBoundary).toEqual({ resourceAllowlist: ['vm-1'], tagKey: 'cui', tagValue: 'true' });
  });

  it('allows a tag-based cui_boundary with no assessment_scope', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), {
      ...rawTenant('acme', { cmmc_level: 'L1', cui_boundary: { tag_key: 'cui', tag_value: 'yes' } }),
      kind: 'live',
    });
    const record = await makeRegistry(roots).get('acme');
    expect(record?.cmmcLevel).toBe('L1');
    expect(record?.assessmentScope).toBeUndefined();
    expect(record?.cuiBoundary).toEqual({ tagKey: 'cui', tagValue: 'yes' });
  });

  it('rejects the Case-B foot-gun at load: cmmc_level set but cui_boundary absent', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), {
      ...rawTenant('acme', { cmmc_level: 'L2', assessment_scope: { ous: ['OU=CUI'] } }),
      kind: 'live',
    });
    await expect(makeRegistry(roots).get('acme')).rejects.toThrow(/cmmc_level is set but cui_boundary is absent/);
  });

  it('fails closed on malformed values (invalid level, non-string array entry, non-object boundary)', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'bad-level'), { ...rawTenant('bad-level', { cmmc_level: 'L3', cui_boundary: {} }), kind: 'live' });
    await expect(makeRegistry(roots).get('bad-level')).rejects.toThrow(/invalid cmmc_level/);

    writeJson(newRootPath(roots, 'live', 'bad-array'), {
      ...rawTenant('bad-array', { cmmc_level: 'L2', cui_boundary: { resource_allowlist: ['ok', 42] } }),
      kind: 'live',
    });
    await expect(makeRegistry(roots).get('bad-array')).rejects.toThrow(/cui_boundary\.resource_allowlist/);

    writeJson(newRootPath(roots, 'live', 'bad-shape'), { ...rawTenant('bad-shape', { assessment_scope: 'everything' }), kind: 'live' });
    await expect(makeRegistry(roots).get('bad-shape')).rejects.toThrow(/invalid assessment_scope/);
  });

  it('honors cmmc_migration_exempt (snake_case) and the literal cmmcMigrationExempt convention', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'snake'), { ...rawTenant('snake', { cmmc_migration_exempt: true }), kind: 'live' });
    writeJson(newRootPath(roots, 'live', 'camel'), { ...rawTenant('camel'), cmmcMigrationExempt: true, kind: 'live' });
    writeJson(newRootPath(roots, 'live', 'bad-exempt'), { ...rawTenant('bad-exempt', { cmmc_migration_exempt: 'yes' }), kind: 'live' });

    const registry = makeRegistry(roots);
    expect((await registry.get('snake'))?.cmmcMigrationExempt).toBe(true);
    expect((await registry.get('camel'))?.cmmcMigrationExempt).toBe(true);
    await expect(registry.get('bad-exempt')).rejects.toThrow(/invalid cmmc_migration_exempt/);
  });

  it('defaults kind:sim records to cmmcMigrationExempt=true; an explicit value (true or false) wins', async () => {
    const roots = makeRoots();
    // sim record with no exempt marker -> exempt by default (ephemeral sims are
    // not real assessment targets; G-AO-CMMC-BOUND-1 record-migration).
    writeJson(newRootPath(roots, 'sim', 'sim-default'), { ...rawTenant('sim-default'), kind: 'sim' });
    // sim record explicitly opted BACK INTO the migration denominator.
    writeJson(newRootPath(roots, 'sim', 'sim-optin'), { ...rawTenant('sim-optin', { cmmc_migration_exempt: false }), kind: 'sim' });
    // live record is unaffected by the sim default (stays undefined).
    writeJson(newRootPath(roots, 'live', 'live-plain'), { ...rawTenant('live-plain'), kind: 'live' });

    const registry = makeRegistry(roots);
    expect((await registry.get('sim-default'))?.cmmcMigrationExempt).toBe(true);
    expect((await registry.get('sim-optin'))?.cmmcMigrationExempt).toBe(false);
    expect((await registry.get('live-plain'))?.cmmcMigrationExempt).toBeUndefined();

    // The default is surfaced generically by listByKind, not only by get.
    const sims = await registry.listByKind('sim');
    expect(sims.find((r) => r.tenantSlug === 'sim-default')?.cmmcMigrationExempt).toBe(true);
    expect(sims.find((r) => r.tenantSlug === 'sim-optin')?.cmmcMigrationExempt).toBe(false);
  });

  it('G7: kind + CMMC fields are surfaced generically by listByKind, not only by get', async () => {
    const roots = makeRoots();
    writeJson(newRootPath(roots, 'live', 'acme'), {
      ...rawTenant('acme', { cmmc_level: 'L2', cui_boundary: { tag_key: 'cui', tag_value: 'true' } }),
      kind: 'live',
    });
    const [record] = await makeRegistry(roots).listByKind('live');
    expect(record.kind).toBe('live');
    expect(record.cmmcLevel).toBe('L2');
    expect(record.cuiBoundary).toEqual({ tagKey: 'cui', tagValue: 'true' });
  });
});
