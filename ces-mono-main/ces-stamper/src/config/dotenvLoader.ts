// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import type { TenantConfig } from 'ces-shared/config';

/**
 * Stamper-specific: load config from .env file (CLI bootstrap only).
 * Returns a TenantConfig populated from environment variables.
 */
export function loadClientConfig(envPath?: string): TenantConfig {
  if (envPath && fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  const config: TenantConfig = {
    tenantSlug: process.env.TENANT_SLUG || 'unknown',
    tenantId: process.env.TENANT_ID || '',
    appId: process.env.APP_ID || '',
    certThumbprint: process.env.CERT_THUMBPRINT || '',
    certPath: process.env.CERT_PATH || '',
    domain: process.env.TARGET_TENANT_DOMAIN || 'vfsgov.onmicrosoft.us',
    endpoints: {
      graph: process.env.GRAPH_ENDPOINT || 'https://graph.microsoft.us',
      login: process.env.LOGIN_ENDPOINT || 'https://login.microsoftonline.us',
    },
    targetTenantDomain: process.env.TARGET_TENANT_DOMAIN || 'vfsgov.onmicrosoft.us',
    subscriptionId: process.env.SUBSCRIPTION_ID,
    clientName: process.env.CLIENT_NAME || 'ValorForge Solutions',
  };

  if (process.env.SUBSCRIPTION_ID && process.env.RESOURCE_GROUP && process.env.LOCATION) {
    config.subscription = {
      subscription_id: process.env.SUBSCRIPTION_ID,
      resource_group: process.env.RESOURCE_GROUP,
      location: process.env.LOCATION,
    };
  }

  return config;
}
