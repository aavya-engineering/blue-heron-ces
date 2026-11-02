// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Storage smoke test for ces-stamper.
 * Verifies that resolved storage dirs match the contract under a tmp CES_PIPELINE_ROOT.
 */
import path from 'node:path';
import {
  getCesPipelineRoot,
  getModuleStorageRoot,
  getStamperPlanDataRoot,
} from '../../../ces-shared/src/storage/node.js';

describe('Stamper storage contract smoke test', () => {
  const TMP_ROOT = '/tmp/ces-smoke-stamper';
  const originalEnv = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    process.env.CES_PIPELINE_ROOT = TMP_ROOT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CES_PIPELINE_ROOT;
    } else {
      process.env.CES_PIPELINE_ROOT = originalEnv;
    }
  });

  it('getCesPipelineRoot resolves to the tmp root', () => {
    expect(getCesPipelineRoot()).toBe(path.resolve(TMP_ROOT));
  });

  it('getModuleStorageRoot returns Stamper/storage under the pipeline root', () => {
    expect(getModuleStorageRoot('Stamper')).toBe(
      path.join(path.resolve(TMP_ROOT), 'Stamper', 'storage'),
    );
  });

  it('getStamperPlanDataRoot returns Stamper/plan-data under the pipeline root', () => {
    expect(getStamperPlanDataRoot()).toBe(
      path.join(path.resolve(TMP_ROOT), 'Stamper', 'plan-data'),
    );
  });
});
