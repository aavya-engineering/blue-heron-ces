// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from '@jest/globals';

/**
 * Integration test for live assessment mode.
 * Requires a live tenant config at ~/.stamper/tenants/{slug}.json
 * with valid Service Principal + certificate.
 *
 * To run: TENANT_SLUG=your-slug npx jest tests/integration/live-assessment.test.ts
 */
describe('Live Assessment Integration', () => {
  const tenantSlug = process.env.TENANT_SLUG;

  it.skip('should complete a full live assessment for 20 controls', async () => {
    if (!tenantSlug) {
      console.warn('Skipping: TENANT_SLUG not set');
      return;
    }

    // This test requires a running EO server
    const response = await fetch(`http://localhost:4002/api/assess?mode=live&tenant=${tenantSlug}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });

  it.skip('should generate SSP with evidence URLs', async () => {
    if (!tenantSlug) {
      console.warn('Skipping: TENANT_SLUG not set');
      return;
    }

    const response = await fetch('http://localhost:4002/api/ssp/generate', { method: 'POST' });
    expect(response.status).toBe(200);
    const ssp = await response.json() as { controlImplementations?: unknown };
    expect(ssp.controlImplementations).toBeDefined();
    expect(Array.isArray(ssp.controlImplementations)).toBe(true);
  });

  it.skip('should write evidence artifacts to blob storage', async () => {
    if (!tenantSlug) {
      console.warn('Skipping: TENANT_SLUG not set');
      return;
    }

    const response = await fetch('http://localhost:4002/api/evidence/artifacts');
    expect(response.status).toBe(200);
    const artifacts = await response.json();
    expect(Array.isArray(artifacts)).toBe(true);
  });

  it('should have evaluator registry coverage', async () => {
    const { evaluatorRegistry } = await import('../../src/eo/mapping/evaluators/index.js');
    expect(Object.keys(evaluatorRegistry).length).toBeGreaterThanOrEqual(20);
  });
});
