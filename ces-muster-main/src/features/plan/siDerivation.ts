// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// siDerivation.ts — G-MUSTER-PLAN-3 M1: the derivation map. For each SIT
// question in the primed SI Question Bank, the Muster source that answers it —
// or null when nothing Muster holds can (that question becomes interview
// residue). Derived answers are represented as ordinary InterviewFacts
// (question_id = SIT id) so they PRUNE via pruneByCoverage AND convert to
// SITAnswers in the adapter — one representation, one fact store (the
// engineering note: no second bank, no invented answers).
//
// Provenance discipline:
//   - factProvenance strings are `derived:si:<source>` — deliberately OUTSIDE
//     draftSemantics.DRAFT_PROVENANCES, so scorableFacts never drops a derived
//     SIT fact (pruning and compile would otherwise diverge).
//   - sitProvenance is the SITAnswer provenance_class: `system_observation`
//     when Muster's engine/discovery observed it, `client_assertion` when the
//     operator declared it (e.g. the service inventory). Never invented.
//   - confidence is non-`unknown` so pruneByCoverage actually prunes.
//
// What is derivable at M1 is modest by design: Muster's current inputs are the
// declared service inventory, the preamble snapshot, the readiness manifest and
// the L2 readiness engine. CUI presence, boundary strategy and the operations
// postures are NOT observable yet — they arrive with BTC/TCP derivation (M2/M3)
// or are asked. Every field left un-derived is honest residue, not a default
// masquerading as fact.
import type { InterviewFact } from '@/shared/types/engagement';
import type { SITAnswer } from '@/vendored/ces-planner/types/siBaseline';

/** Everything a derivation may read. Pure data — no fetch, no Dexie. */
export interface DerivationContext {
  selectedStacks: string[];
  preamble?: {
    license_tier?: string;
    security_archetype?: string;
    endpoint_management?: string;
    monitoring_siem?: string;
    policy_doc_state?: string;
  } | null;
  manifest?: {
    mode?: string;
    tenant_kind?: string;
    tenant_slug?: string;
  } | null;
  engagementKind?: string | null;
  /**
   * FC-MU (MU-10): the session's scorable facts (interview + TCP answers, never
   * unconfirmed drafts). Derivations read answers to OTHER questions here —
   * bnd-001, TCP.TI.004, TCP.LIC.001, TCP.DM.001. The interview (pruning) and the
   * compile pass the same facts so the two cannot disagree.
   */
  facts?: InterviewFact[] | null;
}

export type SitProvenanceClass = Extract<
  SITAnswer['provenance_class'],
  'system_observation' | 'client_assertion'
>;

interface DerivedValue {
  value: string;
  /** InterviewFact.provenance — `derived:si:<source>`, never a draft provenance. */
  factProvenance: string;
  /** SITAnswer.provenance_class carried onto the reconstructed answer. */
  sitProvenance: SitProvenanceClass;
  confidence: Exclude<InterviewFact['confidence'], 'unknown'>;
}

interface SitDerivation {
  questionId: string;
  /** The primary si_baseline.* field this question sets (for the map/docs). */
  field: string;
  derive: (ctx: DerivationContext) => DerivedValue | null;
}

/** cloud_only when cloud stacks are declared and no on-prem AD; hybrid with
 * on-prem AD; unknown when nothing was declared (never invented). Mirrors the
 * M0 rule and preambleMapper.buildSIBaseline. */
function deploymentPosture(stacks: string[]): string | null {
  if (stacks.length === 0) return null;
  if (stacks.includes('on_prem_ad')) return 'hybrid';
  return 'cloud_only';
}

/** gcc_high when the GCC-High E5 tile is declared; commercial for plain M365;
 * otherwise not derivable. */
function tenantModel(stacks: string[]): string | null {
  if (stacks.includes('m365_e5_gcc')) return 'gcc_high';
  if (stacks.includes('m365_e3')) return 'commercial';
  return null;
}

