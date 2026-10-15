// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T4 — CES config contract: validation + customer↔tenant resolvers (pure, no fs).
import { describe, it, expect } from 'vitest';
import {
  validateCesConfig,
  CesConfigError,
  findBindingByCustomerName,
  findBindingByCustomerId,
  findBindingByTenantSlug,
  resolveTenantSlug,
  resolveCesIdentity,
  resolvePipelineRoot,
  EMPTY_CES_CONFIG,
  type CesConfig,
} from './cesConfig.contract.js';

const validRaw = {
  version: '1.0.0',
  pipelineRoot: 'D:/ces',
  customers: [
    { customerName: 'Acme Corp', customerId: 1, tenantSlug: 'acme', tenantId: 'guid-acme' },
    { customerName: 'Globex', tenantSlug: 'globex' },
  ],
  defaults: { cloudEnvironment: 'gcc_high' },
};

describe('validateCesConfig', () => {
  it('accepts a well-formed config and normalizes optional fields', () => {
    const cfg = validateCesConfig(validRaw);
    expect(cfg.version).toBe('1.0.0');
    expect(cfg.pipelineRoot).toBe('D:/ces');
    expect(cfg.customers).toHaveLength(2);
    expect(cfg.customers[1]).toEqual({ customerName: 'Globex', tenantSlug: 'globex' });
    expect(cfg.defaults?.cloudEnvironment).toBe('gcc_high');
  });

  it('rejects structural problems', () => {
    expect(() => validateCesConfig(null)).toThrow(CesConfigError);
    expect(() => validateCesConfig({ customers: [] })).toThrow(/version/);
    expect(() => validateCesConfig({ version: '1', customers: {} })).toThrow(/customers must be an array/);
    expect(() => validateCesConfig({ version: '1', customers: [{ tenantSlug: 't' }] })).toThrow(/customerName/);
    expect(() => validateCesConfig({ version: '1', customers: [{ customerName: 'c' }] })).toThrow(/tenantSlug/);
    expect(() =>
      validateCesConfig({ version: '1', customers: [{ customerName: 'c', tenantSlug: 't', customerId: 'x' }] }),
    ).toThrow(/customerId must be a number/);
  });

  it('rejects ambiguous bindings (duplicate customerName or tenantSlug)', () => {
    expect(() =>
      validateCesConfig({
        version: '1',
        customers: [
          { customerName: 'A', tenantSlug: 't1' },
          { customerName: 'A', tenantSlug: 't2' },
        ],
      }),
    ).toThrow(/duplicate customerName/);
    expect(() =>
      validateCesConfig({
        version: '1',
        customers: [
          { customerName: 'A', tenantSlug: 't' },
          { customerName: 'B', tenantSlug: 't' },
        ],
      }),
    ).toThrow(/duplicate tenantSlug/);
  });
});

describe('customer↔tenant resolvers', () => {
  const cfg = validateCesConfig(validRaw);

  it('finds bindings by name, id, and tenant slug', () => {
    expect(findBindingByCustomerName(cfg, 'Acme Corp')?.tenantSlug).toBe('acme');
    expect(findBindingByCustomerId(cfg, 1)?.customerName).toBe('Acme Corp');
    expect(findBindingByTenantSlug(cfg, 'globex')?.customerName).toBe('Globex');
    expect(findBindingByCustomerName(cfg, 'Nope')).toBeUndefined();
  });

  it('resolves tenantSlug preferring id over name', () => {
    expect(resolveTenantSlug(cfg, { customerId: 1 })).toBe('acme');
    expect(resolveTenantSlug(cfg, { customerName: 'Globex' })).toBe('globex');
    // id miss falls back to name
    expect(resolveTenantSlug(cfg, { customerId: 999, customerName: 'Acme Corp' })).toBe('acme');
    expect(resolveTenantSlug(cfg, { customerId: 999 })).toBeUndefined();
  });
});

describe('resolveCesIdentity — downstream (EO/AO) identity from a tenant', () => {
  const cfg = validateCesConfig(validRaw);

  it('resolves the full binding by tenantSlug', () => {
    expect(resolveCesIdentity(cfg, { tenantSlug: 'acme' })).toEqual({
      customerName: 'Acme Corp',
      customerId: 1,
      tenantSlug: 'acme',
      tenantId: 'guid-acme',
    });
  });

  it('resolves by tenantId when slug is unknown', () => {
    expect(resolveCesIdentity(cfg, { tenantId: 'guid-acme' })).toMatchObject({
      customerName: 'Acme Corp',
      tenantSlug: 'acme',
    });
  });

  it('still echoes an unmapped tenantSlug (no binding ⇒ minimal identity)', () => {
    expect(resolveCesIdentity(cfg, { tenantSlug: 'unknown-tenant' })).toEqual({
      tenantSlug: 'unknown-tenant',
    });
  });
});

describe('resolvePipelineRoot precedence (env → config → undefined)', () => {
  const cfg: CesConfig = { version: '1.0.0', pipelineRoot: 'C:/from-config', customers: [] };
  it('prefers the env value when set', () => {
    expect(resolvePipelineRoot(cfg, 'C:/from-env')).toBe('C:/from-env');
  });
  it('falls back to the config value when env is empty/unset', () => {
    expect(resolvePipelineRoot(cfg, undefined)).toBe('C:/from-config');
    expect(resolvePipelineRoot(cfg, '')).toBe('C:/from-config');
  });
  it('is undefined when neither is set (caller uses platform default)', () => {
    expect(resolvePipelineRoot(EMPTY_CES_CONFIG, undefined)).toBeUndefined();
  });
});
