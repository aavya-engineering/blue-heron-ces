// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '@/shared/types/artifacts';
import type { TaskCatalog, Task, ActionEngine, StepAction, GapClassification } from '../types';
import { orderByDependencies } from './planHelpers';

// ---------------------------------------------------------------------------
// Shared step builder — superset of manual + exec step data
// ---------------------------------------------------------------------------
export interface SharedStep {
  id: string;
  title: string;
  task_type: string;
  priority: string;
  control_coverage: any[];
  actions: StepAction[];
  what_to_do: string[];
  how_to_verify: string[];
  vendor_help_refs: any[];
  expected_artifacts: any[];
  owner_role: string;
  estimated_effort_hours: number;
  effort_estimate: any;
  dependencies: string[];
  gap_classifications: GapClassification[];
  requirement_context: {
    title: string;
    requirement_text: string;
    domain: string;
    level: string;
    nist_reference: string;
  };
  tech_ref?: Task['tech_ref'];
  // Manual plan only
  manual_completion_criteria: string[];
  // Exec plan only (rendered in Markdown)
  execution: {
    engine: ActionEngine;
    command: string;
    args: Record<string, unknown>;
    idempotency: 'safe' | 'best_effort' | 'unsafe_requires_gate';
    rollback: { strategy: 'none' | 'reverse_task' | 'restore_snapshot' | 'manual' };
  };
}

export function deriveSharedSteps(taskCatalog: TaskCatalog): SharedStep[] {
  const tasks = orderByDependencies(taskCatalog.tasks);
  return tasks.map((t) => ({
    id: `step_${t.task_id}`,
    title: t.title,
    task_type: t.task_type,
    priority: t.priority,
    control_coverage: t.control_coverage,
    actions: t.actions || [],
    what_to_do: t.what_to_do,
    how_to_verify: t.how_to_verify,
    vendor_help_refs: t.vendor_help_refs,
    expected_artifacts: t.expected_artifacts,
    owner_role: t.owner_role,
    estimated_effort_hours: t.estimated_effort_hours,
    effort_estimate: t.effort_estimate,
    dependencies: t.dependencies.map((d) => `step_${d}`),
    gap_classifications: t.gap_classifications,
    requirement_context: {
      title: t.requirement_title,
      requirement_text: t.requirement_text,
      domain: t.domain,
      level: t.level,
      nist_reference: t.nist_reference,
    },
    tech_ref: t.tech_ref,
    manual_completion_criteria: deriveCompletionCriteria(t),
    execution: {
      engine: t.impl_engine || chooseEngine(t),
      command: t.impl_command || deriveCommand(t),
      args: t.impl_args || { requirement_id: t.requirement_id },
      idempotency: deriveIdempotency(t),
      rollback: { strategy: deriveRollbackStrategy(t) },
    },
  }));
}

