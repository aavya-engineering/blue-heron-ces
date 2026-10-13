// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// boundaryInference.ts — G-MUSTER-GO-2 M1 (rung 1): infer the CUI boundary from
// discovery footprints, then ask for CORRECTION, not creation.
//
// Rule-based (goal Q1: auditable and cheap, AI never enters the SPA). Consumes
// the SAME discovery results the Discovery tab already produces — no second
// discovery lane, no new tenant access. Emits ordinary InterviewFact rows into
// the ONE fact store, keyed by the boundary questions of THE question bank
// (bnd-001..003), with provenance 'discovery-inferred' and NO attestation:
// unconfirmed drafts that prune but never pass until a named human confirms
// (draftSemantics.ts).
//
// FCA: unknown-confidence discovery rows NEVER draft anything (unknown never
// prunes, never passes — a draft derived from unknown evidence would launder it).
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';
import type { InterviewFact } from '@/shared/types/engagement';

/**
 * Footprint rules, auditable one-liners. A rule fires when at least one
 * NON-unknown discovery row's control_id matches its prefix list; the drafted
 * confidence is the weakest confidence among the matching evidence rows
 * (a draft is never more confident than its worst evidence).
 */
const BOUNDARY_RULES: Array<{
  question_id: string;
  question_text: string;
  control_prefixes: string[];
  rationale: string;
}> = [
  {
    // Any observed security posture at all is evidence the tenant handles
    // regulated data (the gov-cloud-tenancy prior from the design); labels/DLP
    // and media-protection controls are the strongest signals.
    question_id: 'bnd-001',
    question_text: 'Does Controlled Unclassified Information (CUI) exist in your environment?',
    control_prefixes: ['MP.', 'SC.', 'CA.', 'AC.', 'IA.'],
    rationale: 'protection controls observed on the tenant (labels/DLP/access scoping)',
  },
  {
    // Sensitivity labels, DLP, and media/data-protection footprints evidence
    // scoped CUI stores.
    question_id: 'bnd-002',
    question_text:
      'Are the systems and repositories where CUI lives identified and scoped (sites, shares, mailboxes)?',
    control_prefixes: ['MP.', 'SC.L2-3.13', 'CM.'],
    rationale: 'data-protection and configuration footprints (labels, DLP, baselines)',
  },
  {
    // Identity/access footprints (groups, CA scoping, MFA) evidence identified
    // CUI-handling users and groups.
    question_id: 'bnd-003',
    question_text: 'Are the users and groups who handle CUI identified?',
    control_prefixes: ['AC.', 'IA.'],
    rationale: 'identity and access-control footprints (groups, conditional access, MFA)',
  },
];

const CONFIDENCE_ORDER: Record<InterviewFact['confidence'], number> = {
  unknown: -1,
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Draft the CUI boundary from discovery results. Returns one unconfirmed-draft
 * fact per boundary rule whose evidence exists; rules with no non-unknown
 * evidence draft NOTHING (the question stays open and will be asked).
 */
export function inferBoundaryDrafts(results: DiscoveryResult[]): InterviewFact[] {
  const now = new Date().toISOString();
  const drafts: InterviewFact[] = [];

  for (const rule of BOUNDARY_RULES) {
    const evidence = results.filter(
      (r) =>
        r.confidence !== 'unknown' &&
        rule.control_prefixes.some((p) => r.control_id.startsWith(p))
    );
    if (evidence.length === 0) continue;

    const weakest = evidence.reduce<InterviewFact['confidence']>(
      (acc, r) => (CONFIDENCE_ORDER[r.confidence] < CONFIDENCE_ORDER[acc] ? r.confidence : acc),
      'high'
    );

    drafts.push({
      question_id: rule.question_id,
      question_text: rule.question_text,
      answer: 'yes',
      provenance: 'discovery-inferred',
      confidence: weakest,
      recorded_at: now,
      // No attestation: an unconfirmed draft until a named human confirms.
    });
  }

  return drafts;
}