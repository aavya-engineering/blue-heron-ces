// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { TaskCatalog, Task, EffortEstimate, StepAction, EvidenceArtifact, VendorHelpRef } from '../types';
import type { ArtifactMetadata } from '@/shared/types/artifacts';
import { toISODateTime } from '@/shared/utils/dateFormatter';
import { LEVEL_HIERARCHY, DOMAIN_NAMES, GAP_CLASS_STYLE } from '@/shared/constants/cmmcConstants';

// ---------------------------------------------------------------------------
// Data Shapes
// ---------------------------------------------------------------------------

interface TracedTask {
  task_id: string;
  title: string;
  description: string;
  task_type: string;
  priority: string;
  owner_role: string;
  estimated_effort_hours: number;
  effort_estimate: EffortEstimate;
  gap_classifications: string[];
  what_to_do: string[];
  how_to_verify: string[];
  actions: StepAction[];
  impl_engine?: string;
  impl_command?: string;
  expected_artifacts: EvidenceArtifact[];
  vendor_help_refs: VendorHelpRef[];
}

interface RequirementTrace {
  requirement_id: string;
  title: string;
  requirement_text: string;
  domain: string;
  level: string;
  nist_reference: string;
  satisfied: boolean;
  tasks: TracedTask[];
}

interface DomainGroup {
  domain: string;
  requirements: RequirementTrace[];
  satisfied_count: number;
  total_count: number;
}

export interface TraceabilityReport {
  ces: ArtifactMetadata;
  summary: {
    total_requirements: number;
    satisfied: number;
    unsatisfied: number;
    total_tasks: number;
    infrastructure_model: string;
  };
  domains: DomainGroup[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3) + '...';
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateTraceabilityReport(
  cmmcRequirements: any,
  taskCatalog: TaskCatalog,
  targetLevel: string,
  infrastructureModel?: string,
): TraceabilityReport {
  const reqStore: any[] =
    cmmcRequirements?.requirements || cmmcRequirements?.ces?.requirements || [];

  const inScopeLevels = LEVEL_HIERARCHY[targetLevel] || ['L1', 'L2'];
  const inScopeReqs = reqStore.filter((r: any) => inScopeLevels.includes(r.level));

  // Build Map<requirement_id, TracedTask[]> from task catalog
  const taskMap = new Map<string, TracedTask[]>();
  for (const task of taskCatalog.tasks) {
    const rid = task.requirement_id;
    if (!taskMap.has(rid)) taskMap.set(rid, []);
    taskMap.get(rid)!.push(toTracedTask(task));
  }

  // Build requirements grouped by domain
  const domainMap = new Map<string, RequirementTrace[]>();
  for (const req of inScopeReqs) {
    const rid = req.requirement_id;
    const tasks = taskMap.get(rid) || [];
    // Only configure tasks count as satisfied — customize/manual still need work
    const hasConfigure = tasks.some(
      (t) => (t.gap_classifications || []).includes('configure'),
    );
    const trace: RequirementTrace = {
      requirement_id: rid,
      title: req.title || rid,
      requirement_text: req.requirement_text || '',
      domain: req.domain || 'OTHER',
      level: req.level || '',
      nist_reference: req.references?.nist_800_171_id || '',
      satisfied: hasConfigure,
      tasks,
    };
    const domain = trace.domain;
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(trace);
  }

  // Sort domains alphabetically, requirements by ID within each domain
  const domains: DomainGroup[] = Array.from(domainMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, requirements]) => {
      requirements.sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
      return {
        domain,
        requirements,
        satisfied_count: requirements.filter((r) => r.satisfied).length,
        total_count: requirements.length,
      };
    });

  const totalRequirements = inScopeReqs.length;
  const satisfied = domains.reduce((s, d) => s + d.satisfied_count, 0);

  return {
    ces: {
      artifact: 'traceability_report',
      version: '1.0.0',
      generated_on: toISODateTime(new Date()),
      intent: `Traceability report for CMMC ${targetLevel} compliance`,
    },
    summary: {
      total_requirements: totalRequirements,
      satisfied,
      unsatisfied: totalRequirements - satisfied,
      total_tasks: taskCatalog.tasks.length,
      infrastructure_model: infrastructureModel || 'm365_azure',
    },
    domains,
  };
}

