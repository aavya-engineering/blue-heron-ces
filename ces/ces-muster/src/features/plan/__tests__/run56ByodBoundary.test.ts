// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W6 (run 56, S2): a BYOD-under-MDM/MAM answer set must compile and validate
// with warnings, not a block. (1) A BTC_RISK_* normative control is a boundary
// risk finding, not a plan control; its flag rides the CUI boundary. (2) S-13
// allowed_mdm is managed BYOD, not "direct access".
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, test } from 'vitest';
import { classifyAlignment } from '../planValidation';
import { applyManagedByodOverride, buildCuiBoundary, MANAGED_BYOD_MODEL, type CuiQuestionBank } from '../cuiBoundaryAdapter';
import { attachBoundaryRiskFlags } from '../tenantManifestAdapter';
import type { BTCConfirmationOutput, CUIBoundaryOutput, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { InterviewFact } from '@/shared/types/engagement';

const CUI_BANK = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed CUI Boundary Question Bank.yaml'), 'utf8')
) as CuiQuestionBank;

const si = (byod: string): SIBaseline =>
  ({
    ces: { artifact: 'si_baseline', version: '1.0.0', generated_on: '2026-10-28' },
    si_baseline: { target: { cui_presence: 'cui_present' }, operations: { byod_posture: byod } },
  }) as unknown as SIBaseline;
const cuiFact: InterviewFact = {
  question_id: 'G-02',
  question_text: 'CUI presence',
  answer: 'cui_present',
  provenance: 'operator_interview',
  confidence: 'high',
  recorded_at: '2026-10-01T00:00:00.000Z',
};
const RUN56 =
  'Tenant manifest normative control "BTC_RISK_BTC-RULE-BYOD-DIRECT_byod_direct_access_high_boundary_risk" not present in manual plan control coverage';

describe('W6 run 56 (1): a BTC risk control is a boundary finding, not a plan control', () => {
  test('the run-56 message warns instead of blocking; other uncovered controls still block', () => {
    expect(classifyAlignment({ errors: [], warnings: [RUN56] })).toEqual({ blocking: [], warnings: [RUN56] });
    expect(
      classifyAlignment({ errors: [], warnings: ['Control "BTC_RISK_X" has expected artifacts but no evidence monitor in tenant manifest'] }).blocking
    ).toEqual([]);
    expect(classifyAlignment({ errors: [], warnings: ['Tenant manifest normative control "AC.L2-3.1.1" not present in manual plan control coverage'] }).blocking).toHaveLength(1);
  });

  test('the risk flags ride the CUI boundary as boundary_risk_flags (TM boundary_zones definition, CUI boundary envelope)', () => {
    const boundary = { ces: { artifact: 'cui_boundary_output', version: '1', generated_on: 'x', cui_bank_version: '1' }, cui_boundary: { byod_model: 'Yes - direct access allowed' } } as CUIBoundaryOutput;
    const btc = {
      btc_confirmation: {
        risk_flags: [{ flag_id: 'byod_direct_access_high_boundary_risk', domain: 'DV-02', severity: 'high', description: 'BYOD direct access', source_rule_id: 'BTC-RULE-BYOD-DIRECT' }],
      },
    } as unknown as BTCConfirmationOutput;
    expect(attachBoundaryRiskFlags(boundary, btc)).toEqual(['byod_direct_access_high_boundary_risk (high, DV-02; BTC-RULE-BYOD-DIRECT): BYOD direct access']);
    expect(boundary.cui_boundary.boundary_risk_flags).toEqual(['byod_direct_access_high_boundary_risk (high, DV-02; BTC-RULE-BYOD-DIRECT): BYOD direct access']);
    const clean = { ...boundary, cui_boundary: {} } as CUIBoundaryOutput;
    expect(attachBoundaryRiskFlags(clean, { btc_confirmation: { risk_flags: [] } } as unknown as BTCConfirmationOutput)).toEqual([]);
    expect('boundary_risk_flags' in clean.cui_boundary).toBe(false);
  });
});

describe('W6 run 56 (2): S-13 allowed_mdm is managed BYOD, not direct access', () => {
  test('S2-style answers (allowed_mdm, CUI.DEV.001 unanswered): byod_model is the managed value, with its basis', () => {
    const r = buildCuiBoundary({ facts: [cuiFact], siBaseline: si('allowed_mdm'), bank: CUI_BANK, planMode: 'harden_existing' });
    expect(r.boundary?.cui_boundary.device_model).toBe('BYOD direct access allowed'); // the bank option the SI derivation picks
    expect(r.boundary?.cui_boundary.byod_model).toBe(MANAGED_BYOD_MODEL);
    expect(String(r.boundary?.cui_boundary.byod_model_basis)).toContain('allowed_mdm');
    // So BTC-RULE-BYOD-DIRECT (byod_model eq "Yes - direct access allowed") cannot fire.
  });
  test('S1-style (not_allowed) and VDI-only boundaries are untouched', () => {
    expect(buildCuiBoundary({ facts: [cuiFact], siBaseline: si('not_allowed'), bank: CUI_BANK, planMode: 'harden_existing' }).boundary?.cui_boundary.byod_model).toBe('No BYOD');
    expect(buildCuiBoundary({ facts: [cuiFact], siBaseline: si('allowed_vdi_only'), bank: CUI_BANK, planMode: 'harden_existing' }).boundary?.cui_boundary.byod_model).toBe('Yes - VDI/Cloud PC only');
  });
  test('an explicit CUI.DEV.001 answer of direct access is kept as answered', () => {
    const b = { ces: {} as CUIBoundaryOutput['ces'], cui_boundary: { byod_model: 'Yes - direct access allowed' } } as CUIBoundaryOutput;
    expect(applyManagedByodOverride(b, { source: 'answered', question_id: 'CUI.DEV.001' }, si('allowed_mdm'))).toBe(false);
    expect(b.cui_boundary.byod_model).toBe('Yes - direct access allowed');
    expect(applyManagedByodOverride(b, { source: 'derived', provenance: 'derived:cui:si:SI BYOD posture' }, si('allowed_mdm'))).toBe(true);
    expect(b.cui_boundary.byod_model).toBe(MANAGED_BYOD_MODEL);
  });
});
