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
import { loadTenantConfig, certSourceOf, assertNoLiteralInitialPassword } from './TenantConfig.js';

let tmp: string;
const env0 = { ...process.env };

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-cfg-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of ['EDC_THUMB', 'EDC_STORAGE_KEY', 'CES_STRICT_SECRETS', 'EDC_INITIAL_PW'] as const) {
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
    process.env.EDC_THUMB = 'RESOLVED_THUMB';
    const cfg = loadTenantConfig(write('ref.json', base({ cert_thumbprint: 'env:EDC_THUMB' })));
    expect(cfg.certThumbprint).toBe('RESOLVED_THUMB');
  });

  it('fails closed when a referenced secret env var is unset', () => {
    expect(() => loadTenantConfig(write('missing.json', base({ cert_thumbprint: '${EDC_THUMB}' })))).toThrow(
      /not set/,
    );
  });

  it('resolves a referenced evidence_storage.account_key', () => {
    process.env.EDC_STORAGE_KEY = 'sk-resolved';
    const cfg = loadTenantConfig(
      write('storage.json', { ...base(), evidence_storage: { account_name: 'sa', account_key: 'env:EDC_STORAGE_KEY', container: 'c', base_path: 'b', blob_endpoint: 'e' } }),
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
    process.env.EDC_THUMB = 'RESOLVED_THUMB';
    const cfg = loadTenantConfig(write('strict-ref.json', base({ cert_thumbprint: 'env:EDC_THUMB' })));
    expect(cfg.certThumbprint).toBe('RESOLVED_THUMB');
  });

  it('rejects an inline evidence_storage.account_key under strict mode', () => {
    process.env.CES_STRICT_SECRETS = '1';
    process.env.EDC_THUMB = 'RESOLVED_THUMB';
    expect(() =>
      loadTenantConfig(
        write('strict-storage.json', {
          ...base({ cert_thumbprint: 'env:EDC_THUMB' }),
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

describe('loadTenantConfig licence opt-ins (PH-13 P13-LV, DD-h)', () => {
  it('is undefined when absent: no licence-gated registry entry is opted in', () => {
    expect(loadTenantConfig(write('lic-absent.json', base())).licence_opt_ins).toBeUndefined();
  });
  it('keeps the string opt-ins and drops anything else', () => {
    const cfg = loadTenantConfig(write('lic-set.json', { ...base(), licence_opt_ins: ['entra_id_governance', 7, null, 'other'] }));
    expect(cfg.licence_opt_ins).toEqual(['entra_id_governance', 'other']);
  });
  it('ignores a non-array value', () => {
    expect(loadTenantConfig(write('lic-bad.json', { ...base(), licence_opt_ins: 'entra_id_governance' })).licence_opt_ins).toBeUndefined();
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

// FIN-20 / SP-1 (R1, SECRETS-PLAN.md): a literal initial password in a tenant record is refused.
describe('loadTenantConfig refuses a literal initial password (SP-1, always on)', () => {
  // A value that must never appear in an error message.
  const LIT = 'Literal-Pa55-Never-Echo';
  const withResources = (resources: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...base(),
    ...extra,
    resources,
  });

  it('refuses a live record carrying resources.initial_password, naming the field but not the value', () => {
    let err: unknown;
    try {
      loadTenantConfig(write('pw-live.json', withResources({ initial_password: LIT })));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/resources\.initial_password/);
    expect(msg).not.toContain(LIT);
  });

  it('refuses it with no CES_STRICT_SECRETS switch set (the guard is not opt-in)', () => {
    delete process.env.CES_STRICT_SECRETS;
    expect(() => loadTenantConfig(write('pw-live2.json', withResources({ initial_password: LIT }))))
      .toThrow(/initial_password/);
  });

  it('refuses it on an explicit kind:"live" record even if the environment says sim', () => {
    const rec = withResources({ initial_password: LIT }, { kind: 'live' });
    (rec as any).tenant = { ...(rec as any).tenant, environment: 'gcc-high-sim' };
    expect(() => loadTenantConfig(write('pw-kind-live.json', rec))).toThrow(/initial_password/);
  });

  it('keeps sim records loading (tenant-stacksim writes a labelled fake; marker = gcc-high-sim)', () => {
    const rec = withResources({ initial_password: 'Sim-Only-Fake' });
    (rec as any).tenant = { ...(rec as any).tenant, environment: 'gcc-high-sim' };
    expect(() => loadTenantConfig(write('pw-sim.json', rec))).not.toThrow();
    expect(() => loadTenantConfig(write('pw-sim-kind.json', withResources({ initial_password: 'x' }, { kind: 'sim' }))))
      .not.toThrow();
  });

  it('accepts an empty initial_password and a record with no resources', () => {
    expect(() => loadTenantConfig(write('pw-empty.json', withResources({ initial_password: '' })))).not.toThrow();
    expect(() => loadTenantConfig(write('pw-none.json', base()))).not.toThrow();
  });

  it('accepts initial_password_ref only as a reference, left unresolved in resources', () => {
    const cfg = loadTenantConfig(write('pw-ref.json', withResources({ initial_password_ref: 'env:EDC_INITIAL_PW' })));
    expect(cfg.resources?.initial_password_ref).toBe('env:EDC_INITIAL_PW');
    expect(() => loadTenantConfig(write('pw-ref2.json', withResources({ initial_password_ref: '${EDC_INITIAL_PW}' }))))
      .not.toThrow();
  });

  it('refuses a literal in initial_password_ref (any record kind) without echoing it', () => {
    const rec = withResources({ initial_password_ref: LIT }, { kind: 'sim' });
    let msg = '';
    try {
      loadTenantConfig(write('pw-ref-lit.json', rec));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/initial_password_ref must be a reference/);
    expect(msg).not.toContain(LIT);
  });

  it('exposes the guard for callers that hold the raw record', () => {
    expect(() => assertNoLiteralInitialPassword({ resources: { initial_password: LIT } })).toThrow();
    expect(() => assertNoLiteralInitialPassword({})).not.toThrow();
  });
});

// FIN-20 / SP-3 (R3, SECRETS-PLAN.md): auth.cert_source and auth.cert_store_ref.
describe('loadTenantConfig auth.cert_source (SP-3)', () => {
  const THUMB = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';

  it('leaves certSource absent when the record is silent, and certSourceOf defaults to file', () => {
    const cfg = loadTenantConfig(write('cs-none.json', base()));
    expect('certSource' in cfg).toBe(false);
    expect('certStoreRef' in cfg).toBe(false);
    expect(certSourceOf(cfg)).toBe('file');
  });

  it('parses cert_source store with a cert_store_ref', () => {
    const ref = `Cert:\\CurrentUser\\My\\${THUMB}`;
    const cfg = loadTenantConfig(
      write('cs-store.json', base({ cert_source: 'store', cert_store_ref: ref, cert_path: '/c.cer' })),
    );
    expect(cfg.certSource).toBe('store');
    expect(cfg.certStoreRef).toBe(ref);
    expect(certSourceOf(cfg)).toBe('store');
  });

  it('parses cert_source file explicitly', () => {
    expect(loadTenantConfig(write('cs-file.json', base({ cert_source: 'file' }))).certSource).toBe('file');
  });

  it('accepts a store-only cert_store_ref (no thumbprint segment) for LocalMachine', () => {
    const cfg = loadTenantConfig(write('cs-lm.json', base({ cert_source: 'store', cert_store_ref: 'Cert:\\LocalMachine\\My' })));
    expect(cfg.certStoreRef).toBe('Cert:\\LocalMachine\\My');
  });

  it('throws on an unknown cert_source (fail closed)', () => {
    expect(() => loadTenantConfig(write('cs-bad.json', base({ cert_source: 'vault' })))).toThrow(/invalid auth\.cert_source/);
  });

  it('throws on a malformed cert_store_ref (no PowerShell path injection)', () => {
    for (const bad of ['C:\\certs\\x.pfx', 'Cert:\\CurrentUser\\My\\x; Remove-Item', `Cert:\\Other\\My\\${THUMB}`]) {
      expect(() => loadTenantConfig(write('cs-badref.json', base({ cert_source: 'store', cert_store_ref: bad }))))
        .toThrow(/invalid auth\.cert_store_ref/);
    }
  });
});
