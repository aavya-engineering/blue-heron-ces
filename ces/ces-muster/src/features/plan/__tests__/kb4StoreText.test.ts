// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// KB-4 (R-1/R-2): Store rows are untrusted. For every practice with a ces-shared
// reference entry, the gap compiler's title, requirement text and assessment
// objectives come from ces-shared, and evidence_minimum from the KB-1 evidence
// matrix; no Store-row title, AO text or evidence_minimum reaches the gap output.
import { describe, it, expect } from 'vitest';
import approachReference from 'ces-shared/data/assessor-approach';
import objectivesReference from 'ces-shared/data/assessment-objectives';
import evidenceMatrixReference from 'ces-shared/data/assessor-evidence-matrix';
import { compileGapSet } from '@/features/gaps/gapCompiler';
import { vendoredEvidenceCatalog } from '../evidenceCatalogBank';
import { toNistRef, withReferenceRow } from '@/features/plan/engine/shared/services/practiceReference';
import type { ReadinessPosture, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import { loadBanks } from './planTestSupport';

const store = loadBanks().cmmcRequirements as { requirements: any[] };
const rows: any[] = store.requirements;

const TITLE = new Map<string, string>(
  (approachReference.practices as Array<{ id: string; title: string }>).map((p) => [toNistRef(p.id), p.title]),
);
const OBJECTIVES = new Map<string, Array<{ id: string; text: string; methods: string[] }>>();
for (const o of objectivesReference.objectives as Array<{ objectiveId: string; controlId: string; description: string; methods: string[] }>) {
  const k = toNistRef(o.controlId);
  if (!OBJECTIVES.has(k)) OBJECTIVES.set(k, []);
  OBJECTIVES.get(k)!.push({ id: o.objectiveId, text: o.description, methods: o.methods });
}
const MUST_HAVE = new Map<string, string[]>();
for (const o of evidenceMatrixReference.objectives as Array<{ practice_id: string; evidence: Array<{ artifact_type: string }> }>) {
  const k = toNistRef(o.practice_id);
  if (!MUST_HAVE.has(k)) MUST_HAVE.set(k, []);
  const list = MUST_HAVE.get(k)!;
  for (const e of o.evidence) if (!list.includes(e.artifact_type)) list.push(e.artifact_type);
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function compileAll() {
  const posture = { ces: { requirement_results: [] } } as unknown as ReadinessPosture;
  const si = {
    si_baseline: { operations: {}, scope: {}, dependencies: {}, target: { target_cmmc_level: 'L3' } },
  } as unknown as SIBaseline;
  return compileGapSet(si, posture, store, { entries: [] }, undefined, null, null, null, vendoredEvidenceCatalog());
}

describe('KB-4: Store text never reaches gap output', () => {
  it('withReferenceRow takes title, objectives and evidence_minimum from ces-shared', () => {
    let joined = 0;
    for (const row of rows) {
      const k = toNistRef(row.requirement_id);
      const out: any = withReferenceRow(row);
      if (!TITLE.has(k)) {
        expect(out.text_source, row.requirement_id).toBe('store');
        continue;
      }
      joined++;
      expect(out.text_source).toBe('reference');
      expect(out.title, row.requirement_id).toBe(TITLE.get(k));
      expect(out.assessment_objectives, row.requirement_id).toEqual(OBJECTIVES.get(k));
      expect(out.evidence_minimum, row.requirement_id).toEqual({ must_have: MUST_HAVE.get(k), nice_to_have: [] });
      expect(out.evidence_minimum.must_have.length, row.requirement_id).toBeGreaterThan(0);
    }
    expect(joined).toBe(127);
  });

  it('gap rows for reference practices carry ces-shared text only', () => {
    const { gaps } = compileAll();
    expect(gaps.length).toBe(rows.length);
    for (const g of gaps) {
      const k = toNistRef(g.requirement_id);
      if (!TITLE.has(k)) continue;
      expect(g.requirement_title, g.requirement_id).toBe(TITLE.get(k));
      expect(g.assessment_objectives, g.requirement_id).toEqual(OBJECTIVES.get(k));
    }
  });

  it('no Store-row title, AO text or evidence_minimum appears in a reference gap row', () => {
    const { gaps, controlDispositions } = compileAll();
    const refGaps = gaps.filter((g) => TITLE.has(toNistRef(g.requirement_id)));
    const owned = norm(
      JSON.stringify(
        refGaps.map((g) => ({ t: g.requirement_title, x: g.requirement_text, ao: g.assessment_objectives })),
      ),
    );
    const dispTitles = norm(JSON.stringify((controlDispositions ?? []).map((d) => d.title)));
    const ownedValues = new Set<string>(
      [
        ...refGaps.flatMap((g) => [g.requirement_title, g.requirement_text, ...g.assessment_objectives.map((ao) => ao.text)]),
        ...(controlDispositions ?? []).map((d) => d.title),
      ].map(norm),
    );
    const legit = new Set<string>([
      ...[...TITLE.values()].map(norm),
      ...[...OBJECTIVES.values()].flat().map((o) => norm(o.text)),
    ]);
    // Store strings that are fragments of the NIST wording itself are not Store-only text.
    const legitText = [...legit].join('\n');
    let checked = 0;
    for (const row of rows) {
      if (!TITLE.has(toNistRef(row.requirement_id))) continue;
      const storeStrings: string[] = [
        row.title,
        ...(row.assessment_objectives ?? []).map((ao: any) => ao.text),
        ...(row.evidence_minimum?.must_have ?? []),
        ...(row.evidence_minimum?.nice_to_have ?? []),
      ]
        .map(norm)
        .filter((s) => s.length >= 12 && !legit.has(s));
      for (const s of storeStrings) {
        checked++;
        // Exact value match for every Store string; substring match only for long
        // ones (short titles such as "privileged functions" legitimately occur
        // inside NIST wording).
        expect(ownedValues.has(s), `${row.requirement_id}: "${s}"`).toBe(false);
        if (s.length >= 40 && !legitText.includes(s)) {
          const needle = JSON.stringify(s).slice(1, -1);
          expect(owned.includes(needle), `${row.requirement_id}: "${s}"`).toBe(false);
          expect(dispTitles.includes(needle), `${row.requirement_id} disposition: "${s}"`).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
