// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function generateCaPolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `caPolicy-${i + 1}`,
    displayName: `Sim CA Policy ${i + 1}`,
    state: 'enabled',
    // Fixed UTC literal (not `new Date(...).toISOString()`) so this
    // generator's output never varies with the host machine's local
    // timezone - load-bearing for tests/protocol's byte-for-byte golden
    // comparison (tests/protocol/goldens/ca-policies.golden.json).
    createdDateTime: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    // G-STACKSIM-2 iteration 3: AO's A-19 (break-glass CA exclusion) reads
    // and rewrites `conditions.users.excludeUsers` - a real CA policy
    // always has a `conditions` object; without one here, AO's own
    // "CleanCond" helper (TemplateRegistry.ts) has nothing to copy forward
    // and the exclusion assignment has no `users` key to land on.
    conditions: {
      users: { includeUsers: ['All'], excludeUsers: [] },
      applications: { includeApplications: ['All'] },
    },
  }));
}

export function generateNamedLocations(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `namedLocation-${i + 1}`,
    displayName: `Sim Named Location ${i + 1}`,
    isTrusted: true,
  }));
}
