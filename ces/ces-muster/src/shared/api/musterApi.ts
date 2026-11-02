// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * Thin fetch wrapper for the Muster API.
 *
 * Base URL (gap closure API-3a: from config, never a hard-coded host), first found of:
 *   1. localStorage 'muster-api-url' (an operator's per-browser override);
 *   2. runtime config: `window.__MUSTER_CONFIG__.apiBaseUrl` (set by the host page at deploy time);
 *   3. build config: Vite env `VITE_MUSTER_API_URL`;
 *   4. same origin: '/api' (muster-api serving or proxied beside the SPA).
 * Auth:     localStorage 'muster-jwt' sent as Bearer token.
 * Timeout:  3 s via AbortController (override per call with `timeoutMs`).
 *
 * NEVER import or invoke this module in the static interview path — only the
 * adaptive/network-optional features (adaptiveEngine, CoachPanel, ContractsPage)
 * call it. This preserves the DW#5 zero-network-call guarantee for offline sessions.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; degraded: boolean; error?: string };

/** Runtime configuration the host page may define before the SPA loads. */
export interface MusterRuntimeConfig {
  apiBaseUrl?: string;
}

export function getApiBase(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('muster-api-url');
    if (stored) return stored;
  }
  const runtime = (globalThis as { __MUSTER_CONFIG__?: MusterRuntimeConfig }).__MUSTER_CONFIG__?.apiBaseUrl;
  if (runtime) return runtime;
  const built = import.meta.env?.VITE_MUSTER_API_URL as string | undefined;
  if (built) return built;
  return '/api';
}

function getJwt(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('muster-jwt');
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 3000
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const jwt = getJwt();
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    clearTimeout(timer);
    if (!res.ok) {
      let degraded = false;
      let error: string | undefined;
      try {
        const json = (await res.json()) as Record<string, unknown>;
        degraded = json?.degraded === true;
        if (typeof json?.error === 'string') error = json.error;
      } catch {
        // non-JSON error body — degraded stays false
      }
      return { ok: false, status: res.status, degraded, ...(error ? { error } : {}) };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, degraded: true };
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    apiRequest<T>('POST', path, body, timeoutMs),
  put: <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, body),
  delete: <T>(path: string) => apiRequest<T>('DELETE', path),
};