function deriveCompletionCriteria(task: Task): string[] {
  const criteria: string[] = [];

  // --- Implementation actions: break down by action type & name services ---
  const actions = task.actions || [];
  if (actions.length > 0) {
    const byType = new Map<string, number>();
    const services = new Set<string>();
    for (const a of actions) {
      byType.set(a.action_type, (byType.get(a.action_type) || 0) + 1);
      if (a.vendor?.m365_service) services.add(a.vendor.m365_service);
    }
    const typeSummary = Array.from(byType.entries())
      .map(([t, n]) => `${n} ${t}`)
      .join(', ');
    criteria.push(`Complete all implementation actions (${typeSummary})`);
    if (services.size > 0) {
      criteria.push(`Verify configuration in: ${Array.from(services).join(', ')}`);
    }
  }

  // --- What-to-do: categorize and summarize per bucket ---
  const wtd = task.what_to_do || [];
  if (wtd.length > 0) {
    let implCount = 0;
    let cmmcCount = 0;
    let deliverableCount = 0;
    let evidenceCount = 0;
    let tcpCount = 0;
    let bucket: 'impl' | 'cmmc' | 'deliverable' | 'evidence' | 'tcp' = 'impl';
    for (const s of wtd) {
      if (s.startsWith('[TCP Context]') || s.startsWith('[TCP Verification]')) {
        bucket = 'tcp';
        tcpCount++;
      } else if (s.startsWith('[Automated Evidence Collection]') || s.startsWith('[Evidence Collection') || s.startsWith('[Evidence]')) {
        bucket = 'evidence';
        evidenceCount++;
      } else if (s.startsWith('[CMMC Guidance]') || s.startsWith('[Assessment Design]') || s.startsWith('[Common Pitfall]')) {
        bucket = 'cmmc';
        cmmcCount++;
      } else if (s.startsWith('[Deliverable]')) {
        bucket = 'deliverable';
        deliverableCount++;
      } else if (s.startsWith('  ') && (bucket === 'evidence' || bucket === 'deliverable')) {
        // continuation lines — don't count as new items
      } else {
        bucket = 'impl';
        implCount++;
      }
    }
    if (tcpCount > 0) criteria.push(`Apply ${tcpCount} tenant configuration parameter(s)`);
    if (implCount > 0) criteria.push(`Follow ${implCount} implementation guidance step(s)`);
    if (deliverableCount > 0) criteria.push(`Produce ${deliverableCount} deliverable document(s)`);
    if (cmmcCount > 0) criteria.push(`Address ${cmmcCount} CMMC compliance guidance item(s)`);
    if (evidenceCount > 0) criteria.push(`Set up ${evidenceCount} evidence collection workflow(s)`);
  }

  // --- Verification: summarize by assessor method keywords ---
  const verify = task.how_to_verify || [];
  if (verify.length > 0) {
    let examineCount = 0;
    let interviewCount = 0;
    let testCount = 0;
    let tcpVerifyCount = 0;
    for (const v of verify) {
      if (v.startsWith('[TCP Verification]')) {
        tcpVerifyCount++;
        continue;
      }
      const lower = v.toLowerCase();
      if (lower.includes('examine') || lower.includes('review') || lower.includes('documentation') || lower.includes('inspect')) examineCount++;
      if (lower.includes('interview') || lower.includes('personnel') || lower.includes('confirm with')) interviewCount++;
      if (lower.includes('test') || lower.includes('demonstrate') || lower.includes('validate') || lower.includes('verify')) testCount++;
    }
    const baseCount = verify.length - tcpVerifyCount;
    const methods: string[] = [];
    if (examineCount > 0) methods.push(`${examineCount} examine`);
    if (interviewCount > 0) methods.push(`${interviewCount} interview`);
    if (testCount > 0) methods.push(`${testCount} test`);
    if (baseCount > 0) {
      if (methods.length > 0) {
        criteria.push(`Pass all ${baseCount} verification check(s) (${methods.join(', ')})`);
      } else {
        criteria.push(`Pass all ${baseCount} verification check(s)`);
      }
    }
    if (tcpVerifyCount > 0) {
      criteria.push(`Confirm ${tcpVerifyCount} tenant configuration verification(s)`);
    }
  }

  // --- Evidence: list distinct artifact types with retention ---
  const artifacts = task.expected_artifacts || [];
  if (artifacts.length > 0) {
    const byType = new Map<string, number>();
    let maxRetention = 0;
    for (const a of artifacts) {
      const label = (a.artifact_type || 'other').replace(/_/g, ' ');
      byType.set(label, (byType.get(label) || 0) + 1);
      if (a.retention_days > maxRetention) maxRetention = a.retention_days;
    }
    const typeSummary = Array.from(byType.entries())
      .map(([t, n]) => n > 1 ? `${n} ${t}` : t)
      .join(', ');
    criteria.push(`Collect and store evidence: ${typeSummary} (retain ${maxRetention} days)`);
  }

  return criteria;
}

