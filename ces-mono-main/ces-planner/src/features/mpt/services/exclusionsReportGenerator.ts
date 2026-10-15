// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, RRQuestionSet } from '@/shared/types/artifacts';
import type { ArtifactMetadata } from '@/shared/types/artifacts';
import { toISODateTime } from '@/shared/utils/dateFormatter';

export interface ExcludedActivity {
  activity_id: string;
  reason: string;
  mapped_requirements: string[];
  name: string;
  description: string;
}

export interface MissingRequirement {
  requirement_id: string;
  reason: string;
  title: string;
  domain: string;
  level: string;
  requirement_text: string;
}

export interface ExclusionsReport {
  ces: ArtifactMetadata;
  summary: {
    total_in_scope: number;
    total_covered: number;
    total_excluded_activities: number;
    total_missing_requirements: number;
  };
  excluded_activities: ExcludedActivity[];
  missing_requirements: MissingRequirement[];
}

/**
 * Generate an exclusions report from the RR Question Set and CMMC requirements.
 * Lists all activities excluded during question set generation and any in-scope
 * requirements that lack question coverage.
 */
export function generateExclusionsReport(
  siBaseline: SIBaseline,
  questionSet: RRQuestionSet,
  cmmcRequirements: any,
  rrQuestionBank: any,
): ExclusionsReport {
  const reqStore: any[] = cmmcRequirements?.requirements
    || cmmcRequirements?.ces?.requirements
    || [];
  const reqMap = new Map<string, any>();
  for (const r of reqStore) {
    if (r.requirement_id) reqMap.set(r.requirement_id, r);
  }

  // Build activity lookup from the question bank
  const activityMap = new Map<string, any>();
  const bank = rrQuestionBank?.ces?.activity_bank;
  if (bank) {
    for (const act of bank.universal?.activities || []) {
      activityMap.set(act.id || act.activity_id, act);
    }
    for (const level of Object.keys(bank.level_specific || {})) {
      for (const act of bank.level_specific[level]?.activities || []) {
        activityMap.set(act.id || act.activity_id, act);
      }
    }
  }

  // Excluded activities from the question set
  const excludedRaw = questionSet.ces.selection?.excluded_activity_ids || [];
  const excludedActivities: ExcludedActivity[] = excludedRaw.map((ex) => {
    const act = activityMap.get(ex.activity_id);
    return {
      activity_id: ex.activity_id,
      reason: ex.reason,
      mapped_requirements: act?.mapped_requirements || [],
      name: act?.name || ex.activity_id,
      description: act?.advisor_description || '',
    };
  });

  // Missing requirements from the question set coverage
  const missingRaw = questionSet.ces.coverage?.requirements_missing || [];
  const missingRequirements: MissingRequirement[] = missingRaw.map((m) => {
    const req = reqMap.get(m.requirement_id);
    return {
      requirement_id: m.requirement_id,
      reason: m.reason,
      title: req?.title || m.requirement_id,
      domain: req?.domain || '',
      level: req?.level || '',
      requirement_text: req?.requirement_text || '',
    };
  });

  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  const levelHierarchy: Record<string, string[]> = {
    L1: ['L1'],
    L2: ['L1', 'L2'],
    L3: ['L1', 'L2', 'L3'],
  };
  const inScopeLevels = levelHierarchy[targetLevel] || ['L1', 'L2'];
  const totalInScope = reqStore.filter((r: any) => inScopeLevels.includes(r.level)).length;
  const totalCovered = questionSet.ces.coverage?.requirements_covered?.length || 0;

  return {
    ces: {
      artifact: 'exclusions_report',
      version: '1.0.0',
      generated_on: toISODateTime(new Date()),
      intent: `Exclusions report for CMMC ${targetLevel} assessment`,
    },
    summary: {
      total_in_scope: totalInScope,
      total_covered: totalCovered,
      total_excluded_activities: excludedActivities.length,
      total_missing_requirements: missingRequirements.length,
    },
    excluded_activities: excludedActivities,
    missing_requirements: missingRequirements,
  };
}

/**
 * Format exclusions report as human-readable text.
 */
export function formatExclusionsReportAsText(report: ExclusionsReport): string {
  const lines: string[] = [];
  const LINE = '─'.repeat(80);
  const DLINE = '═'.repeat(80);

  lines.push(DLINE);
  lines.push('EXCLUSIONS REPORT');
  lines.push(`Generated: ${report.ces.generated_on}`);
  lines.push(DLINE);
  lines.push('');

  lines.push('SUMMARY');
  lines.push(LINE);
  lines.push(`  In-scope requirements:      ${report.summary.total_in_scope}`);
  lines.push(`  Covered by questions:        ${report.summary.total_covered}`);
  lines.push(`  Excluded activities:         ${report.summary.total_excluded_activities}`);
  lines.push(`  Missing requirement coverage: ${report.summary.total_missing_requirements}`);
  lines.push('');

  if (report.excluded_activities.length > 0) {
    lines.push('EXCLUDED ACTIVITIES');
    lines.push(LINE);
    lines.push('Activities removed from the RR Question Set and the reason for exclusion.');
    lines.push('');
    for (const ea of report.excluded_activities) {
      lines.push(`  ${ea.activity_id}`);
      lines.push(`    Name:         ${ea.name}`);
      if (ea.description) lines.push(`    Description:  ${ea.description}`);
      lines.push(`    Reason:       ${ea.reason}`);
      if (ea.mapped_requirements.length > 0) {
        lines.push(`    Requirements: ${ea.mapped_requirements.join(', ')}`);
      }
      lines.push('');
    }
  } else {
    lines.push('EXCLUDED ACTIVITIES');
    lines.push(LINE);
    lines.push('  None — all activities were included in the question set.');
    lines.push('');
  }

  if (report.missing_requirements.length > 0) {
    lines.push('MISSING REQUIREMENT COVERAGE');
    lines.push(LINE);
    lines.push('In-scope requirements with no question coverage in the RR Question Set.');
    lines.push('');
    for (const mr of report.missing_requirements) {
      lines.push(`  ${mr.requirement_id} — ${mr.title}`);
      lines.push(`    Domain: ${mr.domain}  Level: ${mr.level}`);
      if (mr.requirement_text) lines.push(`    Text:   ${mr.requirement_text}`);
      lines.push(`    Reason: ${mr.reason}`);
      lines.push('');
    }
  } else {
    lines.push('MISSING REQUIREMENT COVERAGE');
    lines.push(LINE);
    lines.push('  None — all in-scope requirements are covered by the question set.');
    lines.push('');
  }

  lines.push(DLINE);
  lines.push('End of Exclusions Report');

  return lines.join('\n');
}
