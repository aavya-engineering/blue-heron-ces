// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// cuiBoundaryAdapter.ts — MG-08: build Planner's cui_boundary_output from what
// Muster already holds, through the VENDORED generators (cuiSIDerivation,
// cuiBoundaryGenerator), so compileGapSet, generateTenantManifest and
// generateManualPlan receive a real boundary instead of null.
//
// Skip rule (the vendored no-CUI skip, plus one Muster guard):
//   - SI cui_presence 'no_cui'                      -> skipped ('no_cui'), as Planner;
//   - CUI presence not established (no confirmed bnd-001 'yes' and no G-02
//     answer, so the SI carries no cui_presence)     -> skipped ('cui_presence_not_established').
//     Planner would walk its wizard here; Muster never fabricates a boundary
//     for a customer whose CUI presence nobody confirmed (unconfirmed bnd-*
//     drafts from boundaryInference never reach this: scorableFacts drops them).
//
// Per-binding precedence (answered > derived > default):
//   1. the operator's answer to a cuiBoundaryNodes question;
//   2. plan mode build_new -> tenant_separation 'Planned but not yet implemented'
//      (the target tenant does not exist yet);
//   3. the SI defaults (vendored deriveCUIDefaults: tenant model, BYOD, DevOps,
//      collaboration, CUI presence, user estimate, retention, and the
//      boundary-controls text derived from those peers);
//   4. the CUI bank's `recommended` value (listed as defaulted).
// A required binding none of these resolves is left out of the boundary and
// listed as unresolved.
import type { CUIBoundaryOutput, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { PlanMode } from '@/features/plan/engine/mpt/types';
import type { CUIAnswer, CUISectionDef } from '@/features/plan/engine/cui/types';
import { deriveCUIDefaults } from '@/features/plan/engine/cui/services/cuiSIDerivation';
import { generateCUIBoundary } from '@/features/plan/engine/cui/services/cuiBoundaryGenerator';
import { CUI_NODE_SPEC_BY_ID, cuiRawAnswer } from '@/features/interview/cuiBoundaryNodes';
import type { InterviewFact } from '@/shared/types/engagement';

/** The raw primed CUI Boundary Question Bank (parsed YAML). */
export interface CuiQuestionBank {
  schema_version?: string;
  sections?: Array<{
    id: string;
    name: string;
    questions?: Array<Record<string, unknown>>;
  }>;
}

export type CuiBindingSource =
  | { source: 'answered'; question_id: string }
  | { source: 'derived'; provenance: string }
  | { source: 'defaulted'; provenance: 'cui-bank:recommended' }
  | { source: 'unresolved' };

export interface CuiBoundaryBuild {
  /** null when skipped. */
  boundary: CUIBoundaryOutput | null;
  skipped: null | 'no_cui' | 'cui_presence_not_established';
  /** Where each CUI bank question's answer came from (empty when skipped). */
  sources: Record<string, CuiBindingSource>;
  /** Human-readable defaulted / unresolved bindings, for the Plan tab's defaultedInputs. */
  defaulted: string[];
}

/** useCUIQuestions: raw bank -> section defs (help fields omitted; the generators do not read them). */
export function cuiSections(bank: CuiQuestionBank): CUISectionDef[] {
  return (bank.sections ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    questions: (s.questions ?? []).map((q) => ({
      id: q.id as string,
      section: q.section as string,
      prompt: q.prompt as string,
      answer_type: q.answer_type as CUISectionDef['questions'][number]['answer_type'],
      options: (q.options as string[]) ?? [],
      required: (q.required as boolean) ?? false,
      help: (q.help as string) ?? '',
      ...(q.recommended !== undefined ? { recommended: q.recommended as string | number | string[] } : {}),
      roles: (q.roles as CUISectionDef['questions'][number]['roles']) ?? { primary_respondents: [], validators: [] },
      bindings: (q.bindings as CUISectionDef['questions'][number]['bindings']) ?? {},
      risk_flags: (q.risk_flags as string[]) ?? [],
    })),
  }));
}

const CUI_PRESENT = new Set(['cui_present', 'cui_plus_other_sensitive', 'fci_only']);

