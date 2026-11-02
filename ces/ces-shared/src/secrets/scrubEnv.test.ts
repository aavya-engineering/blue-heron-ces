// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { scrubEnv, isModuleSecretName, MODULE_SECRET_NAMES } from './scrubEnv.js';

describe('scrubEnv (SP-4 child-environment scrub)', () => {
  it('removes every listed and patterned secret name, keeps the rest, never mutates', () => {
    const env: NodeJS.ProcessEnv = {
      CES_AO_AUTH_TOKEN: 'a', CES_EO_AUTH_TOKEN: 'b', CES_STAMPER_AUTH_TOKEN: 'c',
      CES_AO_PRINCIPAL_SECRET: 'd', CES_EC_PRINCIPAL_SECRET: 'e', EVIDENCE_OPS_SECRET: 'f',
      JWT_SECRET: 'g', CES_MUSTER_SECRETS_TOKEN: 'h', DATABASE_URL: 'i', ANTHROPIC_API_KEY: 'j',
      CES_EO_OPERATOR_SECRET: 'k',
      PATH: 'p', SystemRoot: 'C:\\Windows', CES_AO_BIND: '0.0.0.0', CES_TENANT_ROOT: 't',
      CES_MODULE_SECRETS_PATH: 'x', CES_AO_PRINCIPAL_ISSUER: 'iss',
    };
    const copy = { ...env };
    const out = scrubEnv(env);
    expect(Object.keys(out).sort()).toEqual(['CES_AO_BIND', 'CES_AO_PRINCIPAL_ISSUER', 'CES_MODULE_SECRETS_PATH', 'CES_TENANT_ROOT', 'PATH', 'SystemRoot']);
    expect(env).toEqual(copy);
    expect(out).not.toBe(env);
  });

  it('matches case-insensitively (Windows env names)', () => {
    expect(isModuleSecretName('jwt_secret')).toBe(true);
    expect(isModuleSecretName('Ces_Ao_Auth_Token')).toBe(true);
    expect(scrubEnv({ anthropic_api_key: 'x', Path: 'p' })).toEqual({ Path: 'p' });
  });

  it('does not over-match look-alikes', () => {
    for (const n of ['CES_AUTH_TOKEN_FILE', 'CES_AO_AUTH_TOKENS', 'JWT_EXPIRES_IN', 'CES_EO_URL', 'CES_AO_PRINCIPAL_AUDIENCE']) {
      expect(isModuleSecretName(n)).toBe(false);
    }
  });

  it('the SP-4 list is frozen and complete', () => {
    expect(Object.isFrozen(MODULE_SECRET_NAMES)).toBe(true);
    for (const n of ['EVIDENCE_OPS_SECRET', 'JWT_SECRET', 'CES_MUSTER_SECRETS_TOKEN', 'DATABASE_URL', 'ANTHROPIC_API_KEY']) {
      expect(MODULE_SECRET_NAMES).toContain(n);
    }
  });

  it('a real child gets none of the secrets (spawnSync with the scrubbed env)', () => {
    const env = { ...process.env, CES_AO_AUTH_TOKEN: 'fin42-sentinel', JWT_SECRET: 'fin42-sentinel', KEEP_ME: '1' };
    const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env)))'], { env: scrubEnv(env), encoding: 'utf8' });
    const keys = (JSON.parse(r.stdout) as string[]).map((k) => k.toUpperCase());
    expect(keys).toContain('KEEP_ME');
    expect(keys).not.toContain('CES_AO_AUTH_TOKEN');
    expect(keys).not.toContain('JWT_SECRET');
  });
});
