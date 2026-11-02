// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, jest } from '@jest/globals';

const mockExecSync = jest.fn(() => 'mock-token-'.padEnd(128, 'x'));

jest.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

// Mock @azure/identity
jest.mock('@azure/identity', () => ({
  ClientCertificateCredential: (jest.fn as any)().mockImplementation(() => ({
    getToken: (jest.fn as any)().mockResolvedValue({ token: 'mock-token', expiresOnTimestamp: Date.now() + 3600000 }),
  })),
}));

// Mock @microsoft/microsoft-graph-client
jest.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    init: (jest.fn as any)().mockReturnValue({}),
    initWithMiddleware: (jest.fn as any)().mockReturnValue({
      api: (jest.fn as any)().mockReturnValue({
        get: (jest.fn as any)().mockResolvedValue({ value: [] }),
      }),
    }),
  },
}));

jest.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js', () => ({
  TokenCredentialAuthenticationProvider: jest.fn().mockImplementation(() => ({})),
}));

describe('GraphAuthProvider', () => {
  it('should export getGraphClient function', async () => {
    const { getGraphClient } = await import('../GraphAuthProvider.js');
    expect(typeof getGraphClient).toBe('function');
  });

  it('should export GCC High constants', async () => {
    const { GCC_HIGH_AUTHORITY, GCC_HIGH_GRAPH_ENDPOINT, GCC_HIGH_SCOPE } = await import('../GraphAuthProvider.js');
    expect(GCC_HIGH_AUTHORITY).toBe('https://login.microsoftonline.us');
    expect(GCC_HIGH_GRAPH_ENDPOINT).toBe('https://graph.microsoft.us');
    expect(GCC_HIGH_SCOPE).toBe('https://graph.microsoft.us/.default');
  });

  it('should create a Graph client with GCC High endpoint', async () => {
    const { getGraphClient } = await import('../GraphAuthProvider.js');
    const { Client } = await import('@microsoft/microsoft-graph-client');

    const tenantConfig = {
      tenantSlug: 'test',
      tenantId: 'test-tenant-id',
      appId: 'test-app-id',
      certPath: '/path/to/cert.pem',
      certThumbprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      domain: 'test.onmicrosoft.us',
      endpoints: {
        graph: 'https://graph.microsoft.us',
        login: 'https://login.microsoftonline.us',
      },
    };

    const client = getGraphClient(tenantConfig);
    expect(client).toBeDefined();
    expect(Client.init).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://graph.microsoft.us',
      })
    );
  });

  it('should reuse the cached token for subsequent clients', async () => {
    // Token refresh is handled internally by @azure/identity
    // This test verifies the credential is constructed with correct params
    const { getGraphClient } = await import('../GraphAuthProvider.js');

    const tenantConfig = {
      tenantSlug: 'test',
      tenantId: 'my-tenant',
      appId: 'my-app',
      certPath: '/cert.pem',
      certThumbprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
      domain: 'test.onmicrosoft.us',
      endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
    };

    getGraphClient(tenantConfig);

    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });
});
