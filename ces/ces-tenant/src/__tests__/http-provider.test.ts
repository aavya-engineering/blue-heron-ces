// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * PlanDataTenantHttpKeyProvider -- behavior-preserved port of muster-api's
 * resolveTenantKeys() (tenantKeysService.ts:50-107): plan-data resolution,
 * per-field endpoint fallback, legacy nested fallback, env fallback, and the
 * tenant_not_found / degraded error codes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanDataTenantHttpKeyProvider, TenantKeysError } from '../impl/http-provider.js';
import { SecretRefError } from '../impl/secret-ref.js';
import { InProcessTenantStatus } from '../impl/status.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function writeTenantJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function rawTenant(slug: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    client: { slug },
    tenant: { tenant_id: `tid-${slug}`, domain: `${slug}.onmicrosoft.us` },
    auth: { app_id: `app-${slug}`, cert_path: `certs/${slug}.pfx`, cert_thumbprint: `THUMB-${slug}` },
    endpoints: {},
    ...overrides,
  };
}

function makeProvider(env: NodeJS.ProcessEnv = {}) {
  const cesPipelineRoot = tempDir('ces-tenant-httppipe-');
  const homeDir = tempDir('ces-tenant-httphome-');
  const provider = new PlanDataTenantHttpKeyProvider({ cesPipelineRoot, homeDir, env });
  return { provider, cesPipelineRoot, homeDir };
}

function planDataPath(cesPipelineRoot: string, slug: string): string {
  return path.join(cesPipelineRoot, 'Stamper', 'plan-data', slug, `${slug}.json`);
}

describe('PlanDataTenantHttpKeyProvider -- slug path', () => {
  it('resolves keys from plan-data with per-field endpoint fallback to the GCC High literals', async () => {
    const { provider, cesPipelineRoot } = makeProvider();
    writeTenantJson(
      planDataPath(cesPipelineRoot, 'acme'),
      rawTenant('acme', { endpoints: { graph: 'https://graph.custom.us', login: '' } }),
    );

    const keys = await provider.resolveTenantKeys('acme');
    expect(keys.source).toBe('tenant-config');
    expect(keys.tenantId).toBe('tid-acme');
    expect(keys.appId).toBe('app-acme');
    expect(keys.certThumbprint).toBe('THUMB-acme');
    // Per-field fallback: graph kept, login/arm fall back (tenantKeysService.ts:74-78).
    expect(keys.endpoints.graph).toBe('https://graph.custom.us');
    expect(keys.endpoints.login).toBe('https://login.microsoftonline.us');
    expect(keys.endpoints.arm).toBe('https://management.usgovcloudapi.net');
  });

  it('falls back to the legacy nested ~/.stamper path (resolveTenantJsonPath parity)', async () => {
    const { provider, homeDir } = makeProvider();
    writeTenantJson(path.join(homeDir, '.stamper', 'tenants', 'oldie', 'oldie.json'), rawTenant('oldie'));
    expect((await provider.resolveTenantKeys('oldie')).tenantId).toBe('tid-oldie');
  });

  it('rejects with tenant_not_found for a missing slug', async () => {
    const { provider } = makeProvider();
    await expect(provider.resolveTenantKeys('ghost')).rejects.toMatchObject({
      name: 'TenantKeysError',
      code: 'tenant_not_found',
    });
  });

  it('resolves secret-ref thumbprints from env and fails closed when unresolvable', async () => {
    const { provider, cesPipelineRoot } = makeProvider({ TP_REF: 'RESOLVED-TP' });
    writeTenantJson(
      planDataPath(cesPipelineRoot, 'reffy'),
      rawTenant('reffy', { auth: { app_id: 'a', cert_path: 'p', cert_thumbprint: 'env:TP_REF' } }),
    );
    expect((await provider.resolveTenantKeys('reffy')).certThumbprint).toBe('RESOLVED-TP');

    const bad = makeProvider({});
    writeTenantJson(
      planDataPath(bad.cesPipelineRoot, 'badref'),
      rawTenant('badref', { auth: { app_id: 'a', cert_path: 'p', cert_thumbprint: 'env:NOPE' } }),
    );
    await expect(bad.provider.resolveTenantKeys('badref')).rejects.toThrow(SecretRefError);
  });

  it('honors CES_STRICT_SECRETS: inline literal thumbprint is rejected before resolution', async () => {
    const { provider, cesPipelineRoot } = makeProvider({ CES_STRICT_SECRETS: '1' });
    writeTenantJson(planDataPath(cesPipelineRoot, 'strict'), rawTenant('strict'));
    await expect(provider.resolveTenantKeys('strict')).rejects.toThrow(/inline secret/);
  });
});

