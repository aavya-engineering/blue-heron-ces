// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1: unified demo reset (P1-8, M1 "one command to reset").
import { describe, it, expect } from 'vitest';
import { planReset, executeReset, type ResetPlanOptions } from '../src/demo/reset.js';

const OPTS: ResetPlanOptions = {
  stacksimRoot: '/ces/tenant-stacksim',
  demoSlug: 'demo-dib-small',
  testerRoot: '/ces/ces-tester',
  ports: [
    { name: 'stacksim', port: 4390 },
    { name: 'muster', port: 5173 },
  ],
};

describe('planReset', () => {
  it('orders tenant-reset → lock → runs → ports, without an EO step when no storage root', () => {
    const plan = planReset(OPTS);
    expect(plan.map((a) => a.kind)).toEqual([
      'stacksim-tenant-reset',
      'remove-lock',
      'clear-runs',
      'report-ports',
    ]);
  });

  it('adds the throwaway EO storage clear when a root is given', () => {
    const plan = planReset({ ...OPTS, eoStorageRoot: '/tmp/eo-demo-store' });
    expect(plan.map((a) => a.kind)).toContain('clear-eo-storage');
    expect(plan.find((a) => a.kind === 'clear-eo-storage')?.target).toBe('/tmp/eo-demo-store');
  });

  it('does not auto-kill ports — the port action is report-only (do-no-harm)', () => {
    const portAction = planReset(OPTS).find((a) => a.kind === 'report-ports');
    expect(portAction).toBeDefined();
    expect(portAction?.target).toBeUndefined(); // no fs target; nothing terminated
  });
});

describe('executeReset', () => {
  it('reports every action outcome even when the tenant reset is unwired', async () => {
    const outcomes = await executeReset(planReset(OPTS), OPTS, {
      probePort: async () => 'free',
    });
    const byKind = Object.fromEntries(outcomes.map((o) => [o.kind, o]));
    expect(byKind['stacksim-tenant-reset'].status).toBe('skipped');
    expect(byKind['report-ports'].status).toBe('reported');
    expect(byKind['report-ports'].detail).toContain('all demo ports free');
  });

  it('runs the injected tenant reset and reports still-occupied ports', async () => {
    let resetSlug = '';
    const outcomes = await executeReset(planReset(OPTS), OPTS, {
      resetTenant: async (slug) => {
        resetSlug = slug;
      },
      probePort: async (p) => (p === 4390 ? 'occupied' : 'free'),
    });
    expect(resetSlug).toBe('demo-dib-small');
    const tenant = outcomes.find((o) => o.kind === 'stacksim-tenant-reset');
    expect(tenant?.status).toBe('done');
    const ports = outcomes.find((o) => o.kind === 'report-ports');
    expect(ports?.detail).toContain('4390');
  });

  it('surfaces a tenant-reset error without throwing', async () => {
    const outcomes = await executeReset(planReset(OPTS), OPTS, {
      resetTenant: async () => {
        throw new Error('stacksim reset boom');
      },
      probePort: async () => 'free',
    });
    const tenant = outcomes.find((o) => o.kind === 'stacksim-tenant-reset');
    expect(tenant?.status).toBe('error');
    expect(tenant?.detail).toContain('boom');
  });
});
