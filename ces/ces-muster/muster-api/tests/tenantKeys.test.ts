// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * tenantKeys.test.ts — resolveTenantKeys (the consent-url route it fed is retired, FC-MU-3).
 *
 * Coverage:
 *  1. resolve by slug → tenantId/appId/endpoints correct, source 'tenant-config'
 *  2. secretRef env: resolution (stub ACME_THUMB)
 *  3. secretRef unset → throws (fail-closed)
 *  4. endpoint fallback to stack provider when tenant JSON omits endpoints
 *  5. unknown slug → TenantKeysError('tenant_not_found')
 *  6. no slug + env set → source 'env'
 *  7. no slug + no env → TenantKeysError('degraded')
 *  (8. the GET /consent-url tenant-slug route was retired in FC-MU-3 — harvest.retired.test.ts)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveTenantKeys, TenantKeysError } from '../src/services/tenantKeysService.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

let tmpRoot: string;

function buildFixture(
  slug: string,
  overrides: Record<string, unknown> = {},
): void {
  const dir = path.join(tmpRoot, 'Stamper', 'plan-data', slug);
  fs.mkdirSync(dir, { recursive: true });
  const base = {
    client: { slug, name: 'Acme Corp' },
    tenant: { tenant_id: 'acme-tenant-id-fixture', domain: 'acme.gov' },
    auth: {
      app_id: 'acme-app-id-fixture',
      cert_path: '/path/to/acme.pfx',
      cert_thumbprint: 'env:ACME_THUMB',
    },
    endpoints: {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
    },
    stack: 'microsoft-gcc-high',
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(base));
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-tenant-'));
  buildFixture('acme');
  // Fixture without endpoints to test stack-provider fallback
  buildFixture('acme-noendpoints', { endpoints: undefined });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Token helpers ──────────────────────────────────────────────────────────────


// ── resolveTenantKeys unit tests ───────────────────────────────────────────────

describe('resolveTenantKeys — slug path (Stamper constructs)', () => {
  it('resolves tenantId, appId, endpoints from plan-data; source = tenant-config', async () => {
    vi.stubEnv('CES_PIPELINE_ROOT', tmpRoot);
    vi.stubEnv('ACME_THUMB', 'resolved-thumbprint');
    try {
      const keys = await resolveTenantKeys('acme');
      expect(keys.source).toBe('tenant-config');
      expect(keys.tenantId).toBe('acme-tenant-id-fixture');
      expect(keys.appId).toBe('acme-app-id-fixture');
      expect(keys.certThumbprint).toBe('resolved-thumbprint');
      expect(keys.endpoints.graph).toBe('https://graph.microsoft.us');
      expect(keys.endpoints.login).toBe('https://login.microsoftonline.us');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('resolves secretRef via env var stub', async () => {
    vi.stubEnv('CES_PIPELINE_ROOT', tmpRoot);
    vi.stubEnv('ACME_THUMB', 'my-secret-thumb');
    try {
      const keys = await resolveTenantKeys('acme');
      expect(keys.certThumbprint).toBe('my-secret-thumb');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects (fail-closed) when secretRef env var is unset', async () => {
    vi.stubEnv('CES_PIPELINE_ROOT', tmpRoot);
    // ACME_THUMB intentionally not set
    try {
      await expect(resolveTenantKeys('acme')).rejects.toThrow(/not set/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to stack provider endpoints when tenant JSON omits endpoints', async () => {
    vi.stubEnv('CES_PIPELINE_ROOT', tmpRoot);
    vi.stubEnv('ACME_THUMB', 'thumb');
    try {
      const keys = await resolveTenantKeys('acme-noendpoints');
      // Stack provider for microsoft-gcc-high supplies these
      expect(keys.endpoints.graph).toBe('https://graph.microsoft.us');
      expect(keys.endpoints.login).toBe('https://login.microsoftonline.us');
      expect(keys.endpoints.arm).toBe('https://management.usgovcloudapi.net');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects with TenantKeysError("tenant_not_found") for unknown slug', async () => {
    vi.stubEnv('CES_PIPELINE_ROOT', tmpRoot);
    try {
      await expect(resolveTenantKeys('nonexistent-tenant')).rejects.toThrow(TenantKeysError);
      await expect(resolveTenantKeys('nonexistent-tenant')).rejects.toMatchObject({
        code: 'tenant_not_found',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('resolveTenantKeys — env fallback (no slug)', () => {
  it('returns source env when GRAPH_TENANT_ID and GRAPH_CLIENT_ID are set', async () => {
    vi.stubEnv('GRAPH_TENANT_ID', 'env-tenant');
    vi.stubEnv('GRAPH_CLIENT_ID', 'env-client');
    try {
      const keys = await resolveTenantKeys(undefined);
      expect(keys.source).toBe('env');
      expect(keys.tenantId).toBe('env-tenant');
      expect(keys.appId).toBe('env-client');
      // endpoints come from default stack provider (microsoft-gcc-high)
      expect(keys.endpoints.graph).toContain('graph.microsoft.us');
      expect(keys.endpoints.login).toContain('login.microsoftonline.us');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects with TenantKeysError("degraded") when env vars not set', async () => {
    // Ensure env vars are not set
    const origTenantId = process.env.GRAPH_TENANT_ID;
    const origClientId = process.env.GRAPH_CLIENT_ID;
    delete process.env.GRAPH_TENANT_ID;
    delete process.env.GRAPH_CLIENT_ID;
    try {
      await expect(resolveTenantKeys(undefined)).rejects.toThrow(TenantKeysError);
      await expect(resolveTenantKeys(undefined)).rejects.toMatchObject({ code: 'degraded' });
    } finally {
      if (origTenantId !== undefined) process.env.GRAPH_TENANT_ID = origTenantId;
      if (origClientId !== undefined) process.env.GRAPH_CLIENT_ID = origClientId;
    }
  });
});

// FC-MU-3: the consent-url route that consumed resolveTenantKeys is retired
// (see tests/harvest.retired.test.ts); the resolver itself is unchanged.
