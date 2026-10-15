// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-G (2026-09-28) — a software WebAuthn authenticator for tests. No browser, no device, no
 * network: a locally generated P-256 key pair produces real registration (attestation `none`) and
 * authentication (ES256 assertion) responses that @simplewebauthn/server verifies exactly as it
 * would a platform passkey. Knobs let a test break one property at a time (origin, rpId, user
 * verification, counter).
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

export const b64url = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface SoftAuthenticatorOpts {
  /** Origin the "browser" reports in clientDataJSON. */
  origin: string;
  /** RP id the authenticator hashes into authenticatorData. */
  rpId: string;
}

export interface CeremonyOverrides {
  origin?: string;
  rpId?: string;
  /** Set false to leave the user-verified flag clear. Default true. */
  userVerified?: boolean;
  /** Signature counter to report (authentication). Default: internal counter, incremented. */
  counter?: number;
  /** Challenge to sign instead of the one in the options. */
  challenge?: string;
}

export class SoftAuthenticator {
  readonly credentialId: Buffer = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cosePublicKey: Uint8Array;
  private userHandle: string | undefined;
  counter = 0;

  constructor(private readonly opts: SoftAuthenticatorOpts) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    // COSE_Key: kty EC2 (2), alg ES256 (-7), crv P-256 (1), x, y
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
    ]);
    this.cosePublicKey = isoCBOR.encode(cose as any);
  }

  get id(): string { return b64url(this.credentialId); }

  private authData(rpId: string, flags: number, counter: number, attested?: Uint8Array): Buffer {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter >>> 0, 0);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), c, ...(attested ? [Buffer.from(attested)] : [])]);
  }

  /** Answer navigator.credentials.create() for the given (JSON) creation options. */
  register(options: { challenge: string; user?: { id: string } }, o: CeremonyOverrides = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.create', challenge: o.challenge ?? options.challenge, origin: o.origin ?? this.opts.origin, crossOrigin: false,
    }));
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length, 0);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, Buffer.from(this.cosePublicKey)]);
    const flags = FLAG_UP | FLAG_AT | ((o.userVerified ?? true) ? FLAG_UV : 0);
    const authData = this.authData(o.rpId ?? this.opts.rpId, flags, 0, attested);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)],
    ]) as any);
    this.userHandle = options.user?.id;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** Answer navigator.credentials.get() for the given (JSON) request options. */
  assert(options: { challenge: string }, o: CeremonyOverrides = {}) {
    const counter = o.counter ?? ++this.counter;
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.get', challenge: o.challenge ?? options.challenge, origin: o.origin ?? this.opts.origin, crossOrigin: false,
    }));
    const flags = FLAG_UP | ((o.userVerified ?? true) ? FLAG_UV : 0);
    const authenticatorData = this.authData(o.rpId ?? this.opts.rpId, flags, counter);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        ...(this.userHandle ? { userHandle: this.userHandle } : {}),
      },
      clientExtensionResults: {},
    };
  }
}
