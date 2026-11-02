// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-E test kit: a local stand-in for an Entra ID tenant's signing keys. RSA key pairs are
 * generated in-process; tokens are signed RS256 with node:crypto; the JWKS is served by an injected
 * fetchJson that records every URL it is asked for. Nothing touches the network.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export const OP_TENANT = '00000000-0000-4000-8000-0000000e0e01';
export const OTHER_TENANT = '00000000-0000-4000-8000-0000000e0e02';
export const CLIENT_ID = '00000000-0000-4000-8000-0000000c1e01';
export const OP_GROUP = '00000000-0000-4000-8000-0000000a9001';
export const OTHER_GROUP = '00000000-0000-4000-8000-0000000a9002';
export const HOST = 'login.microsoftonline.com';
export const ISSUER = `https://${HOST}/${OP_TENANT}/v2.0`;
export const JWKS_URI = `https://${HOST}/${OP_TENANT}/discovery/v2.0/keys`;

export const entraEnv = (): Record<string, string> => ({
  CES_EO_OPERATOR_ENTRA_TENANT_ID: OP_TENANT,
  CES_EO_OPERATOR_ENTRA_CLIENT_ID: CLIENT_ID,
  CES_EO_OPERATOR_ENTRA_GROUP_ID: OP_GROUP,
});

export interface KeyPair { kid: string; privateKey: KeyObject; publicKey: KeyObject }

export function makeKey(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, publicKey };
}

export function jwksOf(...keys: KeyPair[]) {
  return { keys: keys.map((k) => ({ ...(k.publicKey.export({ format: 'jwk' }) as object), kid: k.kid, use: 'sig', alg: 'RS256' })) };
}

/** A fetchJson that serves `jwks` for JWKS_URI only and records every request. */
export function fakeFetch(jwks: () => unknown) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (url !== JWKS_URI) throw new Error(`unexpected fetch ${url}`);
    return jwks();
  };
  return { fn, calls };
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Sign an Entra-shaped RS256 token. Defaults describe a valid operator ID token. */
export function entraToken(key: KeyPair, over: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    aud: CLIENT_ID,
    tid: OP_TENANT,
    oid: '11111111-1111-4111-8111-111111111111',
    sub: 'pairwise-subject',
    preferred_username: 'operator.e@bhd.example.test',
    name: 'Operator E',
    groups: [OP_GROUP],
    iat: now,
    nbf: now,
    exp: now + 3600,
    ...over,
  };
  for (const k of Object.keys(claims)) if ((claims as Record<string, unknown>)[k] === undefined) delete (claims as Record<string, unknown>)[k];
  const h = b64u({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const p = b64u(claims);
  const s = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}
