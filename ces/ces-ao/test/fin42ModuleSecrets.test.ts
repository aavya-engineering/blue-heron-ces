// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-42 (SP-4): AO reads its bearer token and principal secret from the DPAPI module-secret store
// through secretEnv(), with an EMPTY process environment for those names. The store is a temp file
// written with a fake protector (no DPAPI, nothing persistent). Unit form of V75 clause (b).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  buildModuleSecretsStore,
  initModuleSecrets,
  secretEnv,
  resetModuleSecretsForTests,
  type Protector,
} from 'ces-shared/secrets';
import { AoServer } from '../src/server/AoServer.js';
import { aoPrincipalOptionsFromEnv } from '../src/server/principal.js';

const fake: Protector = {
  protect: (b) => Buffer.concat([Buffer.from('F:'), Buffer.from(b).reverse()]),
  unprotect: (b) => Buffer.from(b.subarray(2)).reverse(),
};

let tmpRoot: string;
let savedPipelineRoot: string | undefined;
let server: Server | undefined;
const token = crypto.randomBytes(24).toString('base64url');

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-fin42-'));
  savedPipelineRoot = process.env.CES_PIPELINE_ROOT;
  process.env.CES_PIPELINE_ROOT = tmpRoot;
});
afterEach(async () => {
  resetModuleSecretsForTests();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
afterAll(() => {
  if (savedPipelineRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
  else process.env.CES_PIPELINE_ROOT = savedPipelineRoot;
  // The approvals store may still hold its file open on Windows; temp cleanup is best-effort.
  try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp only */ }
});

describe('FIN-42 AO starts from a module-secret store', () => {
  it('token from the store: /api/health says ENFORCED and a tokenless /api call is 401', async () => {
    const storePath = path.join(tmpRoot, 'module-secrets.dpapi');
    fs.writeFileSync(storePath, buildModuleSecretsStore({ CES_AO_AUTH_TOKEN: token, CES_AO_PRINCIPAL_SECRET: crypto.randomBytes(24).toString('base64url') }, 'CurrentUser', fake));
    initModuleSecrets({ path: storePath, protector: fake, env: {} });
    const env = secretEnv({ CES_PIPELINE_ROOT: tmpRoot });
    expect(env.CES_AO_AUTH_TOKEN === token).toBe(true);

    const app = AoServer.createApp(env);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const health = await (await fetch(`${base}/api/health`)).json() as { auth?: string };
    expect(health.auth).toBe('ENFORCED');
    expect((await fetch(`${base}/api/approvals`)).status).toBe(401);
    expect((await fetch(`${base}/api/approvals`, { headers: { authorization: `Bearer ${token}` } })).status).not.toBe(401);
  });

  it('principal secret from the store reaches the default principal options', () => {
    const storePath = path.join(tmpRoot, 'p.dpapi');
    fs.writeFileSync(storePath, buildModuleSecretsStore({ CES_AO_PRINCIPAL_SECRET: crypto.randomBytes(24).toString('base64url') }, 'CurrentUser', fake));
    const saved = process.env.CES_AO_PRINCIPAL_SECRET;
    delete process.env.CES_AO_PRINCIPAL_SECRET;
    try {
      expect(aoPrincipalOptionsFromEnv().verifier).toBeUndefined();
      initModuleSecrets({ path: storePath, protector: fake, env: {} });
      expect(aoPrincipalOptionsFromEnv().verifier).toBeDefined();
      expect(process.env.CES_AO_PRINCIPAL_SECRET).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.CES_AO_PRINCIPAL_SECRET = saved;
    }
  });
});
