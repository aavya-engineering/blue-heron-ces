// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M3 — the sim registry record's two patched auth fields.
//
// A relative `cert_path` is the failure this pins: it resolves against
// whichever GUI server's cwd reads it (a sibling repo root), passes every
// shallow check, and then fails closed at execute time with a missing-file
// error (finding #5). Absolute or nothing. No filesystem is touched here —
// only the pure patch/read/validate helpers.
import { describe, it, expect } from 'vitest';
import {
  applySimTenantAuthPatch,
  readSimTenantAuthFields,
  missingSimTenantAuthFields,
  simRecordPath,
} from '../src/demo/sim-tenant-record.js';

const REGISTRY_RECORD = {
  kind: 'sim',
  client: { slug: 'demo-dib-small', name: 'Sim Tenant (demo-dib-small)' },
  tenant: { tenant_id: 'sim-tenant-demo-dib-small', domain: 'demo-dib-small.simtenant.onmicrosoft.us' },
  auth: {
    app_id: 'sim-app-demo-dib-small',
    cert_path: 'sim/demo-dib-small.pfx',
    cert_thumbprint: 'SIMTHUMBPRINT0000000000000000000000000',
  },
  stacksim_seed: { stance: 'm365_azure' },
};

const PATCH = {
  certThumbprint: '2F916D65470F7E8DD5B8ABB2860757E0A21F2323',
  certPath: 'C:\\ces\\ces-tester\\runs\\e2e\\r1\\sim.pfx',
};

describe('applySimTenantAuthPatch', () => {
  it('replaces only the thumbprint and cert_path, keeping the registry’s own fields', () => {
    const patched = applySimTenantAuthPatch(REGISTRY_RECORD, PATCH);
    const auth = patched.auth as Record<string, unknown>;
    expect(auth.cert_thumbprint).toBe(PATCH.certThumbprint);
    expect(auth.cert_path).toBe(PATCH.certPath);
    expect(auth.app_id).toBe('sim-app-demo-dib-small');
    expect(patched.tenant).toEqual(REGISTRY_RECORD.tenant);
    expect(patched.stacksim_seed).toEqual({ stance: 'm365_azure' });
  });

  it('does not mutate the record it was given', () => {
    applySimTenantAuthPatch(REGISTRY_RECORD, PATCH);
    expect(REGISTRY_RECORD.auth.cert_thumbprint).toBe('SIMTHUMBPRINT0000000000000000000000000');
    expect(REGISTRY_RECORD.auth.cert_path).toBe('sim/demo-dib-small.pfx');
  });

  it('refuses a relative cert_path outright (finding #5 — fails closed at execute time)', () => {
    expect(() => applySimTenantAuthPatch(REGISTRY_RECORD, { ...PATCH, certPath: 'sim/demo.pfx' })).toThrow(
      /must be absolute/,
    );
  });

  it('refuses a non-object record', () => {
    expect(() => applySimTenantAuthPatch(null, PATCH)).toThrow(/not a JSON object/);
    expect(() => applySimTenantAuthPatch([1], PATCH)).toThrow(/not a JSON object/);
  });
});

describe('readSimTenantAuthFields / missingSimTenantAuthFields', () => {
  it('reads all four fields Stamper requires (tenant_id from the tenant block)', () => {
    const fields = readSimTenantAuthFields(applySimTenantAuthPatch(REGISTRY_RECORD, PATCH));
    expect(fields).toEqual({
      tenantId: 'sim-tenant-demo-dib-small',
      appId: 'sim-app-demo-dib-small',
      certThumbprint: PATCH.certThumbprint,
      certPath: PATCH.certPath,
    });
    expect(missingSimTenantAuthFields(fields)).toEqual([]);
  });

  it('flags the unpatched registry record — the placeholder thumbprint can never match the store', () => {
    const missing = missingSimTenantAuthFields(readSimTenantAuthFields(REGISTRY_RECORD));
    expect(missing.join(' ')).toMatch(/cert_thumbprint \(still the registry placeholder\)/);
    expect(missing.join(' ')).toMatch(/cert_path \(relative/);
  });

  it('names every absent field rather than the first one', () => {
    expect(missingSimTenantAuthFields(readSimTenantAuthFields({}))).toHaveLength(4);
  });
});

describe('simRecordPath', () => {
  it('points at the registry’s own sim/<slug>.json layout', () => {
    expect(simRecordPath('C:\\run\\tenant-root', 'demo-dib-small').replace(/\\/g, '/')).toBe(
      'C:/run/tenant-root/sim/demo-dib-small.json',
    );
  });
});
