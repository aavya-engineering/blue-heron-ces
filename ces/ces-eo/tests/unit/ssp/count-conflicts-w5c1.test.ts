// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 1 (SC-2 row 17): buildCountConflicts compares like quantities only. The CUI-authorised user count
 * (CUI boundary fact cui_user_count, and the Mission Plan's copy of the CUI boundary) is never compared with the
 * user / licence counts; a conflict is printed only between two sources of the same quantity.
 */
import { buildCountConflicts } from '../../../src/eo/ssp/SspGenerator.js';
import type { BoundaryFact } from '../../../src/shared/types/ssp.types.js';

const mp = (users: number | undefined, keyFactUsers: number | undefined, inScope: number | undefined, mpCui?: number) => ({
  inputs: {
    infrastructure_configuration: users === undefined ? {} : { user_count: users },
    si_baseline: { si_baseline: { scope: inScope === undefined ? {} : { in_scope_users_estimate: inScope } } },
  },
  outputs: {
    human_readable_mission_plan: {
      disposition_summary: { si_key_facts: keyFactUsers === undefined ? {} : { user_count: keyFactUsers } },
      boundary_context: mpCui === undefined ? {} : { cui_boundary: { cui_user_count: mpCui } },
    },
  },
});
const tm = (licences: number) => ({ tenant_manifest: { tenant_identity: { license_count: licences } } });
const facts = (cuiUsers?: string): BoundaryFact[] => (cuiUsers === undefined ? [] : [{ key: 'cui_user_count', value: cuiUsers }]);

describe('buildCountConflicts (W5 cycle 1: like quantities only)', () => {
  test('run 43 inputs: 44 users / licences everywhere and 18 CUI-authorised users give no conflict', () => {
    expect(buildCountConflicts(mp(44, 44, 44, 18), tm(44), facts('18'))).toEqual([]);
  });

  test('CUI users differing from total users is not a conflict (different quantities)', () => {
    expect(buildCountConflicts(mp(44, 44, 44), tm(44), facts('18'))).toEqual([]);
  });

  test('a single CUI source is never compared with anything', () => {
    expect(buildCountConflicts(undefined, undefined, facts('18'))).toEqual([]);
  });

  test('MP 50 users vs TM 0 licences: one users conflict, without the CUI count', () => {
    const out = buildCountConflicts(mp(50, 50, undefined), tm(0), facts('0'));
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe('users');
    expect(out[0].values.map(v => v.source)).toEqual([
      'Mission Plan inputs.infrastructure_configuration.user_count',
      'Mission Plan disposition_summary.si_key_facts.user_count',
      'Tenant Manifest tenant_identity.license_count',
    ]);
    expect(out[0].values.some(v => /cui_user_count/.test(v.source))).toBe(false);
    expect(out[0].statement).toBe('User counts disagree across the inputs; this SSP states them all and uses none: Mission Plan inputs.infrastructure_configuration.user_count = 50; Mission Plan disposition_summary.si_key_facts.user_count = 50; Tenant Manifest tenant_identity.license_count = 0.');
  });

  test('two CUI-authorised user sources that disagree: one CUI conflict, users untouched', () => {
    const out = buildCountConflicts(mp(44, 44, 44, 20), tm(44), facts('18'));
    expect(out).toEqual([{
      quantity: 'CUI-authorised users',
      values: [
        { source: 'CUI boundary fact cui_user_count', value: '18' },
        { source: 'Mission Plan boundary_context.cui_boundary.cui_user_count', value: '20' },
      ],
      statement: 'CUI-authorised user counts disagree across the inputs; this SSP states them all and uses none: CUI boundary fact cui_user_count = 18; Mission Plan boundary_context.cui_boundary.cui_user_count = 20.',
    }]);
  });

  test('both quantities in conflict: two conflicts, each between sources of its own quantity', () => {
    const out = buildCountConflicts(mp(50, 50, 50, 20), tm(0), facts('18'));
    expect(out.map(c => c.quantity)).toEqual(['users', 'CUI-authorised users']);
    expect(out[0].values.every(v => !/cui_user_count/.test(v.source))).toBe(true);
    expect(out[1].values.every(v => /cui_user_count/.test(v.source))).toBe(true);
  });
});
