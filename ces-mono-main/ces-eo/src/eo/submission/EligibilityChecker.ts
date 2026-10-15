// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Submission Eligibility Checker.
 * Validates whether an SSP submission package meets CMMC L2 requirements.
 * Advisory only -- the Affirming Official is the final authority (Decision 5).
 */

import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import type { DirectivePlanOfActionMilestones } from '../poam/DirectivePoamGenerator.js';

export interface EligibilityReport {
  eligible: boolean;
  score: number;
  blockingIssues: string[];
  warnings: string[];
  poam_summary: {
    total_not_met: number;
    eligible_count: number;
    blocking_count: number;
  };
}

export class EligibilityChecker {

  /**
   * Check submission eligibility based on SPRS score, POA&M status,
   * and directive data completeness.
   */
  checkEligibility(
    ssp: SystemSecurityPlan,
    score: number,
    poamList?: DirectivePlanOfActionMilestones,
    controlsWithoutDirectives?: number
  ): EligibilityReport {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    // Check 1: Score threshold
    if (score >= 110) {
      // Perfect score — eligible
    } else if (score >= 88) {
      warnings.push(`Score at conditional threshold (${score}/110). POA&M items must be eligible.`);
    } else {
      blockingIssues.push(`SPRS score ${score} below conditional threshold of 88`);
    }

    // Check 2: POA&M eligibility
    let totalNotMet = 0;
    let eligibleCount = 0;
    let blockingCount = 0;

    if (poamList) {
      blockingCount = poamList.blocking_items.length;
      eligibleCount = poamList.eligible_items.length;
      totalNotMet = poamList.total_items;

      if (blockingCount > 0) {
        const blockingIds = poamList.blocking_items.map(i => i.control_id).join(', ');
        blockingIssues.push(
          `${blockingCount} NOT MET control(s) not eligible for POA&M per 32 CFR 170.21: ${blockingIds}`
        );
      }
    }

    // Check 3: Directive data completeness
    if (controlsWithoutDirectives && controlsWithoutDirectives > 0) {
      blockingIssues.push(
        `Cannot determine SPRS value for ${controlsWithoutDirectives} controls due to missing directive metadata`
      );
    }

    const eligible = blockingIssues.length === 0;

    return {
      eligible,
      score,
      blockingIssues,
      warnings,
      poam_summary: {
        total_not_met: totalNotMet,
        eligible_count: eligibleCount,
        blocking_count: blockingCount,
      },
    };
  }

  /**
   * Generate a human-readable report for AO review when submission is blocked.
   */
  generateSubmissionBlockedReport(report: EligibilityReport): string {
    const lines: string[] = [
      '=== SUBMISSION ELIGIBILITY REPORT ===',
      '',
      `Score: ${report.score}/110`,
      `Eligible: ${report.eligible ? 'YES' : 'NO'}`,
      '',
    ];

    if (report.blockingIssues.length > 0) {
      lines.push('BLOCKING ISSUES:');
      for (const issue of report.blockingIssues) {
        lines.push(`  - ${issue}`);
      }
      lines.push('');
    }

    if (report.warnings.length > 0) {
      lines.push('WARNINGS:');
      for (const warning of report.warnings) {
        lines.push(`  - ${warning}`);
      }
      lines.push('');
    }

    lines.push('POA&M SUMMARY:');
    lines.push(`  Total NOT MET: ${report.poam_summary.total_not_met}`);
    lines.push(`  Eligible for POA&M: ${report.poam_summary.eligible_count}`);
    lines.push(`  Blocking (ineligible): ${report.poam_summary.blocking_count}`);
    lines.push('');

    if (!report.eligible) {
      lines.push('REMEDIATION GUIDANCE:');
      lines.push('  Close blocking controls or escalate non-eligibility determination.');
      lines.push('  The Affirming Official may override this determination at their discretion.');
    }

    return lines.join('\n');
  }
}
