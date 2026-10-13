// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import {
  evaluateMidPipelineAssertion,
  CLEAN_TENANT_MFA_BASELINE_MID_PIPELINE_ASSERTION,
  type MidPipelineAssertionSpec,
} from '../src/muster-driver/mid-pipeline-assertion.js';

const spec: MidPipelineAssertionSpec = {
  arrayPath: 'outputs.human_readable_mission_plan.control_directives',
  matchField: 'control_id',
  matchValue: 'IA.L2-3.5.3',
  assert: 'exists',
};

describe('evaluateMidPipelineAssertion', () => {
  it('PASSes when the array contains a matching element', () => {
    const missionPlan = {
      outputs: {
        human_readable_mission_plan: {
          control_directives: [{ control_id: 'AC.L1-3.1.1' }, { control_id: 'IA.L2-3.5.3' }],
        },
      },
    };
    const result = evaluateMidPipelineAssertion(missionPlan, spec);
    expect(result.pass).toBe(true);
  });

  it('FAILs (not throws) when the array exists but has no matching element', () => {
    const missionPlan = {
      outputs: { human_readable_mission_plan: { control_directives: [{ control_id: 'AC.L1-3.1.1' }] } },
    };
    const result = evaluateMidPipelineAssertion(missionPlan, spec);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no element');
  });

  it('FAILs (not throws) when the array path itself is absent', () => {
    const missionPlan = { outputs: {} };
    const result = evaluateMidPipelineAssertion(missionPlan, spec);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not an array');
  });

  it('FAILs (not throws) when the mission plan object is empty', () => {
    const result = evaluateMidPipelineAssertion({}, spec);
    expect(result.pass).toBe(false);
  });

  it('the exported clean-tenant-mfa-baseline constant matches the real Manual Mission Plan shape', () => {
    expect(CLEAN_TENANT_MFA_BASELINE_MID_PIPELINE_ASSERTION.arrayPath).toBe(
      'outputs.human_readable_mission_plan.control_directives',
    );
    expect(CLEAN_TENANT_MFA_BASELINE_MID_PIPELINE_ASSERTION.matchValue).toBe('IA.L2-3.5.3');
  });
});
