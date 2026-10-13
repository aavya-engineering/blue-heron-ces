// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// graphClient.ts — Graph API client interface + implementations.
// GCC High base URL: https://graph.microsoft.us/v1.0 [validate with BHD]
// Override via env GRAPH_BASE_URL.
import { assertNotLiveUnderTest } from './liveGuard.js';

export interface GraphClient {
  get(path: string): Promise<unknown>;
}

const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.us/v1.0';

/**
 * realGraphClient — production client using the GCC High Microsoft Graph endpoint.
 * baseUrl defaults to process.env.GRAPH_BASE_URL or https://graph.microsoft.us/v1.0.
 */
export function realGraphClient(accessToken: string, baseUrl?: string): GraphClient {
  const base = baseUrl ?? process.env.GRAPH_BASE_URL ?? DEFAULT_GRAPH_BASE_URL;
  return {
    async get(path: string): Promise<unknown> {
      const url = `${base}${path}`;
      // FC-MU-2: under vitest only a localhost Graph (the stacksim) is reachable.
      assertNotLiveUnderTest('Graph request', url);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(
          `Graph request failed: ${res.status} ${res.statusText} for ${path}`
        );
      }
      return res.json() as Promise<unknown>;
    },
  };
}

/**
 * MockGraphClient — test double for GraphClient.
 * Constructor accepts a fixture map: Record<path, response>.
 * If the fixture value is an Error instance, get() throws it.
 * Records every call path in the public `calls` array.
 */
export class MockGraphClient implements GraphClient {
  private readonly fixtures: Record<string, unknown>;
  readonly calls: string[] = [];

  constructor(fixtures: Record<string, unknown>) {
    this.fixtures = fixtures;
  }

  async get(path: string): Promise<unknown> {
    this.calls.push(path);
    if (!(path in this.fixtures)) {
      throw new Error(`MockGraphClient: no fixture for path "${path}"`);
    }
    const response = this.fixtures[path];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}
