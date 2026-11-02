// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

// FIN-42 (SP-4): the inlined child-env scrub matches ces-shared's scrubEnv (the source of truth).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHILD_ENV_SECRET_NAMES, CHILD_ENV_SECRET_PATTERNS, isChildEnvSecretName, scrubChildEnv } from '../impl/scrub-child-env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED_SCRUB = path.resolve(HERE, '../../../ces-shared/src/secrets/scrubEnv.ts');

describe('scrubChildEnv (FIN-42 / SP-4)', () => {
  it('drops every module-secret name, case-insensitively, keeps the rest, never mutates the input', () => {
    const env = {
      CES_AO_AUTH_TOKEN: 'x', ces_eo_auth_token: 'x', CES_STAMPER_AUTH_TOKEN: 'x', CES_AO_PRINCIPAL_SECRET: 'x',
      CES_EC_PRINCIPAL_SECRET: 'x', EVIDENCE_OPS_SECRET: 'x', JWT_SECRET: 'x', CES_MUSTER_SECRETS_TOKEN: 'x',
      CES_EO_OPERATOR_SECRET: 'x', DATABASE_URL: 'x', ANTHROPIC_API_KEY: 'x',
      PATH: 'p', PSModulePath: 'm', STACKSIM_SERVER_URL: 'u', CES_PIPELINE_ROOT: 'r', CES_EO_URL: 'e',
    };
    const copy = { ...env };
    const out = scrubChildEnv(env);
    expect(Object.keys(out).sort()).toEqual(['CES_EO_URL', 'CES_PIPELINE_ROOT', 'PATH', 'PSModulePath', 'STACKSIM_SERVER_URL']);
    expect(env).toEqual(copy);
    expect(isChildEnvSecretName('CES_TENANT_ROOT')).toBe(false);
  });

  it.skipIf(!fs.existsSync(SHARED_SCRUB))('keeps the same names and patterns as ces-shared/src/secrets/scrubEnv.ts', async () => {
    const shared = (await import(pathToFileURL(SHARED_SCRUB).href)) as {
      MODULE_SECRET_NAMES: readonly string[];
      MODULE_SECRET_PATTERNS: readonly RegExp[];
    };
    expect([...CHILD_ENV_SECRET_NAMES].sort()).toEqual([...shared.MODULE_SECRET_NAMES].sort());
    expect(CHILD_ENV_SECRET_PATTERNS.map(String).sort()).toEqual(shared.MODULE_SECRET_PATTERNS.map(String).sort());
  });
});
