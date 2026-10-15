// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  ControlAssessmentReport,
  ControlEntry,
  GapSet,
  TaskCatalog,
  Task,
  GapClassification,
} from '../types';
import type { ArtifactMetadata } from '@/shared/types/artifacts';
import { toISODateTime } from '@/shared/utils/dateFormatter';
import { LEVEL_HIERARCHY, DOMAIN_NAMES, GAP_CLASS_STYLE, L1_CANONICAL_IN_L2 } from '@/shared/constants/cmmcConstants';

interface AssessorPractice {
  practice_id: string;
  assessor_intent?: string;
  assessor_methods?: string[];
  what_assessors_probe?: string[];
  common_failure_modes?: string[];
}

export function generateControlAssessmentReport(
  cmmcRequirements: any,
  gapSet: GapSet,
  taskCatalog: TaskCatalog,
  assessorKB: any,
  readinessPosture: any,
  targetLevel: string,
): ControlAssessmentReport {
  const reqStore: any[] =
    cmmcRequirements?.requirements || cmmcRequirements?.ces?.requirements || [];

  // 1. Build scope exclusion map from gapSet.scopeExclusions
  const exclusionMap = new Map(
    gapSet.scopeExclusions?.map((e) => [e.requirement_id, e]) || [],
  );

  // 2. Filter requirements by target level, then dedup by NIST base ID
  //    (same logic as buildControlDispositions in gapCompiler.ts)
  const inScopeLevels = LEVEL_HIERARCHY[targetLevel] || ['L1', 'L2'];
  const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3 };
  const bestByBase = new Map<string, any>();
  for (const req of reqStore) {
    if (!inScopeLevels.includes(req.level)) continue;
    const baseId = req.requirement_id.split('-').slice(1).join('-');
    const existing = bestByBase.get(baseId);
    if (!existing) {
      bestByBase.set(baseId, req);
    } else if (targetLevel !== 'L1' && L1_CANONICAL_IN_L2.has(baseId)) {
      if ((LEVEL_RANK[req.level] || 0) < (LEVEL_RANK[existing.level] || 0)) {
        bestByBase.set(baseId, req);
      }
    } else if ((LEVEL_RANK[req.level] || 0) > (LEVEL_RANK[existing.level] || 0)) {
      bestByBase.set(baseId, req);
    }
  }
  const allReqs = Array.from(bestByBase.values());

  // 3. Build task map: Map<requirement_id, Task[]>
  const taskMap = new Map<string, Task[]>();
  for (const task of taskCatalog.tasks) {
    const rid = task.requirement_id;
    if (!taskMap.has(rid)) taskMap.set(rid, []);
    taskMap.get(rid)!.push(task);
  }

  // 4. Build readiness map: Map<requirement_id, RequirementResult>
  const rrResults = readinessPosture?.ces?.requirement_results || [];
  const readinessMap = new Map(rrResults.map((r: any) => [r.requirement_id, r]));

  // 5. Build assessor KB map: Map<practice_id, AssessorPractice>
  const practices: AssessorPractice[] = assessorKB?.ces?.practices || [];
  const assessorMap = new Map(practices.map((p: AssessorPractice) => [p.practice_id, p]));

  // 6. Build ControlEntry for each requirement
  const controls: ControlEntry[] = allReqs.map((req: any) => {
    const rid = req.requirement_id;
    const exclusion = exclusionMap.get(rid);
    const tasks = taskMap.get(rid) || [];
    const readiness = readinessMap.get(rid) as
      | { status?: string; notes?: string }
      | undefined;
    const assessorEntry = assessorMap.get(rid);

    // Derive implementation summary
    let implSummary = '';
    let gapClassifications: GapClassification[] = [];
    let totalEffort = 0;

    if (exclusion) {
      implSummary = exclusion.justification;
      gapClassifications = ['scoped_out'];
    } else if (tasks.length > 0) {
      // Group tasks by gap_classifications
      const classMap = new Map<GapClassification, Task[]>();
      for (const task of tasks) {
        totalEffort += task.estimated_effort_hours || 0;
        for (const gc of task.gap_classifications || []) {
          if (!classMap.has(gc)) classMap.set(gc, []);
          classMap.get(gc)!.push(task);
        }
      }

      // Build summary string
      const classCounts = Array.from(classMap.entries())
        .map(([gc, ts]) => `${ts.length} ${GAP_CLASS_STYLE[gc]?.label || gc}`)
        .join(', ');

      const firstTasks = tasks
        .slice(0, 2)
        .map((t) => t.title)
        .join('; ');
      implSummary = `${classCounts}: ${firstTasks}${tasks.length > 2 ? '...' : ''}. Total effort: ${totalEffort}h`;

      gapClassifications = Array.from(classMap.keys());
    } else {
      implSummary = 'No tasks generated — may require manual assessment or policy-only control';
    }

    return {
      requirement_id: rid,
      title: req.title || rid,
      requirement_text: req.requirement_text || '',
      domain: req.domain || 'OTHER',
      level: req.level || '',
      nist_reference: req.references?.nist_800_171_id || '',
      scope_status: exclusion ? ('scoped_out' as const) : ('in_scope' as const),
      scope_justification: exclusion?.justification,
      si_decision: exclusion
        ? { field: exclusion.si_field, value: exclusion.si_value }
        : undefined,
      readiness_status: readiness?.status as ControlEntry['readiness_status'],
      readiness_notes: readiness?.notes,
      implementation_summary: implSummary,
      gap_classifications: gapClassifications,
      task_count: tasks.length,
      estimated_effort_hours: totalEffort,
      assessor_expectations: {
        assessor_intent: assessorEntry?.assessor_intent,
        assessor_methods: assessorEntry?.assessor_methods,
        what_assessors_probe: assessorEntry?.what_assessors_probe,
        common_failure_modes: assessorEntry?.common_failure_modes,
      },
    };
  });

  // 7. Calculate summary counts
  const summary = {
    total_controls: controls.length,
    in_scope: controls.filter((c) => c.scope_status === 'in_scope').length,
    scoped_out: controls.filter((c) => c.scope_status === 'scoped_out').length,
    met: controls.filter((c) => c.readiness_status === 'met').length,
    partial: controls.filter((c) => c.readiness_status === 'partial').length,
    not_met: controls.filter((c) => c.readiness_status === 'not_met').length,
    unknown: controls.filter(
      (c) => c.readiness_status === 'unknown' || !c.readiness_status,
    ).length,
  };

  return {
    ces: {
      artifact: 'control_assessment_report',
      version: '1.0.0',
      generated_on: toISODateTime(new Date()),
      intent: `Control assessment report for CMMC ${targetLevel} compliance`,
    } as ArtifactMetadata,
    summary,
    controls,
  };
}

