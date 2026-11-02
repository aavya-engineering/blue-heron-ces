// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#10 — Roster CSV import test
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parseRosterCsv } from '../rosterImport';

describe('DW#10 — roster CSV import', () => {
  test('roster CSV creates correct Sub records', () => {
    const csv = readFileSync(
      new URL('../__fixtures__/roster.csv', import.meta.url),
      'utf-8'
    );
    const subs = parseRosterCsv(csv, 'eng-1');
    expect(subs).toHaveLength(2);
    expect(subs[0].name).toBe('Acme Defense LLC');
    expect(subs[0].uei).toBe('ABCDEFGHIJ12');
    expect(subs[0].cage).toBe('1A2B3');
    expect(subs[1].name).toBe('Widget Systems Inc');
    expect(subs[1].uei).toBe('KLMNOPQRST34');
    expect(subs[1].cage).toBe('4C5D6');
  });

  test('each Sub gets a unique id and the correct engagementId', () => {
    const csv = readFileSync(
      new URL('../__fixtures__/roster.csv', import.meta.url),
      'utf-8'
    );
    const subs = parseRosterCsv(csv, 'eng-test-123');
    expect(subs[0].id).toBeTruthy();
    expect(subs[1].id).toBeTruthy();
    expect(subs[0].id).not.toBe(subs[1].id);
    expect(subs[0].engagement_id).toBe('eng-test-123');
    expect(subs[1].engagement_id).toBe('eng-test-123');
  });

  test('CSV with no data rows returns empty array', () => {
    const subs = parseRosterCsv('name,uei,cage\n', 'eng-1');
    expect(subs).toHaveLength(0);
  });

  test('CSV without header row parses all lines', () => {
    const csv = 'Phantom LLC,XYZ123456789,9Z8Y7\n';
    const subs = parseRosterCsv(csv, 'eng-1');
    expect(subs).toHaveLength(1);
    expect(subs[0].name).toBe('Phantom LLC');
  });
});
