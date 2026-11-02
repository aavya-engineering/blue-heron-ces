// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Gap closure API-3a: the SPA's API base URL comes from config, never a hard-coded host.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBase } from './musterApi';

type G = { __MUSTER_CONFIG__?: { apiBaseUrl?: string } };

afterEach(() => {
  localStorage.removeItem('muster-api-url');
  delete (globalThis as G).__MUSTER_CONFIG__;
  vi.unstubAllEnvs();
});

describe('getApiBase (API-3a)', () => {
  it('defaults to the same origin, not localhost:4000', () => {
    vi.stubEnv('VITE_MUSTER_API_URL', '');
    expect(getApiBase()).toBe('/api');
  });

  it('takes the build config (VITE_MUSTER_API_URL)', () => {
    vi.stubEnv('VITE_MUSTER_API_URL', 'https://muster.example/api');
    expect(getApiBase()).toBe('https://muster.example/api');
  });

  it('runtime config wins over the build config', () => {
    vi.stubEnv('VITE_MUSTER_API_URL', 'https://built.example/api');
    (globalThis as G).__MUSTER_CONFIG__ = { apiBaseUrl: 'https://runtime.example/api' };
    expect(getApiBase()).toBe('https://runtime.example/api');
  });

  it("an operator's localStorage override wins over both", () => {
    vi.stubEnv('VITE_MUSTER_API_URL', 'https://built.example/api');
    (globalThis as G).__MUSTER_CONFIG__ = { apiBaseUrl: 'https://runtime.example/api' };
    localStorage.setItem('muster-api-url', 'http://127.0.0.1:4011/api');
    expect(getApiBase()).toBe('http://127.0.0.1:4011/api');
  });
});
