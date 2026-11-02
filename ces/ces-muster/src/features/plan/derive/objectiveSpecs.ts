// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// objectiveSpecs.ts — DEPTH-7 (depth plan DEPTH-REPORT-AND-PLAN.md §4): the assessment objectives of
// a practice, read from the ces-shared assessor approach knowledge base
// (`assessor-approach.reference.json`: practices[].id, objectives[].id, determination, methods).
// Muster writes one postcheck spec per objective from this; it evaluates nothing (ruling a).
//
// Two lookups:
//   - `referencePractice(id)`: the practice whose id is exactly `id` (one of the 110). A phantom
//     L2 twin of an L1 practice (e.g. AC.L2-3.1.1) and a non-practice id (FOUNDATION, scre.OPV.*,
//     btc_gate_*, cui_*) give null: they get no postcheck spec.
//   - `practiceByNistRef(id)`: the practice with the same NIST base id ("3.1.1"), so a phantom twin
//     resolves to its L1 practice. Used for the human plan's how-to-verify text.
import approachReference from 'ces-shared/data/assessor-approach';

export type AssessmentMethod = 'examine' | 'interview' | 'test';

export interface ReferenceObjective {
  id: string;
  determination: string;
  methods: AssessmentMethod[];
}

export interface ReferencePractice {
  id: string;
  objectives: ReferenceObjective[];
}

const PRACTICES: ReferencePractice[] = (approachReference as unknown as { practices: ReferencePractice[] }).practices;
const BY_ID: ReadonlyMap<string, ReferencePractice> = new Map(PRACTICES.map((p) => [p.id, p]));
const nistRef = (id: string): string => id.slice(id.indexOf('-') + 1);
const BY_NIST: ReadonlyMap<string, ReferencePractice> = new Map(PRACTICES.map((p) => [nistRef(p.id), p]));
const PRACTICE_ID = /^[A-Z]{2}\.L[12]-\d+\.\d+\.\d+$/;

/** The practice whose id is exactly `controlId`, else null. */
export function referencePractice(controlId: string): ReferencePractice | null {
  return BY_ID.get(controlId) ?? null;
}

/** The practice with the same NIST base id (a phantom L2 twin resolves to its L1 practice), else null. */
export function practiceByNistRef(controlId: string): ReferencePractice | null {
  if (!PRACTICE_ID.test(controlId)) return null;
  return BY_ID.get(controlId) ?? BY_NIST.get(nistRef(controlId)) ?? null;
}

/** A row id for an objective: `chk_AC.L1-3.1.1_a` for `AC.L1-3.1.1[a]`. */
export function objectiveRowId(objectiveId: string): string {
  return `chk_${objectiveId.replace(/\[([^\]]+)\]/g, '_$1')}`;
}
