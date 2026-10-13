// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { mintToken, verifyToken } from '../src/lib/jwt.js';

describe('jwt', () => {
  const payload = {
    sub: 'user-123',
    tenant_id: 'tenant-456',
    party_id: null,
    role: 'prime',
  };

  it('mintToken returns a string', () => {
    const token = mintToken(payload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('verifyToken returns correct payload for minted token', () => {
    const token = mintToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.tenant_id).toBe(payload.tenant_id);
    expect(decoded.party_id).toBe(payload.party_id);
    expect(decoded.role).toBe(payload.role);
  });

  it('verifyToken throws on garbage token', () => {
    expect(() => verifyToken('garbage-token-not-valid')).toThrow();
  });

  it('verifyToken throws on expired token', async () => {
    const token = mintToken(payload, { expiresIn: 1 }); // 1 second
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    expect(() => verifyToken(token)).toThrow();
  });
});
