// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-4 unit tests with a FAKE protector (no DPAPI, no PowerShell). Temp folders only.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  loadModuleSecrets,
  buildModuleSecretsStore,
  overlaySecrets,
  initModuleSecrets,
  secretEnv,
  moduleSecretsPostureLine,
  resetModuleSecretsForTests,
  defaultModuleSecretsPath,
  ModuleSecretsError,
  MODULE_SECRETS_FORMAT,
} from './moduleSecrets.js';
import { DpapiError, type Protector } from './dpapi.js';

const MAGIC = Buffer.from('FAKEDPAPI:');
/** Fake protector: reversible, with an integrity check, so tamper tests mean something. */
const fake: Protector = {
  protect: (plain) => {
    const mac = crypto.createHash('sha256').update(plain).digest().subarray(0, 8);
    return Buffer.concat([MAGIC, mac, Buffer.from(plain).reverse()]);
  },
  unprotect: (blob) => {
    if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new DpapiError('DPAPI_FAILED', 'DPAPI unprotect failed (CryptographicException)');
    const mac = blob.subarray(MAGIC.length, MAGIC.length + 8);
    const plain = Buffer.from(blob.subarray(MAGIC.length + 8)).reverse();
    if (!crypto.createHash('sha256').update(plain).digest().subarray(0, 8).equals(mac)) {
      throw new DpapiError('DPAPI_FAILED', 'DPAPI unprotect failed (CryptographicException)');
    }
    return plain;
  },
};

const rnd = () => crypto.randomBytes(24).toString('base64url');

let dir: string;
let storePath: string;
let values: Record<string, string>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fin42-'));
  storePath = path.join(dir, 'module-secrets.dpapi');
  values = { CES_AO_AUTH_TOKEN: rnd(), EVIDENCE_OPS_SECRET: rnd(), JWT_SECRET: rnd() };
  resetModuleSecretsForTests();
});
afterEach(() => {
  resetModuleSecretsForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeStore(v: Record<string, string> = values): string {
  const doc = buildModuleSecretsStore(v, 'CurrentUser', fake);
  fs.writeFileSync(storePath, doc);
  return doc;
}

function expectNoValue(text: string): void {
  for (const v of Object.values(values)) expect(text).not.toContain(v);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ModuleSecretsError);
    expectNoValue((err as Error).message);
    return (err as ModuleSecretsError).code;
  }
  throw new Error('expected a throw');
}

describe('loadModuleSecrets', () => {
  it('absent store: source none, environment only', () => {
    const s = loadModuleSecrets({ path: storePath, protector: fake, env: {} });
    expect(s.source).toBe('none');
    expect(s.names).toEqual([]);
    expect(s.get('CES_AO_AUTH_TOKEN')).toBeUndefined();
  });

  it('absent store with CES_MODULE_SECRETS_REQUIRED=1 fails closed', () => {
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: { CES_MODULE_SECRETS_REQUIRED: '1' } }))).toBe('STORE_MISSING');
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, required: true, env: {} }))).toBe('STORE_MISSING');
  });

  it('round trip: values come back, names listed, the file never holds a value', () => {
    const doc = writeStore();
    expectNoValue(doc);
    const parsed = JSON.parse(doc);
    expect(parsed.format).toBe(MODULE_SECRETS_FORMAT);
    expect(parsed.names).toEqual(Object.keys(values).sort());
    const s = loadModuleSecrets({ path: storePath, protector: fake, env: {} });
    expect(s.source).toBe('store');
    expect(s.names).toEqual(Object.keys(values).sort());
    for (const [k, v] of Object.entries(values)) expect(s.get(k) === v).toBe(true);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.names)).toBe(true);
  });

  it('path comes from CES_MODULE_SECRETS_PATH when not given', () => {
    writeStore();
    const s = loadModuleSecrets({ protector: fake, env: { CES_MODULE_SECRETS_PATH: storePath } });
    expect(s.source).toBe('store');
  });

  it('tampered blob fails closed with a regenerate hint and no value', () => {
    const doc = JSON.parse(writeStore());
    const blob = Buffer.from(doc.protected, 'base64');
    blob[blob.length - 3] ^= 0xff;
    doc.protected = blob.toString('base64');
    fs.writeFileSync(storePath, JSON.stringify(doc));
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe('STORE_UNPROTECT_FAILED');
    try { loadModuleSecrets({ path: storePath, protector: fake, env: {} }); } catch (e) {
      expect((e as Error).message).toMatch(/New-CesModuleSecrets\.ps1/);
    }
  });

  it('a store made for another account (protector refuses) fails closed', () => {
    writeStore();
    const other: Protector = { protect: fake.protect, unprotect: () => { throw new DpapiError('DPAPI_FAILED', 'DPAPI unprotect failed (CryptographicException)'); } };
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: other, env: {} }))).toBe('STORE_UNPROTECT_FAILED');
  });

  it('malformed documents fail closed', () => {
    const good = JSON.parse(writeStore());
    const cases: Array<[string, string]> = [
      ['not json {', 'STORE_MALFORMED'],
      [JSON.stringify({ ...good, format: 'other/1' }), 'STORE_MALFORMED'],
      [JSON.stringify({ ...good, scope: 'Everyone' }), 'STORE_MALFORMED'],
      [JSON.stringify({ ...good, protected: 'not base64!' }), 'STORE_MALFORMED'],
      [JSON.stringify({ ...good, names: 'x' }), 'STORE_MALFORMED'],
      [JSON.stringify({ ...good, names: ['CES_AO_AUTH_TOKEN'] }), 'STORE_NAME_MISMATCH'],
    ];
    for (const [text, code] of cases) {
      fs.writeFileSync(storePath, text);
      expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe(code);
    }
  });

  it('a BOM-prefixed store still loads', () => {
    fs.writeFileSync(storePath, '\uFEFF' + buildModuleSecretsStore(values, 'CurrentUser', fake));
    expect(loadModuleSecrets({ path: storePath, protector: fake, env: {} }).source).toBe('store');
  });

  it('payload names must be CES module secrets; values non-empty', () => {
    const put = (payload: unknown) => {
      const blob = fake.protect(Buffer.from(JSON.stringify(payload)), 'CurrentUser');
      const names = payload && typeof payload === 'object' ? Object.keys(payload as object) : [];
      fs.writeFileSync(storePath, JSON.stringify({ format: MODULE_SECRETS_FORMAT, scope: 'CurrentUser', names, protected: blob.toString('base64') }));
    };
    put({ PATH: 'x' });
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe('STORE_BAD_NAME');
    put({ ces_ao_auth_token: 'x' });
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe('STORE_BAD_NAME');
    put({ JWT_SECRET: '' });
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe('STORE_BAD_VALUE');
    put(['JWT_SECRET']);
    expect(codeOf(() => loadModuleSecrets({ path: storePath, protector: fake, env: {} }))).toBe('STORE_MALFORMED');
  });

  it('a store path that is a directory is unreadable, not "absent"', () => {
    expect(codeOf(() => loadModuleSecrets({ path: dir, protector: fake, env: {} }))).toBe('STORE_UNREADABLE');
  });

  it('buildModuleSecretsStore refuses non-secret names', () => {
    expect(() => buildModuleSecretsStore({ HOME: 'x' }, 'CurrentUser', fake)).toThrow(ModuleSecretsError);
  });
});

