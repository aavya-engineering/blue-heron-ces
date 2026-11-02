// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// readinessAnswers.ts — MG-07 test helper for the full-session tests. The asked
// graph no longer holds the 25 retired readiness ids (they are alias nodes);
// it holds the RR activity residue instead. Each asked RR activity gets the
// answer the fixture gave the retired node(s) it aliases (first legacy id in
// table order that names it), else `fallback`. yes / no / unknown are valid for
// both the RR status options and the FOUNDATION yes/no options.
import { LEGACY_READINESS_ALIASES } from '@/features/interview/questionGraph';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { RR_ACTIVITY_PREFIX } from '@/features/scoring/readinessScope';

export function rrActivityAnswers(
  graph: QuestionNode[],
  legacy: Record<string, string>,
  fallback = 'no'
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of graph) {
    if (!node.id.startsWith(RR_ACTIVITY_PREFIX)) continue;
    const from = Object.entries(LEGACY_READINESS_ALIASES).find(
      ([id, acts]) => acts.includes(node.id) && legacy[id] !== undefined
    );
    const wanted = from ? legacy[from[0]] : fallback;
    out[node.id] = node.options.some((o) => o.value === wanted) ? wanted : fallback;
  }
  return out;
}

/** The fixture map minus the retired readiness ids (no longer graph nodes). */
export function withoutLegacyReadiness(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).filter(([id]) => !(id in LEGACY_READINESS_ALIASES)));
}
