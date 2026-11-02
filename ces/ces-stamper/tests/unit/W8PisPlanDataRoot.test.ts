// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-PIS: CES_STAMPER_PLAN_DATA_ROOT redirects dev plan-data (parity runs use a run-scoped root).

import * as path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { getPlanDataRoot, getRepoRoot, getTenantPlanDataDir } from '../../src/config/paths';

describe('getPlanDataRoot', () => {
  const saved = process.env.CES_STAMPER_PLAN_DATA_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.CES_STAMPER_PLAN_DATA_ROOT;
    else process.env.CES_STAMPER_PLAN_DATA_ROOT = saved;
  });

  it('defaults to the repo plan-data folder', () => {
    delete process.env.CES_STAMPER_PLAN_DATA_ROOT;
    expect(getPlanDataRoot()).toBe(path.join(getRepoRoot(), 'plan-data'));
  });

  it('follows the override, resolved', () => {
    process.env.CES_STAMPER_PLAN_DATA_ROOT = 'C:/ces-nb/out/ui/parity-state/repo-plan-data';
    expect(getPlanDataRoot()).toBe(path.resolve('C:/ces-nb/out/ui/parity-state/repo-plan-data'));
    expect(getTenantPlanDataDir('dev')).toBe(path.join(path.resolve('C:/ces-nb/out/ui/parity-state/repo-plan-data'), 'dev'));
  });
});