export function buildCuiBoundary(args: {
  facts: InterviewFact[];
  siBaseline: SIBaseline;
  bank: CuiQuestionBank;
  planMode: PlanMode;
}): CuiBoundaryBuild {
  const sections = cuiSections(args.bank);
  const { defaults, sourceLabels, skipCUI } = deriveCUIDefaults(args.siBaseline, sections);
  if (skipCUI) return { boundary: null, skipped: 'no_cui', sources: {}, defaulted: [] };
  const presence = args.siBaseline.si_baseline?.target?.cui_presence as string | undefined;
  if (!presence || !CUI_PRESENT.has(presence)) {
    return {
      boundary: null,
      skipped: 'cui_presence_not_established',
      sources: {},
      defaulted: ['CUI boundary (CUI presence not confirmed: answer bnd-001 or G-02)'],
    };
  }

  const now = new Date().toISOString();
  // Last stored answer per CUI node (facts are in record order).
  const answered = new Map<string, string>();
  for (const f of args.facts) if (CUI_NODE_SPEC_BY_ID[f.question_id]) answered.set(f.question_id, f.answer);

  const answers: Record<string, CUIAnswer> = {};
  const sources: Record<string, CuiBindingSource> = {};
  const defaulted: string[] = [];
  for (const section of sections) {
    for (const q of section.questions) {
      const wrap = (raw: string | number | string[], provenance_class: string): CUIAnswer => ({
        question_id: q.id,
        answer_type: q.answer_type,
        raw_answer: raw,
        captured_at: now,
        provenance_class,
      });
      const spec = CUI_NODE_SPEC_BY_ID[q.id];
      const stored = answered.get(q.id);
      const raw = spec && stored !== undefined ? cuiRawAnswer(spec, stored) : null;
      if (raw !== null) {
        answers[q.id] = wrap(raw, 'client_assertion');
        sources[q.id] = { source: 'answered', question_id: q.id };
      } else if (q.id === 'CUI.ID.001' && args.planMode === 'build_new') {
        answers[q.id] = wrap('Planned but not yet implemented', 'operator_inference');
        sources[q.id] = { source: 'derived', provenance: 'derived:cui:plan_mode:build_new' };
      } else if (defaults[q.id]) {
        answers[q.id] = defaults[q.id];
        sources[q.id] = { source: 'derived', provenance: `derived:cui:si:${sourceLabels[q.id] ?? 'SI'}` };
      } else if (q.recommended !== undefined) {
        answers[q.id] = wrap(q.recommended, 'operator_inference');
        sources[q.id] = { source: 'defaulted', provenance: 'cui-bank:recommended' };
        defaulted.push(`CUI boundary ${q.id} (bank default)`);
      } else {
        sources[q.id] = { source: 'unresolved' };
        if (q.required) defaulted.push(`CUI boundary ${q.id} (not answered)`);
      }
    }
  }

  const boundary = generateCUIBoundary(answers, sections, args.bank.schema_version || '1.0');
  applyManagedByodOverride(boundary, sources['CUI.DEV.001'], args.siBaseline);
  return { boundary, skipped: null, sources, defaulted };
}

/** W6 (run 56): the managed-BYOD value Muster writes over the vendored "direct access" one. */
export const MANAGED_BYOD_MODEL = 'Yes - MDM/MAM managed';

/**
 * W6 (run 56, S2): the vendored SI derivation maps S-13 `allowed_mdm` ("BYOD
 * allowed with MDM/MAM enforcement", the SI bank's own description) to the CUI
 * option "BYOD direct access allowed", and the generator then sets byod_model
 * "Yes - direct access allowed", which fires BTC-RULE-BYOD-DIRECT. That
 * conflates managed (app-protected / enrolled) BYOD with direct access.
 *
 * When CUI.DEV.001 was NOT answered (its value is the SI derivation) and the SI
 * BYOD posture is allowed_mdm, Muster writes byod_model = MANAGED_BYOD_MODEL
 * and records the basis. An explicit CUI.DEV.001 answer of direct access is
 * kept as answered. device_model keeps the bank option (the bank has no
 * managed-BYOD option); managed_device_required stays as generated ("No":
 * personal devices are not company-owned). The new byod_model value is outside
 * the vendored mapping's four, which no rule or schema enumerates: the BTC
 * activation rules match exact values, so no BYOD rule fires on it.
 * Returns whether it applied.
 */
export function applyManagedByodOverride(
  boundary: CUIBoundaryOutput,
  devSource: CuiBindingSource | undefined,
  siBaseline: SIBaseline
): boolean {
  const b = boundary.cui_boundary;
  if (devSource?.source === 'answered') return false;
  if (siBaseline.si_baseline?.operations?.byod_posture !== 'allowed_mdm') return false;
  if (b.byod_model !== 'Yes - direct access allowed') return false;
  b.byod_model = MANAGED_BYOD_MODEL;
  b.byod_model_basis = 'Muster: SI S-13 allowed_mdm (BYOD allowed with MDM/MAM enforcement), not direct access';
  return true;
}
