// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, ReadinessPosture } from '@/shared/types/artifacts';
import type { TaskCatalog, Task } from '../types';
import { generateId } from '@/shared/utils/idGenerator';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function daysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr);
  const end = new Date(endStr);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Topological sort by task dependencies
// ---------------------------------------------------------------------------
export function orderByDependencies(tasks: Task[]): Task[] {
  const result: Task[] = [];
  const remaining = [...tasks];
  const resolved = new Set<string>();

  let safety = remaining.length * 2;
  while (remaining.length > 0 && safety-- > 0) {
    const idx = remaining.findIndex(
      (t) => t.dependencies.length === 0 || t.dependencies.every((d) => resolved.has(d)),
    );
    if (idx === -1) {
      result.push(...remaining);
      break;
    }
    const task = remaining.splice(idx, 1)[0];
    resolved.add(task.task_id);
    result.push(task);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Inputs block (shared by Manual Plan & Exec Plan schemas)
// ---------------------------------------------------------------------------
export function buildInputsBlock(
  siBaseline: SIBaseline,
  readinessPosture: ReadinessPosture,
  assessorKB: any,
  vendorCaps: any,
  targetLevel: string,
  today: string,
): Record<string, unknown> {
  const summary = readinessPosture.ces?.control_status_summary || {
    met: 0,
    partial: 0,
    not_met: 0,
    unknown: 0,
  };

  const keyFindings = deriveKeyFindings(readinessPosture);
  const deps: any = siBaseline.si_baseline?.dependencies || {};
  const constraints = {
    time: deps.schedule_constraints || 'Standard engagement timeline',
    budget: deps.budget_constraints || 'To be determined',
    tooling: extractTooling(siBaseline),
    staffing: deps.staffing_constraints || 'Dedicated compliance team assumed',
  };

  return {
    si_baseline: siBaseline,
    readiness_posture: {
      snapshot_id: readinessPosture.ces?.snapshot_id || generateId('snap'),
      as_of_date: today,
      control_status_summary: {
        level: targetLevel,
        met: summary.met || 0,
        partial: summary.partial || 0,
        not_met: summary.not_met || 0,
        unknown: summary.unknown || 0,
      },
      key_findings:
        keyFindings.length > 0
          ? keyFindings
          : [
              {
                id: generateId('find'),
                control_id: 'general',
                title: 'Initial assessment findings pending',
                status: 'UNKNOWN',
                severity: 'medium',
                evidence_gaps: [],
                root_cause_hypothesis: '',
                recommended_actions: ['Complete detailed assessment'],
              },
            ],
      constraints,
    },
    authoritative_sources: {
      government: [
        { id: 'cmmc-r2', title: 'CMMC Model v2.0', type: 'government', version: '2.0' },
        { id: '32-cfr-170', title: '32 CFR Part 170 — CMMC Program', type: 'government' },
      ],
      nist: [
        { id: 'sp800-171r2', title: 'NIST SP 800-171 Rev 2', type: 'nist', version: 'Rev 2' },
        { id: 'sp800-171a', title: 'NIST SP 800-171A', type: 'nist' },
      ],
    },
    vendor_capability_packages: extractVendorPackages(vendorCaps, siBaseline),
    assessor_knowledge: {
      assessor_approach_ref: assessorKB?.ces?.approach_ref || 'assessor_approach_v1',
      assessor_evidence_matrix_ref: assessorKB?.ces?.evidence_matrix_ref || 'evidence_matrix_v1',
      design_for_assessment_rules: extractDFARules(assessorKB),
    },
  };
}

function deriveKeyFindings(readinessPosture: ReadinessPosture): any[] {
  const results: any[] = readinessPosture.ces?.requirement_results || [];
  return results
    .filter((rr: any) => rr.status === 'not_met' || rr.status === 'partial')
    .map((rr: any) => ({
      id: generateId('find'),
      control_id: rr.requirement_id,
      title: `${rr.requirement_id}: ${rr.status === 'not_met' ? 'Not Met' : 'Partially Met'}`,
      status: rr.status === 'not_met' ? 'NOT_MET' : 'PARTIAL',
      severity: rr.status === 'not_met' ? 'high' : 'medium',
      evidence_gaps: (rr as any).missing_evidence || [],
      root_cause_hypothesis: '',
      recommended_actions: [rr.notes || `Address ${rr.requirement_id} compliance gap`],
    }));
}

function extractTooling(siBaseline: SIBaseline): string[] {
  const siData = siBaseline.si_baseline as Record<string, any>;
  const ts = siData?.technology_stack;
  if (!ts) return ['To be determined'];
  const tools: string[] = [];
  if (ts.cloud_provider) tools.push(ts.cloud_provider);
  if (ts.identity_provider) tools.push(ts.identity_provider);
  if (ts.endpoint_protection) tools.push(ts.endpoint_protection);
  return tools.length > 0 ? tools : ['To be determined'];
}

function extractVendorPackages(vendorCaps: any, siBaseline: SIBaseline): any[] {
  const pkgs: any[] = vendorCaps?.ces?.packages || vendorCaps?.packages || [];
  if (pkgs.length > 0) {
    return pkgs.map((p: any, i: number) => ({
      tech_stack_id: p.tech_stack_id || i + 1,
      name: p.name || 'Vendor Package',
      vendor: p.vendor || 'Unknown',
      fedramp_level: p.fedramp_level || 'Moderate',
      package_ref: p.package_ref || p.id || `vendor_package_${i + 1}`,
    }));
  }
  const siData = siBaseline.si_baseline as Record<string, any>;
  return [
    {
      tech_stack_id: 1,
      name: siData?.technology_stack?.cloud_provider || 'Primary Tech Stack',
      vendor: siData?.technology_stack?.cloud_provider || 'Unknown',
      fedramp_level: 'Moderate',
      package_ref: 'vendor_caps_v1',
    },
  ];
}

function extractDFARules(assessorKB: any): any[] {
  const rules: any[] =
    assessorKB?.ces?.design_for_assessment_rules || assessorKB?.design_for_assessment_rules || [];
  if (rules.length > 0) {
    return rules.map((r: any) => ({
      id: r.id,
      title: r.title,
      rule: r.rule,
      verification: r.verification,
      assessor_method_alignment: r.assessor_method_alignment || ['examine'],
      sources: r.sources || ['NIST SP 800-171A'],
    }));
  }
  return [
    {
      id: 'dfa-001',
      title: 'Evidence must align with assessor methods',
      rule: 'All controls must have evidence supporting examine, interview, and test methods as applicable',
      verification:
        'Cross-reference evidence artifacts against NIST SP 800-171A assessment objectives',
      assessor_method_alignment: ['examine', 'interview', 'test'],
      sources: ['NIST SP 800-171A'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Assessor alignment notes
// ---------------------------------------------------------------------------
export function deriveAssessorNotes(assessorKB: any, _taskCatalog: TaskCatalog): string[] {
  const dfaRules: any[] =
    assessorKB?.ces?.design_for_assessment_rules || assessorKB?.design_for_assessment_rules || [];
  const notes = dfaRules.slice(0, 5).map((r: any) => `DFA Rule ${r.id}: ${r.title} — ${r.rule}`);
  if (notes.length === 0) {
    notes.push(
      'Evidence artifacts designed to satisfy examine, interview, and test methods per NIST SP 800-171A',
    );
    notes.push(
      'All controls mapped to specific vendor capabilities with traceable implementation paths',
    );
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Barrel re-exports from split modules
// ---------------------------------------------------------------------------
export { deriveTotalDays, deriveMilestones, stepsForMilestone } from './milestoneCompiler';
export { buildInlineCostProposal, buildInlineTenantManifest } from './inlineCostBuilder';
export { type SharedStep, deriveSharedSteps } from './sharedStepCompiler';
