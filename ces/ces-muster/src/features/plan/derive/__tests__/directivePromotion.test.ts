// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import type { ManualMissionPlan } from '@/features/plan/engine/shared/types/artifacts';
import { configuringEntries, promoteConfigurableManualDirectives } from '../directivePromotion';

// The run-48 S1 manual directives (29) plus the muster-partial extras (MP.L2-3.8.5,
// MP.L2-3.8.6 manual there; on S1 both are document-prohibition).
const S1_MANUAL = [
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3', 'AU.L2-3.3.6', 'AU.L2-3.3.7', 'CA.L2-3.12.2', 'CA.L2-3.12.4',
  'CM.L2-3.4.4', 'CM.L2-3.4.8', 'IA.L2-3.5.10', 'IA.L2-3.5.11', 'IA.L2-3.5.8', 'IR.L2-3.6.3', 'MA.L2-3.7.1',
  'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.4', 'MA.L2-3.7.6', 'MP.L2-3.8.7', 'PE.L1-3.10.1', 'PE.L1-3.10.3',
  'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.2', 'PS.L2-3.9.1', 'PS.L2-3.9.2', 'RA.L2-3.11.1', 'RA.L2-3.11.2',
  'RA.L2-3.11.3',
];

function plan(rows: Array<{ id: string; directive: string; steps?: boolean }>): ManualMissionPlan {
  const control_directives = rows.map((r) => ({
    control_id: r.id,
    directive: r.directive,
    ...(r.steps === false ? {} : { step_ids: [`task_${r.id}_x`] }),
  }));
  const control_register = rows.map((r) => ({ control_id: r.id, title: r.id, domain: r.id.slice(0, 2), directive: r.directive, scope_status: 'in_scope' }));
  const directive_counts: Record<string, number> = {};
  for (const r of rows) directive_counts[r.directive] = (directive_counts[r.directive] ?? 0) + 1;
  const controls = rows.map((r) => ({
    requirement_id: r.id,
    stamper_action: r.directive === 'manual' ? 'Non-Stack' : r.directive === 'document-prohibition' ? 'Met-By-Prohibition' : 'Automated',
  }));
  return {
    ces: { artifact: 'manual_mission_plan', version: '1.0.0', generated_on: '2026-10-28' },
    outputs: { human_readable_mission_plan: { control_directives, disposition_summary: { si_key_facts: {}, control_register, directive_counts }, controls } },
  } as unknown as ManualMissionPlan;
}

type Body = {
  control_directives: Array<{ control_id: string; directive: string }>;
  disposition_summary: { control_register: Array<{ control_id: string; directive: string }>; directive_counts: Record<string, number> };
  controls: Array<{ requirement_id: string; stamper_action: string }>;
};
const body = (mp: ManualMissionPlan) => (mp as unknown as { outputs: { human_readable_mission_plan: Body } }).outputs.human_readable_mission_plan;
const directiveOf = (mp: ManualMissionPlan, id: string) => body(mp).control_directives.find((d) => d.control_id === id)?.directive;

