// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  tenant_id: string;
  party_id: string | null;
  role: string;
  iat?: number;
  exp?: number;
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const defaultSecret: string = process.env.JWT_SECRET;
const defaultExpiresIn = process.env.JWT_EXPIRES_IN ?? '8h';

export function mintToken(
  payload: JwtPayload,
  options?: { expiresIn?: string | number }
): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { iat: _iat, exp: _exp, ...clean } = payload;
  return jwt.sign(clean, defaultSecret, {
    expiresIn: options?.expiresIn ?? (defaultExpiresIn as string),
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, defaultSecret) as JwtPayload;
}
