// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-20 / SP-3 (R3, SECRETS-PLAN.md): AO accepts a store-held, non-exportable tenant key.
// `auth.cert_source: 'store'` (ces-shared TenantConfig.certSource) => the thumbprint must be in the
// certificate store WITH a private key, and no PFX file is required. `file` (the default) keeps the
// original rule. The store probe is injected, so no test touches a real certificate store.
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TenantConfig } from 'ces-shared/config';
import {
  createExecutionContext,
  validateTenantKey,
  type CertStoreProbe,
} from '../src/execution/AuthChain.js';

const THUMB = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';

type KeyFields = { certSource?: 'file' | 'store'; certStoreRef?: string };

function cfg(overrides: Partial<TenantConfig> & KeyFields = {}): TenantConfig & KeyFields {
  return {
    tenantSlug: 'acme',
    tenantId: 'guid-1',
    appId: 'app-1',
    certPath: path.join(os.tmpdir(), 'fin20-no-such-file.cer'),
    certThumbprint: THUMB,
    domain: 'acme.onmicrosoft.us',
    endpoints: {} as TenantConfig['endpoints'],
    ...overrides,
  } as TenantConfig & KeyFields;
}

const probeOf = (r: ReturnType<CertStoreProbe>) => vi.fn<CertStoreProbe>(() => r);

describe('SP-3 validateTenantKey — store mode', () => {
  it('passes when the thumbprint is in the store with a private key, with no PFX on disk', () => {
    const probe = probeOf({ found: true, hasPrivateKey: true, location: 'Cert:\\CurrentUser\\My' });
    expect(validateTenantKey(cfg({ certSource: 'store' }), probe)).toEqual([]);
    expect(probe).toHaveBeenCalledWith(THUMB, undefined);
  });

  it('passes the record cert_store_ref through to the probe', () => {
    const ref = `Cert:\\LocalMachine\\My\\${THUMB}`;
    const probe = probeOf({ found: true, hasPrivateKey: true });
    expect(validateTenantKey(cfg({ certSource: 'store', certStoreRef: ref }), probe)).toEqual([]);
    expect(probe).toHaveBeenCalledWith(THUMB, ref);
  });

  it('refuses a certificate found without a private key', () => {
    const errs = validateTenantKey(cfg({ certSource: 'store' }), probeOf({ found: true, hasPrivateKey: false }));
    expect(errs.join('\n')).toMatch(/without a private key/);
  });

  it('refuses a thumbprint not in the store', () => {
    const errs = validateTenantKey(cfg({ certSource: 'store' }), probeOf({ found: false, hasPrivateKey: false }));
    expect(errs.join('\n')).toMatch(/not found in the certificate store/);
  });

  it('fails closed when the probe itself fails', () => {
    const errs = validateTenantKey(
      cfg({ certSource: 'store' }),
      probeOf({ found: false, hasPrivateKey: false, error: 'powershell exited 1' }),
    );
    expect(errs.join('\n')).toMatch(/probe failed/);
  });

  it('refuses a malformed thumbprint or store ref without calling the probe', () => {
    const probe = probeOf({ found: true, hasPrivateKey: true });
    expect(validateTenantKey(cfg({ certSource: 'store', certThumbprint: 'THUMB; Remove-Item' }), probe)).toHaveLength(1);
    expect(validateTenantKey(cfg({ certSource: 'store', certStoreRef: 'C:\\certs\\x.pfx' }), probe)).toHaveLength(1);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('SP-3 validateTenantKey — file mode is unchanged', () => {
  it('a record with no cert_source is file mode: a missing PFX is refused and the probe is never called', () => {
    const probe = probeOf({ found: true, hasPrivateKey: true });
    const errs = validateTenantKey(cfg(), probe);
    expect(errs).toEqual([`Certificate file not found at: ${cfg().certPath}`]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('explicit file mode with the file present passes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin20-ao-'));
    try {
      const p = path.join(dir, 'k.pfx');
      fs.writeFileSync(p, 'not-a-real-pfx');
      expect(validateTenantKey(cfg({ certSource: 'file', certPath: p }))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('file mode with no certPath reports CERT_PATH is required', () => {
    expect(validateTenantKey(cfg({ certPath: '' }))).toEqual(['CERT_PATH is required']);
  });
});

describe('SP-3 createExecutionContext (live, dryRun=false)', () => {
  it('builds the context for a store-mode tenant whose key is in the store (no PFX)', () => {
    const probe = probeOf({ found: true, hasPrivateKey: true });
    const { executionConfig } = createExecutionContext(cfg({ certSource: 'store' }), false, probe);
    expect(executionConfig.certThumbprint).toBe(THUMB);
    expect(executionConfig.dryRun).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('refuses a store-mode tenant whose key has no private key', () => {
    expect(() =>
      createExecutionContext(cfg({ certSource: 'store' }), false, probeOf({ found: true, hasPrivateKey: false })),
    ).toThrow(/Configuration validation failed:[\s\S]*without a private key/);
  });

  it('still refuses a file-mode tenant whose PFX is missing (the sim path is unchanged)', () => {
    expect(() => createExecutionContext(cfg(), false)).toThrow(/Certificate file not found at/);
  });

  it('dry run never probes', () => {
    const probe = probeOf({ found: false, hasPrivateKey: false });
    expect(() => createExecutionContext(cfg({ certSource: 'store' }), true, probe)).not.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
});
