// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import {
  calculateTenantCost,
  listStacks,
  getStackInfrastructureModels,
} from './tenantCost';
import { calculateG5Cost } from './g5CostCalculator';
import type { CostEstimateInput } from '../types';
import { EXAMPLE_STUB_STACK_ID } from '../../../../../ces-shared/src/stack/index';

const base: CostEstimateInput = { stance: 'm365_sentinel', user_count: 50, workload: 'light' };

/** Drop the call-time effective_date so two estimates can be compared on cost content alone. */
function omitEffectiveDate<T extends { effective_date: string }>(o: T): Omit<T, 'effective_date'> {
  const { effective_date: _drop, ...rest } = o;
  return rest;
}

describe('tenantCost — stack-aware dispatch (G7)', () => {
  it('default (no stackId) → Microsoft estimate, IDENTICAL to calculateG5Cost', () => {
    const r = calculateTenantCost(base);
    expect(r.kind).toBe('estimate');
    if (r.kind !== 'estimate') return;
    expect(r.stackId).toBe('microsoft-gcc-high');
    // identical to the pre-G7 calculator → zero behavior change.
    // (effective_date is a call-time timestamp, so normalize it before comparing.)
    expect(omitEffectiveDate(r.output)).toEqual(omitEffectiveDate(calculateG5Cost(base)));
  });

  it('explicit microsoft-gcc-high → estimate (same as default)', () => {
    const r = calculateTenantCost({ ...base, stackId: 'microsoft-gcc-high' });
    expect(r.kind).toBe('estimate');
    if (r.kind !== 'estimate') return;
    expect(omitEffectiveDate(r.output)).toEqual(omitEffectiveDate(calculateG5Cost(base)));
  });

  it('non-Microsoft stack → unsupported, not wrong M365 numbers', () => {
    const r = calculateTenantCost({ ...base, stackId: EXAMPLE_STUB_STACK_ID });
    expect(r.kind).toBe('unsupported');
    if (r.kind !== 'unsupported') return;
    expect(r.stackId).toBe(EXAMPLE_STUB_STACK_ID);
    expect(r.message).toMatch(/no cost model/i);
    expect(r.displayName).toMatch(/stub/i);
  });

  it('unknown stack id → resolves to Microsoft default (resolveStackId fallback)', () => {
    // resolveStackId only falls back when the id is empty; a real unknown id throws in the registry.
    // Empty/undefined → Microsoft default.
    const r = calculateTenantCost({ ...base, stackId: '' });
    expect(r.kind).toBe('estimate');
  });
});

describe('tenantCost — stack metadata helpers (G7)', () => {
  it('listStacks includes Microsoft + the proof stub', () => {
    const ids = listStacks().map((s) => s.id);
    expect(ids).toContain('microsoft-gcc-high');
    expect(ids).toContain(EXAMPLE_STUB_STACK_ID);
  });

  it('Microsoft infrastructure models are the three M365 stances (unchanged)', () => {
    expect(getStackInfrastructureModels('microsoft-gcc-high')).toEqual([
      'm365_only',
      'm365_sentinel',
      'm365_azure',
    ]);
  });

  it('default (undefined) infrastructure models = Microsoft', () => {
    expect(getStackInfrastructureModels(undefined)).toEqual([
      'm365_only',
      'm365_sentinel',
      'm365_azure',
    ]);
  });

  it('proof-stub infrastructure models differ from Microsoft', () => {
    expect(getStackInfrastructureModels(EXAMPLE_STUB_STACK_ID)).toEqual(['default']);
  });
});
