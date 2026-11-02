// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-42b: muster-api's EO client read sites (deliverToEoIntake, emitInterviewRecords) read
// CES_EO_AUTH_TOKEN through the module-secret view (secretEnv()). The token is held ONLY in a store
// (temp file, fake protector); values are compared as booleans and never printed.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { buildModuleSecretsStore, initModuleSecrets, resetModuleSecretsForTests, type Protector } from 'ces-shared/secrets';
import { deliverToEoIntake } from '../src/routes/plan.js';
import { emitInterviewRecords } from '../src/services/interviewRecordService.js';

const fake: Protector = {
  protect: (b) => Buffer.concat([Buffer.from('F:'), Buffer.from(b).reverse()]),
  unprotect: (b) => Buffer.from(b.subarray(2)).reverse(),
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-fin42b-'));
const token = crypto.randomBytes(32).toString('base64url');
const savedUrl = process.env.CES_EO_URL;

afterEach(() => {
  resetModuleSecretsForTests();
  if (savedUrl === undefined) delete process.env.CES_EO_URL; else process.env.CES_EO_URL = savedUrl;
});
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp only */ } });

function initStore(): void {
  const p = path.join(tmp, `store-${crypto.randomUUID()}.dpapi`);
  fs.writeFileSync(p, buildModuleSecretsStore({ CES_EO_AUTH_TOKEN: token }, 'CurrentUser', fake));
  initModuleSecrets({ path: p, protector: fake, env: {} });
}

function fakeEo(status: number): { fetchImpl: typeof fetch; bearerOk: () => boolean } {
  let ok = false;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    ok = new Headers(init?.headers).get('authorization') === `Bearer ${token}`;
    return new Response(JSON.stringify({ stored: 1, skipped: 0 }), { status });
  }) as typeof fetch;
  return { fetchImpl, bearerOk: () => ok };
}

describe('FIN-42b muster-api EO client reads use secretEnv()', () => {
  test('no store and no env token: not_configured, as before', async () => {
    expect(process.env.CES_EO_AUTH_TOKEN === undefined).toBe(true);
    process.env.CES_EO_URL = 'http://127.0.0.1:1';
    expect(await deliverToEoIntake({})).toEqual({ status: 'not_configured' });
  });

  test('deliverToEoIntake sends the store-held CES_EO_AUTH_TOKEN as its bearer', async () => {
    initStore();
    process.env.CES_EO_URL = 'http://127.0.0.1:1';
    const eo = fakeEo(201);
    const r = await deliverToEoIntake({ plans: [] }, undefined, eo.fetchImpl);
    expect(r.status).not.toBe('not_configured');
    expect(eo.bearerOk()).toBe(true);
    expect(process.env.CES_EO_AUTH_TOKEN).toBeUndefined();
  });

  test('emitInterviewRecords sends the store-held CES_EO_AUTH_TOKEN as its bearer', async () => {
    initStore();
    process.env.CES_EO_URL = 'http://127.0.0.1:1';
    const eo = fakeEo(201);
    const r = await emitInterviewRecords('fx-fin42b', [{} as never], undefined, eo.fetchImpl);
    expect(r.status).toBe('delivered');
    expect(eo.bearerOk()).toBe(true);
  });
});
