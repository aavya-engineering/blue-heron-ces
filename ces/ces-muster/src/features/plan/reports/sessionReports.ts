// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// sessionReports.ts — MG-11 / MG-18: the session side of the report
// downloads. The RR Question Set is the one Muster selects readiness
// activities by (readinessScope: the scenario SI over the session's scorable
// facts, the full RR bank, the requirement store with the reference text).
import { load } from 'js-yaml';
import type { InterviewFact } from '@/shared/types/engagement';
import type { RRQuestionSet } from '@/features/plan/engine/shared/types/artifacts';
import { applyReferenceText } from '@/features/plan/engine/shared/services/practiceReference';
import { buildRRQuestionSet, scenarioSiBaseline } from '@/features/scoring/readinessScope';
import { expandLegacyReadinessFacts } from '@/features/interview/questionGraph';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { loadCompilerBanks } from '../compilerBanks';
import type { PlanCompileResult } from '../planCompileService';
import type { CompilerBanks } from '../tenantManifestAdapter';
import { renderReports, type ReportBanks } from './planReports';

const RR_BANK_FILE = '/knowledge/primed RR Question Bank.yaml';

/** The session's RR Question Set (as the parity harness builds it). */
export async function buildSessionQuestionSet(
  facts: InterviewFact[],
  selectedStacks: string[],
  rrQuestionBank: unknown,
  banks: Pick<CompilerBanks, 'cmmcRequirements' | 'assessorKB'>
): Promise<RRQuestionSet> {
  return buildRRQuestionSet(
    scenarioSiBaseline(expandLegacyReadinessFacts(scorableFacts(facts)), selectedStacks),
    rrQuestionBank,
    { cmmcRequirements: applyReferenceText(banks.cmmcRequirements), assessorKB: banks.assessorKB } as never
  );
}

/** The compiler banks plus the RR Question Bank, from the SPA's static /knowledge assets. */
export async function loadReportBanks(): Promise<ReportBanks> {
  const [banks, rrText] = await Promise.all([loadCompilerBanks(), fetch(RR_BANK_FILE).then((r) => r.text())]);
  return { ...banks, rrQuestionBank: load(rrText) };
}

/** Plan tab: a compiled plan + its session's facts -> file name -> content. */
export async function renderReportsForCompile(
  compile: PlanCompileResult,
  session: { facts: InterviewFact[]; selected_stacks?: string[] }
): Promise<Record<string, string>> {
  const banks = await loadReportBanks();
  const questionSet = await buildSessionQuestionSet(session.facts, session.selected_stacks ?? [], banks.rrQuestionBank, banks);
  return renderReports(compile, banks, questionSet);
}
