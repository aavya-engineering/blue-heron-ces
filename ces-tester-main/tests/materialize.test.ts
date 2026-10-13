// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { buildMaterializedScenario } from '../src/stacksim-client/materialize.js';
import type { StacksimSeedBlock } from '../src/stacksim-client/types.js';

describe('buildMaterializedScenario', () => {
  const seed: StacksimSeedBlock = {
    stance: 'm365_azure',
    countOverrides: { users: 3 },
    steps: [{ kind: 'uri', method: 'PATCH', uri: '/v1.0/identity/conditionalAccess/policies/caPolicy-1' }],
  };

  it('splices name from scenario_id and passes stacksim_seed through untouched', () => {
    const materialized = buildMaterializedScenario('my-scenario', seed);
    expect(materialized.name).toBe('my-scenario');
    expect(materialized.stance).toBe('m365_azure');
    expect(materialized.countOverrides).toEqual({ users: 3 });
    expect(materialized.steps).toEqual(seed.steps);
    expect(materialized.description).toBeUndefined();
  });

  it('includes description when supplied', () => {
    const materialized = buildMaterializedScenario('my-scenario', seed, 'a probe scenario');
    expect(materialized.description).toBe('a probe scenario');
  });

  it('does not leak wrapper-only fields beyond name/description + stacksim_seed contents', () => {
    const materialized = buildMaterializedScenario('my-scenario', seed, 'desc');
    expect(Object.keys(materialized).sort()).toEqual(
      ['countOverrides', 'description', 'name', 'stance', 'steps'].sort(),
    );
  });
});
