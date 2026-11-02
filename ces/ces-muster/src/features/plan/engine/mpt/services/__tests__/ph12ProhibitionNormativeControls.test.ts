// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// PH-12 (LOG-PH12-INT.md item 4): per-objective postcheck rows for scoped-out Met-By-Prohibition controls.
import { describe, test, expect } from 'vitest';
import type { SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { ScopeExclusion, TaskCatalog } from '../../types';
import { buildScopeExclusions } from '@/features/gaps/gapCompiler';
import { annotateVerificationRows, CONTROL_EXPECTATIONS } from '@/features/plan/derive/verificationExpectations';
import { referencePractice } from '@/features/plan/derive/objectiveSpecs';
import { buildProhibitionNormativeControls, isProhibitionNormativeControl } from '../manifestGenerator';
import { validateArtifactAlignment } from '../validator';

const catalog = (...requirementIds: string[]): TaskCatalog =>
  ({ tasks: requirementIds.map((r) => ({ task_id: `task_${r}`, requirement_id: r })) }) as unknown as TaskCatalog;

const ex = (requirement_id: string, kind: ScopeExclusion['kind'], extra: Partial<ScopeExclusion> = {}): ScopeExclusion => ({
  requirement_id, kind, justification: 'Removable media prohibited by policy', si_field: 'removable_media_posture', si_value: 'blocked', ...extra,
});

// The removable-media rule of gapCompiler.buildScopeExclusions (Rule 3), from a minimal SI Baseline.
const SI_MEDIA_BLOCKED = { si_baseline: { operations: { removable_media_posture: 'blocked' }, scope: {} } } as unknown as SIBaseline;

describe('buildProhibitionNormativeControls', () => {
  test('the removable-media prohibition gives MP.L2-3.8.5 and MP.L2-3.8.6 one machine row each; AC.L2-3.1.6 is no longer scoped out', () => {
    const exclusions = [...buildScopeExclusions(SI_MEDIA_BLOCKED).exclusions.values()];
    expect(exclusions.map((e) => e.requirement_id).sort()).toEqual(['MP.L2-3.8.5', 'MP.L2-3.8.6']);
    const ncs = buildProhibitionNormativeControls(exclusions, catalog('AC.L2-3.1.6', 'MP.L2-3.8.1'));
    expect(ncs.map((n) => n.control_id)).toEqual(['MP.L2-3.8.5', 'MP.L2-3.8.6']);
    for (const n of ncs) {
      expect(n.verification).toHaveLength(1);
      expect(n.verification[0].method).toBe('config_export');
      expect(n.required_state).toContain('met by prohibition');
      expect(n.evidence_artifacts).toEqual([]);
    }
  });

  test('only prohibitions, only controls with no task, never one needing RR validation, once each', () => {
    const ncs = buildProhibitionNormativeControls(
      [ex('MP.L2-3.8.5', 'prohibition'), ex('AC.L2-3.1.18', 'capability-absent'), ex('CM.L2-3.4.6', 'prohibition'), ex('MP.L2-3.8.5', 'prohibition'),
        ex('SC.L2-3.13.16', 'prohibition', { requires_rr_validation: true })],
      catalog('CM.L2-3.4.6'),
    );
    expect(ncs.map((n) => n.control_id)).toEqual(['MP.L2-3.8.5']);
  });

  test('annotateVerificationRows rebuilds them one row per objective, config_export, presence_only, with no expected_value', () => {
    const ncs = buildProhibitionNormativeControls([ex('MP.L2-3.8.5', 'prohibition'), ex('MP.L2-3.8.6', 'prohibition')], catalog());
    for (const id of ['MP.L2-3.8.5', 'MP.L2-3.8.6']) expect(CONTROL_EXPECTATIONS[id]).toBeUndefined();
    annotateVerificationRows(ncs, { policyValues: {}, sitAnswers: {} });
    expect(ncs.flatMap((n) => n.verification.map((v: any) => v.objective_id))).toEqual(['MP.L2-3.8.5[a]', 'MP.L2-3.8.5[b]', 'MP.L2-3.8.6[a]']);
    for (const n of ncs) {
      expect(n.verification).toHaveLength(referencePractice(n.control_id)!.objectives.length);
      for (const v of n.verification) {
        expect(v.method).toBe('config_export');
        expect(v.presence_only).toBe(true);
        expect(v.expected_value).toBeUndefined();
      }
    }
  });
});

describe('validator check 4 and Met-By-Prohibition normative controls', () => {
  const plan = (scope_exclusions: unknown[]) => ({
    outputs: { human_readable_mission_plan: { steps: [{ id: 's1', control_coverage: [{ control_id: 'MP.L2-3.8.1' }], expected_artifacts: [] }], scope_exclusions } },
  });
  const tm = { tenant_manifest: { normative_controls: [{ control_id: 'MP.L2-3.8.1' }, { control_id: 'MP.L2-3.8.5' }], evidence_monitors: [] } };
  const mismatch = (w: string[]) => w.filter((x) => x.includes('"MP.L2-3.8.5" not present in manual plan control coverage'));

  test('a prohibition scope exclusion is not a mismatch', () => {
    expect(isProhibitionNormativeControl(plan([ex('MP.L2-3.8.5', 'prohibition')]).outputs.human_readable_mission_plan, 'MP.L2-3.8.5')).toBe(true);
    expect(mismatch(validateArtifactAlignment(plan([ex('MP.L2-3.8.5', 'prohibition')]), tm).warnings)).toEqual([]);
  });

  test('without the exclusion, or for a capability-absent one, the mismatch is still reported', () => {
    expect(mismatch(validateArtifactAlignment(plan([]), tm).warnings)).toHaveLength(1);
    expect(mismatch(validateArtifactAlignment(plan([ex('MP.L2-3.8.5', 'capability-absent')]), tm).warnings)).toHaveLength(1);
  });
});
