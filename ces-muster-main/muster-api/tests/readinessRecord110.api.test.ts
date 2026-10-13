// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * readinessRecord110.api.test.ts — FC-MU-3 step 3 (founder decision 2026-09-28
 * #12): the muster-api discovery envelope is a readiness-result/1.1.0, for the
 * sim run and the live run alike, and it validates against the ONE schema
 * (public/schemas/readiness-result.schema.json) the SPA importer uses.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryReadinessResult } from '../src/services/discoveryEnvelope.js';

const BASE = {
  observations: [],
  slug: 'stacksim-local',
  startedAt: '2026-09-28T00:00:00.000Z',
  completedAt: '2026-09-28T00:00:01.000Z',
  registryVersions: {},
};

describe('FC-MU-3 step 3 — the discovery envelope is readiness-result/1.1.0', () => {
  it('sim envelope', () => {
    const env = buildDiscoveryReadinessResult(BASE) as { schema_version: string };
    expect(env.schema_version).toBe('readiness-result/1.1.0');
  });

  it('live envelope keeps the consent', () => {
    const consent = {
      consented_by: 'admin@customer.example',
      consented_at: '2026-09-28T00:00:00.000Z',
      scopes: ['openid', 'https://graph.microsoft.us/Policy.Read.All'],
      tenant_id: '11111111-2222-3333-4444-555555555555',
      auth_tier: 'device-code' as const,
      client_id: 'public-client-fake',
    };
    const env = buildDiscoveryReadinessResult({ ...BASE, live: { engagementId: 'eng-1', consent } }) as {
      schema_version: string;
      manifest: { consent?: unknown };
    };
    expect(env.schema_version).toBe('readiness-result/1.1.0');
    expect(env.manifest.consent).toEqual(consent);
  });
});