/** license tier from the preamble (already mapped from stacks by
 * preambleMapper) or directly from the tiles. */
function licenseTier(ctx: DerivationContext): string | null {
  const t = ctx.preamble?.license_tier;
  if (t && t !== 'unknown') return t;
  if (ctx.selectedStacks.includes('m365_e5_gcc')) return 'g5';
  if (ctx.selectedStacks.includes('m365_e3')) return 'e3';
  return null;
}

/** The answer the session holds for a question — the last explicit one;
 * "I'm not sure" (confidence unknown) is not an answer. */
function answerOf(ctx: DerivationContext, questionId: string): string | null {
  const facts = ctx.facts ?? [];
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i];
    if (f.question_id === questionId && f.confidence !== 'unknown') return f.answer;
  }
  return null;
}

/** TCP.TI.004 cloud environment -> SI tenant model. DoD is not mapped (IL5 vs
 * IL6 is not determined by "DoD"). */
const TENANT_MODEL_BY_CLOUD: Record<string, string> = {
  commercial: 'commercial_only',
  gcc: 'gcc',
  gcc_high: 'gcc_high',
};

/** TCP.LIC.001 primary SKU -> SI licence tier. E3/E5/Other are not in the SI
 * licence enum (business_premium | g3 | g5) and derive nothing. */
const LICENSE_TIER_BY_SKU: Record<string, string> = {
  m365_g5: 'g5',
  o365_g5: 'g5',
  m365_g3: 'g3',
  o365_g3: 'g3',
};

/**
 * The derivation table. Order is the bank's order. Add rows here as BTC/TCP
 * (M2/M3) widen the observable surface — the mechanism does not change.
 */
export const SI_DERIVATIONS: SitDerivation[] = [
  {
    questionId: 'G-01',
    field: 'si_baseline.target.target_cmmc_level',
    // Muster's readiness engine assesses CMMC L2 (COVERAGE_DATASET); the target
    // level is an observed property of the engagement, not a guess.
    derive: () => ({
      value: 'L2',
      factProvenance: 'derived:si:engine:readiness-l2-coverage',
      sitProvenance: 'system_observation',
      confidence: 'high',
    }),
  },
  {
    questionId: 'G-02',
    field: 'si_baseline.target.cui_presence',
    // FC-MU (MU-10): the Boundary question "Does CUI exist in your environment?"
    // answered yes IS the CUI presence assertion. "No" is not mapped: it could be
    // no_cui or fci_only.
    derive: (ctx) =>
      answerOf(ctx, 'bnd-001') === 'yes'
        ? { value: 'cui_present', factProvenance: 'derived:si:interview:bnd-001', sitProvenance: 'client_assertion', confidence: 'high' }
        : null,
  },
  {
    questionId: 'G-08',
    field: 'si_baseline.scope.deployment_posture',
    derive: (ctx) => {
      const v = deploymentPosture(ctx.selectedStacks);
      return v
        ? { value: v, factProvenance: 'derived:si:stacks:selected_stacks', sitProvenance: 'client_assertion', confidence: 'high' }
        : null;
    },
  },
  {
    questionId: 'S-13',
    field: 'si_baseline.operations.byod_posture',
    // FC-MU (MU-10): TCP.DM.001 "Enroll Only (BYOD MDM)" declares personal devices
    // enrolled in MDM — the allowed_mdm BYOD posture. A corporate join (Azure AD /
    // hybrid) or "None" says nothing about BYOD and derives nothing.
    derive: (ctx) =>
      answerOf(ctx, 'TCP.DM.001') === 'enroll_only'
        ? { value: 'allowed_mdm', factProvenance: 'derived:si:tcp:enrollment_type', sitProvenance: 'client_assertion', confidence: 'high' }
        : null,
  },
  {
    questionId: 'S-20',
    field: 'si_baseline.dependencies.tenant_model_preference',
    derive: (ctx) => {
      // FC-MU (MU-10): the TCP's declared cloud environment is the tenant model;
      // it beats the coarser stack-tile inference.
      const cloud = TENANT_MODEL_BY_CLOUD[answerOf(ctx, 'TCP.TI.004') ?? ''];
      if (cloud) {
        return { value: cloud, factProvenance: 'derived:si:tcp:cloud_environment', sitProvenance: 'client_assertion', confidence: 'high' };
      }
      const v = tenantModel(ctx.selectedStacks);
      return v
        ? { value: v, factProvenance: 'derived:si:stacks:selected_stacks', sitProvenance: 'client_assertion', confidence: 'high' }
        : null;
    },
  },
  {
    questionId: 'SIT-020',
    field: 'si_baseline.dependencies.infrastructure_model',
    derive: (ctx) => {
      const dp = deploymentPosture(ctx.selectedStacks);
      if (!dp) return null;
      // cloud/hybrid M365 tenants map to the M365+Azure model; the generator
      // does not persist this field but the compilers read it (default m365_azure).
      return { value: 'm365_azure', factProvenance: 'derived:si:stacks:selected_stacks', sitProvenance: 'client_assertion', confidence: 'medium' };
    },
  },
  {
    questionId: 'SIT-021',
    field: 'si_baseline.dependencies.license_tier',
    derive: (ctx) => {
      // FC-MU (MU-10): the TCP's declared primary SKU beats the preamble/tile.
      const sku = LICENSE_TIER_BY_SKU[answerOf(ctx, 'TCP.LIC.001') ?? ''];
      if (sku) {
        return { value: sku, factProvenance: 'derived:si:tcp:primary_sku', sitProvenance: 'client_assertion', confidence: 'high' };
      }
      const v = licenseTier(ctx);
      return v
        ? { value: v, factProvenance: 'derived:si:preamble:license_tier', sitProvenance: 'client_assertion', confidence: 'high' }
        : null;
    },
  },
];

