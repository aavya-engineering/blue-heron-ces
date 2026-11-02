// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planReports.ts — MG-11 / MG-18 (decision D9): the three assessor reports
// (exclusions, traceability, control assessment) and the tech-ref
// implementation guide, as downloads. Each is Planner's vendored generator,
// called with the arguments Planner's useMissionPlanGenerator passes (steps 5,
// 6, 6B and 9), and each downloads in Planner's format
// (GeneratedArtifactsPanel.handleDownload): exclusions as text, the other three
// as HTML. The JSON objects are emitted too (Planner persists them as JSON).
//
// Posture: every report reads the session's ONE posture (MG-03,
// sessionPosture.ts) — PlanCompileResult.posture, the object the compile read
// and the MP embeds.
//
// Gap set and task catalog: the compile's own (PlanArtifacts.gapSet /
// taskCatalog, MG-16 hand-off (a)), so the reports' task ids are the MP's step
// ids. compileReportIntermediates (a re-run of the vendored compileGapSet +
// compileTaskCatalog on the compile's inputs) remains only for callers that
// hold no compile (the parity harness's derived report goldens).
import type { SIBaseline, RRQuestionSet, CUIBoundaryOutput, TenantConfigProfileOutput, ReadinessPosture } from '@/features/plan/engine/shared/types/artifacts';
import type { GapSet, TaskCatalog, ControlAssessmentReport } from '@/features/plan/engine/mpt/types';
import { compileGapSet } from '@/features/gaps/gapCompiler';
import { vendoredEvidenceCatalog } from '../evidenceCatalogBank';
import { compileTaskCatalog } from '@/features/plan/engine/mpt/services/taskCompiler';
import { buildTechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';
import { applyReferenceText, withReferenceRow } from '@/features/plan/engine/shared/services/practiceReference';
import {
  generateExclusionsReport,
  formatExclusionsReportAsText,
  type ExclusionsReport,
} from '@/features/plan/engine/mpt/services/exclusionsReportGenerator';
import {
  generateTraceabilityReport,
  formatTraceabilityReportAsHTML,
  type TraceabilityReport,
} from '@/features/plan/engine/mpt/services/traceabilityReportGenerator';
import {
  generateControlAssessmentReport,
  formatControlAssessmentReportAsHTML,
} from '@/features/plan/engine/mpt/services/controlAssessmentReportGenerator';
import { compileTechRefPlan, formatTechRefPlanAsHTML, type TechRefPlanData } from '@/features/plan/engine/shared/utils/exportTechRefPlan';
import type { CompilerBanks } from '../tenantManifestAdapter';
import { simulationMarker, type SimulationBlock } from '../policy/policyInputsProfile';

/** The compiler banks plus the RR Question Bank (the exclusions report reads its activity bank). */
export type ReportBanks = CompilerBanks & { rrQuestionBank?: unknown };

/** What the reports are derived from: the compile's inputs and the session's RR Question Set. */
export interface ReportInputs {
  siBaseline: SIBaseline;
  /** The session's one posture (MG-03). */
  posture: ReadinessPosture;
  cuiBoundary: CUIBoundaryOutput | null;
  tenantConfig: TenantConfigProfileOutput | null;
  /** The RR Question Set (activity selection + coverage); null -> no exclusions report, as in Planner. */
  questionSet: RRQuestionSet | null;
}

export interface PlanReports {
  exclusions: ExclusionsReport | null;
  traceability: TraceabilityReport;
  controlAssessment: ControlAssessmentReport;
  techRef: TechRefPlanData;
}

/** The report download file names (base names; the Plan tab adds tenant slug + timestamp). */
export const REPORT_FILES = {
  exclusionsJson: 'exclusions-report.json',
  exclusionsText: 'exclusions-report.txt',
  traceabilityJson: 'traceability-report.json',
  traceabilityHtml: 'traceability-report.html',
  controlAssessmentJson: 'control-assessment-report.json',
  controlAssessmentHtml: 'control-assessment-report.html',
  techRefJson: 'tech-ref-implementation-guide.json',
  techRefHtml: 'tech-ref-implementation-guide.html',
} as const;

/** The GapSet + TaskCatalog the reports read: the vendored compile, called as compilePlan calls it. */
export function compileReportIntermediates(
  inputs: Pick<ReportInputs, 'siBaseline' | 'posture' | 'cuiBoundary' | 'tenantConfig'>,
  banks: CompilerBanks
): { gapSet: GapSet; taskCatalog: TaskCatalog } {
  const vendorCapabilities = { patterns: banks.patterns, playbook: banks.playbook };
  const gapSet = compileGapSet(
    inputs.siBaseline,
    inputs.posture,
    banks.cmmcRequirements,
    banks.evidenceMatrix,
    vendorCapabilities,
    null,
    inputs.cuiBoundary,
    banks.inheritanceTable ?? null,
    vendoredEvidenceCatalog() // EVC.3: released evidence catalog (arg 9)
  );
  const taskCatalog = compileTaskCatalog(
    gapSet,
    inputs.siBaseline,
    vendorCapabilities,
    banks.assessorKB,
    banks.cmmcRequirements,
    banks.evidenceArchetypeCatalog,
    banks.techRef ? buildTechRefIndex(banks.techRef) : undefined,
    null,
    banks.evidenceMatrix,
    inputs.tenantConfig,
    gapSet.controlDispositions
  );
  return { gapSet, taskCatalog: { tasks: taskCatalog.tasks } as TaskCatalog };
}

/**
 * KB-4 remainder (FIN-17, R-1): the Requirements Store the reports read, with the
 * ces-shared reference text (applyReferenceText) AND, for every row with a reference
 * entry, the ces-shared practice title (withReferenceRow's title), never the Store's
 * shifted title. Only the title is swapped: objectives and evidence_minimum stay as
 * applyReferenceText leaves them, so no report row is added, removed or re-scored.
 */
export function withReferenceTitles<S>(store: S): S {
  const withText = applyReferenceText(store) as unknown as { requirements?: unknown[]; ces?: { requirements?: unknown[] } };
  if (!withText) return store;
  const map = (rows: unknown[]) =>
    rows.map((r) => {
      const row = r as { requirement_id: string; requirement_text?: string; title?: string; text_source?: string };
      return row.text_source === 'reference' ? { ...row, title: withReferenceRow(row).title } : row;
    });
  const out: Record<string, unknown> = { ...(withText as Record<string, unknown>) };
  if (Array.isArray(withText.requirements)) out.requirements = map(withText.requirements);
  if (withText.ces && Array.isArray(withText.ces.requirements)) out.ces = { ...withText.ces, requirements: map(withText.ces.requirements) };
  return out as S;
}

/**
 * The four report objects, from a GapSet + TaskCatalog and the posture.
 * Arguments as Planner's useMissionPlanGenerator passes them. The requirement
 * store gets the ces-shared reference text, as Planner's dataLoader does, and
 * (KB-4 remainder) the ces-shared titles (withReferenceTitles).
 */
export function generatePlanReports(
  inputs: ReportInputs,
  intermediates: { gapSet: GapSet; taskCatalog: TaskCatalog },
  banks: ReportBanks
): PlanReports {
  const cmmcRequirements = withReferenceTitles(banks.cmmcRequirements || { requirements: [] });
  const si = inputs.siBaseline;
  const targetLevel = si.si_baseline?.target?.target_cmmc_level || 'L2';
  const infrastructureModel = si.si_baseline?.dependencies?.infrastructure_model || 'm365_only'; // CG-1
  const { gapSet, taskCatalog } = intermediates;
  return {
    exclusions: inputs.questionSet
      ? generateExclusionsReport(si, inputs.questionSet, cmmcRequirements, banks.rrQuestionBank || {})
      : null,
    traceability: generateTraceabilityReport(cmmcRequirements, taskCatalog, targetLevel, infrastructureModel),
    controlAssessment: generateControlAssessmentReport(
      cmmcRequirements,
      { gaps: gapSet.gaps, scopeExclusions: gapSet.scopeExclusions, controlDispositions: gapSet.controlDispositions } as GapSet,
      taskCatalog,
      banks.assessorKB || {},
      inputs.posture,
      targetLevel
    ),
    techRef: compileTechRefPlan(
      banks.techRef || { control_families: [] },
      inputs.posture,
      banks.evidenceMatrix || {},
      banks.evidenceArchetypeCatalog || {}
    ),
  };
}

/** The reports from the compile's inputs (re-runs the gap/task compile; see header). */
export function buildPlanReports(inputs: ReportInputs, banks: ReportBanks): PlanReports {
  return generatePlanReports(inputs, compileReportIntermediates(inputs, banks), banks);
}

const escapeHtml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * V58 (synthetic customer): each report file carries the simulated-customer
 * marker. JSON: a leading `simulation` object (marker included); HTML: a
 * visible paragraph right after <body>; text: the first lines.
 */
export function withReportSimulationMarker(name: string, content: string, sim: SimulationBlock): string {
  const marker = simulationMarker(sim);
  if (name.endsWith('.json')) {
    const obj = JSON.parse(content) as Record<string, unknown>;
    return JSON.stringify({ simulation: { simulated: true, fictional: true, legalName: sim.legalName, marker, ...(sim.disclaimer ? { disclaimer: sim.disclaimer } : {}) }, ...obj }, null, 2);
  }
  if (name.endsWith('.html')) {
    const p = `<p class="simulated-customer"><strong>${escapeHtml(marker)}</strong>${sim.disclaimer ? ` ${escapeHtml(sim.disclaimer)}` : ''}</p>`;
    const body = /<body[^>]*>/i.exec(content);
    return body ? `${content.slice(0, body.index + body[0].length)}\n${p}${content.slice(body.index + body[0].length)}` : `${p}\n${content}`;
  }
  return `${marker}\n${sim.disclaimer ? `${sim.disclaimer}\n` : ''}\n${content}`;
}

/**
 * File name -> content: each report as JSON and in Planner's download format.
 * `simulation` (a simulated customer only) adds the V58 marker to every file.
 */
export function reportFiles(reports: PlanReports, simulation: SimulationBlock | null = null): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const out: Record<string, string> = {};
  if (reports.exclusions) {
    out[REPORT_FILES.exclusionsJson] = json(reports.exclusions);
    out[REPORT_FILES.exclusionsText] = formatExclusionsReportAsText(reports.exclusions);
  }
  out[REPORT_FILES.traceabilityJson] = json(reports.traceability);
  out[REPORT_FILES.traceabilityHtml] = formatTraceabilityReportAsHTML(reports.traceability);
  out[REPORT_FILES.controlAssessmentJson] = json(reports.controlAssessment);
  out[REPORT_FILES.controlAssessmentHtml] = formatControlAssessmentReportAsHTML(reports.controlAssessment);
  out[REPORT_FILES.techRefJson] = json(reports.techRef);
  out[REPORT_FILES.techRefHtml] = formatTechRefPlanAsHTML(reports.techRef);
  if (simulation) for (const name of Object.keys(out)) out[name] = withReportSimulationMarker(name, out[name], simulation);
  return out;
}

