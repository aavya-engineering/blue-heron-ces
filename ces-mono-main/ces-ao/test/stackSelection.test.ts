// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G4 (multi-stack capability) — AdminOps stack selection through the stack-provider seam.
//
// Proves AO resolves the active stack provider from config — wired through AO's actual config path
// (AuthChain.createExecutionContext / resolveStackEndpoints) — and that the Microsoft reference
// stack is byte-identical to the previous hard-coded endpoint literals (zero behaviour change).
// See docs/adr/ADR-003-stack-provider-seam.md.

import { describe, it, expect } from 'vitest';
import type { TenantConfig } from 'ces-shared/config';
import {
  DEFAULT_STACK_ID,
  EXAMPLE_STUB_STACK_ID,
  microsoftGccHighProvider,
  exampleStubProvider,
} from 'ces-shared/stack';
import { resolveStackEndpoints, createExecutionContext } from '../src/execution/AuthChain.js';

/** Minimal TenantConfig with NO explicit endpoints — so the provider supplies the defaults. */
function makeTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantSlug: 'acme',
    tenantId: 'guid-1',
    appId: 'app-1',
    certPath: 'C:/certs/acme.pfx',
    certThumbprint: 'THUMB',
    domain: 'acme.onmicrosoft.us',
    // endpoints intentionally omitted/empty so the stack provider is the source of defaults
    endpoints: {} as TenantConfig['endpoints'],
    ...overrides,
  } as TenantConfig;
}

describe('AO stack selection — resolveStackEndpoints', () => {
  it('config WITHOUT stack → Microsoft provider + Microsoft GCC High endpoints', () => {
    const { provider, endpoints } = resolveStackEndpoints(makeTenantConfig());

    expect(provider).toBe(microsoftGccHighProvider);
    expect(provider.capabilities.id).toBe(DEFAULT_STACK_ID);

    // Byte-identical to the previously hard-coded Microsoft literals (zero behaviour change).
    expect(endpoints.graph).toBe('https://graph.microsoft.us');
    expect(endpoints.login).toBe('https://login.microsoftonline.us');
    expect(endpoints.exchange_env).toBe('O365USGovGCCHigh');
    expect(endpoints.compliance_uri).toBe(
      'https://ps.compliance.protection.office365.us/powershell-liveid/'
    );
    expect(endpoints.azure_auth).toBe('https://login.microsoftonline.us/organizations');
  });

  it("config WITH stack='example-stub' → stub provider + stub endpoints (genuinely pluggable)", () => {
    const { provider, endpoints } = resolveStackEndpoints(
      makeTenantConfig({ stack: EXAMPLE_STUB_STACK_ID })
    );

    expect(provider).toBe(exampleStubProvider);
    expect(provider.capabilities.id).toBe(EXAMPLE_STUB_STACK_ID);

    // Stub endpoints — proves selection is NOT special-cased to Microsoft.
    expect(endpoints.graph).toBe('https://graph.example.invalid');
    expect(endpoints.login).toBe('https://login.example.invalid');
    // Stub omits exchange/compliance/arm → those keys are not populated.
    expect(endpoints.exchange_env).toBeUndefined();
    expect(endpoints.compliance_uri).toBeUndefined();
    expect(endpoints.arm).toBeUndefined();
  });

  it('explicit tenant endpoints OVERRIDE the provider defaults (provider only fills gaps)', () => {
    const { endpoints } = resolveStackEndpoints(
      makeTenantConfig({
        endpoints: { graph: 'https://graph.custom.example', login: 'https://login.custom.example' },
      })
    );
    // resolveStackEndpoints returns the PROVIDER defaults; the override is applied at merge time
    // in createExecutionContext. Here we assert the provider defaults are the Microsoft ones.
    expect(endpoints.graph).toBe('https://graph.microsoft.us');
  });
});

describe('AO stack selection — createExecutionContext (end-to-end config path)', () => {
  // G-TENANT-M5: createExecutionContext now returns the ces-tenant-backed
  // { executionConfig, sessionFactory } pair instead of Stamper's
  // { stamperConfig, sessionManager }. Endpoint values asserted here are the
  // SAME merged values the retired StamperConfig carried (zero behaviour change).
  it('absent stack → execution config carries Microsoft GCC High endpoints', () => {
    const { executionConfig } = createExecutionContext(makeTenantConfig(), true);

    expect(executionConfig.endpoints.graph).toBe('https://graph.microsoft.us');
    expect(executionConfig.endpoints.login).toBe('https://login.microsoftonline.us');
    expect(executionConfig.endpoints.exchange_env).toBe('O365USGovGCCHigh');
    expect(executionConfig.endpoints.compliance_uri).toBe(
      'https://ps.compliance.protection.office365.us/powershell-liveid/'
    );
    expect(executionConfig.endpoints.azure_auth).toBe(
      'https://login.microsoftonline.us/organizations'
    );
    // GCC High conventions surfaced for the adapter (was StamperConfig.gccHighEndpoints).
    expect(executionConfig.gccHighEndpoints).toBe(true);
  });

  it("stack='example-stub' → execution config carries the stub provider's endpoints", () => {
    const { executionConfig } = createExecutionContext(
      makeTenantConfig({ stack: EXAMPLE_STUB_STACK_ID }),
      true
    );

    expect(executionConfig.endpoints.graph).toBe('https://graph.example.invalid');
    expect(executionConfig.endpoints.login).toBe('https://login.example.invalid');
    expect(executionConfig.endpoints.azure_auth).toBe(
      'https://login.example.invalid/organizations'
    );
    // Stub stack is NOT GCC High.
    expect(executionConfig.gccHighEndpoints).toBe(false);
  });

  it('explicit tenant endpoints win over the resolved stack defaults', () => {
    const { executionConfig } = createExecutionContext(
      makeTenantConfig({
        stack: EXAMPLE_STUB_STACK_ID,
        endpoints: { graph: 'https://graph.override.example', login: 'https://login.override.example' },
      }),
      true
    );
    expect(executionConfig.endpoints.graph).toBe('https://graph.override.example');
    expect(executionConfig.endpoints.login).toBe('https://login.override.example');
  });
});
