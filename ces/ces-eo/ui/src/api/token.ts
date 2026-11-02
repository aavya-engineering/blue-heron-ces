// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Reads the claims of a JWT-shaped CES principal token for DISPLAY only (who it names, when it
// expires). Nothing here verifies a signature; the server does. The review screen uses the UPN to
// warn before a self-review, and EO still refuses one (403 reviewer_is_uploader, GD-b).

export interface TokenClaims {
  upn?: string;
  sub?: string;
  roles?: string[];
  exp?: number;
  tid?: string;
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The token's claims, or null when it is not JWT-shaped. */
export function readClaims(token: string | null | undefined): TokenClaims | null {
  if (!token) return null;
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return null;
  try {
    const c = JSON.parse(b64urlDecode(parts[1])) as TokenClaims;
    return c && typeof c === 'object' ? c : null;
  } catch {
    return null;
  }
}

export function tokenUpn(token: string | null | undefined): string | null {
  const c = readClaims(token);
  return c && typeof c.upn === 'string' && c.upn ? c.upn : null;
}

/** True when the token's exp (seconds) is in the past at `nowMs`. Unknown expiry is not expired. */
export function tokenExpired(token: string | null | undefined, nowMs = Date.now()): boolean {
  const c = readClaims(token);
  return !!c && typeof c.exp === 'number' && c.exp * 1000 <= nowMs;
}

export const sameUpn = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