export interface DerivedSitResult {
  /** Derived facts to merge into the fact store (prune the interview, feed the adapter). */
  facts: InterviewFact[];
  /** SIT question ids that derived (for coverage reporting). */
  derivedIds: string[];
}

/**
 * Run the derivation map over a session's Muster context. Returns the derived
 * facts (as InterviewFacts) and the ids that derived. The interview RESIDUE is
 * every bank question NOT in derivedIds — computed at the call site against the
 * full bank (residueIds below), never just the derivation table. `recorded_at`
 * is a fixed stamp — derivation is deterministic and Date.now() is avoided for
 * testability (mirrors the adapter's stable captured_at).
 */
export function deriveSitFacts(ctx: DerivationContext): DerivedSitResult {
  const facts: InterviewFact[] = [];
  const derivedIds: string[] = [];

  for (const d of SI_DERIVATIONS) {
    const r = d.derive(ctx);
    if (!r) continue;
    derivedIds.push(d.questionId);
    facts.push({
      question_id: d.questionId,
      question_text: d.field,
      answer: r.value,
      provenance: r.factProvenance,
      confidence: r.confidence,
      recorded_at: '1970-01-01T00:00:00.000Z',
    });
  }
  return { facts, derivedIds };
}

/** The interview residue: every bank question id not derived. Computed against
 * the FULL bank so coverage is "N of 26", never "N of the derivation table". */
export function residueIds(allBankIds: string[], derivedIds: string[]): string[] {
  const derived = new Set(derivedIds);
  return allBankIds.filter((id) => !derived.has(id));
}

/** The SITAnswer provenance_class for a derived fact, recovered from its
 * `derived:si:<source>` provenance string. Engine observations are
 * system_observation; declared inventory is client_assertion. */
export function sitProvenanceOf(factProvenance: string): SitProvenanceClass {
  return factProvenance.startsWith('derived:si:engine') ? 'system_observation' : 'client_assertion';
}
