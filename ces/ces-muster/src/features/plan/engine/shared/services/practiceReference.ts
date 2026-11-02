// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import controlsReference from 'ces-shared/data/cmmc-l2-controls';
import approachReference from 'ces-shared/data/assessor-approach';
import objectivesReference from 'ces-shared/data/assessment-objectives';
import evidenceMatrixReference from 'ces-shared/data/assessor-evidence-matrix';

/**
 * EVC.2 / R-1 ("stop copying"): practice requirement text comes from the
 * ces-shared controls reference, not from the Requirements Store rows (Store
 * rows carry other practices' text; see R-1).
 *
 * Keying: by NIST base id ("3.1.1"), the part of the practice id after the
 * first dash. `AC.L1-3.1.1` and `AC.L2-3.1.1` both resolve to the same
 * reference row. Ids with no reference row (the L3 `…e` practices) keep the
 * Store text and are marked `text_source: 'store'`.
 *
 * KB-4: `withReferenceRow` (used by the gap compiler) also takes `title`,
 * `assessment_objectives` and `evidence_minimum` from ces-shared (assessor
 * approach KB, 800-171A objectives reference, KB-1 evidence matrix), never
 * from the Store row. `withReferenceText` itself is unchanged.
 */

export type TextSource = 'reference' | 'store';

interface ReferenceControl {
  control_id: string;
  nist_ref: string;
  practice: string;
}

const PRACTICE_BY_NIST_REF: ReadonlyMap<string, string> = new Map(
  (controlsReference.controls as ReferenceControl[]).map((c) => [c.nist_ref, c.practice]),
);

/** "AC.L2-3.1.1" -> "3.1.1"; a value already in NIST-ref form passes through. */
export function toNistRef(practiceId: string): string {
  const dash = practiceId.indexOf('-');
  return dash === -1 ? practiceId : practiceId.slice(dash + 1);
}

/** Reference practice text for a practice id at any level, or undefined. */
export function referencePracticeText(practiceId: string): string | undefined {
  return PRACTICE_BY_NIST_REF.get(toNistRef(practiceId));
}

/**
 * Return a copy of a Store row whose `requirement_text` is the reference text
 * and whose `text_source` records where the text came from.
 */
export function withReferenceText<T extends { requirement_id: string; requirement_text?: string }>(
  row: T,
): T & { text_source: TextSource } {
  const ref = referencePracticeText(row.requirement_id);
  return ref === undefined
    ? { ...row, text_source: 'store' }
    : { ...row, requirement_text: ref, text_source: 'reference' };
}

/** Apply `withReferenceText` to every row of a Requirements Store document. */
export function applyReferenceText<S>(store: S): S {
  const s = store as unknown as { requirements?: unknown[]; ces?: { requirements?: unknown[] } };
  if (!s) return store;
  const map = (rows: unknown[]) =>
    rows.map((r) => withReferenceText(r as { requirement_id: string; requirement_text?: string }));
  const out: Record<string, unknown> = { ...(s as Record<string, unknown>) };
  if (Array.isArray(s.requirements)) out.requirements = map(s.requirements);
  if (s.ces && Array.isArray(s.ces.requirements)) out.ces = { ...s.ces, requirements: map(s.ces.requirements) };
  return out as S;
}

// ---------------------------------------------------------------------------
// KB-4: title, assessment objectives and evidence_minimum from ces-shared.
// ---------------------------------------------------------------------------

interface ApproachPractice { id: string; title: string }
interface ReferenceObjective { objectiveId: string; controlId: string; description: string; methods: string[] }
interface MatrixObjective { id: string; practice_id: string; evidence: Array<{ artifact_type: string }> }

const TITLE_BY_NIST_REF: ReadonlyMap<string, string> = new Map(
  (approachReference.practices as ApproachPractice[]).map((p) => [toNistRef(p.id), p.title]),
);

const OBJECTIVES_BY_NIST_REF: ReadonlyMap<string, Array<{ id: string; text: string; methods: string[] }>> = (() => {
  const m = new Map<string, Array<{ id: string; text: string; methods: string[] }>>();
  for (const o of objectivesReference.objectives as ReferenceObjective[]) {
    const k = toNistRef(o.controlId);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ id: o.objectiveId, text: o.description, methods: [...o.methods] });
  }
  return m;
})();

/** must_have = the practice's unique matrix artifact types in matrix order; the matrix has no nice-to-have split. */
const EVIDENCE_MINIMUM_BY_NIST_REF: ReadonlyMap<string, { must_have: string[]; nice_to_have: string[] }> = (() => {
  const m = new Map<string, { must_have: string[]; nice_to_have: string[] }>();
  for (const o of evidenceMatrixReference.objectives as MatrixObjective[]) {
    const k = toNistRef(o.practice_id);
    if (!m.has(k)) m.set(k, { must_have: [], nice_to_have: [] });
    const em = m.get(k)!;
    for (const e of o.evidence) if (!em.must_have.includes(e.artifact_type)) em.must_have.push(e.artifact_type);
  }
  return m;
})();

/**
 * `withReferenceText` plus KB-4: for a row with a reference entry, `title`,
 * `assessment_objectives` and `evidence_minimum` come from ces-shared. Rows
 * with no reference entry (L3) are returned as `withReferenceText` returns them.
 */
export function withReferenceRow<T extends { requirement_id: string; requirement_text?: string }>(
  row: T,
): T & { text_source: TextSource } {
  const out = withReferenceText(row);
  if (out.text_source !== 'reference') return out;
  const k = toNistRef(row.requirement_id);
  return {
    ...out,
    title: TITLE_BY_NIST_REF.get(k) ?? referencePracticeText(row.requirement_id),
    assessment_objectives: (OBJECTIVES_BY_NIST_REF.get(k) ?? []).map((o) => ({ ...o, methods: [...o.methods] })),
    evidence_minimum: (() => {
      const em = EVIDENCE_MINIMUM_BY_NIST_REF.get(k);
      return { must_have: em ? [...em.must_have] : [], nice_to_have: [] };
    })(),
  };
}
