// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { evaluate, type CmmcAwareTenantConfig } from '../src/execution/CmmcScopeGate.js';
import { makeAoCommand } from './fixtures.js';

function makeTenant(overrides: Partial<CmmcAwareTenantConfig> = {}): CmmcAwareTenantConfig {
  return {
    tenantSlug: 'acme',
    ...overrides,
  } as CmmcAwareTenantConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CmmcScopeGate.evaluate', () => {
  it('(a) denies an L2-only practice against an L1 tenant', () => {
    const tenant = makeTenant({ cmmcLevel: 'L1' });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command);

    expect(result.allow).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('(b) allows an L2-only practice against an L2 tenant', () => {
    const tenant = makeTenant({ cmmcLevel: 'L2' });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command);

    expect(result.allow).toBe(true);
  });

  it('(c) allows with a warning when cmmcLevel is absent and non-strict is explicitly requested (Phase-1 migration path)', () => {
    // CMMC_STRICT_DEFAULT is now `true` (Phase 2), so the fail-open migration-window
    // path is exercised by an explicit non-strict opt (an operator --no-strict override),
    // not by the bare default. The bare default is covered below.
    const tenant = makeTenant({ cmmcLevel: undefined });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command, { strictCmmc: false });

    expect(result.allow).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.warning!.length).toBeGreaterThan(0);
  });

  it('allows a migration-exempt tenant even when cmmcLevel is absent under strict (dev/sim carve-out)', () => {
    const tenant = makeTenant({ cmmcLevel: undefined, cmmcMigrationExempt: true });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    // Exempt records are not assessment targets: allowed even with strict forced on.
    const result = evaluate(tenant, command, { strictCmmc: true });

    expect(result.allow).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('denies when cmmcLevel is absent under the Phase-2 default (no opts, no env)', () => {
    const tenant = makeTenant({ cmmcLevel: undefined }); // not exempt
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command);

    expect(result.allow).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('(d) denies when cmmcLevel is absent and AO_CMMC_STRICT=1 is set', () => {
    vi.stubEnv('AO_CMMC_STRICT', '1');
    const tenant = makeTenant({ cmmcLevel: undefined });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command);

    expect(result.allow).toBe(false);
  });

  it('allows an L1-only command (no .L2- practices) against an L1 tenant (no false-positive deny)', () => {
    const tenant = makeTenant({ cmmcLevel: 'L1' });
    const command = makeAoCommand({ id: 'A-02', cmmcPractices: ['AC.L1-3.1.1'] });

    const result = evaluate(tenant, command);

    expect(result.allow).toBe(true);
  });

  it('opts.strictCmmc explicit override bypasses env and denies on absent cmmcLevel', () => {
    const tenant = makeTenant({ cmmcLevel: undefined });
    const command = makeAoCommand({ id: 'A-01', cmmcPractices: ['AC.L2-3.1.5'] });

    const result = evaluate(tenant, command, { strictCmmc: true });

    expect(result.allow).toBe(false);
  });
});