describe('W5c3: manual -> implement when a registry entry with a set command lists the control', () => {
  it('promotes exactly AU.L2-3.3.7, CM.L2-3.4.8, IA.L2-3.5.10, IA.L2-3.5.8, MA.L2-3.7.1, MA.L2-3.7.2, MP.L2-3.8.7, PS.L2-3.9.2 and RA.L2-3.11.3 of the S1 manual set', () => {
    const mp = plan([...S1_MANUAL.map((id) => ({ id, directive: 'manual' })), { id: 'MP.L2-3.8.6', directive: 'document-prohibition' }]);
    const promoted = promoteConfigurableManualDirectives(mp);
    expect(promoted.map((p) => p.control_id)).toEqual(['AU.L2-3.3.7', 'CM.L2-3.4.8', 'IA.L2-3.5.10', 'IA.L2-3.5.8', 'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MP.L2-3.8.7', 'PS.L2-3.9.2', 'RA.L2-3.11.3']);
    // PH-13 (orchestrator decision): CM.L2-3.4.8 is renderable; it promotes through the state-verified App Control entry.
    expect(promoted.find((p) => p.control_id === 'CM.L2-3.4.8')?.entries).toEqual(['CM.L2-3.4.8.app-control']);
    // PH-13 (orchestrator decision): RA.L2-3.11.2 keeps its rendered document although mde-onboarding configures it.
    expect(configuringEntries('RA.L2-3.11.2')).toEqual(['SI.L1-3.14.1.mde-onboarding']);
    expect(directiveOf(mp, 'RA.L2-3.11.2')).toBe('manual');
    // PH-13: MP.L2-3.8.7 is configured by the removable-storage block (PH-12 R2 cross-credit, LOG-PH12-R2.md).
    expect(promoted.find((p) => p.control_id === 'MP.L2-3.8.7')?.entries).toEqual(['AC.L2-3.1.21.block-storage']);
    // W5c7: AU.L2-3.3.7 has its first configuring entry, the time-sync policy.
    expect(promoted.find((p) => p.control_id === 'AU.L2-3.3.7')?.entries).toEqual(['AU.L2-3.3.7.time-sync']);
    // W5c5: IA.L2-3.5.8 is Stamper-renderable; it promotes only through the state-verified compliance entry.
    expect(promoted.find((p) => p.control_id === 'IA.L2-3.5.8')?.entries).toEqual(['CM.L2-3.4.1.compliance-policy-windows']);
    expect(promoted.find((p) => p.control_id === 'IA.L2-3.5.10')?.entries).toEqual([
      'IA.L2-3.5.10.block-legacy-auth',
      'IA.L2-3.5.10.cert-auth',
      'IA.L2-3.5.10.credential-guard',
    ]);
    // W5c4: RA.L2-3.11.3's only entry is now verify-only (no set command); it still configures.
    expect(promoted.find((p) => p.control_id === 'RA.L2-3.11.3')?.entries).toEqual(['RA.L2-3.11.3.vuln-remediation', 'SI.L1-3.14.1.mde-onboarding']);
    // PH-12 (LOG-PH12-INT.md item 3, R5 C): Defender onboarding also lists RA.L2-3.11.3.
    // W7: Stamper's verify-only leaver workflow configures PS.L2-3.9.2; PH-12 adds the access review; PH-13 (P13-LV,
    // P13-INT) adds the verify-only past-leaver read that judges AdminOps A-22 (the LCW route is licence-gated in the translator).
    expect(promoted.find((p) => p.control_id === 'PS.L2-3.9.2')?.entries).toEqual(['PS.L2-3.9.2.access-review', 'PS.L2-3.9.2.leaver-access-terminated', 'PS.L2-3.9.2.leaver-workflow']);
    // A document-prohibition with a configuring entry (bitlocker) never moves.
    expect(directiveOf(mp, 'MP.L2-3.8.6')).toBe('document-prohibition');
    // Evidence-only / manual-only controls stay manual.
    for (const id of ['PE.L1-3.10.1', 'PS.L2-3.9.1', 'AT.L2-3.2.3', 'MA.L2-3.7.4']) expect(directiveOf(mp, id)).toBe('manual');
  });

  it('keeps a renderable control manual although it has a set-command entry (AU.L2-3.3.6)', () => {
    expect(configuringEntries('AU.L2-3.3.6')).toEqual(['AU.L2-3.3.6.audit-reduction']);
    const mp = plan([{ id: 'AU.L2-3.3.6', directive: 'manual' }]);
    expect(promoteConfigurableManualDirectives(mp)).toEqual([]);
    expect(directiveOf(mp, 'AU.L2-3.3.6')).toBe('manual');
  });

  it('promotes MP.L2-3.8.6 where it is manual (muster-partial), and MP.L2-3.8.5 through the removable-storage block (PH-12)', () => {
    const mp = plan([
      { id: 'MP.L2-3.8.5', directive: 'manual' },
      { id: 'MP.L2-3.8.6', directive: 'manual' },
    ]);
    const promoted = promoteConfigurableManualDirectives(mp);
    expect(promoted.map((p) => p.control_id)).toEqual(['MP.L2-3.8.5', 'MP.L2-3.8.6']);
    expect(promoted[0].entries).toEqual(['AC.L2-3.1.21.block-storage']);
    expect(directiveOf(mp, 'MP.L2-3.8.5')).toBe('implement');
  });

  it('never promotes a manual directive without step_ids', () => {
    const mp = plan([{ id: 'IA.L2-3.5.10', directive: 'manual', steps: false }]);
    expect(promoteConfigurableManualDirectives(mp)).toEqual([]);
    expect(directiveOf(mp, 'IA.L2-3.5.10')).toBe('manual');
  });

  it('keeps the plan self-consistent: register, counts and stamper_action move with the directive', () => {
    const mp = plan([
      { id: 'IA.L2-3.5.10', directive: 'manual' },
      { id: 'PE.L1-3.10.1', directive: 'manual' },
      { id: 'AC.L1-3.1.1', directive: 'implement' },
    ]);
    promoteConfigurableManualDirectives(mp);
    const b = body(mp);
    expect(b.disposition_summary.control_register.find((r) => r.control_id === 'IA.L2-3.5.10')?.directive).toBe('implement');
    expect(b.disposition_summary.directive_counts).toEqual({ implement: 2, manual: 1 });
    expect(b.controls.find((c) => c.requirement_id === 'IA.L2-3.5.10')?.stamper_action).toBe('Automated');
    expect(b.controls.find((c) => c.requirement_id === 'PE.L1-3.10.1')?.stamper_action).toBe('Non-Stack');
  });

  it('leaves a plan with no manual directives untouched', () => {
    const mp = plan([{ id: 'AC.L1-3.1.1', directive: 'implement' }]);
    const before = JSON.stringify(mp);
    expect(promoteConfigurableManualDirectives(mp)).toEqual([]);
    expect(JSON.stringify(mp)).toBe(before);
  });
});
