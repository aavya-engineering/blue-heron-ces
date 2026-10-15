// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { StamperConfig } from '../../src/config/StamperConfig';
import * as fs from 'fs';
import * as path from 'path';
import {
  getActiveStackProvider,
  EXAMPLE_STUB_STACK_ID,
} from 'ces-shared/stack';

describe('StamperConfig', () => {
  describe('fromTenantConfig', () => {
    it('should create config from tenant JSON structure', () => {
      const tenantJson = {
        tenant: { tenant_id: 'test-tenant-id' },
        auth: {
          app_id: 'test-app-id',
          cert_thumbprint: 'test-thumbprint',
          cert_path: '/path/to/cert.pfx',
        },
        endpoints: {
          graph: 'https://graph.microsoft.us',
          login: 'https://login.microsoftonline.us',
          exchange_env: 'O365USGovGCCHigh',
          compliance_uri: 'https://ps.compliance.protection.office365.us/powershell-liveid/',
          azure_auth: 'https://login.microsoftonline.us/organizations',
        },
      };

      const config = StamperConfig.fromTenantConfig(tenantJson);

      expect(config.tenantId).toBe('test-tenant-id');
      expect(config.appId).toBe('test-app-id');
      expect(config.certThumbprint).toBe('test-thumbprint');
      expect(config.certPath).toBe('/path/to/cert.pfx');
      expect(config.graphEndpoint).toBe('https://graph.microsoft.us');
      expect(config.loginEndpoint).toBe('https://login.microsoftonline.us');
      expect(config.exchangeEnv).toBe('O365USGovGCCHigh');
      expect(config.complianceUri).toBe('https://ps.compliance.protection.office365.us/powershell-liveid/');
      expect(config.azureAuthEndpoint).toBe('https://login.microsoftonline.us/organizations');
      expect(config.gccHighEndpoints).toBe(true);
    });

    it('should create config from ClientConfig structure', () => {
      const clientConfig = {
        tenantId: 'test-tenant-id',
        appId: 'test-app-id',
        certThumbprint: 'test-thumbprint',
        certPath: '/path/to/cert.pfx',
        targetTenantDomain: 'test.onmicrosoft.us',
        clientName: 'Test Client',
      };

      const config = StamperConfig.fromTenantConfig(clientConfig);

      expect(config.tenantId).toBe('test-tenant-id');
      expect(config.appId).toBe('test-app-id');
      expect(config.certThumbprint).toBe('test-thumbprint');
      expect(config.certPath).toBe('/path/to/cert.pfx');
    });

    it('should use default GCC High endpoints when not specified', () => {
      const tenantJson = {
        tenant: { tenant_id: 'test-tenant-id' },
        auth: {
          app_id: 'test-app-id',
          cert_thumbprint: 'test-thumbprint',
          cert_path: '/path/to/cert.pfx',
        },
      };

      const config = StamperConfig.fromTenantConfig(tenantJson);

      expect(config.graphEndpoint).toBe('https://graph.microsoft.us');
      expect(config.loginEndpoint).toBe('https://login.microsoftonline.us');
      expect(config.exchangeEnv).toBe('O365USGovGCCHigh');
      expect(config.complianceUri).toBe('https://ps.compliance.protection.office365.us/powershell-liveid/');
      expect(config.azureAuthEndpoint).toBe('https://login.microsoftonline.us/organizations');
      expect(config.gccHighEndpoints).toBe(true);
    });

    it('should handle missing optional fields', () => {
      const minimalConfig = {
        tenant: { tenant_id: 'test-tenant-id' },
        auth: {
          app_id: 'test-app-id',
          cert_thumbprint: 'test-thumbprint',
        },
      };

      const config = StamperConfig.fromTenantConfig(minimalConfig);

      expect(config.tenantId).toBe('test-tenant-id');
      expect(config.appId).toBe('test-app-id');
      expect(config.certThumbprint).toBe('test-thumbprint');
      expect(config.certPath).toBe('');
    });

    it('should not mutate process.env', () => {
      const originalTenantId = process.env.TENANT_ID;
      const originalAppId = process.env.APP_ID;
      const originalCertThumbprint = process.env.CERT_THUMBPRINT;

      const tenantJson = {
        tenant: { tenant_id: 'new-tenant-id' },
        auth: {
          app_id: 'new-app-id',
          cert_thumbprint: 'new-thumbprint',
          cert_path: '/new/path/cert.pfx',
        },
      };

      StamperConfig.fromTenantConfig(tenantJson);

      expect(process.env.TENANT_ID).toBe(originalTenantId);
      expect(process.env.APP_ID).toBe(originalAppId);
      expect(process.env.CERT_THUMBPRINT).toBe(originalCertThumbprint);
    });

    it('should produce same config values as process.env constructor', () => {
      // Set up process.env
      const envBackup = {
        TENANT_ID: process.env.TENANT_ID,
        APP_ID: process.env.APP_ID,
        CERT_THUMBPRINT: process.env.CERT_THUMBPRINT,
        CERT_PATH: process.env.CERT_PATH,
        GRAPH_ENDPOINT: process.env.GRAPH_ENDPOINT,
        LOGIN_ENDPOINT: process.env.LOGIN_ENDPOINT,
        EXCHANGE_ENV: process.env.EXCHANGE_ENV,
        COMPLIANCE_URI: process.env.COMPLIANCE_URI,
        AZURE_AUTH_ENDPOINT: process.env.AZURE_AUTH_ENDPOINT,
      };

      try {
        process.env.TENANT_ID = 'test-tenant-id';
        process.env.APP_ID = 'test-app-id';
        process.env.CERT_THUMBPRINT = 'test-thumbprint';
        process.env.CERT_PATH = '/path/to/cert.pfx';
        process.env.GRAPH_ENDPOINT = 'https://graph.microsoft.us';
        process.env.LOGIN_ENDPOINT = 'https://login.microsoftonline.us';
        process.env.EXCHANGE_ENV = 'O365USGovGCCHigh';
        process.env.COMPLIANCE_URI = 'https://ps.compliance.protection.office365.us/powershell-liveid/';
        process.env.AZURE_AUTH_ENDPOINT = 'https://login.microsoftonline.us/organizations';
        process.env.DRY_RUN = 'true'; // Bypass validation

        const envConfig = new StamperConfig();

        const tenantJson = {
          tenant: { tenant_id: 'test-tenant-id' },
          auth: {
            app_id: 'test-app-id',
            cert_thumbprint: 'test-thumbprint',
            cert_path: '/path/to/cert.pfx',
          },
          endpoints: {
            graph: 'https://graph.microsoft.us',
            login: 'https://login.microsoftonline.us',
            exchange_env: 'O365USGovGCCHigh',
            compliance_uri: 'https://ps.compliance.protection.office365.us/powershell-liveid/',
            azure_auth: 'https://login.microsoftonline.us/organizations',
          },
        };

        const paramConfig = StamperConfig.fromTenantConfig(tenantJson);

        // Compare key values
        expect(paramConfig.tenantId).toBe(envConfig.tenantId);
        expect(paramConfig.appId).toBe(envConfig.appId);
        expect(paramConfig.certThumbprint).toBe(envConfig.certThumbprint);
        expect(paramConfig.certPath).toBe(envConfig.certPath);
        expect(paramConfig.graphEndpoint).toBe(envConfig.graphEndpoint);
        expect(paramConfig.loginEndpoint).toBe(envConfig.loginEndpoint);
        expect(paramConfig.exchangeEnv).toBe(envConfig.exchangeEnv);
        expect(paramConfig.complianceUri).toBe(envConfig.complianceUri);
        expect(paramConfig.azureAuthEndpoint).toBe(envConfig.azureAuthEndpoint);
      } finally {
        // Restore process.env
        Object.keys(envBackup).forEach((key) => {
          if (envBackup[key as keyof typeof envBackup] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = envBackup[key as keyof typeof envBackup];
          }
        });
        delete process.env.DRY_RUN;
      }
    });

    it('should handle empty config gracefully (dryRun defaults to true)', () => {
      const emptyConfig = {};

      const config = StamperConfig.fromTenantConfig(emptyConfig);

      expect(config.tenantId).toBe('');
      expect(config.appId).toBe('');
      expect(config.certThumbprint).toBe('');
      expect(config.certPath).toBe('');
      expect(config.graphEndpoint).toBe('https://graph.microsoft.us');
      expect(config.gccHighEndpoints).toBe(true);
      expect(config.dryRun).toBe(true);
    });
  });

  // G4 — cloud-endpoint / convention DEFAULTS now resolve through the stack-provider seam (ADR-003)
  // instead of being inlined in StamperConfig. These tests pin the Microsoft default (no behavior
  // change), prove the seam is selectable, and guard against re-inlining stack literals.
  describe('stack-provider seam (ADR-003)', () => {
    // (a) Regression pin: with no `stack` field, defaults are the EXACT GCC High endpoints as before.
    it('with no stack → identical GCC High endpoints as before (regression pin)', () => {
      const config = StamperConfig.fromTenantConfig({
        tenant: { tenant_id: 't' },
        auth: { app_id: 'a', cert_thumbprint: 'c' },
      });

      expect(config.graphEndpoint).toBe('https://graph.microsoft.us');
      expect(config.loginEndpoint).toBe('https://login.microsoftonline.us');
      expect(config.exchangeEnv).toBe('O365USGovGCCHigh');
      expect(config.complianceUri).toBe('https://ps.compliance.protection.office365.us/powershell-liveid/');
      expect(config.azureAuthEndpoint).toBe('https://login.microsoftonline.us/organizations');
      expect(config.gccHighEndpoints).toBe(true);
    });

    // The default-stack values must be exactly what the Microsoft reference provider declares.
    it('default-stack endpoints equal the Microsoft provider capabilities (proof identical)', () => {
      const ms = getActiveStackProvider(undefined).capabilities;
      const config = StamperConfig.fromTenantConfig({
        tenant: { tenant_id: 't' },
        auth: { app_id: 'a', cert_thumbprint: 'c' },
      });

      expect(config.graphEndpoint).toBe(ms.cloudEndpoints.graph);
      expect(config.loginEndpoint).toBe(ms.cloudEndpoints.login);
      expect(config.exchangeEnv).toBe(ms.cloudEndpoints.exchange);
      expect(config.complianceUri).toBe(ms.cloudEndpoints.compliance);
      expect(config.azureAuthEndpoint).toBe(`${ms.cloudEndpoints.login}/organizations`);
      expect(config.gccHighEndpoints).toBe(ms.conventions.cloudEnvironment === 'gcc_high');
    });

    // (b) Selection works: stack='example-stub' → endpoints come from the stub provider, not Microsoft.
    it("with stack='example-stub' → endpoints come from the stub provider (selection works)", () => {
      const stub = getActiveStackProvider({ stack: EXAMPLE_STUB_STACK_ID }).capabilities;
      const config = StamperConfig.fromTenantConfig({
        stack: EXAMPLE_STUB_STACK_ID,
        tenant: { tenant_id: 't' },
        auth: { app_id: 'a', cert_thumbprint: 'c' },
      });

      expect(config.graphEndpoint).toBe(stub.cloudEndpoints.graph);
      expect(config.loginEndpoint).toBe(stub.cloudEndpoints.login);
      expect(config.azureAuthEndpoint).toBe(`${stub.cloudEndpoints.login}/organizations`);
      // Stub is not GCC High and declares no exchange/compliance endpoints.
      expect(config.gccHighEndpoints).toBe(false);
      expect(config.exchangeEnv).toBe('');
      expect(config.complianceUri).toBe('');
      // And it is definitively NOT the Microsoft endpoints.
      expect(config.graphEndpoint).not.toBe('https://graph.microsoft.us');
    });

    // (c) No stray literals: the GCC High endpoint defaults must NOT be inlined in StamperConfig
    // source anymore — they come from the provider. (PowerShell/Azure internals are out of scope.)
    it('no stray GCC High endpoint literals inlined in StamperConfig source', () => {
      const srcPath = path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
        '../../src/config/StamperConfig.ts'
      );
      const src = fs.readFileSync(srcPath, 'utf8');
      const strayEndpointLiterals = [
        'https://graph.microsoft.us',
        'https://login.microsoftonline.us',
        'O365USGovGCCHigh',
        'https://ps.compliance.protection.office365.us/powershell-liveid/',
      ];
      for (const literal of strayEndpointLiterals) {
        expect(src).not.toContain(literal);
      }
    });
  });
});