// ---------------------------------------------------------------------------
// HTML Formatter
// ---------------------------------------------------------------------------

export function formatControlAssessmentReportAsHTML(
  report: ControlAssessmentReport,
): string {
  const s = report.summary;

  // Group controls by domain
  const domainMap = new Map<string, ControlEntry[]>();
  for (const ctrl of report.controls) {
    const domain = ctrl.domain;
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(ctrl);
  }

  const domainSections = Array.from(domainMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, controls]) => renderDomain(domain, controls))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CMMC Control Assessment Report</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.5;color:#1f2937;background:#f9fafb}
.c{max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 2px;color:#111827}
.sub{font-size:13px;color:#6b7280;margin:0 0 20px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}
.sc{padding:12px;border-radius:8px;text-align:center}
.sc .v{font-size:26px;font-weight:700}
.sc .l{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
.dh{background:#1f2937;color:#fff;padding:10px 16px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;margin-top:20px}
.dh .dt{font-weight:700;font-size:14px}
.dh .ds{font-size:11px;opacity:.8}
.bar{height:3px;background:#374151;border-radius:2px;margin-top:4px;overflow:hidden;width:160px}
.bar-fill{height:100%;background:#34d399;border-radius:2px}
table{width:100%;border-collapse:collapse}
.dt-table{border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;overflow:hidden;margin-bottom:4px}
.ctrl-row{border-bottom:1px solid #f3f4f6}
.ctrl-row td{padding:12px;vertical-align:top;font-size:13px}
.ctrl-row.scoped{background:#fafafa;border-left:3px solid #9ca3af}
.ctrl-row.in-scope{border-left:3px solid #3b82f6}
.rid{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;font-weight:600;color:#374151;white-space:nowrap}
.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;margin-right:4px}
.impl{font-size:12px;color:#4b5563;margin-top:6px}
details{margin-top:8px;font-size:12px}
summary{cursor:pointer;font-weight:600;color:#6b7280}
summary:hover{color:#374151}
.expect-section{margin-top:4px;padding-left:12px;border-left:2px solid #e5e7eb}
.expect-label{font-weight:600;color:#4b5563;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.footer{text-align:center;font-size:11px;color:#9ca3af;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb}
@media print{
  body{background:#fff;font-size:9pt}
  .c{max-width:100%;padding:0}
  .dh{break-after:avoid}
  .dt-table{break-inside:avoid}
  td{padding:8px}
}
</style>
</head>
<body>
<div class="c">
<h1>CMMC Control Assessment Report</h1>
<p class="sub">Generated ${esc(report.ces.generated_on)} &middot; ${s.total_controls} controls</p>
<div class="stats">
  <div class="sc" style="background:#dbeafe;color:#1e40af"><div class="v">${s.total_controls}</div><div class="l">Total</div></div>
  <div class="sc" style="background:#d1fae5;color:#065f46"><div class="v">${s.in_scope}</div><div class="l">In Scope</div></div>
  <div class="sc" style="background:#f3f4f6;color:#6b7280"><div class="v">${s.scoped_out}</div><div class="l">Scoped Out</div></div>
  <div class="sc" style="background:#fef3c7;color:#92400e"><div class="v">${s.met}/${s.partial}/${s.not_met}</div><div class="l">Met/Part/Not</div></div>
</div>
${renderScopeExclusionsHTML(report.controls)}
${domainSections}
<div class="footer">Generated by CES Mission Planning Tool on ${esc(new Date().toISOString().slice(0, 10))}</div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDomain(domain: string, controls: ControlEntry[]): string {
  const name = DOMAIN_NAMES[domain] || domain;
  const inScope = controls.filter((c) => c.scope_status === 'in_scope');
  const met = inScope.filter((c) => c.readiness_status === 'met').length;
  const pct = inScope.length > 0 ? Math.round((met / inScope.length) * 100) : 0;

  const rows = controls
    .map((ctrl) => {
      const scopeBadge =
        ctrl.scope_status === 'in_scope'
          ? '<span class="badge" style="background:#dbeafe;color:#1e40af">IN SCOPE</span>'
          : '<span class="badge" style="background:#f3f4f6;color:#6b7280">SCOPED OUT</span>';

      const readinessBadge = ctrl.readiness_status
        ? `<span class="badge" style="background:${getReadinessBg(ctrl.readiness_status)};color:${getReadinessText(ctrl.readiness_status)}">${ctrl.readiness_status.toUpperCase()}</span>`
        : '';

      const gapBadges = ctrl.gap_classifications
        .map((gc) => {
          const style = GAP_CLASS_STYLE[gc];
          return `<span class="badge" style="background:${style.bg};color:${style.text}">${style.label}</span>`;
        })
        .join('');

      const assessorSection = hasAssessorData(ctrl.assessor_expectations)
        ? `<details>
        <summary>Assessor Expectations</summary>
        <div class="expect-section">
          ${ctrl.assessor_expectations.assessor_intent ? `<div><span class="expect-label">Intent:</span> ${esc(ctrl.assessor_expectations.assessor_intent)}</div>` : ''}
          ${ctrl.assessor_expectations.assessor_methods && ctrl.assessor_expectations.assessor_methods.length > 0 ? `<div><span class="expect-label">Methods:</span> ${ctrl.assessor_expectations.assessor_methods.join(', ')}</div>` : ''}
          ${ctrl.assessor_expectations.what_assessors_probe && ctrl.assessor_expectations.what_assessors_probe.length > 0 ? `<div><span class="expect-label">Probes:</span> ${ctrl.assessor_expectations.what_assessors_probe.map(esc).join('; ')}</div>` : ''}
          ${ctrl.assessor_expectations.common_failure_modes && ctrl.assessor_expectations.common_failure_modes.length > 0 ? `<div><span class="expect-label">Failures:</span> ${ctrl.assessor_expectations.common_failure_modes.map(esc).join('; ')}</div>` : ''}
        </div>
      </details>`
        : '<div class="expect-section" style="color:#9ca3af">No assessor guidance available for this control.</div>';

      return `<tr class="ctrl-row ${ctrl.scope_status === 'scoped_out' ? 'scoped' : 'in-scope'}">
      <td style="width:120px" class="rid">${esc(ctrl.requirement_id)}</td>
      <td>
        <div style="font-weight:500;margin-bottom:4px">${esc(ctrl.title)}</div>
        <div>${scopeBadge}${readinessBadge}${gapBadges}</div>
        <div class="impl">${esc(ctrl.implementation_summary)}</div>
        ${ctrl.scope_justification && ctrl.si_decision ? `<div style="font-size:11px;color:#6b7280;margin-top:4px">SI: ${esc(ctrl.si_decision.field)} = ${esc(ctrl.si_decision.value)}</div>` : ''}
        ${assessorSection}
      </td>
    </tr>`;
    })
    .join('\n');

  return `
<div class="dh">
  <div><span class="dt">${esc(domain)} &mdash; ${esc(name)}</span><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>
  <span class="ds">${met}/${inScope.length} met (${pct}%)</span>
</div>
<div class="dt-table"><table>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function renderScopeExclusionsHTML(controls: ControlEntry[]): string {
  const excluded = controls.filter((c) => c.scope_status === 'scoped_out');
  if (excluded.length === 0) return '';

  const rows = excluded
    .map(
      (ctrl) =>
        `<tr class="ctrl-row scoped">
      <td style="width:120px" class="rid">${esc(ctrl.requirement_id)}</td>
      <td>
        <div style="font-weight:500;margin-bottom:4px">${esc(ctrl.title)}</div>
        <div class="impl">${esc(ctrl.scope_justification || ctrl.implementation_summary)}</div>
        ${ctrl.si_decision ? `<div style="font-size:11px;color:#6b7280;margin-top:4px">SI: ${esc(ctrl.si_decision.field)} = ${esc(ctrl.si_decision.value)}</div>` : ''}
      </td>
    </tr>`,
    )
    .join('\n');

  return `
<div class="dh" style="background:#6b7280">
  <div><span class="dt">Scope Exclusions</span></div>
  <span class="ds">${excluded.length} control${excluded.length !== 1 ? 's' : ''} excluded</span>
</div>
<div class="dt-table"><table>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function getReadinessBg(status: string): string {
  const map: Record<string, string> = {
    met: '#d1fae5',
    partial: '#fef3c7',
    not_met: '#fee2e2',
    unknown: '#f3f4f6',
  };
  return map[status] || '#f3f4f6';
}

function getReadinessText(status: string): string {
  const map: Record<string, string> = {
    met: '#065f46',
    partial: '#92400e',
    not_met: '#991b1b',
    unknown: '#6b7280',
  };
  return map[status] || '#6b7280';
}

function hasAssessorData(
  expectations: ControlEntry['assessor_expectations'],
): boolean {
  return !!(
    expectations.assessor_intent ||
    (expectations.assessor_methods && expectations.assessor_methods.length > 0) ||
    (expectations.what_assessors_probe &&
      expectations.what_assessors_probe.length > 0) ||
    (expectations.common_failure_modes &&
      expectations.common_failure_modes.length > 0)
  );
}

// ---------------------------------------------------------------------------
// Plain-text Formatter (for in-app viewer)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  met: 'MET',
  partial: 'PARTIAL',
  not_met: 'NOT MET',
  unknown: 'UNKNOWN',
};

export function formatControlAssessmentReportAsText(
  report: ControlAssessmentReport,
): string {
  const s = report.summary;
  const lines: string[] = [];

  lines.push('CMMC CONTROL ASSESSMENT REPORT');
  lines.push(`Generated: ${report.ces.generated_on}`);
  lines.push('');
  lines.push(
    `Total: ${s.total_controls}  |  In Scope: ${s.in_scope}  |  Scoped Out: ${s.scoped_out}  |  Met: ${s.met}  |  Partial: ${s.partial}  |  Not Met: ${s.not_met}  |  Unknown: ${s.unknown}`,
  );
  lines.push('='.repeat(100));

  // Scope Exclusions section
  const excluded = report.controls.filter((c) => c.scope_status === 'scoped_out');
  if (excluded.length > 0) {
    lines.push('');
    lines.push(`SCOPE EXCLUSIONS  (${excluded.length} control${excluded.length !== 1 ? 's' : ''} excluded)`);
    lines.push('-'.repeat(80));
    for (const ctrl of excluded) {
      lines.push(`  ${ctrl.requirement_id} \u2014 ${ctrl.title}`);
      lines.push(`    Justification: ${ctrl.scope_justification || ctrl.implementation_summary}`);
      if (ctrl.si_decision) {
        lines.push(`    SI Decision: ${ctrl.si_decision.field} = ${ctrl.si_decision.value}`);
      }
      lines.push('');
    }
    lines.push('='.repeat(100));
  }

  // Group by domain
  const domainMap = new Map<string, ControlEntry[]>();
  for (const ctrl of report.controls) {
    if (!domainMap.has(ctrl.domain)) domainMap.set(ctrl.domain, []);
    domainMap.get(ctrl.domain)!.push(ctrl);
  }

  for (const [domain, controls] of Array.from(domainMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const name = DOMAIN_NAMES[domain] || domain;
    const inScope = controls.filter((c) => c.scope_status === 'in_scope');
    const met = inScope.filter((c) => c.readiness_status === 'met').length;
    const pct = inScope.length > 0 ? Math.round((met / inScope.length) * 100) : 0;

    lines.push('');
    lines.push(`${domain} — ${name}  (${met}/${inScope.length} met, ${pct}%)`);
    lines.push('-'.repeat(80));

    for (const ctrl of controls) {
      const scope =
        ctrl.scope_status === 'scoped_out' ? '[SCOPED OUT]' : '[IN SCOPE]';
      const status = ctrl.readiness_status
        ? `  ${STATUS_LABEL[ctrl.readiness_status] || ctrl.readiness_status}`
        : '';
      const classes = ctrl.gap_classifications
        .map((gc) => GAP_CLASS_STYLE[gc]?.label || gc)
        .join(', ');

      lines.push(`  ${ctrl.requirement_id} \u2014 ${ctrl.title}  ${scope}${status}`);
      if (classes) lines.push(`    Classification: ${classes}`);
      lines.push(`    ${ctrl.implementation_summary}`);

      if (ctrl.scope_justification && ctrl.si_decision) {
        lines.push(
          `    SI Decision: ${ctrl.si_decision.field} = ${ctrl.si_decision.value}`,
        );
      }

      const exp = ctrl.assessor_expectations;
      if (hasAssessorData(exp)) {
        if (exp.assessor_intent) lines.push(`    Assessor Intent: ${exp.assessor_intent}`);
        if (exp.assessor_methods && exp.assessor_methods.length > 0)
          lines.push(`    Methods: ${exp.assessor_methods.join(', ')}`);
        if (exp.what_assessors_probe && exp.what_assessors_probe.length > 0)
          lines.push(`    Probes: ${exp.what_assessors_probe.join('; ')}`);
        if (exp.common_failure_modes && exp.common_failure_modes.length > 0)
          lines.push(`    Common Failures: ${exp.common_failure_modes.join('; ')}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}