describe('overlaySecrets / secretEnv', () => {
  it('store value wins for its name only; other names pass through live', () => {
    writeStore();
    const s = loadModuleSecrets({ path: storePath, protector: fake, env: {} });
    const env: NodeJS.ProcessEnv = { CES_AO_AUTH_TOKEN: 'env-token', CES_AO_BIND: '0.0.0.0' };
    const view = overlaySecrets(s, env);
    expect(view.CES_AO_AUTH_TOKEN === values.CES_AO_AUTH_TOKEN).toBe(true);
    expect(view.CES_AO_BIND).toBe('0.0.0.0');
    env.CES_AO_BIND = '10.0.0.5';
    expect(view.CES_AO_BIND).toBe('10.0.0.5');
    expect('JWT_SECRET' in view).toBe(true);
    expect(Object.keys(view)).toEqual(expect.arrayContaining(['CES_AO_BIND', 'JWT_SECRET', 'CES_AO_AUTH_TOKEN']));
    expect({ ...view }.EVIDENCE_OPS_SECRET === values.EVIDENCE_OPS_SECRET).toBe(true);
  });

  it('the view is read-only and never writes into the environment', () => {
    writeStore();
    const s = loadModuleSecrets({ path: storePath, protector: fake, env: {} });
    const env: NodeJS.ProcessEnv = {};
    const view = overlaySecrets(s, env);
    expect(() => { (view as Record<string, string>).X = '1'; }).toThrow(TypeError);
    expect(() => { delete (view as Record<string, string>).JWT_SECRET; }).toThrow(TypeError);
    expect(env).toEqual({});
  });

  it('no store: the view IS the environment object (byte-identical behaviour)', () => {
    const s = loadModuleSecrets({ path: storePath, protector: fake, env: {} });
    const env: NodeJS.ProcessEnv = { CES_AO_AUTH_TOKEN: 't' };
    expect(overlaySecrets(s, env)).toBe(env);
  });

  it('secretEnv before init returns env itself; after init overlays; init is idempotent', () => {
    const env: NodeJS.ProcessEnv = { CES_AO_AUTH_TOKEN: 'env-token' };
    expect(secretEnv(env)).toBe(env);
    expect(moduleSecretsPostureLine()).toMatch(/not initialised/);
    writeStore();
    const first = initModuleSecrets({ path: storePath, protector: fake, env: {} });
    const second = initModuleSecrets({ path: path.join(dir, 'other'), protector: fake, env: {} });
    expect(second).toBe(first);
    expect(secretEnv(env).CES_AO_AUTH_TOKEN === values.CES_AO_AUTH_TOKEN).toBe(true);
    const line = moduleSecretsPostureLine();
    expect(line).toMatch(/DPAPI store/);
    expect(line).toContain('CES_AO_AUTH_TOKEN');
    expectNoValue(line);
  });

  it('init with no store: posture says environment only, secretEnv is env', () => {
    initModuleSecrets({ path: storePath, protector: fake, env: {} });
    const env: NodeJS.ProcessEnv = { CES_AO_AUTH_TOKEN: 't' };
    expect(secretEnv(env)).toBe(env);
    expect(moduleSecretsPostureLine()).toMatch(/no store at .*environment only/);
  });

  it('init fails closed on a present-but-bad store and stays uninitialised', () => {
    fs.writeFileSync(storePath, 'garbage');
    expect(() => initModuleSecrets({ path: storePath, protector: fake, env: {} })).toThrow(ModuleSecretsError);
    expect(moduleSecretsPostureLine()).toMatch(/not initialised/);
  });
});

describe('defaultModuleSecretsPath', () => {
  it('uses ProgramData, or the override', () => {
    expect(defaultModuleSecretsPath({ ProgramData: 'D:\\PD' })).toBe('D:\\PD\\CES\\secrets\\module-secrets.dpapi');
    expect(defaultModuleSecretsPath({})).toBe('C:\\ProgramData\\CES\\secrets\\module-secrets.dpapi');
    expect(defaultModuleSecretsPath({ CES_MODULE_SECRETS_PATH: ' X:\\s.dpapi ' })).toBe('X:\\s.dpapi');
  });
});