describe('PlanDataTenantHttpKeyProvider -- env fallback path', () => {
  it('resolves from GRAPH_TENANT_ID/GRAPH_CLIENT_ID with GRAPH_BASE_URL override', async () => {
    const { provider } = makeProvider({
      GRAPH_TENANT_ID: 'env-tid',
      GRAPH_CLIENT_ID: 'env-app',
      GRAPH_BASE_URL: 'https://graph.override.us',
    });
    const keys = await provider.resolveTenantKeys(undefined);
    expect(keys.source).toBe('env');
    expect(keys.tenantId).toBe('env-tid');
    expect(keys.appId).toBe('env-app');
    expect(keys.certThumbprint).toBeUndefined(); // env path never returns a thumbprint
    expect(keys.endpoints.graph).toBe('https://graph.override.us');
    expect(keys.endpoints.login).toBe('https://login.microsoftonline.us');
  });

  it('rejects with degraded when no slug and no env fallback', async () => {
    const { provider } = makeProvider({});
    await expect(provider.resolveTenantKeys(undefined)).rejects.toMatchObject({
      name: 'TenantKeysError',
      code: 'degraded',
    });
  });
});

describe('PlanDataTenantHttpKeyProvider -- caller identity + activity (ratified amendment 2026-07-10)', () => {
  function makeAmendedProvider(options: Partial<ConstructorParameters<typeof PlanDataTenantHttpKeyProvider>[0]> = {}) {
    const cesPipelineRoot = tempDir('ces-tenant-httppipe-');
    const homeDir = tempDir('ces-tenant-httphome-');
    const status = new InProcessTenantStatus();
    const warn = vi.fn();
    const provider = new PlanDataTenantHttpKeyProvider({
      cesPipelineRoot,
      homeDir,
      env: {},
      activity: status,
      logger: { log: () => {}, warn, error: () => {} },
      ...options,
    });
    return { provider, cesPipelineRoot, status, warn };
  }

  it('a token request with a consumer records an activity entry attributed to the module', async () => {
    const { provider, cesPipelineRoot, status, warn } = makeAmendedProvider({
      consumer: { module: 'muster-api', purpose: 'discovery scan' },
    });
    writeTenantJson(planDataPath(cesPipelineRoot, 'acme'), rawTenant('acme'));

    await provider.resolveTenantKeys('acme');

    const entries = await status.getActivity({ module: 'muster-api' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      consumer: { module: 'muster-api', purpose: 'discovery scan' },
      operation: 'resolveTenantKeys',
      tenantSlug: 'acme',
      outcome: 'ok',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a per-request consumer overrides the construction-time binding', async () => {
    const { provider, cesPipelineRoot, status } = makeAmendedProvider({
      consumer: { module: 'muster-api', purpose: 'default' },
    });
    writeTenantJson(planDataPath(cesPipelineRoot, 'acme'), rawTenant('acme'));

    await provider.resolveTenantKeys('acme', { module: 'ces-tester', purpose: 'scenario token' });

    expect(await status.getActivity({ module: 'ces-tester' })).toHaveLength(1);
    expect(await status.getActivity({ module: 'muster-api' })).toHaveLength(0);
  });

  it('a request without any consumer is LOGGED in library mode and recorded with consumer: null (amendment invariant)', async () => {
    const { provider, cesPipelineRoot, status, warn } = makeAmendedProvider();
    writeTenantJson(planDataPath(cesPipelineRoot, 'acme'), rawTenant('acme'));

    await provider.resolveTenantKeys('acme');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without consumer identity'));
    const entries = await status.getActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0].consumer).toBeNull();
  });

  it('a failed token request records an outcome: error entry and still throws the same TenantKeysError', async () => {
    const { provider, status } = makeAmendedProvider({ consumer: { module: 'muster-api', purpose: 'discovery' } });

    await expect(provider.resolveTenantKeys('ghost')).rejects.toThrow(TenantKeysError);

    const entries = await status.getActivity({ module: 'muster-api' });
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('error');
    expect(entries[0].detail).toContain('ghost');
  });
});
