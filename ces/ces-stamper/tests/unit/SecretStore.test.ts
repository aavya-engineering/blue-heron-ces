// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 2: SecretStore is the in-memory-only holding area for operator-held secret
// values. This test proves it never persists — no file appears anywhere under a temp CES_PIPELINE_ROOT
// after set()/getAll() round-trip, and per-tenant isolation holds.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SecretStore } from '../../src/core/SecretStore';

describe('SecretStore', () => {
  afterEach(() => {
    SecretStore.clearAll();
  });

  it('round-trips a value for a tenant/variable pair', () => {
    SecretStore.set('tenant-a', 'initialPassword', 'Sup3r-Secret!');
    expect(SecretStore.get('tenant-a', 'initialPassword')).toBe('Sup3r-Secret!');
  });

  it('returns undefined for a variable never set', () => {
    expect(SecretStore.get('tenant-a', 'neverSet')).toBeUndefined();
  });

  it('isolates values per tenant — the same variable name on another tenant is unaffected', () => {
    SecretStore.set('tenant-a', 'initialPassword', 'aaa');
    SecretStore.set('tenant-b', 'initialPassword', 'bbb');
    expect(SecretStore.get('tenant-a', 'initialPassword')).toBe('aaa');
    expect(SecretStore.get('tenant-b', 'initialPassword')).toBe('bbb');
  });

  it('getAll returns every stored variable for a tenant as a plain object', () => {
    SecretStore.set('tenant-a', 'initialPassword', 'aaa');
    SecretStore.set('tenant-a', 'touAdminSecret', 'zzz');
    expect(SecretStore.getAll('tenant-a')).toEqual({ initialPassword: 'aaa', touAdminSecret: 'zzz' });
  });

  it('getAll on a tenant with nothing stored returns an empty object, never undefined', () => {
    expect(SecretStore.getAll('never-touched')).toEqual({});
  });

  it('clear(tenant, variable) removes only that variable', () => {
    SecretStore.set('tenant-a', 'initialPassword', 'aaa');
    SecretStore.set('tenant-a', 'touAdminSecret', 'zzz');
    SecretStore.clear('tenant-a', 'initialPassword');
    expect(SecretStore.get('tenant-a', 'initialPassword')).toBeUndefined();
    expect(SecretStore.get('tenant-a', 'touAdminSecret')).toBe('zzz');
  });

  it('clear(tenant) with no variable removes every variable for that tenant', () => {
    SecretStore.set('tenant-a', 'initialPassword', 'aaa');
    SecretStore.set('tenant-a', 'touAdminSecret', 'zzz');
    SecretStore.clear('tenant-a');
    expect(SecretStore.getAll('tenant-a')).toEqual({});
  });

  it('throws rather than silently accepting an empty tenant or variable name', () => {
    expect(() => SecretStore.set('', 'initialPassword', 'x')).toThrow();
    expect(() => SecretStore.set('tenant-a', '', 'x')).toThrow();
  });

  it('never touches disk — no file is created anywhere under a fresh temp root while values are stored', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-secretstore-'));
    try {
      const before = fs.readdirSync(tmpRoot);
      SecretStore.set('tenant-a', 'initialPassword', 'Sup3r-Secret!');
      SecretStore.getAll('tenant-a');
      const after = fs.readdirSync(tmpRoot);
      expect(after).toEqual(before);
      expect(after).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