/** The slice of PlanCompileResult the reports read (structural, so the runner can pass its own). */
export interface CompiledForReports {
  artifacts: {
    siBaseline: SIBaseline;
    cuiBoundary: CUIBoundaryOutput | null;
    tenantConfig: TenantConfigProfileOutput | null;
    /** The compile's own intermediates (MG-16 hand-off (a)); absent -> re-compiled. */
    gapSet?: GapSet;
    taskCatalog?: TaskCatalog;
  };
  posture: unknown;
}

/**
 * Headless entry point (agent 2C-1 wires the runner): a compiled plan + banks
 * (+ the session's RR Question Set) -> file name -> content.
 */
export function renderReports(
  compile: CompiledForReports,
  banks: ReportBanks,
  questionSet: RRQuestionSet | null = null,
  simulation: SimulationBlock | null = null
): Record<string, string> {
  const inputs: ReportInputs = {
    siBaseline: compile.artifacts.siBaseline,
    posture: compile.posture as ReadinessPosture,
    cuiBoundary: compile.artifacts.cuiBoundary,
    tenantConfig: compile.artifacts.tenantConfig,
    questionSet,
  };
  const { gapSet, taskCatalog } = compile.artifacts;
  return reportFiles(
    gapSet && taskCatalog ? generatePlanReports(inputs, { gapSet, taskCatalog }, banks) : buildPlanReports(inputs, banks),
    simulation
  );
}