function toTracedTask(task: Task): TracedTask {
  return {
    task_id: task.task_id,
    title: task.title,
    description: task.description,
    task_type: task.task_type,
    priority: task.priority,
    owner_role: task.owner_role,
    estimated_effort_hours: task.estimated_effort_hours,
    effort_estimate: task.effort_estimate,
    gap_classifications: task.gap_classifications,
    what_to_do: task.what_to_do,
    how_to_verify: task.how_to_verify,
    actions: task.actions,
    impl_engine: task.impl_engine,
    impl_command: task.impl_command,
    expected_artifacts: task.expected_artifacts,
    vendor_help_refs: task.vendor_help_refs,
  };
}

// ---------------------------------------------------------------------------
// HTML Formatter — tight table layout: one row per requirement, one row per task
// ---------------------------------------------------------------------------

const PRIORITY_LABELS: Record<string, string> = {
  p0: 'CRITICAL',
  p1: 'HIGH',
  p2: 'STANDARD',
  p3: 'LOW',
};

const PRIORITY_COLORS: Record<string, string> = {
  p0: '#dc2626',
  p1: '#ea580c',
  p2: '#2563eb',
  p3: '#9ca3af',
};

const PRIORITY_BG: Record<string, string> = {
  p0: '#fef2f2',
  p1: '#fff7ed',
  p2: '#eff6ff',
  p3: '#f9fafb',
};

function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function classificationBadges(gc: string[]): string {
  if (gc.length === 0) return '';
  return gc
    .map((c) => {
      const s = GAP_CLASS_STYLE[c] || GAP_CLASS_STYLE['manual'];
      return `<span class="badge" style="background:${s.bg};color:${s.text}">${s.label}</span>`;
    })
    .join(' ');
}

function priorityBadge(p: string): string {
  const label = PRIORITY_LABELS[p] || p;
  const bg = PRIORITY_BG[p] || '#f9fafb';
  const color = PRIORITY_COLORS[p] || '#9ca3af';
  return `<span class="badge" style="background:${bg};color:${color}">${esc(label)}</span>`;
}

/** Derive a short approach string for a single classification. */
function approachForClassification(
  cls: string,
  actions: TracedTask['actions'],
  vendorRefs: TracedTask['vendor_help_refs'],
  whatToDo: string[],
  taskType: string,
): string {
  if (cls === 'configure') {
    const services = new Map<string, string[]>();
    for (const a of (actions || [])) {
      const svc = a.vendor?.m365_service;
      if (svc) {
        if (!services.has(svc)) services.set(svc, []);
        const impl = a.vendor?.implementation;
        if (impl) services.get(svc)!.push(impl);
      }
    }
    if (services.size > 0) {
      const parts: string[] = [];
      for (const [svc, impls] of services) {
        const unique = [...new Set(impls)];
        parts.push(unique.length > 0 ? `${svc}: ${unique.slice(0, 2).join('; ')}` : svc);
      }
      return `Configure — ${parts.join('. ')}`;
    }
    if ((vendorRefs || []).length > 0) {
      return `Configure — ${[...new Set(vendorRefs!.map((r) => `${r.product || r.vendor}: ${r.title}`))].slice(0, 2).join('; ')}`;
    }
    return `Configure — Enable ${taskType} controls via vendor stack`;
  }

  if (cls === 'customize') {
    const cmds: string[] = [];
    for (const a of (actions || [])) {
      if (a.vendor?.powershell?.length) cmds.push(...a.vendor.powershell);
    }
    const unique = [...new Set(cmds.filter((c) => !c.startsWith('#') && !c.startsWith('Connect-')))];
    if (unique.length > 0) return `Customize — ${truncate(unique.slice(0, 2).join('; '), 120)}`;
    if ((vendorRefs || []).length > 0) {
      return `Customize — ${[...new Set(vendorRefs!.map((r) => `${r.product || r.vendor}: ${r.title}`))].slice(0, 2).join('; ')}`;
    }
    const implLine = whatToDo.find((s) => !s.startsWith('[') && !s.startsWith('  '));
    if (implLine) return `Customize — ${truncate(implLine, 120)}`;
    return `Customize — Scripting/customization for ${taskType}`;
  }

  // manual
  const implLine = whatToDo.find((s) => !s.startsWith('[') && !s.startsWith('  '));
  if (implLine) return `Manual — ${truncate(implLine, 120)}`;
  const deliverable = whatToDo.find((s) => s.startsWith('[Deliverable]'));
  if (deliverable) return `Manual — ${truncate(deliverable.replace('[Deliverable] ', ''), 120)}`;
  return `Manual — ${taskType} work outside vendor stack`;
}

