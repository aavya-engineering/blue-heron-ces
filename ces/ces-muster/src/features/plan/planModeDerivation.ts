// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planModeDerivation.ts — MG-10 (decision D6): derive the Mission Plan's mode
// from discovery instead of always planning harden_existing.
//
//   answered PLAN.MODE.001                 -> that mode (the operator's confirm/correct);
//   no target tenant observed              -> build_new  (no readiness manifest and
//                                             no discovery-sourced fact);
//   an empty target tenant                 -> build_new  (discovery read the tenant and
//                                             observed nothing in place: every
//                                             discovery-sourced answer is 'no');
//   otherwise (an established tenant)      -> harden_existing.
//
// Planner's operator picks the mode from a list (useMissionPlanGenerator
// PLAN_MODE_OPTIONS); V1 builds only harden_existing and build_new. Migrate and
// hybrid signals (directory sync / on-prem AD; a commercial or GCC source tenant
// with a GCC High target) never change the mode: they set `deferred`, which the
// Plan tab and the headless runner report so BHD can raise it.
import type { PlanMode } from '@/features/plan/engine/mpt/types';
import type { InterviewFact } from '@/shared/types/engagement';
import { PLAN_MODE_NODE_ID } from '@/features/interview/planModeNode';

/** Provenances that mean "discovery read this from the tenant". */
const DISCOVERY_PROVENANCES = new Set(['discovery', 'auto_detected', 'discovery-inferred']);

export interface PlanModeDecision {
  planMode: Extract<PlanMode, 'harden_existing' | 'build_new'>;
  source: 'answered' | 'derived';
  reason: string;
  /** Migrate/hybrid signals seen: flagged and reported, never built (D6). */
  deferred: null | { modes: Array<'migrate' | 'hybrid'>; signals: string[] };
}

export interface PlanModeContext {
  /** Scorable facts (unconfirmed drafts already removed). */
  facts: InterviewFact[];
  /** The session's readiness manifest (present when a tenant was discovered). */
  hasTenantManifest: boolean;
  /** si_baseline.dependencies.tenant_model_preference (the target), when known. */
  targetTenantModel?: string | null;
}

function lastAnswer(facts: InterviewFact[], id: string): string | undefined {
  let v: string | undefined;
  for (const f of facts) if (f.question_id === id) v = f.answer;
  return v;
}

/** Migrate/hybrid signals (D6: flag, never build). */
export function deferredModeSignals(ctx: PlanModeContext): PlanModeDecision['deferred'] {
  const signals: string[] = [];
  const modes = new Set<'migrate' | 'hybrid'>();
  const idp = lastAnswer(ctx.facts, 'TCP.IA.004');
  if (idp === 'hybrid_ad_connect' || idp === 'hybrid_cloud_sync') {
    signals.push(`TCP.IA.004 identity provider is ${idp} (directory sync from on-premises AD)`);
    modes.add('hybrid');
  }
  if (lastAnswer(ctx.facts, 'TCP.IA.005') === 'yes') {
    signals.push('TCP.IA.005 directory synchronisation from on-premises AD is enabled');
    modes.add('hybrid');
  }
  const source = lastAnswer(ctx.facts, 'TCP.TI.004');
  if ((source === 'commercial' || source === 'gcc') && ctx.targetTenantModel === 'gcc_high') {
    signals.push(`TCP.TI.004 source tenant is ${source} but the target tenant model is gcc_high`);
    modes.add('migrate');
  }
  return signals.length ? { modes: [...modes].sort(), signals } : null;
}

export function derivePlanMode(ctx: PlanModeContext): PlanModeDecision {
  const deferred = deferredModeSignals(ctx);
  const answered = lastAnswer(ctx.facts, PLAN_MODE_NODE_ID);
  if (answered === 'harden_existing' || answered === 'build_new') {
    return { planMode: answered, source: 'answered', reason: `${PLAN_MODE_NODE_ID} answered`, deferred };
  }
  const discovered = ctx.facts.filter((f) => DISCOVERY_PROVENANCES.has(f.provenance));
  if (!ctx.hasTenantManifest && discovered.length === 0) {
    return { planMode: 'build_new', source: 'derived', reason: 'no target tenant observed (no discovery)', deferred };
  }
  if (discovered.length > 0 && discovered.every((f) => f.answer === 'no')) {
    return {
      planMode: 'build_new',
      source: 'derived',
      reason: `empty target tenant (all ${discovered.length} discovery reads observed nothing in place)`,
      deferred,
    };
  }
  return {
    planMode: 'harden_existing',
    source: 'derived',
    reason: discovered.length
      ? `established target tenant (${discovered.filter((f) => f.answer === 'yes').length} of ${discovered.length} discovery reads found controls in place)`
      : 'target tenant discovered (readiness manifest present)',
    deferred,
  };
}

/** One-line text for reports (Plan tab warnings, runner trace). */
export function deferredModeMessage(d: NonNullable<PlanModeDecision['deferred']>): string {
  return `Deferred plan mode (${d.modes.join(', ')}): not built in V1 (D6); raise with BHD. Signals: ${d.signals.join('; ')}`;
}
