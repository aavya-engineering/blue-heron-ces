// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// FIN-17, SPA side:
//  - CG-8: the headless runner's MX_SUMMARY fields and MX_COST_NOTICE lines (COST-GATE-SPEC §5.2);
//  - KB-4 remainder: the plan reports read ces-shared practice titles, never the Store's; the RR
//    question set reads no requirement title at all (so no Store title can reach it).
import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
import approachReference from 'ces-shared/data/assessor-approach';
import { applyReferenceText, toNistRef } from '@/features/plan/engine/shared/services/practiceReference';
import type { ReadinessPosture, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import { buildPlanReports, withReferenceTitles } from '../reports/planReports';
import { buildSessionQuestionSet } from '../reports/sessionReports';
import { noticeLines, noticeSummaryFields, range } from '../headless/runnerCostLines';
import { loadBanks } from './planTestSupport';

const banks = loadBanks();
const store = banks.cmmcRequirements as { requirements: any[] };
const TITLE = new Map<string, string>(
  (approachReference.practices as Array<{ id: string; title: string }>).map((p) => [toNistRef(p.id), p.title]),
);

const si = (deps: Record<string, unknown>) =>
  ({ si_baseline: { operations: {}, scope: {}, dependencies: deps, target: { target_cmmc_level: 'L2' } } }) as unknown as SIBaseline;
const emptyPosture = { ces: { requirement_results: [] } } as unknown as ReadinessPosture;

describe('CG-8: runner cost-notice lines (FIN-17)', () => {
  const notice = {
    items: [
      { item_id: 'AZ-LAW-001', label: 'Log Analytics  workspace', estimate_month_low: 2.3, estimate_month_high: 46 },
      { item_id: 'AZ-KV-001', label: 'Key Vault Standard', estimate_month_low: 0, estimate_month_high: 0 },
    ],
    licence_dependencies: [{}, {}, {}],
    total_estimate_low: 2.3,
    total_estimate_high: 46,
  };

  it('MX_SUMMARY gains recurring_items, recurring_est_month and licence_deps', () => {
    expect(noticeSummaryFields(notice)).toBe('recurring_items=2 recurring_est_month=$2.30-$46 licence_deps=3');
    expect(noticeSummaryFields(null)).toBe('recurring_items=0 recurring_est_month=$0-$0 licence_deps=0');
  });

  it('one MX_COST_NOTICE line per item, both ends always printed', () => {
    expect(noticeLines(notice)).toEqual([
      'MX_COST_NOTICE AZ-LAW-001 Log Analytics workspace ~$2.30-$46/month',
      'MX_COST_NOTICE AZ-KV-001 Key Vault Standard ~$0-$0/month',
    ]);
    expect(noticeLines(undefined)).toEqual([]);
    expect(range(32, 128.75)).toBe('$32-$128.75');
  });

  it('the runner prints the fields on MX_SUMMARY and the lines before MX_RESULT', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'scripts/mx/plan-from-discovery.ts'), 'utf8');
    const summaryAt = src.lastIndexOf('noticeSummaryFields(compiled.recurringCostNotice)');
    const linesAt = src.lastIndexOf('noticeLines(compiled.recurringCostNotice)');
    const resultAt = src.lastIndexOf('`MX_RESULT ');
    expect(summaryAt).toBeGreaterThan(src.lastIndexOf('`MX_SUMMARY '));
    expect(linesAt).toBeGreaterThan(summaryAt);
    expect(resultAt).toBeGreaterThan(linesAt);
    expect(src).toContain('recurring_cost_notice: compiled.recurringCostNotice ?? null');
  });
});

describe('KB-4 remainder: plan reports and the RR question set (FIN-17)', () => {
  it('withReferenceTitles swaps only the title, and only on reference rows', () => {
    const before = applyReferenceText(store);
    const after = withReferenceTitles(store);
    expect(after.requirements).toHaveLength(before.requirements.length);
    let swapped = 0;
    after.requirements.forEach((row: any, i: number) => {
      const was: any = before.requirements[i];
      const { title: t1, ...rest1 } = row;
      const { title: t0, ...rest0 } = was;
      expect(rest1, row.requirement_id).toEqual(rest0); // text, objectives, evidence_minimum unchanged
      if (was.text_source === 'reference') {
        expect(t1, row.requirement_id).toBe(TITLE.get(toNistRef(row.requirement_id)));
        if (t1 !== t0) swapped++;
      } else {
        expect(t1).toBe(t0);
      }
    });
    expect(swapped).toBeGreaterThan(0); // the Store titles really were different (R-1)
  });

  it('the traceability and control-assessment reports carry the ces-shared titles', () => {
    const reports = buildPlanReports(
      { siBaseline: si({ infrastructure_model: 'm365_only' }), posture: emptyPosture, cuiBoundary: null, tenantConfig: null, questionSet: null },
      banks,
    );
    const titled = (rows: Array<{ requirement_id: string; title: string }>) =>
      rows.filter((r) => TITLE.has(toNistRef(r.requirement_id)));
    const traceRows = titled(reports.traceability.domains.flatMap((d) => d.requirements));
    expect(traceRows.length).toBeGreaterThan(0);
    for (const r of traceRows) expect(r.title, r.requirement_id).toBe(TITLE.get(toNistRef(r.requirement_id)));
    const storeTitles = new Set(store.requirements.filter((r) => TITLE.has(toNistRef(r.requirement_id)) && r.title !== TITLE.get(toNistRef(r.requirement_id))).map((r) => r.title));
    const json = JSON.stringify(reports.controlAssessment);
    expect([...storeTitles].filter((t) => t && json.includes(JSON.stringify(t)))).toEqual([]);
  });

  it('the RR question set does not read requirement titles (Store titles cannot reach it)', async () => {
    const rrQuestionBank = load(fs.readFileSync(path.resolve(process.cwd(), 'public/knowledge/primed RR Question Bank.yaml'), 'utf8'));
    const poisoned = { ...store, requirements: store.requirements.map((r) => ({ ...r, title: 'POISONED STORE TITLE' })) };
    const a = await buildSessionQuestionSet([], ['m365_e5_gcc'], rrQuestionBank, { cmmcRequirements: store, assessorKB: banks.assessorKB });
    const b = await buildSessionQuestionSet([], ['m365_e5_gcc'], rrQuestionBank, { cmmcRequirements: poisoned, assessorKB: banks.assessorKB });
    expect(JSON.stringify(b)).not.toContain('POISONED STORE TITLE');
    // Only the run metadata differs (time, random scenario id, and the store's own input hash).
    const strip = (q: any) => {
      const c = JSON.parse(JSON.stringify(q));
      delete c.ces.generated_on;
      delete c.ces.scenario.scenario_id;
      delete c.ces.inputs.cmmc_requirements_ref.hash_sha256;
      return c;
    };
    expect(strip(b)).toEqual(strip(a));
  });
});
