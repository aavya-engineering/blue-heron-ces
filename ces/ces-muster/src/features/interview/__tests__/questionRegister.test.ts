// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-28: the question register is complete, current and honest.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QUESTION_GRAPH, type QuestionNode } from '../questionGraph';
import { buildQuestionRegister, isPhantomReadinessNode, serializeQuestionRegister, type QuestionRegister } from '../questionRegister';
import controlsReference from 'ces-shared/data/cmmc-l2-controls';
import { PLAN_TAB_QUESTIONS, PROFILE_QUESTIONS, TO_JUSTIFY } from '../questionRegisterJustifications';

const REGISTER_PATH = path.resolve(__dirname, '../questionRegister.json');
// Normalise line endings: a CRLF checkout must not read as stale.
const committedText = fs.readFileSync(REGISTER_PATH, 'utf8').replace(/\r\n/g, '\n');
const committed = JSON.parse(committedText) as QuestionRegister;

describe('MG-28 question register', () => {
  it('has a committed row for every question graph node', () => {
    const ids = new Set(committed.rows.map((r) => r.id));
    const missing = QUESTION_GRAPH.map((n) => n.id).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it('FIN-17b (NS-audit F-10): marks exactly the 17 RR activities keyed to L2 ids the ces-shared reference lacks', () => {
    const ref = new Set((controlsReference.controls as Array<{ control_id: string }>).map((c) => c.control_id));
    const phantom = committed.rows.filter((r) => r.phantom_requirement_ids);
    expect(phantom.map((r) => r.id).sort()).toEqual([
      'RR-ACT-AC_L2_3_1_1', 'RR-ACT-AC_L2_3_1_2', 'RR-ACT-AC_L2_3_1_20', 'RR-ACT-AC_L2_3_1_22',
      'RR-ACT-IA_L2_3_5_1', 'RR-ACT-IA_L2_3_5_2', 'RR-ACT-MP_L2_3_8_3',
      'RR-ACT-PE_L2_3_10_1', 'RR-ACT-PE_L2_3_10_3', 'RR-ACT-PE_L2_3_10_4', 'RR-ACT-PE_L2_3_10_5',
      'RR-ACT-SC_L2_3_13_1', 'RR-ACT-SC_L2_3_13_5',
      'RR-ACT-SI_L2_3_14_1', 'RR-ACT-SI_L2_3_14_2', 'RR-ACT-SI_L2_3_14_4', 'RR-ACT-SI_L2_3_14_5',
    ].sort());
    expect(committed.counts.phantom).toBe(17);
    for (const r of phantom) {
      for (const id of r.phantom_requirement_ids!) {
        expect(ref.has(id), `${r.id} ${id}`).toBe(false);
        // Each is an L1 practice in the reference, and that L1 activity has its own row.
        expect(ref.has(id.replace('.L2-', '.L1-')), `${r.id} ${id}`).toBe(true);
      }
      expect(committed.rows.some((row) => row.id === r.id.replace('_L2_', '_L1_')), r.id).toBe(true);
    }
    // No other RR activity row names an L1/L2 requirement the reference lacks.
    for (const r of committed.rows.filter((x) => x.id.startsWith('RR-ACT-') && !x.phantom_requirement_ids)) {
      for (const f of r.output_fields) {
        const m = /^requirement_results\[([A-Z]{2}\.L[12]-[^\]]+)\]/.exec(f);
        if (m) expect(ref.has(m[1]), `${r.id} ${m[1]}`).toBe(true);
      }
    }
    expect(QUESTION_GRAPH.filter(isPhantomReadinessNode).length).toBe(17);
  });

  it('has a hand-authored justification for every graph node (none unregistered)', () => {
    const unregistered = buildQuestionRegister().rows.filter((r) => r.status === 'unregistered');
    expect(unregistered.map((r) => r.id)).toEqual([]);
  });

  it('flags a new question node that has no justification', () => {
    const extra: QuestionNode = {
      id: 'zz-999',
      text: 'An unregistered test question',
      options: [],
      cluster: 'identity',
      mapped_requirements: ['AC.L1-3.1.1'],
    };
    const reg = buildQuestionRegister([...QUESTION_GRAPH, extra]);
    expect(reg.rows.find((r) => r.id === 'zz-999')?.status).toBe('unregistered');
    expect(reg.counts.unregistered).toBe(1);
  });

  it('the committed file equals the generator output (run npm run register:generate)', () => {
    // Structural compare: a prettier run over the JSON must not read as stale.
    expect(committed).toEqual(JSON.parse(serializeQuestionRegister(buildQuestionRegister())));
  });

  it('every row names at least one output field and a reason', () => {
    for (const r of committed.rows) {
      expect(r.output_fields.length, r.id).toBeGreaterThan(0);
      expect(r.why_not_derived, r.id).toMatch(/\S/);
    }
  });

  it('reasons are grounded, a backlog candidate, or the BHD placeholder', () => {
    for (const r of committed.rows) {
      if (r.status === 'candidate') expect(r.why_not_derived, r.id).toMatch(/^candidate for derivation: MG-\d{2}(, MG-\d{2})*$/);
      if (r.status === 'to_justify') expect(r.why_not_derived, r.id).toBe(TO_JUSTIFY);
    }
  });

  it('has no stale rows: graph rows name real nodes, profile rows still exist on the Profile tab', () => {
    const graphIds = new Set(QUESTION_GRAPH.map((n) => n.id));
    for (const r of committed.rows.filter((x) => x.kind !== 'profile' && x.kind !== 'plan-review')) {
      expect(graphIds.has(r.id), r.id).toBe(true);
    }
    const page = fs.readFileSync(path.resolve(__dirname, '../../assessment/AssessmentPage.tsx'), 'utf8');
    for (const p of PROFILE_QUESTIONS) {
      expect(page.includes(p.uiAnchor), `${p.id} anchor ${p.uiAnchor}`).toBe(true);
    }
    // MG-16 hand-off (e): the Plan tab's capture-review rows anchor in their component.
    for (const p of PLAN_TAB_QUESTIONS) {
      const file = fs.readFileSync(path.resolve(__dirname, '../../plan', p.uiFile), 'utf8');
      expect(file.includes(p.uiAnchor), `${p.id} anchor ${p.uiAnchor} in ${p.uiFile}`).toBe(true);
    }
  });

  it('ids are unique', () => {
    const ids = committed.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
