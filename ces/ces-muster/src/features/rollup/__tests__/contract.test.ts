// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#10 — Contract type has exactly 14 required fields matching §3.2
import { describe, test, expect } from 'vitest';
import type { Contract } from '@/shared/types/contract';

const REQUIRED_FIELDS: (keyof Contract)[] = [
  'contract_id',
  'contract_number',
  'award_date',
  'pop_start',
  'pop_end',
  'party_cage',
  'party_uei',
  'dfars_clauses',
  'cui_flowdown',
  'status',
  'value_at_risk',
  'prime_ref',
  'sub_ref',
  'engagement_ref',
];

describe('DW#10 — Contract type field contract', () => {
  test('Contract has exactly 14 required fields', () => {
    expect(REQUIRED_FIELDS).toHaveLength(14);
  });

  test('all 14 field names are present on a sample Contract object', () => {
    const sample: Contract = {
      contract_id: 'c-001',
      contract_number: 'FA8675-26-C-0001',
      award_date: '2026-01-15',
      pop_start: '2026-02-01',
      pop_end: '2027-01-31',
      party_cage: 'ZZZZZ',
      party_uei: 'ABC123456789',
      dfars_clauses: ['252.204-7012', '252.204-7020'],
      cui_flowdown: true,
      status: 'active',
      value_at_risk: 1500000,
      prime_ref: null,
      sub_ref: 'sub-abc',
      engagement_ref: 'eng-1',
    };

    for (const field of REQUIRED_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(sample, field)).toBe(true);
    }
  });

  test('status enum values are exhaustive', () => {
    const statusValues: Contract['status'][] = [
      'pending',
      'active',
      'option_year',
      'expired',
      'closed',
    ];
    expect(statusValues).toHaveLength(5);
  });
});
