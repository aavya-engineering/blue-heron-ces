// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T6 — loadTenantConfig resolves secret references in auth/storage fields.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTenantConfig } from './TenantConfig.js';

let tmp: string;
const env0 = { ...process.env };

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-cfg-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of ['VFS_THUMB', 'VFS_STORAGE_KEY', 'CES_STRICT_SECRETS'] as const) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
});

function write(name: string, obj: unknown): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

const base = (overrides: Record<string, unknown> = {}) => ({
  client: { slug: 'acme' },
  tenant: { tenant_id: 'guid', domain: 'acme.com' },
  auth: { app_id: 'app', cert_path: '/c.pfx', cert_thumbprint: 'LITERAL_THUMB', ...overrides },
});

describe('loadTenantConfig secret-ref resolution', () => {
  it('passes a literal cert_thumbprint through unchanged', () => {
    const cfg = loadTenantConfig(write('lit.json', base()));
    expect(cfg.certThumbprint).toBe('LITERAL_THUMB');
  });

  it('resolves an env: cert_thumbprint from the environment', () => {
    process.env.VFS_THUMB = 'RESOLVED_THUMB';
    const cfg = loadTenantConfig(write('ref.json', base({ cert_thumbprint: 'env:VFS_THUMB' })));
    expect(cfg.certThumbprint).toBe('RESOLVED_THUMB');
  });

  it('fails closed when a referenced secret env var is unset', () => {
    expect(() => loadTenantConfig(write('missing.json', base({ cert_thumbprint: '${VFS_THUMB}' })))).toThrow(
      /not set/,
    );
  });

  it('resolves a referenced evidence_storage.account_key', () => {
    process.env.VFS_STORAGE_KEY = 'sk-resolved';
    const cfg = loadTenantConfig(
      write('storage.json', { ...base(), evidence_storage: { account_name: 'sa', account_key: 'env:VFS_STORAGE_KEY', container: 'c', base_path: 'b', blob_endpoint: 'e' } }),
    );
    expect(cfg.evidenceStorage?.account_key).toBe('sk-resolved');
  });
});

describe('loadTenantConfig strict-secrets mode (G8 — CES_STRICT_SECRETS)', () => {
  it('rejects an inline literal cert_thumbprint when strict mode is on', () => {
    process.env.CES_STRICT_SECRETS = '1';
    expect(() => loadTenantConfig(write('strict-lit.json', base()))).toThrow(/inline secret/);
  });

  it('accepts a referenced cert_thumbprint under strict mode', () => {
    process.env.CES_STRICT_SECRETS = '1';
    process.env.VFS_THUMB = 'RESOLVED_THUMB';
    const cfg = loadTenantConfig(write('strict-ref.json', base({ cert_thumbprint: 'env:VFS_THUMB' })));
    expect(cfg.certThumbprint).toBe('RESOLVED_THUMB');
  });

  it('rejects an inline evidence_storage.account_key under strict mode', () => {
    process.env.CES_STRICT_SECRETS = '1';
    process.env.VFS_THUMB = 'RESOLVED_THUMB';
    expect(() =>
      loadTenantConfig(
        write('strict-storage.json', {
          ...base({ cert_thumbprint: 'env:VFS_THUMB' }),
          evidence_storage: { account_name: 'sa', account_key: 'INLINE_KEY', container: 'c', base_path: 'b', blob_endpoint: 'e' },
        }),
      ),
    ).toThrow(/inline secret/);
  });

  it('is off by default (inline secrets pass) — zero regression', () => {
    const cfg = loadTenantConfig(write('default-lit.json', base()));
    expect(cfg.certThumbprint).toBe('LITERAL_THUMB');
  });
});

describe('loadTenantConfig CMMC scoping fields (GP-SHARED-M0-1)', () => {
  it('leaves all three fields undefined when absent — backward compat', () => {
    const cfg = loadTenantConfig(write('cmmc-absent.json', base()));
    expect(cfg.cmmcLevel).toBeUndefined();
    expect(cfg.assessmentScope).toBeUndefined();
    expect(cfg.cuiBoundary).toBeUndefined();
  });

  it('parses cmmc_level, assessment_scope, and allowlist cui_boundary to camelCase fields', () => {
    const cfg = loadTenantConfig(
      write('cmmc-full.json', {
        ...base(),
        cmmc_level: 'L2',
        assessment_scope: {
          subscription_ids: ['sub-1'],
          resource_groups: ['rg-cui'],
          ous: ['OU=CUI'],
        },
        cui_boundary: { resource_allowlist: ['vault_name', 'log_workspace'] },
      }),
    );
    expect(cfg.cmmcLevel).toBe('L2');
    expect(cfg.assessmentScope).toEqual({
      subscriptionIds: ['sub-1'],
      resourceGroups: ['rg-cui'],
      ous: ['OU=CUI'],
    });
    expect(cfg.cuiBoundary).toEqual({
      resourceAllowlist: ['vault_name', 'log_workspace'],
      tagKey: undefined,
      tagValue: undefined,
    });
  });

  it('parses a tag-based cui_boundary', () => {
    const cfg = loadTenantConfig(
      write('cmmc-tag.json', {
        ...base(),
        cmmc_level: 'L1',
        cui_boundary: { tag_key: 'data-class', tag_value: 'cui' },
      }),
    );
    expect(cfg.cuiBoundary?.tagKey).toBe('data-class');
    expect(cfg.cuiBoundary?.tagValue).toBe('cui');
    expect(cfg.cuiBoundary?.resourceAllowlist).toBeUndefined();
  });

  it('throws on an invalid cmmc_level value (fail closed on config error)', () => {
    expect(() => loadTenantConfig(write('cmmc-bad-level.json', { ...base(), cmmc_level: 'L3' }))).toThrow(
      /invalid cmmc_level/,
    );
  });

  it('throws on a non-string entry in assessment_scope.subscription_ids', () => {
    expect(() =>
      loadTenantConfig(
        write('cmmc-bad-scope.json', { ...base(), assessment_scope: { subscription_ids: ['ok', 42] } }),
      ),
    ).toThrow(/invalid assessment_scope\.subscription_ids/);
  });

  it('throws when assessment_scope is not an object', () => {
    expect(() =>
      loadTenantConfig(write('cmmc-scope-array.json', { ...base(), assessment_scope: ['sub-1'] })),
    ).toThrow(/invalid assessment_scope/);
  });

  it('throws on a non-string cui_boundary.tag_key', () => {
    expect(() =>
      loadTenantConfig(write('cmmc-bad-tag.json', { ...base(), cui_boundary: { tag_key: 7 } })),
    ).toThrow(/invalid cui_boundary\.tag_key/);
  });
});
