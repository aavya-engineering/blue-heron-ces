// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PH11-TS: S3's gates_max 25 (founder ruling Q6, 2026-11-01), the remote-maintenance MFA baseline expectation
// (enabled since PH-6) and the S3 remote-MFA check wording. Reads scenario files only; nothing is spawned.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadMusterE2eFile } from '../src/scenarios/musterE2eFile.js';
import { loadScenarioFile } from '../src/scenarios/scenarioFile.js';

const SCEN = path.join(__dirname, '..', 'scenarios');
const S3 = path.join(SCEN, 'muster', 's3-def-e2e.json');
const RM = path.join(SCEN, 'remote-maintenance-mfa-baseline.json');

const findBySelect = (o: unknown, equals: string): Record<string, unknown> | null => {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if ((r.select as { equals?: string } | undefined)?.equals === equals) return r;
  for (const v of Object.values(r)) { const hit = findBySelect(v, equals); if (hit) return hit; }
  return null;
};

describe('S3 postcheck thresholds (Q6)', () => {
  it('gates_max is 25 and the note names the founder ruling and the three DEPTH-11 gates', async () => {
    const sc = (await loadMusterE2eFile(S3)) as unknown as { postcheck_thresholds: Record<string, unknown> };
    expect(sc.postcheck_thresholds.gates_max).toBe(25);
    expect(sc.postcheck_thresholds.presence_max).toBe(2);
    const note = String(sc.postcheck_thresholds._note);
    expect(note).toContain('2026-11-01');
    for (const c of ['AU.L2-3.3.4', 'MA.L2-3.7.2', 'SC.L2-3.13.7']) expect(note).toContain(c);
  });
});

describe('S3 remote-maintenance MFA check wording', () => {
  it("no longer claims the lookup admits report-only; the S3-CA01 assertion is unchanged", () => {
    const sc = JSON.parse(fs.readFileSync(S3, 'utf8'));
    const chk = findBySelect(sc, 'S3-CA01 Require MFA - all users');
    expect(chk).not.toBeNull();
    expect(String(chk!.description)).not.toContain('(it admits');
    expect(String(chk!.description)).not.toContain('no CES policy created');
    expect(String(chk!.description)).toContain("-State 'enabled'");
    expect(chk!.value).toBe('enabledForReportingButNotEnforced');
  });
});

describe('remote-maintenance-mfa-baseline expectation', () => {
  it('expects the CES policy enabled, as the MA.L2-3.7.5.remote-mfa SET writes it', async () => {
    await loadScenarioFile(RM);
    const all = fs.readFileSync(RM, 'utf8');
    expect(all).not.toContain('enabledForReportingButNotEnforced');
    const chk = findBySelect(JSON.parse(all), 'CMMC-RemoteMaintenance-MFA');
    expect(chk).not.toBeNull();
    expect(chk!.path).toBe('state');
    expect(chk!.value).toBe('enabled');
  });
});
