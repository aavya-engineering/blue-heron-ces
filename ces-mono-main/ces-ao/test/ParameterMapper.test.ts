// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mapAoParametersToVariables } from '../src/execution/ParameterMapper.js';
import { makeAoCommand } from './fixtures.js';

// Characterization tests for the config + user variable merge and dotted-path resolution.
describe('mapAoParametersToVariables', () => {
  const ao = makeAoCommand({
    parameters: [
      { name: 'tenantId', label: 'T', type: 'readonly', source: 'tenantId', required: true },
      { name: 'graphEp', label: 'G', type: 'readonly', source: 'endpoints.graph', required: true },
      { name: 'missingOne', label: 'M', type: 'text', source: 'nope.notthere', required: false },
    ],
  });
  const tenantConfig: any = { tenantId: 'abc-123', endpoints: { graph: 'https://graph.example' } };

  it('resolves source params (incl. dotted paths) keyed by param.name and merges user inputs', () => {
    const result = mapAoParametersToVariables(ao, tenantConfig, { upn: 'u@x.com', count: 5 });
    expect(result).toEqual({
      tenantId: 'abc-123',
      graphEp: 'https://graph.example',
      // missingOne omitted: unresolved dotted path yields undefined and is skipped
      upn: 'u@x.com',
      count: '5', // user inputs are stringified
    });
  });

  it('omits params whose dotted source path does not resolve', () => {
    const result = mapAoParametersToVariables(ao, tenantConfig, {});
    expect(result).not.toHaveProperty('missingOne');
  });

  // FX-AO1 (2026-09-27): corrected. This used to assert that a request value overrode a
  // tenant-sourced value -- the CUI-boundary bypass. The tenant record now wins.
  it('tenant-sourced values win over request inputs on key collision (request override ignored + logged)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = mapAoParametersToVariables(ao, tenantConfig, { tenantId: 'override' });
    expect(result.tenantId).toBe('abc-123');
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('ignoring request override'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('coerces non-string user input values to strings', () => {
    const result = mapAoParametersToVariables(ao, tenantConfig, { flag: true, num: 0 });
    expect(result.flag).toBe('true');
    expect(result.num).toBe('0');
  });
});

// G-FW-ALT: the network commands (F-13/F-14) and A-19 auto-fill their parameters from the
// tenant config via `source`, so a CLI/GUI/MCP caller can run them with zero -p flags.
import * as fs from 'node:fs';
import * as path from 'node:path';
const registryJson: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src/registry/ao-commands.registry.json'), 'utf8')
);

describe('registry source auto-fill (F-13/F-14/A-19)', () => {
  const cfg: any = {
    subscription: { resource_group: 'rg-eo-prod' },
    resources: {
      vnet_name: 'vfsgov-vnet-eo',
      storage_account_name: 'vfsgoevops01',
      law_name: 'vfsgov-law-prod',
      breakglass_upn: 'breakglass@vfsgov.us',
    },
  };
  const byId = (id: string) => registryJson.find(c => c.id === id)!;

  it('F-13 fills resourceGroup + vnetName from tenant config', () => {
    const v = mapAoParametersToVariables(byId('F-13'), cfg, {});
    expect(v.resourceGroup).toBe('rg-eo-prod');
    expect(v.vnetName).toBe('vfsgov-vnet-eo');
  });

  it('F-14 fills all four params from tenant config', () => {
    const v = mapAoParametersToVariables(byId('F-14'), cfg, {});
    expect(v.resourceGroup).toBe('rg-eo-prod');
    expect(v.vnetName).toBe('vfsgov-vnet-eo');
    expect(v.storageAccountName).toBe('vfsgoevops01');
    expect(v.workspaceName).toBe('vfsgov-law-prod');
  });

  it('A-19 fills breakglassUPN; policyDisplayName stays user-supplied', () => {
    const v = mapAoParametersToVariables(byId('A-19'), cfg, { policyDisplayName: 'CA-02: Block Legacy Authentication' });
    expect(v.breakglassUPN).toBe('breakglass@vfsgov.us');
    expect(v.policyDisplayName).toBe('CA-02: Block Legacy Authentication');
  });
});

// G-AO-CMMC-BOUND-1 M3: ParameterMapper CUI-boundary checks on resolved `resources.*` values.
describe('mapAoParametersToVariables — CUI boundary enforcement', () => {
  const dCommand = (overrides: any = {}) =>
    makeAoCommand({
      id: 'D-01',
      domain: 'D',
      domainName: 'Data Protection & CUI Boundary',
      parameters: [
        { name: 'vnetName', label: 'V', type: 'readonly', source: 'resources.vnet_name', required: true },
      ],
      ...overrides,
    });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allowlist match proceeds (D-family command with resource inside cuiBoundary.resourceAllowlist)', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['vfsgov-vnet-eo'] },
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    const v = mapAoParametersToVariables(dCommand(), tenant, {});
    expect(v.vnetName).toBe('vfsgov-vnet-eo');
  });

  it('allowlist miss is denied (Phase 2/strict)', () => {
    vi.stubEnv('AO_CMMC_STRICT', '1');
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['some-other-vnet'] },
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, {})).toThrow(/cuiBoundary/);
  });

  it('tag match proceeds (tagKey/tagValue resolve on tenantConfig)', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { tagKey: 'complianceTag', tagValue: 'cui-in-scope' },
      complianceTag: 'cui-in-scope',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    const v = mapAoParametersToVariables(dCommand(), tenant, {});
    expect(v.vnetName).toBe('vfsgov-vnet-eo');
  });

  it('tag miss is denied', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { tagKey: 'complianceTag', tagValue: 'cui-in-scope' },
      complianceTag: 'out-of-scope',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, {})).toThrow(/cuiBoundary/);
  });

  it('Case A (pre-migration tenant: cmmcLevel and cuiBoundary both absent), Phase 1 default: warns and allows', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tenant: any = {
      tenantSlug: 'acme',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    const v = mapAoParametersToVariables(dCommand(), tenant, {});
    expect(v.vnetName).toBe('vfsgov-vnet-eo');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('Case A, strict mode (AO_CMMC_STRICT=1): denies', () => {
    vi.stubEnv('AO_CMMC_STRICT', '1');
    const tenant: any = {
      tenantSlug: 'acme',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, {})).toThrow(/AO_CMMC_STRICT/);
  });

  it('Case B (foot-gun: cmmcLevel present, cuiBoundary absent) is denied in Phase 1 with the distinct reason string', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, {})).toThrow(
      /cuiBoundary missing on cmmcLevel-scoped tenant/
    );
  });

  it('Case B is denied in strict mode too, with the same distinct reason string', () => {
    vi.stubEnv('AO_CMMC_STRICT', '1');
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, {})).toThrow(
      /cuiBoundary missing on cmmcLevel-scoped tenant/
    );
  });

  it('D-family command scenario: real D-domain registry resource param outside allowlist is denied', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['not-the-configured-vnet'] },
      resources: {
        resourceGroup: 'rg-eo-prod',
        vnetName: 'vfsgov-vnet-eo',
        vnet_name: 'vfsgov-vnet-eo',
        storage_account_name: 'vfsgoevops01',
        law_name: 'vfsgov-law-prod',
      },
    };
    const f14 = registryJson.find((c) => c.id === 'F-14')!;
    expect(() => mapAoParametersToVariables(f14, tenant, {})).toThrow(/cuiBoundary/);
  });

  // FX-AO1: request inputs cannot widen the boundary.
  it('a request value for a resources.* param is ignored when the tenant value resolves in-boundary', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['vnet-a', 'vnet-b'] },
      resources: { vnet_name: 'vnet-a' },
    };
    const v = mapAoParametersToVariables(dCommand(), tenant, { vnetName: 'vnet-b' });
    expect(v.vnetName).toBe('vnet-a');
    warnSpy.mockRestore();
  });

  it('a request value for a resources.* param outside the boundary is denied even when the tenant value is in-boundary', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['vfsgov-vnet-eo'] },
      resources: { vnet_name: 'vfsgov-vnet-eo' },
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, { vnetName: 'outside-vnet' })).toThrow(/cuiBoundary/);
  });

  it('an unresolvable resources.* source cannot be filled by the request to skip the check', () => {
    const tenant: any = {
      tenantSlug: 'acme',
      cmmcLevel: 'L2',
      cuiBoundary: { resourceAllowlist: ['vfsgov-vnet-eo'] },
      resources: {},
    };
    expect(() => mapAoParametersToVariables(dCommand(), tenant, { vnetName: 'outside-vnet' })).toThrow(/cuiBoundary/);
    // An in-boundary request value for the same unresolvable source is allowed.
    expect(mapAoParametersToVariables(dCommand(), tenant, { vnetName: 'vfsgov-vnet-eo' }).vnetName).toBe('vfsgov-vnet-eo');
  });
});
