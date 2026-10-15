// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * The six canonical action types from domain implementation patterns,
 * plus evidence_collection for evidence-gathering work.
 */
export type CanonicalTaskType =
  | 'policy'
  | 'configuration'
  | 'process'
  | 'monitoring'
  | 'training'
  | 'assessment'
  | 'evidence_collection';

export const CANONICAL_TASK_TYPES: CanonicalTaskType[] = [
  'policy',
  'configuration',
  'process',
  'monitoring',
  'training',
  'assessment',
  'evidence_collection',
];

/** Human-readable labels for each canonical task type. */
export const TASK_TYPE_LABELS: Record<CanonicalTaskType, string> = {
  policy: 'Policy',
  configuration: 'Configuration',
  process: 'Process',
  monitoring: 'Monitoring',
  training: 'Training',
  assessment: 'Assessment',
  evidence_collection: 'Evidence Collection',
};

/**
 * One row in the LOE rate table — the five effort-estimate columns that
 * map 1-to-1 with the EffortEstimate interface on every generated task.
 */
export interface TaskLoeRow {
  one_time_dev_loe: number;            // hours — automation tooling build-out
  one_time_config_manual: number;      // hours — manual implementation
  one_time_config_automated: number;   // hours — implementation with automation
  recurring_evidence_manual: number;   // hours/year — manual evidence maintenance
  recurring_evidence_automated: number; // hours/year — automated evidence maintenance
}

/** Column keys in display order. */
export const LOE_COLUMNS: Array<{
  key: keyof TaskLoeRow;
  heading: string;
  tooltip: string;
}> = [
  {
    key: 'one_time_dev_loe',
    heading: 'Dev LOE (h)',
    tooltip: 'One-time hours to build automation tooling — scripts, monitors, pipelines',
  },
  {
    key: 'one_time_config_manual',
    heading: 'Manual (h)',
    tooltip: 'One-time hours to implement the control entirely by hand, no automation',
  },
  {
    key: 'one_time_config_automated',
    heading: 'Automated (h)',
    tooltip: 'One-time hours to implement with automation assist — scripts, templates',
  },
  {
    key: 'recurring_evidence_manual',
    heading: 'Recur Manual (h/yr)',
    tooltip: 'Annual hours to collect and maintain evidence manually — reviews, collection cycles',
  },
  {
    key: 'recurring_evidence_automated',
    heading: 'Recur Auto (h/yr)',
    tooltip: 'Annual hours to collect and maintain evidence with automated pipelines',
  },
];

/**
 * Full LOE rate configuration — a rate card persisted to localStorage.
 *
 * Rows   = canonical task types (implementation + evidence collection)
 * Cols   = 5 effort estimates per row
 * Extras = severity multipliers (scale one-time config hours) + labor rate
 */
export interface LoeRateConfig {
  taskRates: Record<CanonicalTaskType, TaskLoeRow>;
  severityMultipliers: { HIGH: number; MEDIUM: number; LOW: number };
  laborRatePerHour: number;
  orgSizeMultiplier?: number;
}

// ---------------------------------------------------------------------------
// Default estimates — initial rate card for CMMC compliance engagements
// ---------------------------------------------------------------------------
export const DEFAULT_LOE_RATES: LoeRateConfig = {
  taskRates: {
    // Implementation task types (from domain implementation patterns)
    policy: {
      one_time_dev_loe: 2,       // template tooling
      one_time_config_manual: 16, // draft, review, approval cycle
      one_time_config_automated: 12, // template-assisted, still needs review
      recurring_evidence_manual: 6,  // annual review and revision
      recurring_evidence_automated: 4, // template-assisted annual review
    },
    configuration: {
      one_time_dev_loe: 6,       // PowerShell / IaC script development
      one_time_config_manual: 24, // hands-on technical setup and validation
      one_time_config_automated: 4, // script execution + spot-check
      recurring_evidence_manual: 8,  // quarterly config reviews, drift checks
      recurring_evidence_automated: 2, // automated config audits
    },
    process: {
      one_time_dev_loe: 2,       // workflow automation setup
      one_time_config_manual: 16, // design, document, pilot, align stakeholders
      one_time_config_automated: 12, // partially automatable, human design
      recurring_evidence_manual: 6,  // process reviews and updates
      recurring_evidence_automated: 4, // automated tracking + review
    },
    monitoring: {
      one_time_dev_loe: 6,       // dashboard / alert rule engineering
      one_time_config_manual: 20, // tool deployment, baseline, tuning
      one_time_config_automated: 5, // template-based deployment
      recurring_evidence_manual: 12, // alert review, tuning, false-positive mgmt
      recurring_evidence_automated: 3, // automated health checks
    },
    training: {
      one_time_dev_loe: 0,       // no automation dev needed
      one_time_config_manual: 8,  // content development + delivery
      one_time_config_automated: 6, // LMS-assisted delivery
      recurring_evidence_manual: 4,  // annual refresh, new-hire onboarding
      recurring_evidence_automated: 3, // LMS-tracked compliance
    },
    assessment: {
      one_time_dev_loe: 2,       // scan tool configuration
      one_time_config_manual: 12, // conduct assessment, analyze, document
      one_time_config_automated: 8, // automated scan + manual analysis
      recurring_evidence_manual: 8,  // periodic assessments (quarterly/annual)
      recurring_evidence_automated: 4, // automated recurring scans
    },
    // Evidence-gathering work
    evidence_collection: {
      one_time_dev_loe: 6,       // evidence monitor / pipeline development
      one_time_config_manual: 12, // initial evidence inventory + collection
      one_time_config_automated: 3, // automated collection pipeline setup
      recurring_evidence_manual: 8,  // regular collection cycles
      recurring_evidence_automated: 2, // automated pipeline maintenance
    },
  },
  severityMultipliers: { HIGH: 1.5, MEDIUM: 1.0, LOW: 0.7 },
  laborRatePerHour: 200,
};
