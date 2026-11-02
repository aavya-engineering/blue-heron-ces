// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline } from '../../shared/types/artifacts';
import type { TaskCatalog } from '../types';
import { addDays, daysBetween } from './planHelpers';

// ---------------------------------------------------------------------------
// Derive total elapsed days from SI timing goal
// ---------------------------------------------------------------------------

export function deriveTotalDays(siBaseline: SIBaseline | undefined, today: string): number {
  let totalDays = 90; // default
  const timing = (siBaseline?.si_baseline?.assessment as Record<string, any>)
    ?.certification_timing_goal;
  if (timing) {
    if (timing.goal_type === 'by_date' && timing.by_date) {
      totalDays = daysBetween(today, timing.by_date);
    } else if (timing.goal_type === 'within_days' && typeof timing.within_days === 'number') {
      totalDays = timing.within_days;
    } else if (timing.goal_type === 'asap') {
      totalDays = 60;
    }
  }
  if (totalDays < 30) totalDays = 30; // minimum 30 days
  return totalDays;
}

// ---------------------------------------------------------------------------
// Milestones (shared by Manual Plan & Exec Plan)
// ---------------------------------------------------------------------------

export function deriveMilestones(
  taskCatalog: TaskCatalog,
  today: string,
  siBaseline?: SIBaseline,
): any[] {
  const tasks = taskCatalog.tasks;
  if (tasks.length === 0) {
    return [
      {
        id: 'MS-1',
        name: 'Assessment Preparation',
        objective: 'Prepare for CMMC assessment',
        exit_criteria: ['All preparation activities complete'],
        target_date: addDays(today, 90),
      },
    ];
  }

  const totalDays = deriveTotalDays(siBaseline, today);

  const implDays = Math.round(totalDays * 0.7);
  const readinessDays = totalDays - 14;

  // --- Detect phasing need ---
  const budgetText = (
    siBaseline?.si_baseline?.dependencies as Record<string, any>
  )?.budget_constraints;
  const budgetHint =
    typeof budgetText === 'string'
      ? budgetText.toLowerCase()
      : '';
  const budgetTriggered =
    budgetHint.includes('phased') ||
    budgetHint.includes('limited') ||
    budgetHint.includes('budget');

  const p2p3Count = tasks.filter((t) => t.priority === 'p2' || t.priority === 'p3').length;
  const taskRatioTriggered = tasks.length > 0 && p2p3Count / tasks.length > 0.3;
  const usePhasing = budgetTriggered || taskRatioTriggered;

  // Count by classification for exit criteria detail
  let configureCount = 0;
  let customizeCount = 0;
  let manualCount = 0;
  for (const t of tasks) {
    const gc = t.gap_classifications || [];
    if (gc.includes('configure')) configureCount++;
    if (gc.includes('customize')) customizeCount++;
    if (gc.includes('manual') || gc.length === 0) manualCount++;
  }

  const milestones: any[] = [];

  if (usePhasing) {
    // --- Phased milestones ---
    const p0p1Tasks = tasks.filter((t) => t.priority === 'p0' || t.priority === 'p1');
    const p2Tasks = tasks.filter((t) => t.priority === 'p2');
    const p3Tasks = tasks.filter((t) => t.priority === 'p3');

    const halfImpl = Math.round(implDays * 0.5);

    if (p0p1Tasks.length > 0) {
      milestones.push({
        id: 'MS-1',
        name: 'Phase 1 — Critical & High Priority',
        objective: 'Implement all critical (p0) and high-priority (p1) compliance controls',
        exit_criteria: [
          `${p0p1Tasks.length} critical/high tasks completed`,
          'Vendor stack settings verified for priority controls',
          'Evidence artifacts collected for priority controls',
        ],
        target_date: addDays(today, halfImpl),
        phase_tasks: p0p1Tasks.map((t) => t.task_id),
      });
    }

    if (p2Tasks.length > 0) {
      milestones.push({
        id: `MS-${milestones.length + 1}`,
        name: 'Phase 2 — Medium Priority',
        objective: 'Implement medium-priority (p2) compliance controls',
        exit_criteria: [
          `${p2Tasks.length} medium-priority tasks completed`,
          'Evidence artifacts collected for medium-priority controls',
        ],
        target_date: addDays(today, implDays),
        phase_tasks: p2Tasks.map((t) => t.task_id),
      });
    }

    if (p3Tasks.length > 0) {
      milestones.push({
        id: `MS-${milestones.length + 1}`,
        name: 'Phase 3 — Lower Priority',
        objective: 'Implement lower-priority (p3) compliance controls',
        exit_criteria: [
          `${p3Tasks.length} lower-priority tasks completed`,
          'Evidence artifacts collected for remaining controls',
        ],
        target_date: addDays(today, readinessDays),
        phase_tasks: p3Tasks.map((t) => t.task_id),
      });
    }

    // Assessment readiness milestone
    milestones.push({
      id: `MS-${milestones.length + 1}`,
      name: 'Assessment Readiness Verification',
      objective: 'Verify all controls implemented and evidence collected',
      exit_criteria: [
        'All evidence artifacts verified',
        'Cross-control validation passed',
        'Assessment readiness confirmed',
      ],
      target_date: addDays(today, totalDays),
    });
  } else {
    // --- Non-phased: single implementation + readiness milestones ---
    const breakdownParts: string[] = [];
    if (configureCount > 0) breakdownParts.push(`${configureCount} configure`);
    if (customizeCount > 0) breakdownParts.push(`${customizeCount} customize`);
    if (manualCount > 0) breakdownParts.push(`${manualCount} manual`);

    milestones.push({
      id: 'MS-1',
      name: 'Implementation',
      objective: 'Configure, customize, and implement all compliance controls',
      exit_criteria: [
        `All ${tasks.length} tasks completed (${breakdownParts.join(', ')})`,
        'Vendor stack settings verified against requirements',
        'Evidence artifacts collected for all controls',
      ],
      target_date: addDays(today, implDays),
    });

    // Assessment readiness milestone
    milestones.push({
      id: 'MS-2',
      name: 'Assessment Readiness Verification',
      objective: 'Verify all controls implemented and evidence collected',
      exit_criteria: [
        'All evidence artifacts verified',
        'Cross-control validation passed',
        'Assessment readiness confirmed',
      ],
      target_date: addDays(today, totalDays),
    });
  }

  return milestones;
}

// ---------------------------------------------------------------------------
// Map steps → milestones: all steps belong to the implementation milestone
// ---------------------------------------------------------------------------
export function stepsForMilestone(
  milestone: any,
  steps: any[],
  _taskCatalog: TaskCatalog,
): any[] {
  // Phased milestones: filter steps to matching phase_tasks
  if (milestone.phase_tasks && Array.isArray(milestone.phase_tasks)) {
    const phaseTaskIds = new Set<string>(milestone.phase_tasks);
    return steps.filter((s: any) => {
      // step id is `step_{task_id}` — extract the task_id portion
      const taskId = (s.id as string)?.replace(/^step_/, '');
      return phaseTaskIds.has(taskId);
    });
  }
  // Non-phased: MS-1 (Implementation) gets all steps; others get none
  if (milestone.id === 'MS-1') return steps;
  return [];
}
