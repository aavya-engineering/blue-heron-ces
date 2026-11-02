// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// directivePromotion.ts — synthetic-customer W5 cycle 3: a control the vendored
// gap compiler disposes as Non-Stack (directive `manual`) is promoted to
// `implement` when Stamper's registry has an entry with a set command that lists
// it, so Stamper configures it instead of opening a manual gate.
//
// The vendored Planner generator is pinned (0 drift), so the promotion is a
// Muster post-step over the generated Manual Mission Plan. It keeps the plan
// self-consistent: control_directives[], disposition_summary.control_register[]
// and .directive_counts, and controls[].stamper_action ('Automated', the
// disposition the generator maps to implement) move together.
//
// Never promoted:
//  - any directive other than `manual` (document-prohibition, validate, ...);
//  - a control with no configuring entry (evidence-only or manual-only entries
//    alone): REGISTRY_FIX_PATHS lists only entries with a non-empty set_command
//    or, W5c4, `verify_only: true` (it runs and asserts state another entry
//    creates: RA.L2-3.11.3.vuln-remediation verifies MA.L2-3.7.1.update-ring's
//    ring, so it yields a SAT record only when that creator also runs); no
//    manual_only entry is either in the current registry; the extract's drift
//    test, export/__tests__/registryFixPaths.drift.test.ts, is the guard;
//  - a control Stamper itself promotes manual -> document-renderable
//    (STAMPER_RENDERABLE_CONTROLS): an implement directive would bypass that
//    signal-verification path. W5c5 exception: a renderable control whose
//    configuring entry state-verifies its setting (RENDERABLE_STATE_ENTRIES,
//    IA.L2-3.5.8 through the Windows compliance policy) is promoted; the entry's
//    state record replaces the rendered document;
//  - a manual directive without step_ids (Stamper skips an implement directive
//    that has no step to translate).
import type { ManualMissionPlan } from '@/features/plan/engine/shared/types/artifacts';
import { REGISTRY_FIX_PATHS } from '@/features/export/registryFixPaths';

/**
 * Mirror of Stamper's PlanTranslator DOC_RENDERABLE_CONTROL_IDS (ces-stamper
 * src/translators/PlanTranslator.ts): the manual controls Stamper reclassifies
 * as document-renderable. Stamper owns the list; this copy only keeps Muster
 * from promoting them.
 */
export const STAMPER_RENDERABLE_CONTROLS: ReadonlySet<string> = new Set([
  'IA.L2-3.5.8',
  'CM.L2-3.4.4',
  'CM.L2-3.4.8',
  'AU.L2-3.3.6',
  'CA.L2-3.12.2',
  'CA.L2-3.12.4',
  'RA.L2-3.11.2',
]);

/**
 * W5c5: the configuring entries that DO promote a Stamper-renderable control,
 * because they state-verify the control's setting by value (registry
 * `verification.postcheck_mode: 'state'`): a configured, verified setting is
 * stronger evidence than a rendered document. A presence-only entry
 * (AU.L2-3.3.6.audit-reduction) does not. The drift test
 * (export/__tests__/registryFixPaths.drift.test.ts) derives this set from the
 * registry: every state-verified configuring entry on a renderable control.
 */
export const RENDERABLE_STATE_ENTRIES: ReadonlySet<string> = new Set([
  // IA.L2-3.5.8 (password reuse): the Windows compliance policy holds history >= 24 (or the answered value).
  'CM.L2-3.4.1.compliance-policy-windows',
  // CM.L2-3.4.8 (application allow/deny list): the App Control policy, state-verified (PH-12 R5;
  // PH-13 orchestrator decision, LOG-PH13-UNIT.md Round 2).
  'CM.L2-3.4.8.app-control',
  // Not SI.L1-3.14.1.mde-onboarding: RA.L2-3.11.2 keeps its rendered document (the drift test's
  // one reviewed exception, PH-13 orchestrator decision, LOG-PH13-UNIT.md Round 2).
]);

export interface DirectivePromotion {
  control_id: string;
  /** The configuring registry entries (REGISTRY_FIX_PATHS, `tenant:` prefix dropped). */
  entries: string[];
}

interface DirectiveRow {
  control_id: string;
  directive: string;
  step_ids?: string[];
}

interface PlanBody {
  control_directives?: DirectiveRow[];
  disposition_summary?: {
    control_register?: Array<{ control_id: string; directive: string }>;
    directive_counts?: Record<string, number>;
  };
  controls?: Array<{ requirement_id: string; stamper_action?: string }>;
}

/** The configuring entries for a control, or [] (registry entries with a set command). */
export function configuringEntries(controlId: string): string[] {
  return (REGISTRY_FIX_PATHS[controlId] ?? []).map((e) => e.replace(/^tenant:/, ''));
}

/**
 * Promote eligible `manual` directives to `implement`, in place. Returns the
 * promotions (empty when none), in control_directives order.
 */
export function promoteConfigurableManualDirectives(missionPlan: ManualMissionPlan): DirectivePromotion[] {
  const hrmp = (missionPlan as { outputs?: { human_readable_mission_plan?: PlanBody } }).outputs
    ?.human_readable_mission_plan;
  const rows = hrmp?.control_directives;
  if (!hrmp || !Array.isArray(rows)) return [];

  const promoted: DirectivePromotion[] = [];
  for (const row of rows) {
    if (row.directive !== 'manual') continue;
    if (!row.step_ids || row.step_ids.length === 0) continue;
    const all = configuringEntries(row.control_id);
    // W5c5: a renderable control promotes only through a state-verified entry.
    const entries = STAMPER_RENDERABLE_CONTROLS.has(row.control_id) ? all.filter((e) => RENDERABLE_STATE_ENTRIES.has(e)) : all;
    if (entries.length === 0) continue;
    row.directive = 'implement';
    promoted.push({ control_id: row.control_id, entries });
  }
  if (promoted.length === 0) return promoted;

  const ids = new Set(promoted.map((p) => p.control_id));
  const summary = hrmp.disposition_summary;
  if (summary?.control_register) {
    for (const entry of summary.control_register) {
      if (ids.has(entry.control_id) && entry.directive === 'manual') entry.directive = 'implement';
    }
    const counts: Record<string, number> = {};
    for (const entry of summary.control_register) counts[entry.directive] = (counts[entry.directive] ?? 0) + 1;
    summary.directive_counts = counts;
  }
  for (const c of hrmp.controls ?? []) {
    if (ids.has(c.requirement_id) && c.stamper_action === 'Non-Stack') c.stamper_action = 'Automated';
  }
  return promoted;
}
