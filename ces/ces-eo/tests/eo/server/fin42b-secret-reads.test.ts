// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.


// FIN-42b: EO's remaining secret read sites go through the module-secret view (secretEnv()). Each secret is
// held ONLY in a store (temp file, fake protector), never in process.env, and must still reach the read site.
// Values are compared as booleans and never printed.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  buildModuleSecretsStore,
  initModuleSecrets,
  resetModuleSecretsForTests,
  type Protector,
} from 'ces-shared/secrets';
import { uploaderIssuerConfigured } from '../../../src/eo/uploader-tokens/UploaderTokenIssuer';
import { describeEoUi } from '../../../src/eo/server/routers/eo-ui-router';
import { runEo } from '../../../src/cli/eo';

const fake: Protector = {
  protect: (b) => Buffer.concat([Buffer.from('F:'), Buffer.from(b).reverse()]),
  unprotect: (b) => Buffer.from(b.subarray(2)).reverse(),
};

let tmp: string;
const ecSecret = crypto.randomBytes(32).toString('base64url');
const eoToken = crypto.randomBytes(32).toString('base64url');

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fin42b-'));
  expect(process.env.CES_EC_PRINCIPAL_SECRET === undefined && process.env.CES_EO_AUTH_TOKEN === undefined).toBe(true);
});
afterEach(() => resetModuleSecretsForTests());
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp only */ } });

function initStore(values: Record<string, string>): void {
  const p = path.join(tmp, `store-${crypto.randomUUID()}.dpapi`);
  fs.writeFileSync(p, buildModuleSecretsStore(values, 'CurrentUser', fake));
  initModuleSecrets({ path: p, protector: fake, env: {} });
}

describe('FIN-42b EO secret read sites use secretEnv()', () => {
  it('without a store, the uploader issuer is not configured (the env has no EC secret)', () => {
    expect(uploaderIssuerConfigured()).toBe(false);
    expect(describeEoUi(tmp).uploaderTokenIssuer).toBe(false);
  });

  it('CES_EC_PRINCIPAL_SECRET held only in the store reaches the uploader issuer and /api/ui/info', () => {
    initStore({ CES_EC_PRINCIPAL_SECRET: ecSecret });
    expect(uploaderIssuerConfigured()).toBe(true);
    expect(describeEoUi(tmp).uploaderTokenIssuer).toBe(true);
    expect(process.env.CES_EC_PRINCIPAL_SECRET).toBeUndefined();
  });

  it('the eo CLI sends CES_EO_AUTH_TOKEN from the store as its bearer', async () => {
    initStore({ CES_EO_AUTH_TOKEN: eoToken });
    let sentOk = false;
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      const h = new Headers(init?.headers);
      sentOk = h.get('authorization') === `Bearer ${eoToken}`;
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const out: string[] = [];
    const code = await runEo(['status'], { fetchImpl, stdout: { write: (s) => { out.push(s); } }, stderr: { write: () => {} } });
    expect(code).toBe(0);
    expect(sentOk).toBe(true);
    expect(out.join('').includes(eoToken)).toBe(false);
  });

  it('EoServer loopbackAssess reads CES_EO_AUTH_TOKEN through secretEnv() (text pin; BOM kept)', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../../src/eo/server/EoServer.ts'), 'utf8');
    expect(raw.charCodeAt(0)).toBe(0xfeff);
    expect(raw).toContain("import { secretEnv } from 'ces-shared/secrets';");
    expect(raw).toContain('{ token: secretEnv().CES_EO_AUTH_TOKEN }');
    expect(raw).not.toContain('process.env.CES_EO_AUTH_TOKEN');
  });
});