// ---------------------------------------------------------------------------
// Execution metadata helpers (shared for exec plan)
// ---------------------------------------------------------------------------
export function chooseEngine(task: Task): ActionEngine {
  const psCommands = (task.impl_args as Record<string, unknown>)?.powershell_commands;
  if (Array.isArray(psCommands) && psCommands.length > 0) {
    return 'powershell';
  }

  switch (task.task_type) {
    case 'configuration':
      return 'terraform';
    case 'monitoring':
      return 'powershell';
    case 'assessment':
      return 'cli';
    case 'evidence_collection':
      return 'powershell';
    case 'process':
      return 'api';
    case 'policy':
    case 'training':
      return 'manual_gate';
    default:
      return 'manual_gate';
  }
}

export function deriveCommand(task: Task): string {
  const psCommands = (task.impl_args as Record<string, unknown>)?.powershell_commands;
  if (Array.isArray(psCommands) && psCommands.length > 0) {
    const actionCmd = psCommands.find(
      (c: string) => !c.startsWith('Connect-') && !c.startsWith('#'),
    );
    if (actionCmd) return actionCmd;
  }

  switch (task.task_type) {
    case 'configuration':
      return `configure_${task.requirement_id}`;
    case 'policy':
      return `generate_policy_${task.requirement_id}`;
    case 'process':
      return `implement_process_${task.requirement_id}`;
    case 'monitoring':
      return `deploy_monitoring_${task.requirement_id}`;
    case 'assessment':
      return `verify_${task.requirement_id}`;
    case 'evidence_collection':
      return `collect_evidence_${task.requirement_id}`;
    case 'training':
      return `deliver_training_${task.requirement_id}`;
    default:
      return `execute_${task.requirement_id}`;
  }
}

export function deriveIdempotency(task: Task): 'safe' | 'best_effort' | 'unsafe_requires_gate' {
  if (task.task_type === 'policy' || task.task_type === 'training' || task.task_type === 'assessment') return 'safe';
  return 'best_effort';
}

export function deriveRollbackStrategy(task: Task): 'none' | 'reverse_task' | 'restore_snapshot' | 'manual' {
  if (task.task_type === 'policy' || task.task_type === 'training' || task.task_type === 'assessment') return 'none';
  if (task.task_type === 'configuration') return 'reverse_task';
  if (task.task_type === 'evidence_collection') return 'none';
  return 'manual';
}

// ---------------------------------------------------------------------------
// Executable plan metadata helpers
// ---------------------------------------------------------------------------
export function buildVariables(siBaseline: SIBaseline): Record<string, unknown> {
  const siData = siBaseline.si_baseline as Record<string, any>;
  const ts: any = siData?.technology_stack || {};
  return {
    target_level: siBaseline.si_baseline?.target?.target_cmmc_level || 'L2',
    organization: (siBaseline.si_baseline?.target as Record<string, any>)?.organization_name || 'organization',
    cloud_provider: ts.cloud_provider || 'unknown',
    identity_provider: ts.identity_provider || 'unknown',
    region: ts.region || 'us-east-1',
  };
}

export function buildPlanPrechecks(): any[] {
  return [
    {
      id: 'pre-001',
      description: 'Verify connectivity to target environment',
      method: 'api_query',
      expected: 'All target systems reachable',
      on_fail: 'Abort execution and notify operator',
    },
    {
      id: 'pre-002',
      description: 'Verify operator permissions are sufficient',
      method: 'api_query',
      expected: 'Operator has required administrative permissions',
      on_fail: 'Request permission escalation before proceeding',
    },
  ];
}

export function buildPlanPostchecks(taskCatalog: TaskCatalog): any[] {
  return [
    {
      id: 'post-001',
      description: 'Verify all tasks completed successfully',
      method: 'api_query',
      expected: `All ${taskCatalog.tasks.length} tasks report success`,
      on_fail: 'Generate failure report and flag incomplete tasks',
    },
    {
      id: 'post-002',
      description: 'Verify evidence artifacts collected',
      method: 'config_export',
      expected: 'All expected evidence artifacts present in evidence store',
      on_fail: 'Flag missing evidence for manual collection',
    },
  ];
}
