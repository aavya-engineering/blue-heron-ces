// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * @deprecated No longer used. Graph API calls now go through SessionManager.execute()
 * which runs PowerShell cmdlets within a Connect-MgGraph session (matching Stamper pattern).
 * Retained for reference only.
 */

import { execSync } from 'node:child_process';
import { Client } from '@microsoft/microsoft-graph-client';
import type { TenantConfig } from 'ces-shared/config';

const GCC_HIGH_AUTHORITY = 'https://login.microsoftonline.us';
const GCC_HIGH_GRAPH_ENDPOINT = 'https://graph.microsoft.us';
const GCC_HIGH_SCOPE = 'https://graph.microsoft.us/.default';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

/**
 * Acquire a Graph API access token via PowerShell and the Microsoft.Graph module.
 * Uses Connect-MgGraph with certificate thumbprint from the Windows cert store —
 * same auth path as Stamper. No PEM conversion needed.
 */
function acquireToken(tenantConfig: TenantConfig): string {
  // Return cached token if still valid (5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300_000) {
    return cachedToken.token;
  }

  const script = [
    `$ErrorActionPreference = 'Stop';`,
    `Connect-MgGraph -ClientId '${tenantConfig.appId}'`,
    `-TenantId '${tenantConfig.tenantId}'`,
    `-CertificateThumbprint '${tenantConfig.certThumbprint}'`,
    `-Environment USGov -NoWelcome`,
    `| Out-Null;`,
    `$token = (Get-MgContext).AccessToken;`,
    `if (-not $token) { throw 'AccessToken is null — module may be outdated' };`,
    `Write-Output $token`,
  ].join(' ');

  try {
    const result = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${script}"`, {
      encoding: 'utf-8',
      timeout: 30_000,
      windowsHide: true,
    }).trim();

    if (!result || result.length < 100) {
      throw new Error(`Token acquisition returned invalid result (length: ${result.length})`);
    }

    // Cache for 50 minutes (tokens are typically valid for 60-90 min)
    cachedToken = { token: result, expiresAt: Date.now() + 50 * 60 * 1000 };
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Graph token acquisition failed: ${msg}`);
  }
}

/**
 * Creates a Microsoft Graph SDK client authenticated via certificate thumbprint
 * for GCC High national cloud. Uses PowerShell + Microsoft.Graph module to
 * acquire tokens from the Windows certificate store.
 */
export function getGraphClient(tenantConfig: TenantConfig): Client {
  const token = acquireToken(tenantConfig);

  const client = Client.init({
    baseUrl: GCC_HIGH_GRAPH_ENDPOINT,
    authProvider: (done) => {
      try {
        const currentToken = acquireToken(tenantConfig);
        if (!currentToken || currentToken.length < 100) {
          done(new Error('Token acquisition returned empty or invalid token'), null);
          return;
        }
        done(null, currentToken);
      } catch (err) {
        done(err as Error, null);
      }
    },
  });

  return client;
}

export { GCC_HIGH_AUTHORITY, GCC_HIGH_GRAPH_ENDPOINT, GCC_HIGH_SCOPE };
