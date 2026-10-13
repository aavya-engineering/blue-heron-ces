// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// musterAuth.ts — FX-MU4: the operator signs in to muster-api so the Plan tab's
// "Send to Stamper" / "Check Stamper progress" carry a real bearer token.
//
// muster-api already owns the identity path: POST /auth/login {email,password}
// → {token} (muster-api/src/routes/auth.ts), bcrypt-checked against the User
// table, minted with JWT_SECRET. This module only calls it and stores the
// returned token under 'muster-jwt' — the key musterApi.ts already sends as
// `Authorization: Bearer`. The password is never stored.
//
// Network-optional (musterApi.ts DW#5): only the Plan tab's explicit sign-in
// click reaches this; the interview path never imports it.
import { getApiBase } from './musterApi';

export const MUSTER_JWT_KEY = 'muster-jwt';

/** Login timeout: bcrypt + a DB lookup; generous next to the 3s API default. */
export const SIGN_IN_TIMEOUT_MS = 10_000;

export type SignInOutcome = { ok: true } | { ok: false; status: number; message: string };

/**
 * The auth router is mounted at `/auth`, beside (not under) `/api`. Strip only
 * a trailing `/api` so a prefixed base (e.g. https://host/muster/api) keeps its
 * prefix.
 */
export function getAuthBase(): string {
  return getApiBase().replace(/\/+$/, '').replace(/\/api$/, '');
}

export function hasMusterToken(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(MUSTER_JWT_KEY);
}

export function signOutOfMuster(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(MUSTER_JWT_KEY);
}

export function signInFailureMessage(status: number): string {
  if (status === 0) return 'muster-api is not reachable (not running, blocked, or timed out)';
  if (status === 401) return 'muster-api did not accept that email and password';
  if (status === 400) return 'enter a valid email and a password';
  return `muster-api sign-in returned ${status}`;
}

export async function signInToMuster(email: string, password: string): Promise<SignInOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIGN_IN_TIMEOUT_MS);
  try {
    const res = await fetch(`${getAuthBase()}/auth/login`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      signOutOfMuster();
      return { ok: false, status: res.status, message: signInFailureMessage(res.status) };
    }
    const json = (await res.json()) as { token?: unknown };
    if (typeof json?.token !== 'string' || json.token.length === 0) {
      signOutOfMuster();
      return { ok: false, status: res.status, message: 'muster-api sign-in returned no token' };
    }
    localStorage.setItem(MUSTER_JWT_KEY, json.token);
    return { ok: true };
  } catch {
    return { ok: false, status: 0, message: signInFailureMessage(0) };
  } finally {
    clearTimeout(timer);
  }
}
