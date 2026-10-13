// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// draftSemantics.ts — G-MUSTER-GO-2 draft/attested boundary (pure module).
//
// ONE provenance model serves all resolver rungs (mandatory engineering note):
// a resolver-drafted fact is an ordinary InterviewFact whose provenance names its
// resolver source and whose `attestation` is absent until a named human confirms.
//
// The two FCA invariants this module and its tests pin (goal sec. "Draft vs.
// attested"):
//   1. Drafts PRUNE (they defer questions via the ordinary confidence-based
//      pruner) but NEVER PASS: an unconfirmed draft contributes nothing to any
//      score — a drafts-only session scores identically to the facts-absent
//      session (M5 gate). Exclusion, not unknown-coercion: coercing to unknown
//      would deduct, which is a contribution.
//   2. Unknown never prunes, never passes (unchanged, still enforced upstream).
import type { FactAttestation, InterviewFact } from '@/shared/types/engagement';

/** The four resolver provenances (goal's mapping table, verbatim strings). */
export const DRAFT_PROVENANCES = new Set([
  'discovery-inferred', // rung 1 — inferred from discovery footprints
  'document-extracted', // rung 2 — read from an uploaded document
  'archetype-default', // rung 3 — archetype prior
  'interview-extracted', // rung 4 — parsed from conversational intake
]);

/** Human-readable source labels for the attestation record string. */
export const DRAFT_SOURCE_LABELS: Record<string, string> = {
  'discovery-inferred': 'discovery inference',
  'document-extracted': 'document extraction',
  'archetype-default': 'archetype default',
  'interview-extracted': 'interview parsing',
};

/** A resolver-drafted fact not yet confirmed by a named human. */
export function isUnconfirmedDraft(fact: InterviewFact): boolean {
  return DRAFT_PROVENANCES.has(fact.provenance) && fact.attestation === undefined;
}

/**
 * The facts that may reach any scoring path. Unconfirmed drafts are EXCLUDED
 * (never coerced): M5's gate is score-identical-to-absent. Call this BEFORE
 * routeFacts in scoring flows so a draft can never win a routing group and
 * shadow a scorable fact.
 */
export function scorableFacts(facts: InterviewFact[]): InterviewFact[] {
  return facts.filter((f) => !isUnconfirmedDraft(f));
}

/**
 * The exact attestation record string (M4 gate asserts this shape):
 *   "drafted by [source], confirmed by [name] on [date]"
 */
export function attestationRecord(att: FactAttestation): string {
  return `drafted by ${att.drafted_by}, confirmed by ${att.confirmed_by} on ${att.confirmed_on}`;
}

/**
 * Confirm a drafted fact: writes the named-human attestation, preserving the
 * draft provenance (the tier upgrade is read from the attestation by
 * classOfFact, not rewritten into the provenance string — one model, no
 * string mutation). Returns a new object; never mutates.
 */
export function confirmFact(
  fact: InterviewFact,
  confirmedBy: string,
  confirmedOn: string = new Date().toISOString().slice(0, 10)
): InterviewFact {
  // Brutal-critic D1/D4: THE choke point enforces the named-human invariant
  // itself — a blank name is not an attestation, and no caller's UI gating is
  // trusted to have checked. An attestation with confirmed_by '' would launder
  // a draft across the boundary (isUnconfirmedDraft only checks presence).
  if (confirmedBy.trim() === '') {
    throw new Error(
      'confirmFact: an attestation requires a named human (confirmed_by must be non-blank)'
    );
  }
  const sourceLabel = DRAFT_SOURCE_LABELS[fact.provenance] ?? fact.provenance;
  return {
    ...fact,
    attestation: {
      drafted_by: sourceLabel,
      confirmed_by: confirmedBy.trim(),
      confirmed_on: confirmedOn,
    },
  };
}