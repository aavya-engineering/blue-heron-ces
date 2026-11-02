// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant-init P-5 (TENANT-INIT-AUDIT.md section 5 gaps 2 and 3): `stamper bootstrap` launches pwsh and
// turns the script's result file into a ces-tenant registry record. Every write goes to a temp
// registry root passed as env (never ~/.ces or %LOCALAPPDATA%).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileTenantRegistry } from 'ces-tenant';
import {
  BOOTSTRAP_PWSH,
  PWSH_MISSING_MESSAGE,
  buildBootstrapTenantRecord,
  deriveTenantSlug,
  describeBootstrapSpawnError,
  readBootstrapResult,
  writeBootstrapTenantRecord,
  type BootstrapResult,
} from '../../src/cli/bootstrapTenantRecord';

const TENANT = '11111111-2222-3333-4444-555555555555';

function result(overrides: Partial<BootstrapResult> = {}): BootstrapResult {
  return {
    schema: 'ces-stamper/bootstrap-result@1',
    tenant_id: TENANT,
    display_name: 'CMMC Automation',
    environment: 'GCCHigh',
    org_name: 'Contoso Defense',
    domain: 'contoso.onmicrosoft.us',
    app_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    cert_thumbprint: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    cert_source: 'store',
    cert_store_ref: 'Cert:\\CurrentUser\\My\\ABCDEF0123456789ABCDEF0123456789ABCDEF01',
    cer_path: 'C:\\stamper-certs\\CMMC Automation.cer',
    cert_expires: '2028-10-31T00:00:00.0000000Z',
    endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us', arm: 'https://management.usgovcloudapi.net' },
    permissions: { granted: 24, skipped: 0, failed: 0 },
    subscription: { subscription_id: null, status: 'skipped' },
    security_defaults: 'disabled_by_operator',
    break_glass: { verified: true, upns: ['bg1@contoso.us', 'bg2@contoso.us'], user_ids: ['u1', 'u2'], detail: 'ok' },
    validation_passed: true,
    completed_at: '2026-10-31T12:00:00.000Z',
    ...overrides,
  };
}

describe('bootstrap launcher', () => {
  it('launches PowerShell 7 (pwsh), not Windows PowerShell 5.1', () => {
    expect(BOOTSTRAP_PWSH).toBe('pwsh');
  });

  it('gives a clear error when pwsh is missing', () => {
    const err = Object.assign(new Error('spawn pwsh ENOENT'), { code: 'ENOENT' });
    expect(describeBootstrapSpawnError(err)).toBe(PWSH_MISSING_MESSAGE);
    expect(PWSH_MISSING_MESSAGE).toMatch(/PowerShell 7 \(pwsh\) was not found/);
    expect(PWSH_MISSING_MESSAGE).toContain('https://aka.ms/powershell');
    const other = Object.assign(new Error('boom'), { code: 'EACCES' });
    expect(describeBootstrapSpawnError(other)).toContain('boom');
  });

  it('derives a registry-safe slug from the display name', () => {
    expect(deriveTenantSlug('CMMC Automation')).toBe('cmmc-automation');
    expect(deriveTenantSlug('  Contoso/GCC High!! ')).toBe('contoso-gcc-high');
  });
});

describe('bootstrap tenant record', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-ti-registry-'));
    env = { ...process.env, CES_TENANT_ROOT: root };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a live record in the registry format that the ces-tenant registry reads back', async () => {
    const written = writeBootstrapTenantRecord(result(), 'contoso', env);
    expect(written.path).toBe(path.join(root, 'live', 'contoso.json'));
    expect(written.updated).toBe(false);

    const raw = JSON.parse(fs.readFileSync(written.path, 'utf-8'));
    expect(raw.kind).toBe('live');
    expect(raw.client).toEqual({ slug: 'contoso', name: 'Contoso Defense' });
    expect(raw.tenant).toEqual({ tenant_id: TENANT, domain: 'contoso.onmicrosoft.us', environment: 'gcc-high' });
    expect(raw.auth.cert_source).toBe('store');
    expect(raw.auth.cert_path).toMatch(/\.cer$/);
    expect(raw.onboarding.validation_passed).toBe(true);
    expect(raw.onboarding.break_glass.upns).toEqual(['bg1@contoso.us', 'bg2@contoso.us']);
    expect(JSON.stringify(raw)).not.toMatch(/\.pfx|password/i);

    const registry = new FileTenantRegistry({ registryRoot: root, cesPipelineRoot: root, homeDir: root, env });
    const record = await registry.get('contoso');
    expect(record?.kind).toBe('live');
    expect(record?.tenantId).toBe(TENANT);
    expect(record?.appId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(record?.certThumbprint).toBe('ABCDEF0123456789ABCDEF0123456789ABCDEF01');
  });

  it('FIN-21: a -Simulator bootstrap writes a sim record (never live) and keeps the licence result', () => {
    const written = writeBootstrapTenantRecord({ ...result(), simulator: true, licenses: { assigned: 1 } }, 'clean-g5', env);
    expect(written.path).toBe(path.join(root, 'sim', 'clean-g5.json'));
    const raw = JSON.parse(fs.readFileSync(written.path, 'utf-8'));
    expect(raw.kind).toBe('sim');
    expect(raw.onboarding.licenses).toEqual({ assigned: 1 });
    expect(fs.existsSync(path.join(root, 'live', 'clean-g5.json'))).toBe(false);
  });

  it('a rerun updates the record and keeps operator-added fields', () => {
    writeBootstrapTenantRecord(result(), 'contoso', env);
    const p = path.join(root, 'live', 'contoso.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    raw.subscription = { subscription_id: 'sub-1', resource_group: 'rg', location: 'usgovvirginia' };
    raw.client.name = 'Operator Name';
    fs.writeFileSync(p, JSON.stringify(raw));

    const second = writeBootstrapTenantRecord(result({ cert_thumbprint: 'NEWTHUMB' }), 'contoso', env);
    expect(second.updated).toBe(true);
    expect(second.record.auth.cert_thumbprint).toBe('NEWTHUMB');
    expect(second.record.subscription.resource_group).toBe('rg');
    expect(second.record.client.name).toBe('Operator Name');
  });

  it('refuses to repoint an existing record at another tenant, and refuses the dev slug', () => {
    writeBootstrapTenantRecord(result(), 'contoso', env);
    expect(() => writeBootstrapTenantRecord(result({ tenant_id: 'other' }), 'contoso', env)).toThrow(/belongs to tenant/);
    expect(() => writeBootstrapTenantRecord(result(), 'dev', env)).toThrow(/dev/);
    expect(() => writeBootstrapTenantRecord(result(), 'bad slug', env)).toThrow(/letters, numbers/);
    expect(fs.existsSync(path.join(root, 'live', 'dev.json'))).toBe(false);
  });

  it('reads a BOM-prefixed result file and rejects one missing required fields', () => {
    const f = path.join(root, 'r.json');
    fs.writeFileSync(f, '\uFEFF' + JSON.stringify(result()));
    expect(readBootstrapResult(f).app_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    fs.writeFileSync(f, JSON.stringify({ ...result(), cert_thumbprint: '' }));
    expect(() => readBootstrapResult(f)).toThrow(/cert_thumbprint/);
  });

  it('commercial environment maps to the commercial label', () => {
    expect(buildBootstrapTenantRecord(result({ environment: 'Commercial' }), 'c').tenant.environment).toBe('commercial');
  });
});
