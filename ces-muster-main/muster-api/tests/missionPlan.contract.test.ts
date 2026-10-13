// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R1 (M3): contract validation — proves the checked-in Muster fixtures
// parse with the canonical ces-shared contract (the schema Stamper uses).
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  validateMissionPlan,
  validateTenantManifest,
} from '../src/contracts/missionPlan.contract';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');

describe('MS-R1: Zod contract (canonical ces-shared contract)', () => {
  test('Muster MP fixture parses the Zod contract', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
    const r = validateMissionPlan(mp);
    if (!r.ok) console.error('Zod errors:', r.errors.slice(0, 10));
    expect(r.ok).toBe(true);
  });

  test('Muster TM fixture parses the Zod contract', () => {
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
    const r = validateTenantManifest(tm);
    if (!r.ok) console.error('Zod errors:', r.errors.slice(0, 10));
    expect(r.ok).toBe(true);
  });

  test('unknown ces.version is rejected', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
    mp.ces.version = '99.0.0';
    const r = validateMissionPlan(mp);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.includes('99.0.0'))).toBe(true);
  });

  test('MP with empty control_directives still parses (optional in Stamper)', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8'));
    mp.outputs.human_readable_mission_plan.control_directives = [];
    const r = validateMissionPlan(mp);
    expect(r.ok).toBe(true);
  });

  test('MP with malformed ces block fails', () => {
    const r = validateMissionPlan({ ces: { artifact: '' }, inputs: {}, outputs: {} });
    expect(r.ok).toBe(false);
  });

  test('TM with missing normative_controls fails', () => {
    const tm = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), 'utf8'));
    tm.tenant_manifest.normative_controls = [];
    const r = validateTenantManifest(tm);
    expect(r.ok).toBe(false);
  });
});