/** Derive a short approach string describing how the task supports the requirement. */
function deriveApproach(task: TracedTask): string {
  const gc = task.gap_classifications || [];
  const classifications = gc.length > 0 ? gc : ['manual'];
  const actions = task.actions || [];
  const vendorRefs = task.vendor_help_refs || [];
  const whatToDo = task.what_to_do || [];
  const taskType = task.task_type || '';

  const approaches = classifications.map((cls) =>
    approachForClassification(cls, actions, vendorRefs, whatToDo, taskType),
  );
  return approaches.join(' | ');
}

export function formatTraceabilityReportAsHTML(report: TraceabilityReport): string {
  const s = report.summary;
  const domainSections = report.domains.map((d) => renderDomain(d)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CMMC Traceability Report</title>
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
th{text-align:left;padding:6px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
.rr td{padding:7px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;font-size:13px}
.rr.sat{border-left:3px solid #22c55e}
.rr.unsat{border-left:3px solid #ef4444;background:#fef2f2}
.rid{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;font-weight:600;color:#374151;white-space:nowrap}
.tr td{padding:4px 12px 4px 32px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#4b5563;background:#fafafa}
.badge{display:inline-block;padding:1px 8px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;vertical-align:middle}
.task-title{font-weight:500;color:#111827}
.approach{font-size:12px;color:#4b5563}
.meta{color:#9ca3af;font-size:11px}
.unsat-label{color:#991b1b;font-weight:600;font-size:12px}
.footer{text-align:center;font-size:11px;color:#9ca3af;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb}
@media print{
  body{background:#fff;font-size:9pt}
  .c{max-width:100%;padding:0}
  .dh{break-after:avoid}
  .dt-table{break-inside:avoid}
  th,td{padding:4px 8px}
}
</style>
</head>
<body>
<div class="c">
<h1>CMMC Traceability Report</h1>
<p class="sub">Generated ${esc(report.ces.generated_on)} &middot; ${s.total_requirements} requirements &middot; ${s.total_tasks} tasks &middot; Infrastructure: ${esc(s.infrastructure_model)}</p>
<div class="stats">
  <div class="sc" style="background:#dbeafe;color:#1e40af"><div class="v">${s.total_requirements}</div><div class="l">Requirements</div></div>
  <div class="sc" style="background:#d1fae5;color:#065f46"><div class="v">${s.satisfied}</div><div class="l">Satisfied</div></div>
  <div class="sc" style="background:#fee2e2;color:#991b1b"><div class="v">${s.unsatisfied}</div><div class="l">Unsatisfied</div></div>
  <div class="sc" style="background:#f3f4f6;color:#374151"><div class="v">${s.total_tasks}</div><div class="l">Tasks</div></div>
</div>
${domainSections}
<div class="footer">Generated by CES Mission Planning Tool on ${esc(new Date().toISOString().slice(0, 10))}</div>
</div>
</body>
</html>`;
}

function renderDomain(d: DomainGroup): string {
  const name = DOMAIN_NAMES[d.domain] || d.domain;
  const pct = d.total_count > 0 ? Math.round((d.satisfied_count / d.total_count) * 100) : 0;

  const rows = d.requirements.map((req) => {
    const cls = req.satisfied ? 'rr sat' : 'rr unsat';
    const taskRows = req.tasks.map((t) => {
      const gc = classificationBadges(t.gap_classifications);
      const pb = priorityBadge(t.priority);
      const approach = deriveApproach(t);
      return `<tr class="tr"><td>${gc} ${pb}</td><td class="task-title">${esc(t.title)}</td><td class="approach">${esc(approach)}</td><td class="meta">${t.estimated_effort_hours}h</td></tr>`;
    }).join('\n');

    const unsatLabel = !req.satisfied
      ? `<tr class="tr"><td colspan="4"><span class="unsat-label">No tasks address this requirement</span></td></tr>`
      : '';

    return `<tr class="${cls}"><td class="rid">${esc(req.requirement_id)}</td><td>${esc(req.title)}</td><td class="meta" colspan="2">${esc(req.level)}${req.nist_reference ? ' &middot; ' + esc(req.nist_reference) : ''}</td></tr>\n${taskRows}${unsatLabel}`;
  }).join('\n');

  return `
<div class="dh">
  <div><span class="dt">${esc(d.domain)} &mdash; ${esc(name)}</span><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>
  <span class="ds">${d.satisfied_count}/${d.total_count} (${pct}%)</span>
</div>
<div class="dt-table"><table>
<thead><tr><th style="width:140px">Requirement</th><th>Title</th><th>Approach</th><th style="width:60px">Effort</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

// ---------------------------------------------------------------------------
// Plain-Text Formatter (for in-app viewer panel) — same tight layout
// ---------------------------------------------------------------------------

const LINE = '\u2500'.repeat(80);
const DLINE = '\u2550'.repeat(80);

export function formatTraceabilityReportAsText(report: TraceabilityReport): string {
  const lines: string[] = [];
  const s = report.summary;

  lines.push(DLINE);
  lines.push('TRACEABILITY REPORT');
  lines.push(`Generated: ${report.ces.generated_on}`);
  lines.push(`Infrastructure: ${s.infrastructure_model}`);
  lines.push(`Requirements: ${s.total_requirements}  Satisfied: ${s.satisfied}  Unsatisfied: ${s.unsatisfied}  Tasks: ${s.total_tasks}`);
  lines.push(DLINE);
  lines.push('');

  for (const domain of report.domains) {
    const domainName = DOMAIN_NAMES[domain.domain] || domain.domain;
    lines.push(`${domain.domain} - ${domainName}  (${domain.satisfied_count}/${domain.total_count} satisfied)`);
    lines.push(LINE);

    for (const req of domain.requirements) {
      const status = req.satisfied ? '+' : '-';
      lines.push(`  [${status}] ${req.requirement_id}  ${req.title}`);

      if (!req.satisfied) {
        lines.push(`        No tasks address this requirement`);
      }

      for (const task of req.tasks) {
        const classifications = task.gap_classifications.length > 0 ? task.gap_classifications : ['manual'];
        const gcLabel = classifications
          .map((c) => (GAP_CLASS_STYLE[c]?.label || c).toUpperCase())
          .join('+');
        const pl = PRIORITY_LABELS[task.priority] || task.priority;
        const approach = deriveApproach(task);
        lines.push(`      ${gcLabel.padEnd(9)} ${pl.padEnd(8)}  ${task.title}  (${task.estimated_effort_hours}h)`);
        lines.push(`                          ${approach}`);
      }
    }
    lines.push('');
  }

  lines.push(DLINE);
  lines.push('End of Traceability Report');

  return lines.join('\n');
}
